import { CACHE_STORAGE_KEY, LEGACY_CACHE_STORAGE_KEY } from '../shared/constants';
import type { CacheStats, GlossaryEntry, ModelConfig, TranslationStyle } from '../shared/types';
import { bytesOfString, hashString, isPlainObject } from '../shared/utils';
import type { StorageAreaLike } from '../settings/repository';

interface StoredCacheEntry {
  value: string;
  createdAt: number;
  lastUsedAt: number;
}

interface StoredCacheData {
  version: 1;
  entries: Record<string, StoredCacheEntry>;
}

export interface CacheKeyInput {
  model: Pick<
    ModelConfig,
    'id' | 'baseUrl' | 'modelId' | 'protocol' | 'temperature' | 'maxTokens' | 'maxTokensField' | 'params'
  >;
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  style: TranslationStyle;
  customPrompt: string;
  context: string;
  glossary: GlossaryEntry[];
  useGlossary: boolean;
}

export function buildCacheKey(input: CacheKeyInput): string {
  const glossary = input.useGlossary
    ? input.glossary.map((entry) => [entry.source, entry.target, entry.caseSensitive])
    : [];
  const fingerprint = {
    text: input.text,
    id: input.model.id,
    baseUrl: input.model.baseUrl,
    modelId: input.model.modelId,
    protocol: input.model.protocol,
    temperature: input.model.temperature ?? null,
    maxTokens: input.model.maxTokens ?? null,
    maxTokensField: input.model.maxTokensField ?? null,
    params: input.model.params,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage,
    style: input.style,
    customPrompt: input.customPrompt,
    context: input.context,
    glossary,
  };
  return `${hashString(JSON.stringify(fingerprint))}:${input.text.length}`;
}

export class TranslationCache {
  private entries = new Map<string, StoredCacheEntry>();
  private initialized = false;
  private persistChain: Promise<void> = Promise.resolve();
  private revision = 0;
  private maxEntries: number;

  constructor(
    private readonly storage: StorageAreaLike,
    maxEntries = 1500,
  ) {
    this.maxEntries = Math.max(0, maxEntries);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const raw = await this.storage.get([CACHE_STORAGE_KEY, LEGACY_CACHE_STORAGE_KEY]);
      const data = raw[CACHE_STORAGE_KEY] ?? raw[LEGACY_CACHE_STORAGE_KEY];
      if (!isPlainObject(data) || data.version !== 1 || !isPlainObject(data.entries)) return;
      for (const [key, entry] of Object.entries(data.entries)) {
        if (!isPlainObject(entry) || typeof entry.value !== 'string') continue;
        this.entries.set(key, {
          value: entry.value,
          createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
          lastUsedAt: typeof entry.lastUsedAt === 'number' ? entry.lastUsedAt : Date.now(),
        });
      }
      this.evict();
    } catch {
      // Cache is an optimization. A broken cache must never block translation.
      this.entries.clear();
    }
  }

  setMaxEntries(maxEntries: number): void {
    this.maxEntries = Math.max(0, maxEntries);
    this.evict();
  }

  get(key: string): string | undefined {
    if (this.maxEntries === 0) return undefined;
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.lastUsedAt = Date.now();
    // Refresh insertion order for LRU eviction.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  has(key: string): boolean {
    return this.maxEntries > 0 && this.entries.has(key);
  }

  set(key: string, value: string): void {
    if (this.maxEntries === 0) return;
    const now = Date.now();
    this.entries.delete(key);
    this.entries.set(key, { value, createdAt: now, lastUsedAt: now });
    this.evict();
  }

  async persist(): Promise<void> {
    const revision = this.revision;
    const snapshot: StoredCacheData = {
      version: 1,
      entries: Object.fromEntries(this.entries),
    };
    this.persistChain = this.persistChain.catch(() => undefined).then(async () => {
      // A clear() after this snapshot was queued must win; otherwise the stale
      // snapshot would resurrect the cache that the user just deleted.
      if (revision !== this.revision) return;
      try {
        await this.storage.set({ [CACHE_STORAGE_KEY]: snapshot });
      } catch (error) {
        console.warn('[意方通行] Translation cache could not be persisted.', error);
      }
    });
    await this.persistChain;
  }

  stats(): CacheStats {
    let bytes = 0;
    for (const [key, entry] of this.entries) {
      bytes += bytesOfString(key) + bytesOfString(entry.value) + 80;
    }
    return { entries: this.entries.size, approxBytes: bytes, maxEntries: this.maxEntries };
  }

  async clear(): Promise<number> {
    this.revision += 1;
    const count = this.entries.size;
    this.entries.clear();
    try {
      await this.storage.remove([CACHE_STORAGE_KEY, LEGACY_CACHE_STORAGE_KEY]);
    } catch {
      // Ignore storage cleanup failures; memory has already been cleared.
    }
    return count;
  }

  private evict(): void {
    while (this.maxEntries >= 0 && this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }
}