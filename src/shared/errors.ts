import type { AppErrorShape } from './types';

export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_BASE_URL'
  | 'INVALID_API_KEY'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_DISABLED'
  | 'NO_MODEL'
  | 'UNSUPPORTED_PROTOCOL'
  | 'QUOTA_EXCEEDED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'PERMISSION_DENIED'
  | 'INVALID_RESPONSE'
  | 'CANCELLED'
  | 'CONTENT_UNAVAILABLE'
  | 'UNSUPPORTED_PAGE'
  | 'SUBTITLE_PARSE_ERROR'
  | 'SUBTITLE_NO_SOURCE'
  | 'AUDIO_UNAVAILABLE'
  | 'ASR_FAILED'
  | 'STORAGE_ERROR'
  | 'NOT_FOUND'
  | 'UNKNOWN';

const FALLBACK_MESSAGES: Record<ErrorCode, string> = {
  INVALID_REQUEST: '请求参数无效。',
  INVALID_BASE_URL: 'API Base URL 无效，只允许 HTTPS，或本机 HTTP（localhost / 127.0.0.1）。',
  INVALID_API_KEY: 'API Key 无效或没有访问权限。',
  MODEL_NOT_FOUND: '模型 ID 不存在或当前账号无权使用该模型。',
  MODEL_DISABLED: '该模型配置已停用。',
  NO_MODEL: '尚未配置可用的翻译模型，请先在设置中添加模型。',
  UNSUPPORTED_PROTOCOL: '该模型协议不支持当前操作。',
  QUOTA_EXCEEDED: 'API 余额不足或额度已耗尽。',
  RATE_LIMITED: '请求过于频繁，已被服务端限流。',
  TIMEOUT: '请求超时，请检查网络或稍后重试。',
  NETWORK_ERROR: '网络请求失败，请检查 Base URL、网络连接或浏览器权限。',
  PERMISSION_DENIED: '缺少访问该地址的扩展权限。',
  INVALID_RESPONSE: '模型返回格式不符合预期，请重试或更换模型。',
  CANCELLED: '任务已取消。',
  CONTENT_UNAVAILABLE: '无法连接当前页面的内容脚本。请刷新页面后重试。',
  UNSUPPORTED_PAGE: '该页面不允许扩展运行（例如浏览器内置页或扩展商店）。',
  SUBTITLE_PARSE_ERROR: '字幕文件格式无法解析。',
  SUBTITLE_NO_SOURCE: '当前视频没有可读取的字幕源。',
  AUDIO_UNAVAILABLE: '无法访问该视频的音频流（可能受跨域、DRM 或播放器限制）。',
  ASR_FAILED: '语音识别失败。',
  STORAGE_ERROR: '读取或写入扩展本地存储失败。',
  NOT_FOUND: '请求的资源不存在。',
  UNKNOWN: '发生未知错误。',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly diagnostic?: string;

  constructor(
    code: ErrorCode,
    message?: string,
    options: { retryable?: boolean; status?: number; diagnostic?: string; cause?: unknown } = {},
  ) {
    super(message || FALLBACK_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.retryable = options.retryable ?? isRetryableCode(code);
    this.status = options.status;
    this.diagnostic = options.diagnostic;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }

  toShape(): AppErrorShape {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.diagnostic === undefined ? {} : { diagnostic: this.diagnostic }),
    };
  }
}

export function isRetryableCode(code: ErrorCode): boolean {
  return code === 'TIMEOUT' || code === 'NETWORK_ERROR' || code === 'RATE_LIMITED';
}

export function appErrorShape(
  code: ErrorCode,
  message?: string,
  options: { retryable?: boolean; status?: number; diagnostic?: string } = {},
): AppErrorShape {
  return new AppError(code, message, options).toShape();
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new AppError('CANCELLED');
  }
  if (error instanceof Error) {
    return new AppError('UNKNOWN', error.message || FALLBACK_MESSAGES.UNKNOWN, { cause: error });
  }
  return new AppError('UNKNOWN');
}

/**
 * Remove credentials from text before it reaches logs or another extension surface.
 * Never render the original API key anywhere.
 */
export function redactSecrets(input: string, secrets: Array<string | undefined>): string {
  let output = input;
  for (const secret of secrets) {
    if (!secret || secret.length < 4) continue;
    output = output.split(secret).join('***');
  }
  output = output.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1***');
  output = output.replace(/("?(?:api[_-]?key|authorization|token)"?\s*[:=]\s*")([^"]{4,})(")/gi, '$1***$3');
  return output;
}

export function errorToMessage(error: unknown): string {
  return normalizeError(error).message;
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && (error.name === 'AbortError' || error.message === 'AbortError')) ||
    (error instanceof AppError && error.code === 'CANCELLED')
  );
}