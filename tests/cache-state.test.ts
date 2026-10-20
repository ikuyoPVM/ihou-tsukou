import { describe, expect, it } from 'vitest';
import { MemoryStorageArea } from '../src/settings/repository';
import { buildCacheKey, TranslationCache } from '../src/translation/cache';
import { emptyPageState, progressFromState, sanitizeSnapshot, sanitizeSubtitleState } from '../src/background/state';
import { createDefaultSettings } from '../src/settings/defaults';
import { encodePcm16Wav } from '../src/shared/wav';
import type { CacheKeyInput } from '../src/translation/cache';
import type { ModelConfig } from '../src/shared/types';

function keyInput(text: string, overrides: Partial<CacheKeyInput> = {}): CacheKeyInput {
  const model: Pick<
    ModelConfig,
    'id' | 'baseUrl' | 'modelId' | 'protocol' | 'temperature' | 'maxTokens' | 'maxTokensField' | 'params'
  > = {
    id: 'm1',
    baseUrl: 'https://api.example.com/v1',
    modelId: 'chat',
    protocol: 'openai-chat',
    params: {},
  };
  return {
    model,
    text,
    sourceLanguage: 'en',
    targetLanguage: 'zh-CN',
    style: 'natural',
    customPrompt: '',
    context: '',
    glossary: [],
    useGlossary: true,
    ...overrides,
  };
}

describe('translation cache', () => {
  it('keys by full text, not only its length', () => {
    expect(buildCacheKey(keyInput('Hello'))).not.toBe(buildCacheKey(keyInput('World')));
    expect(buildCacheKey(keyInput('Hello'))).toBe(buildCacheKey(keyInput('Hello')));
    expect(buildCacheKey(keyInput('Hello', { targetLanguage: 'ja' }))).not.toBe(
      buildCacheKey(keyInput('Hello')),
    );
    expect(
      buildCacheKey(
        keyInput('Hello', {
          glossary: [{ id: 'g', source: 'API', target: '接口', caseSensitive: false }],
        }),
      ),
    ).not.toBe(buildCacheKey(keyInput('Hello')));
  });

  it('does not include the API key in the cache key', () => {
    const withSecret = keyInput('Hello', {
      model: {
        ...keyInput('Hello').model,
        apiKey: 'sk-do-not-hash-me-12345',
      } as CacheKeyInput['model'],
    });
    const withoutSecret = keyInput('Hello');
    expect(buildCacheKey(withSecret)).toBe(buildCacheKey(withoutSecret));
    expect(buildCacheKey(withSecret)).not.toContain('sk-do-not-hash-me-12345');
  });

  it('persists entries, restores them and evicts least recently used', async () => {
    const storage = new MemoryStorageArea();
    const cache = new TranslationCache(storage, 2);
    cache.set('a', 'A');
    cache.set('b', 'B');
    expect(cache.get('a')).toBe('A');
    cache.set('c', 'C');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe('A');
    await cache.persist();

    const reloaded = new TranslationCache(storage, 2);
    await reloaded.init();
    expect(reloaded.get('a')).toBe('A');
    expect(reloaded.get('c')).toBe('C');
    expect(reloaded.stats()).toMatchObject({ entries: 2, maxEntries: 2 });
    expect(await reloaded.clear()).toBe(2);
    expect(reloaded.get('a')).toBeUndefined();
  });

  it('honours a zero-entry cache without throwing', () => {
    const cache = new TranslationCache(new MemoryStorageArea(), 0);
    cache.set('a', 'A');
    expect(cache.get('a')).toBeUndefined();
    expect(cache.stats().entries).toBe(0);
  });

  it('does not resurrect a cleared cache from an already queued write', async () => {
    class DelayedStorage extends MemoryStorageArea {
      private resolveWrite!: () => void;
      readonly gate = new Promise<void>((resolve) => {
        this.resolveWrite = resolve;
      });
      override async set(items: Record<string, unknown>): Promise<void> {
        await this.gate;
        await super.set(items);
      }
      release(): void {
        this.resolveWrite();
      }
    }
    const storage = new DelayedStorage();
    const cache = new TranslationCache(storage, 10);
    cache.set('a', 'A');
    const pendingPersist = cache.persist();
    expect(await cache.clear()).toBe(1);
    storage.release();
    await pendingPersist;
    const reloaded = new TranslationCache(storage, 10);
    await reloaded.init();
    expect(reloaded.stats().entries).toBe(0);
  });
});

describe('background state sanitization', () => {
  it('keeps page counts but bounds strings and error fields', () => {
    const state = sanitizeSnapshot({
      page: {
        status: 'translating',
        total: 10.4,
        completed: -4,
        failed: 2,
        message: 'x'.repeat(2000),
        error: { code: 'X'.repeat(200), message: 'y'.repeat(2000), retryable: 'yes' },
      },
      subtitle: { cues: [{ text: 'secret cue' }], cueCount: 1 },
      url: `https://example.com/${'a'.repeat(4000)}`,
      title: 't'.repeat(1000),
    });
    expect(state.page.total).toBe(10);
    expect(state.page.completed).toBe(0);
    expect(state.page.message?.length).toBe(500);
    expect(state.page.error?.code.length).toBe(80);
    expect(state.page.error?.retryable).toBe(false);
    expect(state.subtitle.cues).toEqual([]);
    expect(state.url.length).toBe(2048);
    expect(state.title.length).toBe(300);
  });

  it('drops full subtitle cues even when the content script reports them', () => {
    const state = sanitizeSubtitleState({
      enabled: true,
      cueCount: 99,
      cues: [{ id: '1', original: 'private text', translation: 'private' }],
      videos: [{ id: 'v', label: 'Video', width: 640, height: 360, trackCount: 2 }],
      style: { fontSize: 9999, color: 'javascript:alert(1)' },
    });
    expect(state.cues).toEqual([]);
    expect(state.cueCount).toBe(99);
    expect(state.style.fontSize).toBeLessThanOrEqual(56);
    expect(state.style.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(state.videos).toHaveLength(1);
  });

  it('computes badge progress including done and error', () => {
    const page = emptyPageState();
    expect(progressFromState(page)).toBeNull();
    expect(progressFromState({ ...page, active: true, status: 'translating', total: 10, completed: 5 })).toEqual({
      text: '50%',
      color: '#2a9d8f',
    });
    expect(progressFromState({ ...page, active: true, status: 'done', total: 10, completed: 10 })).toEqual({
      text: '100%',
      color: '#2a9d8f',
    });
    expect(progressFromState({ ...page, active: true, status: 'error', failed: 1 })).toEqual({
      text: '!',
      color: '#dc4b4b',
    });
  });

  it('produces a valid WAV header for silent test audio', () => {
    const wav = encodePcm16Wav(new Float32Array([0, 0.5, -0.5]), 16_000);
    const text = new TextDecoder().decode(wav.slice(0, 12));
    expect(text).toContain('RIFF');
    expect(text).toContain('WAVE');
    expect(wav.length).toBe(44 + 6);
    expect(createDefaultSettings().languages.target).toBe('zh-CN');
  });
});