import { AppError } from './errors';

export function createId(prefix = 'id'): string {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${uuid.replace(/-/g, '').slice(0, 20)}`;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new AppError('CANCELLED'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new AppError('CANCELLED'));
    };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function hostnameOf(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return '';
  }
}

export function truncateText(text: string, maxLength: number): string {
  if (!Number.isFinite(maxLength) || maxLength <= 0) return '';
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Stable non-cryptographic hash for cache keys. Collisions are additionally guarded by length. */
export function hashString(input: string): string {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    hashA ^= code;
    hashA = Math.imul(hashA, 0x01000193);
    hashB ^= code + i;
    hashB = Math.imul(hashB, 0x85ebca6b);
  }
  return `${(hashA >>> 0).toString(16).padStart(8, '0')}${(hashB >>> 0)
    .toString(16)
    .padStart(8, '0')}`;
}

export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): (...args: Args) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Args) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn(...args);
    }, waitMs);
  };
}

export function throttle<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): (...args: Args) => void {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: Args | undefined;
  return (...args: Args) => {
    const now = Date.now();
    const remaining = waitMs - (now - last);
    lastArgs = args;
    if (remaining <= 0) {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      last = now;
      fn(...args);
      return;
    }
    if (timer === undefined) {
      timer = setTimeout(() => {
        timer = undefined;
        last = Date.now();
        if (lastArgs) fn(...lastArgs);
      }, remaining);
    }
  };
}

export function safeJsonParse<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function bytesOfString(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}