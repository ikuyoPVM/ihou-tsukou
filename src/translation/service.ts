import { MAX_BATCH_CHARS, MAX_BATCH_ITEMS, TARGET_LANGUAGES } from '../shared/constants';
import { AppError, isAbortError, normalizeError } from '../shared/errors';
import type {
  GlossaryEntry,
  ModelConfig,
  TranslateBatchData,
  TranslateBatchRequest,
  TranslationStyle,
} from '../shared/types';
import { sleep } from '../shared/utils';
import { createChatProvider } from '../providers/factory';
import type { ChatMessage, ModelApiProvider } from '../providers/types';
import type { SettingsRepository } from '../settings/repository';
import { taskChatModel } from '../settings/validation';
import { buildCacheKey, TranslationCache } from './cache';
import { parseTranslationPayload } from './parse';
import { protectText, restoreText } from './placeholder';
import { buildSystemPrompt, buildUserPrompt } from './prompt';
import { joinTranslatedPieces, splitLongText, type TextPiece } from './segments';

export interface TranslationServiceDeps {
  providerFactory?: (model: ModelConfig) => ModelApiProvider;
  retryDelaysMs?: number[];
}

interface WorkItem {
  workId: string;
  chunkIndex: number;
  pieceIndex: number;
  text: string;
  separator: string;
  cacheKey: string;
  cached?: string;
}

interface TranslationOptions {
  sourceLanguage: string;
  targetLanguage: string;
  style: TranslationStyle;
  customPrompt: string;
  context: string;
  glossary: GlossaryEntry[];
  useGlossary: boolean;
  taskLabel: string;
}

const TARGET_CODES = new Set<string>(TARGET_LANGUAGES.map((language) => language.code));
const MAX_REQUEST_CHUNKS = 200;
const MAX_REQUEST_CHARS = 120_000;

export class TranslationService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly cache: TranslationCache,
    private readonly deps: TranslationServiceDeps = {},
  ) {}

  async translateBatch(
    request: TranslateBatchRequest,
    signal?: AbortSignal,
  ): Promise<TranslateBatchData> {
    if (!request || !Array.isArray(request.chunks) || request.chunks.length === 0) {
      throw new AppError('INVALID_REQUEST', '没有需要翻译的文本。');
    }
    if (request.chunks.length > MAX_REQUEST_CHUNKS) {
      throw new AppError('INVALID_REQUEST', '单次翻译段落过多，请分批请求。');
    }
    if (request.chunks.some((chunk) => typeof chunk !== 'string')) {
      throw new AppError('INVALID_REQUEST', '翻译文本必须是字符串。');
    }
    const totalChars = request.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    if (totalChars > MAX_REQUEST_CHARS) {
      throw new AppError('INVALID_REQUEST', '单次翻译内容过长，请减少文本后重试。');
    }
    if (signal?.aborted) throw new AppError('CANCELLED');

    const settings = await this.repository.load();
    this.cache.setMaxEntries(settings.cache.maxEntries);
    await this.cache.init();

    const model = this.resolveModel(settings, request);
    const sourceLanguage = request.sourceLanguage || settings.languages.source || 'auto';
    const targetLanguage =
      request.targetLanguage && TARGET_CODES.has(request.targetLanguage)
        ? request.targetLanguage
        : settings.languages.target;
    if (sourceLanguage === targetLanguage) {
      throw new AppError('INVALID_REQUEST', '源语言与目标语言相同，请选择不同的目标语言。');
    }
    const style = request.style ?? settings.translation.style;
    const glossary = settings.translation.useGlossary ? settings.translation.glossary : [];
    const context = [settings.translation.context.trim(), request.context?.trim().slice(0, 1000)]
      .filter(Boolean)
      .join('\n');
    const options: TranslationOptions = {
      sourceLanguage,
      targetLanguage,
      style,
      customPrompt: settings.translation.customPrompt,
      context,
      glossary,
      useGlossary: settings.translation.useGlossary,
      taskLabel:
        request.task === 'subtitles'
          ? '视频字幕翻译（保持字幕简短，不合并相邻条目）'
          : request.task === 'quality'
            ? '高质量文本翻译'
            : '网页文本翻译',
    };

    const provider = this.deps.providerFactory?.(model) ?? createChatProvider(model);
    const workByChunk: WorkItem[][] = [];
    const pending: WorkItem[] = [];
    let cachedCount = 0;

    request.chunks.forEach((chunk, chunkIndex) => {
      if (!chunk.trim()) {
        workByChunk[chunkIndex] = [];
        return;
      }
      const pieces = splitLongText(chunk, 1800);
      const items: WorkItem[] = pieces.map((piece, pieceIndex) => {
        const cacheKey = buildCacheKey({
          model,
          text: piece.text,
          sourceLanguage,
          targetLanguage,
          style,
          customPrompt: settings.translation.customPrompt,
          context,
          glossary: settings.translation.glossary,
          useGlossary: settings.translation.useGlossary,
        });
        return {
          workId: `${chunkIndex}:${pieceIndex}`,
          chunkIndex,
          pieceIndex,
          text: piece.text,
          separator: piece.separator,
          cacheKey,
        };
      });
      for (const item of items) {
        if (!request.bypassCache) {
          const cached = this.cache.get(item.cacheKey);
          if (cached !== undefined) {
            item.cached = cached;
            cachedCount += 1;
          }
        }
        if (item.cached === undefined) pending.push(item);
      }
      workByChunk[chunkIndex] = items;
    });

    const groups = groupWorkItems(pending);
    for (const group of groups) {
      if (signal?.aborted) throw new AppError('CANCELLED');
      const translations = await this.translateGroup(group, provider, options, signal);
      for (const item of group) {
        const translation = translations.get(item.workId);
        if (translation === undefined) {
          throw new AppError('INVALID_RESPONSE', '模型返回结果未能覆盖全部段落。');
        }
        item.cached = translation;
        this.cache.set(item.cacheKey, translation);
      }
    }

    if (pending.length > 0) await this.cache.persist();

    const translations = request.chunks.map((chunk, chunkIndex) => {
      if (!chunk.trim()) return chunk;
      const items = workByChunk[chunkIndex] ?? [];
      const pieces: TextPiece[] = items.map((item) => ({
        text: item.text,
        separator: item.separator,
      }));
      return joinTranslatedPieces(
        pieces,
        items.map((item) => item.cached ?? ''),
      );
    });

    return {
      translations,
      modelId: model.id,
      modelName: model.name,
      cachedCount,
    };
  }

  private resolveModel(
    settings: Awaited<ReturnType<SettingsRepository['load']>>,
    request: TranslateBatchRequest,
  ): ModelConfig {
    if (request.task === 'asr') {
      throw new AppError('UNSUPPORTED_PROTOCOL', '语音识别不能使用文本翻译接口。');
    }
    if (request.modelId) {
      const configured = settings.models.find((model) => model.id === request.modelId);
      if (!configured) throw new AppError('NOT_FOUND', '请求的模型配置不存在。');
      if (!configured.enabled) throw new AppError('MODEL_DISABLED');
      if (configured.protocol !== 'openai-chat') {
        throw new AppError('UNSUPPORTED_PROTOCOL', '该模型不是 Chat Completions 协议，无法翻译文本。');
      }
      return configured;
    }
    return taskChatModel(settings, request.task);
  }

  private async translateGroup(
    items: WorkItem[],
    provider: ModelApiProvider,
    options: TranslationOptions,
    signal?: AbortSignal,
  ): Promise<Map<string, string>> {
    if (items.length === 0) return new Map();
    const ids = items.map((_, index) => String(index));
    const segments = items.map((item, index) => {
      const protectedText = protectText(item.text, options.glossary);
      return { id: ids[index]!, text: protectedText.text, protectedText };
    });
    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt() },
      {
        role: 'user',
        content: buildUserPrompt(
          segments.map((segment) => ({ id: segment.id, text: segment.text })),
          options,
        ),
      },
    ];
    try {
      const content = await this.withRetry(
        () => provider.chat(messages, { signal }),
        signal,
      );
      const parsed = parseTranslationPayload(content.content, ids);
      const result = new Map<string, string>();
      parsed.forEach((entry, index) => {
        const item = items[index];
        const segment = segments[index];
        if (!item || !segment) throw new AppError('INVALID_RESPONSE');
        const restored = restoreText(entry.text, segment.protectedText);
        if (!restored.trim()) {
          throw new AppError('INVALID_RESPONSE', '模型返回了空译文。');
        }
        result.set(item.workId, restored);
      });
      return result;
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized.code !== 'INVALID_RESPONSE' || items.length <= 1) {
        throw normalized;
      }
    }

    // Fall back to individual requests so one malformed translation cannot
    // discard the whole batch. Only format failures reach this path.
    const result = new Map<string, string>();
    for (const item of items) {
      if (signal?.aborted) throw new AppError('CANCELLED');
      const translated = await this.translateGroup([item], provider, options, signal);
      const value = translated.get(item.workId);
      if (value !== undefined) result.set(item.workId, value);
    }
    return result;
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const retryDelays = this.deps.retryDelaysMs ?? [700, 1800];
    let lastError: unknown;
    for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
      if (signal?.aborted) throw new AppError('CANCELLED');
      try {
        return await operation();
      } catch (error) {
        if (isAbortError(error)) throw new AppError('CANCELLED');
        const normalized = normalizeError(error);
        if (!normalized.retryable || attempt >= retryDelays.length) throw normalized;
        lastError = normalized;
        await sleep(retryDelays[attempt] ?? 2000, signal);
      }
    }
    throw normalizeError(lastError);
  }
}

function groupWorkItems(items: WorkItem[]): WorkItem[][] {
  const groups: WorkItem[][] = [];
  let current: WorkItem[] = [];
  let charCount = 0;
  for (const item of items) {
    if (
      current.length > 0 &&
      (current.length >= MAX_BATCH_ITEMS || charCount + item.text.length > MAX_BATCH_CHARS)
    ) {
      groups.push(current);
      current = [];
      charCount = 0;
    }
    current.push(item);
    charCount += item.text.length;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}