import type { ApiProtocol, ModelConfig, TestModelResult } from '../shared/types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatCompletionResult {
  content: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
}

export interface ModelApiProvider {
  readonly id: string;
  readonly protocol: ApiProtocol;
  readonly model: ModelConfig;
  chat(messages: ChatMessage[], options?: ChatCompletionOptions): Promise<ChatCompletionResult>;
  listModels(signal?: AbortSignal): Promise<string[]>;
  testConnection(signal?: AbortSignal): Promise<TestModelResult>;
}

export interface AudioTranscriptionOptions {
  language?: string;
  prompt?: string;
  signal?: AbortSignal;
}

export interface AudioTranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

export interface AudioApiProvider {
  readonly id: string;
  readonly protocol: ApiProtocol;
  readonly model: ModelConfig;
  transcribe(
    audio: Uint8Array,
    mimeType: string,
    options?: AudioTranscriptionOptions,
  ): Promise<AudioTranscriptionResult>;
  testConnection(signal?: AbortSignal): Promise<TestModelResult>;
  listModels(signal?: AbortSignal): Promise<string[]>;
}

export type AnyProvider = ModelApiProvider | AudioApiProvider;

export function isChatProvider(provider: AnyProvider): provider is ModelApiProvider {
  return provider.protocol === 'openai-chat';
}

export function isAudioProvider(provider: AnyProvider): provider is AudioApiProvider {
  return provider.protocol === 'openai-audio';
}