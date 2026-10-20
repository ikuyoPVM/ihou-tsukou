import { AppError } from '../shared/errors';
import type { ParsedSubtitleCue } from './parser';
import { sanitizeSubtitleText } from './parser';

export interface NativeTrackDescriptor {
  track: TextTrack;
  index: number;
  label: string;
  language: string;
  kind: string;
  mode: TextTrackMode;
  cueCount: number;
}

export interface NativeTrackReadResult {
  cues: ParsedSubtitleCue[];
  originalMode: TextTrackMode;
}

export function listNativeTracks(video: HTMLVideoElement): NativeTrackDescriptor[] {
  const list = video.textTracks;
  const result: NativeTrackDescriptor[] = [];
  if (!list) return result;
  for (let index = 0; index < list.length; index += 1) {
    const track = list[index];
    if (!track) continue;
    if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
    result.push({
      track,
      index,
      label: track.label || track.language || `字幕轨道 ${index + 1}`,
      language: track.language || '',
      kind: track.kind,
      mode: track.mode,
      cueCount: track.cues?.length ?? 0,
    });
  }
  return result;
}

function cuesFromTrack(track: TextTrack): ParsedSubtitleCue[] {
  const cues = track.cues;
  if (!cues) return [];
  const result: ParsedSubtitleCue[] = [];
  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    if (!cue) continue;
    if (!Number.isFinite(cue.startTime) || !Number.isFinite(cue.endTime) || cue.endTime <= cue.startTime) {
      continue;
    }
    const text = sanitizeSubtitleText((cue as TextTrackCue & { text?: string }).text ?? '');
    if (!text) continue;
    result.push({
      id: `native-${index + 1}`,
      start: cue.startTime,
      end: cue.endTime,
      text,
    });
  }
  return result.sort((a, b) => a.start - b.start || a.end - b.end);
}

async function waitForCues(track: TextTrack, timeoutMs: number): Promise<void> {
  if (track.cues && track.cues.length > 0) return;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      track.removeEventListener('load', onLoad);
      track.removeEventListener('cuechange', onCueChange);
      if (error) reject(error);
      else resolve();
    };
    const onLoad = () => {
      if (track.cues && track.cues.length > 0) finish();
    };
    const onCueChange = () => {
      if (track.cues && track.cues.length > 0) finish();
    };
    const timer = setTimeout(() => {
      finish(
        new AppError(
          'SUBTITLE_NO_SOURCE',
          '字幕轨道没有可读取的 Cue。浏览器可能因跨域限制、DRM 或播放器实现而无法提供字幕内容。',
        ),
      );
    }, timeoutMs);
    const poll = setInterval(() => {
      if (track.cues && track.cues.length > 0) finish();
    }, 150);
    track.addEventListener('load', onLoad);
    track.addEventListener('cuechange', onCueChange);
    onLoad();
  });
}

/**
 * Read a native TextTrack. The track is switched to "hidden" so the browser
 * loads cues without painting its own captions (the overlay owns rendering).
 * The previous mode is returned so it can be restored when subtitles stop.
 */
export async function readNativeTrack(
  track: TextTrack,
  options: { timeoutMs?: number } = {},
): Promise<NativeTrackReadResult> {
  const originalMode = track.mode;
  if (track.mode === 'disabled') track.mode = 'hidden';
  await waitForCues(track, options.timeoutMs ?? 5000);
  const cues = cuesFromTrack(track);
  if (cues.length === 0) {
    throw new AppError('SUBTITLE_NO_SOURCE', '字幕轨道存在，但没有可读取的字幕内容。');
  }
  return { cues, originalMode };
}

export function restoreNativeTrackModes(
  video: HTMLVideoElement,
  modes: Map<TextTrack, TextTrackMode>,
): void {
  const list = video.textTracks;
  if (!list) return;
  for (const [track, mode] of modes) {
    try {
      track.mode = mode;
    } catch {
      // Some tracks become unreadable after the video is torn down.
    }
  }
}

export function captureTrackModes(video: HTMLVideoElement): Map<TextTrack, TextTrackMode> {
  const modes = new Map<TextTrack, TextTrackMode>();
  const list = video.textTracks;
  if (!list) return modes;
  for (let index = 0; index < list.length; index += 1) {
    const track = list[index];
    if (track) modes.set(track, track.mode);
  }
  return modes;
}