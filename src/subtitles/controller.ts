import { SUBTITLE_MAX_FILE_BYTES } from '../shared/constants';
import { AppError, normalizeError } from '../shared/errors';
import type {
  AppErrorShape,
  PublicSettings,
  SubtitleCue,
  SubtitleDisplayMode,
  SubtitleSourceKind,
  SubtitleState,
  SubtitleStylePrefs,
  TrackInfo,
  VideoInfo,
} from '../shared/types';
import { bytesOfString, createId } from '../shared/utils';
import { AudioChunker, type AudioChunk } from '../asr/audio-chunker';
import { describeAudioCapability } from '../asr/types';
import { findActiveCues } from './timeline';
import {
  captureTrackModes,
  listNativeTracks,
  readNativeTrack,
  restoreNativeTrackModes,
  type NativeTrackDescriptor,
} from './native';
import { parseSubtitles } from './parser';
import { countSubtitleProgress, groupCuesForTranslation } from './translator';

export interface SubtitleOverlayCue {
  key: string;
  original: string;
  translation?: string;
}

export interface SubtitleOverlayData {
  enabled: boolean;
  cues: SubtitleOverlayCue[];
  mode: SubtitleDisplayMode;
  style: SubtitleStylePrefs;
  rect: { left: number; top: number; width: number; height: number; bottom: number };
  targetLanguage: string;
}

export interface SubtitleTranslateOptions {
  requestId: string;
  cues: Array<{ id: string; text: string }>;
  modelId?: string;
  bypassCache?: boolean;
}

export interface SubtitleTranslateResult {
  translations: Array<{ id: string; text: string }>;
  modelName: string;
}

export interface SubtitleControllerDeps {
  getSettings: () => PublicSettings | null;
  translate: (options: SubtitleTranslateOptions) => Promise<SubtitleTranslateResult>;
  cancel: (requestId: string) => void;
  onState: (state: SubtitleState) => void;
  onOverlay: (data: SubtitleOverlayData | null) => void;
  transcribe?: (audio: ArrayBuffer, mimeType: string) => Promise<string>;
}

interface VideoSubtitleSession {
  source: SubtitleSourceKind | null;
  selectedTrackIndex: number | null;
  cues: SubtitleCue[];
  trackModes: Map<TextTrack, TextTrackMode>;
}

export class SubtitleController {
  private readonly videoIds = new WeakMap<HTMLVideoElement, string>();
  private videos: HTMLVideoElement[] = [];
  private nextVideoId = 1;
  private selectedVideoId: string | null = null;
  private sessions = new Map<string, VideoSubtitleSession>();
  private nativeTracks: NativeTrackDescriptor[] = [];
  private settings: PublicSettings | null = null;

  private enabled = false;
  private panelOpen = false;
  private translating = false;
  private asrRunning = false;
  private asrChunker: AudioChunker | null = null;
  private asrQueue: Promise<void> = Promise.resolve();
  private asrGeneration = 0;
  private modelName: string | undefined;
  private lastError: AppErrorShape | null = null;
  private lastMessage: string | undefined;
  private generation = 0;
  private requestIds = new Set<string>();
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  private mutationObserver: MutationObserver | null = null;
  private scanTimer: ReturnType<typeof setTimeout> | null = null;
  private rescanInterval: ReturnType<typeof setInterval> | null = null;
  private lastOverlayKey = '';
  private disposed = false;
  private autoEnableAttempted = false;
  private autoEnableSuppressed = false;

  constructor(
    private readonly doc: Document,
    private readonly deps: SubtitleControllerDeps,
  ) {
    this.settings = deps.getSettings();
    this.refreshVideos();
    this.attachDiscovery();
  }

  setSettings(settings: PublicSettings): void {
    const previousStyle = this.settings?.subtitle.style;
    this.settings = settings;
    if (previousStyle && JSON.stringify(previousStyle) !== JSON.stringify(settings.subtitle.style)) {
      this.syncOverlay(true);
    }
    this.emit();
    void this.maybeAutoEnable();
  }

  /**
   * Apply the saved "default enabled" preference only when a native track is
   * already known and the user has not explicitly switched subtitles off.
   */
  async maybeAutoEnable(): Promise<void> {
    if (
      this.disposed ||
      this.autoEnableAttempted ||
      this.autoEnableSuppressed ||
      this.enabled ||
      this.panelOpen ||
      !this.settings?.subtitle.enabled
    ) {
      return;
    }
    if (!this.selectedVideo()) return;
    this.refreshTracks();
    const first = this.nativeTracks.find((track) => track.cueCount > 0);
    if (!first) return;
    this.autoEnableAttempted = true;
    const wasOpen = this.panelOpen;
    try {
      await this.selectTrack(first.index);
      if (!wasOpen) {
        this.panelOpen = false;
        this.emit();
      }
    } catch {
      // Default-on must never block the page or spam errors; the panel still
      // offers a manual retry with the detailed error.
      this.lastError = null;
      this.lastMessage = undefined;
      this.enabled = false;
      this.stopSync();
      this.deps.onOverlay(null);
      this.emit();
    }
  }

  getState(): SubtitleState {
    const session = this.currentSession();
    const cues = session?.cues ?? [];
    const progress = countSubtitleProgress(cues);
    const video = this.selectedVideo();
    const usesAudioModel = Boolean(
      this.settings?.models.some((model) => model.enabled && model.protocol === 'openai-audio'),
    );
    const audioCapability = video ? describeAudioCapability(video) : null;
    const canUseAsr = Boolean(usesAudioModel && audioCapability?.canCapture);
    return {
      enabled: this.enabled,
      panelOpen: this.panelOpen,
      videoCount: this.videos.length,
      videos: this.videos.map((item, index) => this.videoInfo(item, index)),
      selectedVideoId: this.selectedVideoId,
      tracks: this.trackInfos(),
      selectedTrackIndex: session?.selectedTrackIndex ?? null,
      source: session?.source ?? null,
      cues: [],
      cueCount: cues.length,
      translating: this.translating || this.asrRunning,
      asrRunning: this.asrRunning,
      translatedCount: progress.translated,
      failedCount: progress.failed,
      style:
        this.settings?.subtitle.style ?? {
          mode: 'bilingual',
          fontSize: 22,
          color: '#ffffff',
          backgroundOpacity: 0.62,
          bottomOffset: 6,
          lineHeight: 1.38,
          maxWidth: 88,
        },
      ...(this.lastMessage ? { message: this.lastMessage } : {}),
      ...(this.lastError ? { error: this.lastError } : {}),
      mode: this.settings?.subtitle.style.mode ?? 'bilingual',
      canUseAsr,
      asrNote: canUseAsr
        ? '实验性功能：按 8 秒音频块识别，时间轴为近似值；仅对允许 captureStream 的非 DRM 视频生效。'
        : usesAudioModel
          ? audioCapability?.message ?? '当前视频无法确认可访问音频。'
          : '未配置语音识别模型；可先导入 SRT/VTT 或使用原生字幕。',
      updatedAt: Date.now(),
    };
  }

  getCues(): SubtitleCue[] {
    return [...(this.currentSession()?.cues ?? [])];
  }

  openPanel(open = true): void {
    this.panelOpen = open;
    this.lastError = null;
    this.emit();
  }

  async toggleEnabled(enabled: boolean): Promise<void> {
    if (!enabled) {
      this.autoEnableSuppressed = true;
      this.setEnabled(false);
      return;
    }
    this.autoEnableSuppressed = false;
    this.autoEnableAttempted = true;
    const session = this.currentSession();
    if (!session || session.cues.length === 0) {
      const loaded = await this.tryLoadFirstNativeTrack();
      if (!loaded) {
        this.panelOpen = true;
        if (!this.lastError) {
          this.lastError = {
            code: 'SUBTITLE_NO_SOURCE',
            message: '当前视频没有可读取的原生字幕。请在字幕面板导入 SRT/VTT 文件。',
            retryable: false,
          };
        }
        this.lastMessage = this.lastError.message;
        this.emit();
        return;
      }
    }
    this.setEnabled(true);
  }

  private setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.hideNativeTrackIfNeeded();
      this.startSync();
      this.lastMessage = undefined;
    } else {
      this.teardownAsr();
      this.cancelTranslation();
      this.restoreNativeModes();
      this.stopSync();
      this.deps.onOverlay(null);
    }
    this.emit();
    this.syncOverlay(true);
  }

  async refreshVideosNow(): Promise<void> {
    this.refreshVideos();
    this.emit();
    void this.maybeAutoEnable();
  }

  async selectVideo(videoId: string): Promise<void> {
    if (!this.videos.some((video) => this.getVideoId(video) === videoId)) {
      throw new AppError('NOT_FOUND', '视频不存在或已被移除。');
    }
    if (videoId === this.selectedVideoId) return;
    this.teardownAsr();
    this.saveCurrentSession();
    this.cancelTranslation();
    this.restoreNativeModes();
    this.selectedVideoId = videoId;
    this.nativeTracks = [];
    this.modelName = undefined;
    this.lastError = null;
    this.lastMessage = undefined;
    this.refreshTracks();
    const session = this.currentSession();
    if (this.enabled && session?.cues.length) {
      this.hideNativeTrackIfNeeded();
    }
    this.startSync();
    this.syncOverlay(true);
    this.emit();
  }

  async selectTrack(trackIndex: number): Promise<void> {
    const video = this.selectedVideo();
    if (!video) throw new AppError('NOT_FOUND', '请先选择视频。');
    this.teardownAsr();
    const track = video.textTracks?.[trackIndex];
    if (!track || (track.kind !== 'subtitles' && track.kind !== 'captions')) {
      throw new AppError('SUBTITLE_NO_SOURCE', '字幕轨道不存在。');
    }
    this.cancelTranslation();
    this.restoreNativeModes();
    const session = this.ensureSession();
    const modes = captureTrackModes(video);
    session.trackModes = modes;
    session.selectedTrackIndex = trackIndex;
    session.source = 'native';
    session.cues = [];
    this.lastError = null;
    this.lastMessage = '正在读取原生字幕…';
    this.emit();
    try {
      const result = await readNativeTrack(track, { timeoutMs: 5000 });
      session.cues = result.cues.map((cue) => ({
        id: cue.id,
        start: cue.start,
        end: cue.end,
        original: cue.text,
        status: 'pending',
      }));
      session.trackModes = modes;
      this.lastMessage = `已读取 ${session.cues.length} 条原生字幕。`;
      this.enabled = true;
      this.panelOpen = true;
      this.hideNativeTrackIfNeeded();
      this.startSync();
      this.refreshTracks();
      this.syncOverlay(true);
      this.emit();
    } catch (error) {
      this.restoreNativeModes();
      session.cues = [];
      this.lastError = normalizeError(error).toShape();
      this.lastMessage = this.lastError.message;
      this.emit();
      throw error;
    }
  }

  importSubtitleFile(content: string, filename: string): void {
    if (bytesOfString(content) > SUBTITLE_MAX_FILE_BYTES) {
      throw new AppError('SUBTITLE_PARSE_ERROR', '字幕文件超过 2 MB 上限，请拆分后再导入。');
    }
    const extension = filename.toLowerCase().endsWith('.vtt') ? 'vtt' : 'srt';
    const parsed = parseSubtitles(content, extension);
    this.teardownAsr();
    this.cancelTranslation();
    this.restoreNativeModes();
    const session = this.ensureSession();
    session.source = 'file';
    session.selectedTrackIndex = null;
    session.trackModes = new Map();
    session.cues = parsed.cues.map((cue) => ({
      id: cue.id,
      start: cue.start,
      end: cue.end,
      original: cue.text,
      status: 'pending',
    }));
    this.enabled = true;
    this.panelOpen = true;
    this.hideNativeTrackIfNeeded();
    this.lastError = null;
    this.lastMessage = `已导入 ${session.cues.length} 条字幕${
      parsed.warnings.length ? `，${parsed.warnings.length} 个异常块已跳过` : ''
    }。`;
    this.startSync();
    this.syncOverlay(true);
    this.emit();
  }

  setMode(mode: SubtitleDisplayMode): void {
    if (!this.settings) return;
    this.settings = {
      ...this.settings,
      subtitle: {
        ...this.settings.subtitle,
        style: { ...this.settings.subtitle.style, mode },
      },
    };
    this.syncOverlay(true);
    this.emit();
  }

  applySubtitleStyle(style: Partial<SubtitleStylePrefs>): void {
    if (!this.settings) return;
    this.settings = {
      ...this.settings,
      subtitle: {
        ...this.settings.subtitle,
        style: { ...this.settings.subtitle.style, ...style },
      },
    };
    this.syncOverlay(true);
    this.emit();
  }

  async startTranslation(options: { modelId?: string; onlyFailed?: boolean; bypassCache?: boolean } = {}): Promise<void> {
    if (this.asrRunning) throw new AppError('INVALID_REQUEST', '语音识别进行中，请先停止识别。');
    const session = this.currentSession();
    if (!session || session.cues.length === 0) {
      throw new AppError('SUBTITLE_NO_SOURCE', '请先读取或导入字幕。');
    }
    if (this.translating) return;
    this.generation += 1;
    const generation = this.generation;
    const candidates = options.onlyFailed
      ? session.cues.filter((cue) => cue.status === 'failed')
      : session.cues.filter((cue) => !cue.translation || cue.status !== 'translated');
    if (candidates.length === 0) {
      this.lastMessage = '所有字幕已翻译。';
      this.emit();
      return;
    }
    this.translating = true;
    this.lastError = null;
    this.lastMessage = `正在翻译 ${candidates.length} 条字幕…`;
    for (const cue of candidates) cue.status = 'pending';
    this.emit();

    const groups = groupCuesForTranslation(candidates);
    let cursor = 0;
    let modelName = this.modelName;
    const errors: AppError[] = [];

    const worker = async (): Promise<void> => {
      while (cursor < groups.length) {
        if (generation !== this.generation) return;
        const group = groups[cursor];
        cursor += 1;
        if (!group) continue;
        const requestId = createId('sub');
        this.requestIds.add(requestId);
        try {
          const result = await this.deps.translate({
            requestId,
            cues: group.map((cue) => ({ id: cue.id, text: cue.original })),
            modelId: options.modelId,
            bypassCache: options.bypassCache,
          });
          if (generation !== this.generation) return;
          if (result.translations.length !== group.length) {
            throw new AppError('INVALID_RESPONSE', '字幕翻译结果数量不一致。');
          }
          const byId = new Map(result.translations.map((entry) => [entry.id, entry.text.trim()]));
          for (const cue of group) {
            const translation = byId.get(cue.id);
            if (translation) {
              cue.translation = translation;
              cue.status = 'translated';
            } else {
              cue.status = 'failed';
            }
          }
          modelName = result.modelName || modelName;
        } catch (error) {
          if (generation !== this.generation) return;
          const normalized = normalizeError(error);
          if (normalized.code === 'CANCELLED') return;
          errors.push(normalized);
          for (const cue of group) cue.status = 'failed';
        } finally {
          this.requestIds.delete(requestId);
          this.syncOverlay(true);
          this.emit();
        }
      }
    };

    try {
      await Promise.all([worker(), worker()]);
    } finally {
      if (generation === this.generation) {
        this.translating = false;
        this.modelName = modelName;
        const progress = countSubtitleProgress(session.cues);
        this.lastError = errors[0]?.toShape() ?? null;
        this.lastMessage =
          progress.failed > 0
            ? `字幕翻译完成，${progress.failed} 条失败，已保留原文。`
            : `已翻译 ${progress.translated} 条字幕。`;
        this.syncOverlay(true);
        this.emit();
      }
    }
  }

  retryFailed(modelId?: string): Promise<void> {
    return this.startTranslation({ modelId, onlyFailed: true });
  }

  async stopTranslation(): Promise<void> {
    if (this.asrRunning) {
      await this.stopAsr('语音识别已停止，已识别内容保留。');
      return;
    }
    this.cancelTranslation();
    this.translating = false;
    this.lastMessage = '字幕翻译已停止，未完成的字幕保留原文。';
    this.emit();
  }

  async startAsr(): Promise<void> {
    if (!this.deps.transcribe) {
      throw new AppError('AUDIO_UNAVAILABLE', '语音识别接口尚未配置。');
    }
    const video = this.selectedVideo();
    if (!video) throw new AppError('NOT_FOUND', '请先选择视频。');
    const audioModelAvailable = Boolean(
      this.settings?.models.some((model) => model.enabled && model.protocol === 'openai-audio'),
    );
    if (!audioModelAvailable) {
      throw new AppError('NO_MODEL', '请先在设置中为“语音识别”指定 Audio 模型。');
    }
    const capability = describeAudioCapability(video);
    if (!capability.canCapture) {
      throw new AppError('AUDIO_UNAVAILABLE', capability.message);
    }
    if (this.asrRunning) return;
    this.cancelTranslation();
    this.restoreNativeModes();
    const session = this.ensureSession();
    session.source = 'asr';
    session.selectedTrackIndex = null;
    session.trackModes = new Map();
    session.cues = [];
    this.enabled = true;
    this.panelOpen = true;
    this.hideNativeTrackIfNeeded();
    this.asrRunning = true;
    this.translating = false;
    this.lastError = null;
    this.lastMessage = '正在捕获音频：请播放视频。识别按约 8 秒分块，时间轴为近似值。';
    this.asrGeneration += 1;
    const generation = this.asrGeneration;
    this.startSync();
    this.emit();
    const chunker = new AudioChunker(video, {
      chunkSeconds: 8,
      targetSampleRate: 16_000,
      onChunk: (chunk) => {
        this.asrQueue = this.asrQueue
          .then(() => this.processAsrChunk(chunk, generation))
          .catch((error: unknown) => {
            const normalized = normalizeError(error);
            this.lastError = normalized.toShape();
            this.lastMessage = `语音识别失败：${normalized.message}`;
            this.emit();
          });
      },
      onError: (error) => {
        this.lastError = normalizeError(error).toShape();
        this.lastMessage = `音频捕获失败：${error.message}`;
        this.emit();
      },
    });
    this.asrChunker = chunker;
    video.addEventListener('ended', this.handleAsrEnded);
    try {
      await chunker.start();
      if (generation !== this.asrGeneration) {
        await chunker.stop();
        return;
      }
      this.lastMessage = '正在捕获音频并识别。请播放视频，识别文本会逐步加入字幕。';
      this.emit();
    } catch (error) {
      video.removeEventListener('ended', this.handleAsrEnded);
      this.asrChunker = null;
      this.asrRunning = false;
      this.restoreNativeModes();
      await chunker.stop().catch(() => undefined);
      const normalized = normalizeError(error);
      this.lastError = normalized.toShape();
      this.lastMessage = normalized.message;
      this.emit();
      throw normalized;
    }
  }

  async stopAsr(message = '语音识别已停止，已识别内容保留。'): Promise<void> {
    this.teardownAsr();
    await this.asrQueue.catch(() => undefined);
    this.asrRunning = false;
    this.lastMessage = message;
    this.emit();
    this.syncOverlay(true);
  }

  private handleAsrEnded = (): void => {
    void this.stopAsr('视频播放结束，语音识别已停止。');
  };

  private teardownAsr(): void {
    this.asrGeneration += 1;
    this.asrRunning = false;
    for (const requestId of this.requestIds) this.deps.cancel(requestId);
    this.requestIds.clear();
    const video = this.selectedVideo();
    video?.removeEventListener('ended', this.handleAsrEnded);
    const chunker = this.asrChunker;
    this.asrChunker = null;
    if (chunker) void chunker.stop().catch(() => undefined);
  }

  private async processAsrChunk(chunk: AudioChunk, generation: number): Promise<void> {
    if (generation !== this.asrGeneration || !this.asrRunning || !this.deps.transcribe) return;
    if (chunk.endTime <= chunk.startTime) return;
    let text = '';
    try {
      text = await this.deps.transcribe(chunk.wav, 'audio/wav');
    } catch (error) {
      if (generation !== this.asrGeneration) return;
      const normalized = normalizeError(error);
      this.lastError = normalized.toShape();
      this.lastMessage = `语音识别失败（${Math.round(chunk.startTime)}s）：${normalized.message}`;
      this.emit();
      return;
    }
    if (generation !== this.asrGeneration || !this.asrRunning) return;
    text = text.trim();
    if (!text) return;
    const session = this.currentSession();
    if (!session) return;
    const cue: SubtitleCue = {
      id: `asr-${Math.round(chunk.startTime * 1000)}-${Math.round(chunk.endTime * 1000)}`,
      start: chunk.startTime,
      end: chunk.endTime,
      original: text,
      status: 'pending',
    };
    session.cues.push(cue);
    session.cues.sort((a, b) => a.start - b.start || a.end - b.end);
    this.lastMessage = `识别到 ${session.cues.length} 条语音字幕，正在翻译…`;
    this.syncOverlay(true);
    this.emit();
    const requestId = createId('asr');
    this.requestIds.add(requestId);
    try {
      const result = await this.deps.translate({
        requestId,
        cues: [{ id: cue.id, text: cue.original }],
      });
      if (generation !== this.asrGeneration) return;
      const translated = result.translations.find((entry) => entry.id === cue.id)?.text.trim();
      if (translated) {
        cue.translation = translated;
        cue.status = 'translated';
        this.modelName = result.modelName || this.modelName;
      } else {
        cue.status = 'failed';
      }
      this.lastMessage = `已识别 ${session.cues.length} 条语音字幕。`;
      this.syncOverlay(true);
      this.emit();
    } catch (error) {
      if (generation !== this.asrGeneration) return;
      cue.status = 'failed';
      const normalized = normalizeError(error);
      this.lastError = normalized.toShape();
      this.lastMessage = `字幕翻译失败：${normalized.message}`;
      this.emit();
    } finally {
      this.requestIds.delete(requestId);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.teardownAsr();
    this.cancelTranslation();
    this.restoreNativeModes();
    this.stopSync();
    this.mutationObserver?.disconnect();
    if (this.scanTimer !== null) clearTimeout(this.scanTimer);
    if (this.rescanInterval !== null) clearInterval(this.rescanInterval);
  }

  private selectedVideo(): HTMLVideoElement | null {
    return this.videos.find((video) => this.getVideoId(video) === this.selectedVideoId) ?? null;
  }

  private getVideoId(video: HTMLVideoElement): string {
    let id = this.videoIds.get(video);
    if (!id) {
      id = `video-${this.nextVideoId}`;
      this.nextVideoId += 1;
      this.videoIds.set(video, id);
    }
    return id;
  }

  private videoInfo(video: HTMLVideoElement, index: number): VideoInfo {
    const id = this.getVideoId(video);
    const rect = video.getBoundingClientRect();
    const label =
      video.getAttribute('title') ||
      video.getAttribute('aria-label') ||
      video.currentSrc?.split('/').pop() ||
      `视频 ${index + 1}`;
    return {
      id,
      label: label.slice(0, 120),
      width: Math.round(video.videoWidth || rect.width || 0),
      height: Math.round(video.videoHeight || rect.height || 0),
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      trackCount: this.nativeTrackCount(video),
      selected: id === this.selectedVideoId,
    };
  }

  private nativeTrackCount(video: HTMLVideoElement): number {
    try {
      return listNativeTracks(video).length;
    } catch {
      return 0;
    }
  }

  private refreshVideos(): void {
    if (this.disposed) return;
    const candidates = Array.from(this.doc.querySelectorAll('video')).filter((video) => this.isEligibleVideo(video));
    const previousSelected = this.selectedVideoId;
    this.videos = candidates;
    if (previousSelected && !candidates.some((video) => this.getVideoId(video) === previousSelected)) {
      this.teardownAsr();
      this.cancelTranslation();
      this.restoreNativeModes();
      this.selectedVideoId = null;
    }
    if (!this.selectedVideoId && candidates[0]) {
      this.selectedVideoId = this.getVideoId(candidates[0]);
    }
    if (this.selectedVideoId !== previousSelected) {
      this.refreshTracks();
      this.startSync();
      this.syncOverlay(true);
    }
    const validIds = new Set(candidates.map((video) => this.getVideoId(video)));
    for (const id of this.sessions.keys()) {
      if (!validIds.has(id)) this.sessions.delete(id);
    }
    if (this.enabled) this.syncOverlay(true);
  }

  private isEligibleVideo(video: HTMLVideoElement): boolean {
    if (!video.isConnected) return false;
    const rect = video.getBoundingClientRect();
    if (rect.width >= 120 && rect.height >= 80) return true;
    return video.videoWidth >= 120 && video.videoHeight >= 80;
  }

  private refreshTracks(): void {
    const video = this.selectedVideo();
    if (!video) {
      this.nativeTracks = [];
      return;
    }
    try {
      this.nativeTracks = listNativeTracks(video);
    } catch {
      this.nativeTracks = [];
    }
  }

  private trackInfos(): TrackInfo[] {
    return this.nativeTracks.map((track) => ({
      index: track.index,
      label: track.label,
      language: track.language,
      kind: track.kind,
      mode: track.track.mode,
      cueCount: track.track.cues?.length ?? track.cueCount,
    }));
  }

  private attachDiscovery(): void {
    if (this.doc.body) {
      this.mutationObserver = new MutationObserver(() => {
        if (this.scanTimer !== null) return;
        this.scanTimer = setTimeout(() => {
          this.scanTimer = null;
          const before = this.selectedVideoId;
          this.refreshVideos();
          if (this.selectedVideoId !== before) {
            this.refreshTracks();
            this.emit();
          }
        }, 500);
      });
      this.mutationObserver.observe(this.doc.body, { childList: true, subtree: true });
    }
    this.rescanInterval = setInterval(() => {
      const before = this.selectedVideoId;
      const trackSignature = this.nativeTracks
        .map((track) => `${track.index}:${track.label}:${track.track.mode}:${track.track.cues?.length ?? 0}`)
        .join('|');
      this.refreshVideos();
      this.refreshTracks();
      const nextSignature = this.nativeTracks
        .map((track) => `${track.index}:${track.label}:${track.track.mode}:${track.track.cues?.length ?? 0}`)
        .join('|');
      if (this.selectedVideoId !== before || trackSignature !== nextSignature) this.emit();
    }, 5000);
  }

  private ensureSession(): VideoSubtitleSession {
    if (!this.selectedVideoId) {
      throw new AppError('NOT_FOUND', '页面上没有可用视频。');
    }
    let session = this.sessions.get(this.selectedVideoId);
    if (!session) {
      session = {
        source: null,
        selectedTrackIndex: null,
        cues: [],
        trackModes: new Map(),
      };
      this.sessions.set(this.selectedVideoId, session);
    }
    return session;
  }

  private currentSession(): VideoSubtitleSession | null {
    return this.selectedVideoId ? this.sessions.get(this.selectedVideoId) ?? null : null;
  }

  private saveCurrentSession(): void {
    if (this.selectedVideoId && !this.sessions.has(this.selectedVideoId)) {
      this.sessions.set(this.selectedVideoId, {
        source: null,
        selectedTrackIndex: null,
        cues: [],
        trackModes: new Map(),
      });
    }
  }

  private async tryLoadFirstNativeTrack(): Promise<boolean> {
    const video = this.selectedVideo();
    if (!video) return false;
    this.refreshTracks();
    const first = this.nativeTracks[0];
    if (!first) return false;
    try {
      await this.selectTrack(first.index);
      return true;
    } catch {
      return false;
    }
  }

  private hideNativeTrackIfNeeded(): void {
    const video = this.selectedVideo();
    const session = this.currentSession();
    if (!video || !session) return;
    if (session.trackModes.size === 0) session.trackModes = captureTrackModes(video);
    // The extension overlay must be the only visible caption renderer for
    // every source (native, imported file, ASR), otherwise the browser paints
    // a second copy. Disabled tracks remain disabled and are not force-loaded.
    const list = video.textTracks;
    if (!list) return;
    for (let index = 0; index < list.length; index += 1) {
      const track = list[index];
      if (!track || (track.kind !== 'subtitles' && track.kind !== 'captions')) continue;
      if (track.mode === 'disabled') continue;
      try {
        track.mode = 'hidden';
      } catch {
        // Ignore tracks that the browser refuses to toggle.
      }
    }
  }

  private restoreNativeModes(): void {
    const video = this.selectedVideo();
    const session = this.currentSession();
    if (!video || !session) return;
    if (session.trackModes.size > 0) {
      restoreNativeTrackModes(video, session.trackModes);
      session.trackModes = new Map();
    }
  }

  private cancelTranslation(): void {
    this.generation += 1;
    for (const requestId of this.requestIds) this.deps.cancel(requestId);
    this.requestIds.clear();
    this.translating = false;
    const session = this.currentSession();
    if (session) {
      for (const cue of session.cues) {
        if (cue.status === 'pending') continue;
        if (cue.status === 'failed') cue.status = cue.translation ? 'translated' : 'pending';
      }
    }
  }

  private startSync(): void {
    if (this.syncTimer !== null) clearInterval(this.syncTimer);
    if (!this.enabled) return;
    this.syncTimer = setInterval(() => this.syncOverlay(false), 100);
    this.syncOverlay(true);
  }

  private stopSync(): void {
    if (this.syncTimer !== null) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    this.lastOverlayKey = '';
  }

  private syncOverlay(force: boolean): void {
    if (!this.enabled) {
      this.deps.onOverlay(null);
      return;
    }
    const video = this.selectedVideo();
    const session = this.currentSession();
    if (!video || !session || session.cues.length === 0) {
      if (force || this.lastOverlayKey) {
        this.lastOverlayKey = '';
        this.deps.onOverlay(null);
      }
      return;
    }
    const rect = video.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 50 || rect.bottom <= 0 || rect.top >= window.innerHeight) {
      this.deps.onOverlay(null);
      this.lastOverlayKey = '';
      return;
    }
    const time = video.currentTime;
    const active = findActiveCues(session.cues, time);
    const targetLanguage = this.settings?.languages.target ?? 'zh-CN';
    const mode = this.settings?.subtitle.style.mode ?? 'bilingual';
    const style = this.settings?.subtitle.style ?? {
      mode,
      fontSize: 22,
      color: '#ffffff',
      backgroundOpacity: 0.62,
      bottomOffset: 6,
      lineHeight: 1.38,
      maxWidth: 88,
    };
    const cues = active.map((cue) => ({
      key: cue.id,
      original: cue.original,
      ...(cue.translation ? { translation: cue.translation } : {}),
    }));
    const key = JSON.stringify({
      cues,
      mode,
      style,
      rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
      targetLanguage,
    });
    if (!force && key === this.lastOverlayKey) return;
    this.lastOverlayKey = key;
    this.deps.onOverlay({
      enabled: true,
      cues,
      mode,
      style,
      rect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
      },
      targetLanguage,
    });
  }

  private emit(): void {
    this.deps.onState(this.getState());
  }
}