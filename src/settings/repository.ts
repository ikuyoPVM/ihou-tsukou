import { STORAGE_KEY } from '../shared/constants';
import { AppError } from '../shared/errors';
import type { Settings } from '../shared/types';
import { normalizeSettings } from './validation';

export interface StorageAreaLike {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  clear(): Promise<void>;
}

export class ChromeStorageArea implements StorageAreaLike {
  constructor(private readonly area: chrome.storage.StorageArea = chrome.storage.local) {}

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    return (await this.area.get(keys)) as Record<string, unknown>;
  }

  async set(items: Record<string, unknown>): Promise<void> {
    await this.area.set(items);
  }

  async remove(keys: string | string[]): Promise<void> {
    await this.area.remove(keys);
  }

  async clear(): Promise<void> {
    await this.area.clear();
  }
}

export class MemoryStorageArea implements StorageAreaLike {
  readonly data = new Map<string, unknown>();

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    if (keys === null) return Object.fromEntries(this.data);
    const list = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(list.filter((key) => this.data.has(key)).map((key) => [key, this.data.get(key)]));
  }

  async set(items: Record<string, unknown>): Promise<void> {
    for (const [key, value] of Object.entries(items)) {
      this.data.set(key, structuredClone(value));
    }
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.data.delete(key);
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}

/**
 * Single-owner repository for extension settings. All callers share one serialized
 * write queue so parallel model edits cannot clobber each other.
 */
export class SettingsRepository {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly storage: StorageAreaLike) {}

  async load(): Promise<Settings> {
    try {
      const raw = await this.storage.get(STORAGE_KEY);
      return normalizeSettings(raw[STORAGE_KEY]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('STORAGE_ERROR', '无法读取扩展设置。', { cause: error });
    }
  }

  async save(settings: Settings): Promise<void> {
    try {
      await this.storage.set({ [STORAGE_KEY]: settings });
    } catch (error) {
      throw new AppError('STORAGE_ERROR', '无法保存扩展设置（可能超出存储配额）。', { cause: error });
    }
  }

  async update<T>(mutator: (settings: Settings) => { settings: Settings; result: T }): Promise<T> {
    const operation = this.writeChain.catch(() => undefined).then(async () => {
      const current = await this.load();
      const { settings, result } = mutator(current);
      await this.save(normalizeSettings(settings));
      return result;
    });
    this.writeChain = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async clear(): Promise<void> {
    try {
      await this.storage.remove(STORAGE_KEY);
    } catch (error) {
      throw new AppError('STORAGE_ERROR', '无法清除扩展设置。', { cause: error });
    }
  }
}