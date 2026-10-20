import type { TestModelResult } from '../shared/types';

export interface AsrAudioInput {
  bytes: Uint8Array;
  mimeType: string;
  language?: string;
  prompt?: string;
  signal?: AbortSignal;
}

export interface AsrResult {
  text: string;
  language?: string;
  duration?: number;
}

/**
 * Independent speech-recognition boundary. Subtitle capture, audio transport,
 * ASR API calls and translation remain separate layers.
 */
export interface AsrProvider {
  readonly id: string;
  transcribe(input: AsrAudioInput): Promise<AsrResult>;
  testConnection(signal?: AbortSignal): Promise<TestModelResult>;
}

export type AudioAccessReason =
  | 'unsupported-element'
  | 'drm-protected'
  | 'no-source'
  | 'capture-blocked';

export interface AudioAccessCapability {
  canCapture: boolean;
  reason?: AudioAccessReason;
  message: string;
}

export function describeAudioCapability(video: HTMLVideoElement): AudioAccessCapability {
  const captureStream = (video as HTMLVideoElement & { captureStream?: unknown }).captureStream;
  if (typeof captureStream !== 'function') {
    return {
      canCapture: false,
      reason: 'unsupported-element',
      message: '当前浏览器或播放器不支持从该视频捕获音频。',
    };
  }
  if ((video as HTMLVideoElement & { mediaKeys?: unknown }).mediaKeys) {
    return {
      canCapture: false,
      reason: 'drm-protected',
      message: '该视频受 DRM 保护，扩展不会也无法绕过媒体保护读取音频。',
    };
  }
  if (video.readyState < 1 || !video.currentSrc) {
    return {
      canCapture: false,
      reason: 'no-source',
      message: '视频尚未加载媒体源，暂时无法捕获音频。',
    };
  }
  return {
    canCapture: true,
    message: '可尝试捕获音频；跨域媒体可能只产生静音，无法保证识别效果。',
  };
}