import { describe, expect, it } from 'vitest';
import { MemoryStorageArea, SettingsRepository } from '../src/settings/repository';
import { createDefaultSettings } from '../src/settings/defaults';
import { TranslationCache } from '../src/translation/cache';
import { TranslationService } from '../src/translation/service';
import { parseTranslationPayload } from '../src/translation/parse';
import { protectText, restoreText } from '../src/translation/placeholder';
import { joinTranslatedPieces, splitLongText } from '../src/translation/segments';
import type { ModelConfig, ModelConfigInput, Settings } from '../src/shared/types';
import type {
  ChatCompletionOptions,
  ChatCompletionResult,
  ChatMessage,
  ModelApiProvider,
} from '../src/providers/types';

function modelInput(overrides: Partial<ModelConfigInput> = {}): ModelConfigInput {
  return {
    name: '翻译模型',
    providerName: 'Mock',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-test-key-123456',
    protocol: 'openai-chat',
    modelId: 'mock-chat',
    headers: {},
    params: {},
    enabled: true,
    ...overrides,
  };
}

async function setup(customPrompt = '', glossary = createDefaultSettings().translation.glossary) {
  const storage = new MemoryStorageArea();
  const repository = new SettingsRepository(storage);
  const defaults = createDefaultSettings();
  const model = {
    ...modelInput(),
    id: 'model_fixed',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } satisfies ModelConfig;
  const settings: Settings = {
    ...defaults,
    models: [model],
    defaultModelId: model.id,
    taskModels: { ...defaults.taskModels, webpage: model.id, subtitles: model.id },
    translation: { ...defaults.translation, customPrompt, glossary },
  };
  await repository.save(settings);
  const cache = new TranslationCache(storage);
  return { repository, cache, model, settings };
}

class FakeProvider implements ModelApiProvider {
  readonly id = 'fake';
  readonly protocol = 'openai-chat' as const;
  calls: ChatMessage[][] = [];
  mode: 'normal' | 'invalid-on-batch' = 'normal';

  constructor(readonly model: ModelConfig) {}

  async chat(messages: ChatMessage[], _options?: ChatCompletionOptions): Promise<ChatCompletionResult> {
    this.calls.push(messages);
    const user = messages[1]?.content ?? '';
    const start = user.indexOf('{"segments"');
    const end = user.lastIndexOf('}');
    const payload = JSON.parse(user.slice(start, end + 1)) as {
      segments: Array<{ id: string; text: string }>;
    };
    if (this.mode === 'invalid-on-batch' && payload.segments.length > 1) {
      return { content: 'this is not the required JSON payload' };
    }
    return {
      content: JSON.stringify({
        translations: payload.segments.map((segment) => ({
          id: segment.id,
          text: `译:${segment.text}`,
        })),
      }),
    };
  }

  async listModels(): Promise<string[]> {
    return ['mock-chat'];
  }

  async testConnection() {
    return { ok: true, latencyMs: 1, message: 'ok', model: 'mock-chat' };
  }
}

describe('translation protocol', () => {
  it('parses IDs, positional results and rejects count/ID mismatches', () => {
    expect(
      parseTranslationPayload(
        '{"translations":[{"id":"0","text":"你好"},{"id":"1","text":"世界"}]}',
        ['0', '1'],
      ),
    ).toEqual([
      { id: '0', text: '你好' },
      { id: '1', text: '世界' },
    ]);
    expect(parseTranslationPayload('["甲","乙"]', ['a', 'b'])).toEqual([
      { id: 'a', text: '甲' },
      { id: 'b', text: '乙' },
    ]);
    expect(() => parseTranslationPayload('{"translations":[]}', ['0'])).toThrow(
      expect.objectContaining({ code: 'INVALID_RESPONSE' }),
    );
    expect(() =>
      parseTranslationPayload('{"translations":[{"id":"other","text":"x"}]}', ['0']),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RESPONSE' }));
    expect(() =>
      parseTranslationPayload('```json\n{"translations":[{"id":"0","text":"x"}]}\n```', ['0']),
    ).not.toThrow();
  });

  it('protects URLs, e-mail and glossary terms with round-trippable tokens', () => {
    const protectedText = protectText('Visit https://example.com/a?b=1 or mail a@b.com. Use API.', [
      { id: 't1', source: 'API', target: '接口', caseSensitive: true },
    ]);
    expect(protectedText.text).not.toContain('https://example.com');
    expect(protectedText.text).not.toContain('a@b.com');
    expect(protectedText.text).not.toContain('API');
    const restored = restoreText(protectedText.text.replace('Use', '使用'), protectedText);
    expect(restored).toContain('https://example.com/a?b=1');
    expect(restored).toContain('a@b.com');
    expect(restored).toContain('接口');
    expect(() => restoreText('missing token', protectedText)).toThrow(
      expect.objectContaining({ code: 'INVALID_RESPONSE' }),
    );
  });

  it('splits long text at boundaries and joins translated pieces', () => {
    const text = `${'First sentence. '.repeat(200)}Last line without punctuation`;
    const pieces = splitLongText(text, 300);
    expect(pieces.length).toBeGreaterThan(1);
    expect(pieces.map((piece) => piece.text).join('').length).toBeLessThan(text.length);
    const joined = joinTranslatedPieces(
      pieces,
      pieces.map((piece) => `译:${piece.text}`),
    );
    expect(joined).toContain('译:First sentence.');
    expect(joined).not.toContain('undefined');
  });
});

describe('TranslationService', () => {
  it('translates, caches and reports cached count without leaking API keys', async () => {
    const { repository, cache, model } = await setup('面向开发者');
    const fake = new FakeProvider(model);
    const service = new TranslationService(repository, cache, {
      providerFactory: () => fake,
      retryDelaysMs: [],
    });

    const first = await service.translateBatch({
      requestId: 'r1',
      task: 'webpage',
      chunks: ['Hello', 'World'],
    });
    expect(first.translations).toEqual(['译:Hello', '译:World']);
    expect(first.cachedCount).toBe(0);
    expect(fake.calls).toHaveLength(1);

    const second = await service.translateBatch({
      requestId: 'r2',
      task: 'webpage',
      chunks: ['Hello', 'World'],
    });
    expect(second.translations).toEqual(['译:Hello', '译:World']);
    expect(second.cachedCount).toBe(2);
    expect(fake.calls).toHaveLength(1);

    const bypassed = await service.translateBatch({
      requestId: 'r3',
      task: 'webpage',
      chunks: ['Hello'],
      bypassCache: true,
    });
    expect(bypassed.translations).toEqual(['译:Hello']);
    expect(fake.calls).toHaveLength(2);
  });

  it('retries the batch individually when a multi-item response is malformed', async () => {
    const { repository, cache, model } = await setup();
    const fake = new FakeProvider(model);
    fake.mode = 'invalid-on-batch';
    const service = new TranslationService(repository, cache, {
      providerFactory: () => fake,
      retryDelaysMs: [],
    });

    const result = await service.translateBatch({
      requestId: 'fallback',
      task: 'webpage',
      chunks: ['one', 'two'],
    });
    expect(result.translations).toEqual(['译:one', '译:two']);
    // One failed batch + one request per segment.
    expect(fake.calls).toHaveLength(3);
  });

  it('accepts glossary glossary and keeps the protected terms after translation', async () => {
    const glossary = [{ id: 't1', source: 'API', target: '接口', caseSensitive: false }];
    const { repository, cache, model } = await setup('', glossary);
    const fake = new FakeProvider(model);
    const service = new TranslationService(repository, cache, {
      providerFactory: () => fake,
      retryDelaysMs: [],
    });

    const result = await service.translateBatch({
      requestId: 'glossary',
      task: 'webpage',
      chunks: ['Use the API now'],
    });
    expect(result.translations[0]).toContain('接口');
    expect(result.translations[0]).not.toContain('API');
  });

  it('fails clearly when no model is configured or the target equals source', async () => {
    const { repository, cache, model } = await setup();
    const fake = new FakeProvider(model);
    const service = new TranslationService(repository, cache, {
      providerFactory: () => fake,
      retryDelaysMs: [],
    });
    await expect(
      service.translateBatch({
        requestId: 'x',
        task: 'webpage',
        chunks: ['a'],
        sourceLanguage: 'en',
        targetLanguage: 'en',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    const empty = await new SettingsRepository(new MemoryStorageArea()).load();
    const noModelService = new TranslationService(new SettingsRepository(new MemoryStorageArea()), new TranslationCache(new MemoryStorageArea()), {
      providerFactory: () => fake,
    });
    expect(empty.models).toHaveLength(0);
    await expect(
      noModelService.translateBatch({ requestId: 'y', task: 'webpage', chunks: ['a'] }),
    ).rejects.toMatchObject({ code: 'NO_MODEL' });
  });
});