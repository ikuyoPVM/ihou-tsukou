import { DEFAULT_TIMEOUT_MS } from '../shared/constants';
import { AppError, normalizeError } from '../shared/errors';
import type { ModelConfig, TestModelResult } from '../shared/types';
import { createSilentWav } from '../shared/wav';
import type {
  AudioApiProvider,
  AudioTranscriptionOptions,
  AudioTranscriptionResult,
  ChatCompletionOptions,
  ChatCompletionResult,
  ChatMessage,
  ModelApiProvider,
} from './types';
import {
  classifyHttpFailure,
  fetchWithTimeout,
  parseJsonResponse,
  providerHeaders,
  readResponseText,
  resolveApiUrl,
  type FetchLike,
} from './http';

interface ChatApiResponse {
  choices?: Array<{
    message?: { content?: unknown };
    text?: unknown;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

interface AudioApiResponse {
  text?: unknown;
  result?: { text?: unknown };
  data?: { text?: unknown };
}

function contentToText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (typeof part === 'string') parts.push(part);
      else if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
        parts.push((part as { text: string }).text);
      }
    }
    return parts.join('');
  }
  return null;
}

export class OpenAICompatibleProvider implements ModelApiProvider, AudioApiProvider {
  readonly id: string;
  readonly model: ModelConfig;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(model: ModelConfig, options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}) {
    this.id = model.id;
    this.model = model;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get protocol(): ModelConfig['protocol'] {
    return this.model.protocol;
  }

  private get secrets(): string[] {
    return [this.model.apiKey, ...Object.values(this.model.headers)];
  }

  private async request(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    return fetchWithTimeout(url, init, {
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      signal,
      secrets: this.secrets,
    });
  }

  async chat(messages: ChatMessage[], options: ChatCompletionOptions = {}): Promise<ChatCompletionResult> {
    if (this.model.protocol !== 'openai-chat') {
      throw new AppError('UNSUPPORTED_PROTOCOL', '该配置不是 Chat Completions 协议，不能用于文本翻译。');
    }
    const url = resolveApiUrl(this.model.baseUrl, '/chat/completions');
    const body: Record<string, unknown> = {
      ...this.model.params,
      model: this.model.modelId,
      messages,
      stream: false,
    };
    if (this.model.temperature !== undefined) body.temperature = this.model.temperature;
    const maxTokens = options.maxTokens ?? this.model.maxTokens;
    if (maxTokens !== undefined) {
      body[this.model.maxTokensField ?? 'max_tokens'] = maxTokens;
    }
    let response: Response;
    try {
      response = await this.request(
        url,
        {
          method: 'POST',
          headers: providerHeaders(this.model, { 'Content-Type': 'application/json' }),
          body: JSON.stringify(body),
        },
        options.signal,
      );
    } catch (error) {
      throw normalizeError(error);
    }
    const raw = await readResponseText(response);
    if (!response.ok) {
      throw classifyHttpFailure(response.status, raw, this.secrets);
    }
    const json = await parseJsonResponse<ChatApiResponse>(response, this.secrets, raw);
    const choice = json.choices?.[0];
    const content = contentToText(choice?.message?.content) ?? contentToText(choice?.text);
    if (typeof content !== 'string') {
      throw new AppError('INVALID_RESPONSE', '接口响应中没有 choices[0].message.content。请确认使用 Chat Completions 兼容接口。');
    }
    return {
      content,
      usage: {
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens,
      },
    };
  }

  async listModels(signal?: AbortSignal): Promise<string[]> {
    const url = resolveApiUrl(this.model.baseUrl, '/models');
    let response: Response;
    try {
      response = await this.request(
        url,
        { method: 'GET', headers: providerHeaders(this.model) },
        signal,
      );
    } catch (error) {
      throw normalizeError(error);
    }
    const raw = await readResponseText(response);
    if (!response.ok) throw classifyHttpFailure(response.status, raw, this.secrets);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new AppError('INVALID_RESPONSE', '模型列表接口返回的不是 JSON。');
    }
    const result: string[] = [];
    const add = (value: unknown) => {
      if (typeof value === 'string' && value.trim() && !result.includes(value)) result.push(value);
    };
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === 'string') add(item);
        else if (item && typeof item === 'object') add((item as { id?: unknown }).id);
      }
    } else if (parsed && typeof parsed === 'object') {
      const data = (parsed as { data?: unknown; models?: unknown }).data;
      const models = (parsed as { data?: unknown; models?: unknown }).models;
      const list = Array.isArray(data) ? data : Array.isArray(models) ? models : [];
      for (const item of list) {
        if (typeof item === 'string') add(item);
        else if (item && typeof item === 'object') add((item as { id?: unknown }).id);
      }
    }
    return result.sort((a, b) => a.localeCompare(b));
  }

  async testConnection(signal?: AbortSignal): Promise<TestModelResult> {
    const start = Date.now();
    try {
      if (this.model.protocol === 'openai-audio') {
        const result = await this.transcribe(createSilentWav(0.25), 'audio/wav', { signal });
        return {
          ok: true,
          latencyMs: Date.now() - start,
          message: result.text
            ? `连接成功，语音接口返回了 ${result.text.length} 个字符。`
            : '连接成功（静音测试未返回文本）。',
          model: this.model.modelId,
        };
      }
      const result = await this.chat(
        [
          { role: 'system', content: 'You are a connectivity test. Follow the instruction exactly.' },
          { role: 'user', content: 'Reply with exactly: OK' },
        ],
        { maxTokens: 24, signal },
      );
      return {
        ok: true,
        latencyMs: Date.now() - start,
        message: result.content.trim()
          ? `连接成功，模型返回：${result.content.trim().slice(0, 60)}`
          : '连接成功，但模型返回空内容。',
        model: this.model.modelId,
      };
    } catch (error) {
      const normalized = normalizeError(error);
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: normalized.message,
        model: this.model.modelId,
        code: normalized.code,
      };
    }
  }

  async transcribe(
    audio: Uint8Array,
    mimeType: string,
    options: AudioTranscriptionOptions = {},
  ): Promise<AudioTranscriptionResult> {
    if (this.model.protocol !== 'openai-audio') {
      throw new AppError('UNSUPPORTED_PROTOCOL', '该配置不是音频转写协议。');
    }
    const url = resolveApiUrl(this.model.baseUrl, '/audio/transcriptions');
    const form = new FormData();
    const copy = new Uint8Array(audio.byteLength);
    copy.set(audio);
    const extension = mimeType.includes('webm') ? 'webm' : mimeType.includes('mp3') ? 'mp3' : 'wav';
    form.append('file', new Blob([copy.buffer], { type: mimeType }), `audio.${extension}`);
    form.append('model', this.model.modelId);
    if (options.language) form.append('language', options.language);
    if (options.prompt) form.append('prompt', options.prompt);
    let response: Response;
    try {
      response = await this.request(
        url,
        {
          method: 'POST',
          headers: providerHeaders(this.model),
          body: form,
        },
        options.signal,
      );
    } catch (error) {
      throw normalizeError(error);
    }
    const raw = await readResponseText(response);
    if (!response.ok) throw classifyHttpFailure(response.status, raw, this.secrets);
    let parsed: AudioApiResponse | null = null;
    try {
      parsed = JSON.parse(raw) as AudioApiResponse;
    } catch {
      // Some servers return plain text for transcriptions.
      if (raw.trim()) return { text: raw.trim() };
      throw new AppError('INVALID_RESPONSE', '语音识别接口返回了空内容。');
    }
    const candidates = [parsed.text, parsed.result?.text, parsed.data?.text];
    const hasTextField = candidates.some((value) => typeof value === 'string');
    if (!hasTextField) {
      throw new AppError('INVALID_RESPONSE', '语音识别接口响应中缺少 text 字段。');
    }
    const text = candidates.find((value): value is string => typeof value === 'string') ?? '';
    // A 200 response with {"text": ""} is valid (for example silent audio) and
    // should not turn the connectivity test into a false failure.
    return { text };
  }
}