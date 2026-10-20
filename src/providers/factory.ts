import { AppError } from '../shared/errors';
import type { ModelConfig } from '../shared/types';
import type { FetchLike } from './http';
import { OpenAICompatibleProvider } from './openai';
import type { AnyProvider, AudioApiProvider, ModelApiProvider } from './types';

export interface ProviderDeps {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export function createProvider(model: ModelConfig, deps: ProviderDeps = {}): AnyProvider {
  switch (model.protocol) {
    case 'openai-chat':
    case 'openai-audio':
      return new OpenAICompatibleProvider(model, deps);
    default:
      throw new AppError('UNSUPPORTED_PROTOCOL', '不支持的 API 协议。');
  }
}

export function createChatProvider(model: ModelConfig, deps: ProviderDeps = {}): ModelApiProvider {
  if (model.protocol !== 'openai-chat') {
    throw new AppError('UNSUPPORTED_PROTOCOL', '该配置不是 Chat Completions 协议。');
  }
  return createProvider(model, deps) as ModelApiProvider;
}

export function createAudioProvider(model: ModelConfig, deps: ProviderDeps = {}): AudioApiProvider {
  if (model.protocol !== 'openai-audio') {
    throw new AppError('UNSUPPORTED_PROTOCOL', '该配置不是 Audio Transcription 协议。');
  }
  return createProvider(model, deps) as AudioApiProvider;
}