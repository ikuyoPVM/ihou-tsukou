import { DEFAULT_TIMEOUT_MS } from '../shared/constants';
import { AppError, redactSecrets } from '../shared/errors';
import type { ModelConfig } from '../shared/types';
import { truncateText } from '../shared/utils';

export type FetchLike = typeof fetch;

export interface HttpRequestOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  signal?: AbortSignal;
  secrets?: Array<string | undefined>;
}

export function resolveApiUrl(baseUrl: string, suffix: string): string {
  const base = new URL(baseUrl);
  let path = base.pathname.replace(/\/+$/, '');
  for (const known of ['/chat/completions', '/audio/transcriptions', '/models']) {
    if (path.endsWith(known)) {
      path = path.slice(0, -known.length);
      break;
    }
  }
  path = `${path}${suffix.startsWith('/') ? suffix : `/${suffix}`}`;
  base.pathname = path.replace(/\/{2,}/g, '/');
  base.search = '';
  base.hash = '';
  return base.toString();
}

export function providerHeaders(model: ModelConfig, extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...model.headers,
  };
  const hasAuth = Object.keys(headers).some(
    (key) => key.toLowerCase() === 'authorization' || key.toLowerCase() === 'x-api-key',
  );
  if (model.apiKey && !hasAuth) {
    headers.Authorization = `Bearer ${model.apiKey}`;
  }
  return { ...headers, ...extra };
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  options: HttpRequestOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    // Never forward credentials across a redirect to a different origin.
    return await fetchImpl(url, { ...init, redirect: 'error', signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new AppError('TIMEOUT', `请求超过 ${Math.round(timeoutMs / 1000)} 秒未完成。`, {
        retryable: true,
      });
    }
    if (options.signal?.aborted) throw new AppError('CANCELLED');
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new AppError('CANCELLED');
    }
    const raw = error instanceof Error ? error.message : String(error);
    throw new AppError(
      'NETWORK_ERROR',
      '网络请求失败。请检查 Base URL、网络、代理和扩展权限；浏览器扩展会阻止部分服务的跨域请求。',
      { retryable: true, diagnostic: redactSecrets(raw, options.secrets ?? []) },
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export async function readResponseText(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 200_000 ? text.slice(0, 200_000) : text;
  } catch {
    return '';
  }
}

export function extractProviderMessage(raw: string): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: unknown; code?: unknown; type?: unknown } | string;
      message?: unknown;
      detail?: unknown;
    };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error && typeof parsed.error.message === 'string') return parsed.error.message;
    if (typeof parsed.message === 'string') return parsed.message;
    if (typeof parsed.detail === 'string') return parsed.detail;
  } catch {
    // Plain text or HTML error pages are common behind proxies.
  }
  const stripped = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return stripped;
}

export function classifyHttpFailure(
  status: number,
  rawBody: string,
  secrets: Array<string | undefined>,
): AppError {
  const detail = truncateText(redactSecrets(extractProviderMessage(rawBody), secrets), 320);
  const lower = detail.toLowerCase();
  const suffix = detail ? ` 服务端信息：${detail}` : '';
  if (status === 401 || status === 403) {
    return new AppError('INVALID_API_KEY', `API Key 无效或没有访问权限。${suffix}`, {
      status,
      retryable: false,
      diagnostic: `HTTP ${status}`,
    });
  }
  if (status === 402) {
    return new AppError('QUOTA_EXCEEDED', `API 余额不足或额度已耗尽。${suffix}`, {
      status,
      retryable: false,
    });
  }
  if (status === 429) {
    if (/(quota|billing|balance|insufficient|额度|余额|配额)/i.test(lower)) {
      return new AppError('QUOTA_EXCEEDED', `API 余额不足或额度已耗尽。${suffix}`, {
        status,
        retryable: false,
      });
    }
    return new AppError('RATE_LIMITED', `请求过于频繁，已被服务端限流。${suffix}`, {
      status,
      retryable: true,
    });
  }
  if (status === 408 || status === 504) {
    return new AppError('TIMEOUT', `服务端响应超时。${suffix}`, {
      status,
      retryable: true,
    });
  }
  if (status === 404) {
    if (/model|模型|deployment|engine/i.test(lower)) {
      return new AppError('MODEL_NOT_FOUND', `模型 ID 不存在或无权使用。${suffix}`, {
        status,
        retryable: false,
      });
    }
    return new AppError(
      'INVALID_BASE_URL',
      `接口地址返回 404。请检查 Base URL 是否包含正确的 API 路径（例如 /v1）。${suffix}`,
      { status, retryable: false },
    );
  }
  if (status === 400 && /(context|token|too long|maximum|length)/i.test(lower)) {
    return new AppError('INVALID_REQUEST', `输入超过模型上下文限制。${suffix}`, {
      status,
      retryable: false,
    });
  }
  if (status === 400 && /(api.?key|unauthorized|authentication)/i.test(lower)) {
    return new AppError('INVALID_API_KEY', `API Key 无效或鉴权失败。${suffix}`, {
      status,
      retryable: false,
    });
  }
  if (status >= 500) {
    return new AppError('NETWORK_ERROR', `服务端暂时不可用（HTTP ${status}）。${suffix}`, {
      status,
      retryable: true,
    });
  }
  return new AppError('INVALID_REQUEST', `API 请求失败（HTTP ${status}）。${suffix}`, {
    status,
    retryable: false,
  });
}

export async function parseJsonResponse<T>(
  response: Response,
  secrets: Array<string | undefined>,
  rawBody?: string,
): Promise<T> {
  const text = rawBody ?? (await readResponseText(response));
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError(
      'INVALID_RESPONSE',
      '接口返回的内容不是合法 JSON，可能 Base URL 指向了网页而不是 API。',
      { status: response.status, diagnostic: truncateText(redactSecrets(text, secrets), 200) },
    );
  }
}

export function normalizeApiError(error: unknown, secrets: Array<string | undefined>): AppError {
  if (error instanceof AppError) {
    if (error.diagnostic) {
      const safeDiagnostic = redactSecrets(error.diagnostic, secrets);
      if (safeDiagnostic !== error.diagnostic) {
        return new AppError(error.code, error.message, {
          retryable: error.retryable,
          status: error.status,
          diagnostic: safeDiagnostic,
        });
      }
    }
    return error;
  }
  if (error instanceof Error) {
    return new AppError('UNKNOWN', redactSecrets(error.message, secrets), { cause: error });
  }
  return new AppError('UNKNOWN');
}