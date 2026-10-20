import { DEFAULT_SUBTITLE_STYLE } from '../shared/constants';
import type { ContentPageSnapshot, PageState, SubtitleState } from '../shared/types';
import { isPlainObject } from '../shared/utils';
import { mergeSubtitleStyle } from '../settings/validation';

export function emptyPageState(): PageState {
  return {
    status: 'idle',
    mode: 'bilingual',
    active: false,
    paused: false,
    total: 0,
    completed: 0,
    failed: 0,
    canRetry: false,
    autoTranslateNewContent: true,
    updatedAt: Date.now(),
  };
}

export function emptySubtitleState(): SubtitleState {
  return {
    enabled: false,
    panelOpen: false,
    videoCount: 0,
    videos: [],
    selectedVideoId: null,
    tracks: [],
    selectedTrackIndex: null,
    source: null,
    cues: [],
    cueCount: 0,
    translating: false,
    asrRunning: false,
    translatedCount: 0,
    failedCount: 0,
    style: { ...DEFAULT_SUBTITLE_STYLE },
    mode: 'bilingual',
    canUseAsr: false,
    updatedAt: Date.now(),
  };
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Content scripts can be compromised by a compromised renderer; never trust
 * arbitrary fields from their state reports. Keep only bounded, display-safe
 * summaries and drop full cue text before it is stored in session storage.
 */
export function sanitizePageState(raw: unknown): PageState {
  if (!isPlainObject(raw)) return emptyPageState();
  const statusValues = new Set(['idle', 'translating', 'paused', 'done', 'error', 'restored']);
  const status = typeof raw.status === 'string' && statusValues.has(raw.status) ? raw.status : 'idle';
  return {
    status: status as PageState['status'],
    mode: raw.mode === 'replace' ? 'replace' : 'bilingual',
    active: raw.active === true,
    paused: raw.paused === true,
    total: Math.max(0, Math.round(number(raw.total))),
    completed: Math.max(0, Math.round(number(raw.completed))),
    failed: Math.max(0, Math.round(number(raw.failed))),
    ...(typeof raw.message === 'string' ? { message: raw.message.slice(0, 500) } : {}),
    ...(isPlainObject(raw.error)
      ? {
          error: {
            code: typeof raw.error.code === 'string' ? raw.error.code.slice(0, 80) : 'UNKNOWN',
            message:
              typeof raw.error.message === 'string' ? raw.error.message.slice(0, 500) : '未知错误',
            retryable: raw.error.retryable === true,
          },
        }
      : {}),
    canRetry: raw.canRetry === true,
    ...(typeof raw.modelName === 'string' ? { modelName: raw.modelName.slice(0, 100) } : {}),
    autoTranslateNewContent: raw.autoTranslateNewContent !== false,
    updatedAt: number(raw.updatedAt, Date.now()),
  };
}

export function sanitizeSubtitleState(raw: unknown): SubtitleState {
  if (!isPlainObject(raw)) return emptySubtitleState();
  const videos = Array.isArray(raw.videos)
    ? raw.videos.slice(0, 30).flatMap((video) => {
        if (!isPlainObject(video)) return [];
        return [
          {
            id: typeof video.id === 'string' ? video.id.slice(0, 80) : '',
            label: typeof video.label === 'string' ? video.label.slice(0, 120) : '视频',
            width: Math.max(0, Math.round(number(video.width))),
            height: Math.max(0, Math.round(number(video.height))),
            duration: Math.max(0, number(video.duration)),
            trackCount: Math.max(0, Math.round(number(video.trackCount))),
            selected: video.selected === true,
          },
        ];
      })
    : [];
  const tracks = Array.isArray(raw.tracks)
    ? raw.tracks.slice(0, 50).flatMap((track) => {
        if (!isPlainObject(track)) return [];
        return [
          {
            index: Math.round(number(track.index)),
            label: typeof track.label === 'string' ? track.label.slice(0, 120) : '',
            language: typeof track.language === 'string' ? track.language.slice(0, 40) : '',
            kind: typeof track.kind === 'string' ? track.kind.slice(0, 40) : '',
            mode:
              track.mode === 'showing' || track.mode === 'hidden'
                ? (track.mode as TextTrackMode)
                : ('disabled' as TextTrackMode),
            cueCount: Math.max(0, Math.round(number(track.cueCount))),
          },
        ];
      })
    : [];
  const modeValues = new Set(['translated', 'original', 'bilingual']);
  const sourceValues = new Set(['native', 'file', 'asr']);
  return {
    enabled: raw.enabled === true,
    panelOpen: raw.panelOpen === true,
    videoCount: Math.max(0, Math.round(number(raw.videoCount))),
    videos,
    selectedVideoId: typeof raw.selectedVideoId === 'string' ? raw.selectedVideoId.slice(0, 80) : null,
    tracks,
    selectedTrackIndex:
      typeof raw.selectedTrackIndex === 'number' && Number.isFinite(raw.selectedTrackIndex)
        ? Math.round(raw.selectedTrackIndex)
        : null,
    source:
      typeof raw.source === 'string' && sourceValues.has(raw.source)
        ? (raw.source as SubtitleState['source'])
        : null,
    cues: [],
    cueCount: Math.max(0, Math.round(number(raw.cueCount))),
    translating: raw.translating === true,
    asrRunning: raw.asrRunning === true,
    translatedCount: Math.max(0, Math.round(number(raw.translatedCount))),
    failedCount: Math.max(0, Math.round(number(raw.failedCount))),
    style: mergeSubtitleStyle(
      {
        ...DEFAULT_SUBTITLE_STYLE,
        mode:
          typeof raw.mode === 'string' &&
          ['translated', 'original', 'bilingual'].includes(raw.mode)
            ? (raw.mode as SubtitleState['mode'])
            : DEFAULT_SUBTITLE_STYLE.mode,
      },
      isPlainObject(raw.style) ? raw.style : {},
    ),
    ...(typeof raw.message === 'string' ? { message: raw.message.slice(0, 500) } : {}),
    ...(isPlainObject(raw.error)
      ? {
          error: {
            code: typeof raw.error.code === 'string' ? raw.error.code.slice(0, 80) : 'UNKNOWN',
            message:
              typeof raw.error.message === 'string' ? raw.error.message.slice(0, 500) : '未知错误',
            retryable: raw.error.retryable === true,
          },
        }
      : {}),
    mode:
      typeof raw.mode === 'string' && modeValues.has(raw.mode)
        ? (raw.mode as SubtitleState['mode'])
        : 'bilingual',
    canUseAsr: raw.canUseAsr === true,
    ...(typeof raw.asrNote === 'string' ? { asrNote: raw.asrNote.slice(0, 500) } : {}),
    updatedAt: number(raw.updatedAt, Date.now()),
  };
}

export function sanitizeSnapshot(raw: unknown): ContentPageSnapshot {
  if (!isPlainObject(raw)) {
    return {
      page: emptyPageState(),
      subtitle: emptySubtitleState(),
      url: '',
      title: '',
    };
  }
  return {
    page: sanitizePageState(raw.page),
    subtitle: sanitizeSubtitleState(raw.subtitle),
    url: typeof raw.url === 'string' ? raw.url.slice(0, 2048) : '',
    title: typeof raw.title === 'string' ? raw.title.slice(0, 300) : '',
  };
}

export function progressFromState(page: PageState): { text: string; color: string } | null {
  if (page.status === 'error' || (page.failed > 0 && !page.active)) {
    return { text: '!', color: '#dc4b4b' };
  }
  if (!page.active) return null;
  if (page.status === 'done') return { text: '100%', color: '#2a9d8f' };
  if (page.total === 0) return { text: '…', color: '#2a9d8f' };
  const percent = Math.max(0, Math.min(99, Math.round((page.completed / page.total) * 100)));
  return { text: `${percent}%`, color: '#2a9d8f' };
}