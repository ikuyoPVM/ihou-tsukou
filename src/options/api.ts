import { AppError, normalizeError, type ErrorCode } from '../shared/errors';
import type { RuntimeRequest } from '../shared/messages';
import type { ApiResult } from '../shared/types';

export async function request<T>(message: RuntimeRequest): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as ApiResult<T> | undefined;
  if (!response) throw new AppError('UNKNOWN', '扩展后台没有响应，请刷新设置页后重试。');
  if (!response.ok) {
    throw new AppError(response.error.code as ErrorCode, response.error.message, {
      retryable: response.error.retryable,
      status: response.error.status,
      diagnostic: response.error.diagnostic,
    });
  }
  return response.data;
}

export function messageOf(error: unknown): string {
  return normalizeError(error).message;
}