import { describe, expect, it } from 'vitest';
import { BackgroundRouter } from '../src/background/router';
import { ModelService } from '../src/background/model-service';
import { createDefaultSettings } from '../src/settings/defaults';
import { MemoryStorageArea, SettingsRepository } from '../src/settings/repository';
import { TranslationCache } from '../src/translation/cache';
import { TranslationService } from '../src/translation/service';
import type { ModelConfigInput } from '../src/shared/types';

const RUNTIME_ID = 'abcdefghijklmnopabcdefghijklmnop';

function input(overrides: Partial<ModelConfigInput> = {}): ModelConfigInput {
  return {
    name: 'Secret model',
    providerName: 'Mock',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-router-secret-12345',
    protocol: 'openai-chat',
    modelId: 'mock',
    headers: {},
    params: {},
    enabled: true,
    ...overrides,
  };
}

async function makeRouter() {
  const storage = new MemoryStorageArea();
  const repository = new SettingsRepository(storage);
  await repository.save(createDefaultSettings());
  const models = new ModelService(repository);
  const saved = await models.save(input());
  await models.setDefault(saved.id);
  await models.setTaskModel('webpage', saved.id);
  const cache = new TranslationCache(storage);
  const translation = new TranslationService(repository, cache);
  return {
    router: new BackgroundRouter({ repository, cache, translation, models, runtimeId: RUNTIME_ID }),
    saved,
  };
}

const contentSender = {
  id: RUNTIME_ID,
  tab: { id: 7 },
  url: 'https://example.com/article',
} as unknown as chrome.runtime.MessageSender;

const uiSender = {
  id: RUNTIME_ID,
  url: `chrome-extension://${RUNTIME_ID}/options.html`,
} as unknown as chrome.runtime.MessageSender;

describe('background sender isolation', () => {
  it('serves public settings to content without any API key', async () => {
    const { router } = await makeRouter();
    const response = await router.handle({ type: 'settings.getPublic' }, contentSender);
    expect(response.ok).toBe(true);
    if (!response.ok) return;
    expect(JSON.stringify(response.data)).not.toContain('sk-router-secret-12345');
    expect((response.data as { models: Array<Record<string, unknown>> }).models[0]).not.toHaveProperty(
      'apiKey',
    );
  });

  it('denies full settings, model writes and model tests to content scripts', async () => {
    const { router } = await makeRouter();
    for (const message of [
      { type: 'settings.getFull' as const },
      { type: 'settings.saveModel' as const, model: input() },
      { type: 'settings.deleteModel' as const, id: 'x' },
      { type: 'models.test' as const, modelId: 'x' },
      { type: 'tab.command' as const, command: { type: 'page:start' as const } },
      { type: 'cache.clear' as const },
      { type: 'data.clear' as const },
    ]) {
      const response = await router.handle(message, contentSender);
      expect(response).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
    }
  });

  it('denies translation and subtitle state reports from extension UI', async () => {
    const { router } = await makeRouter();
    const translation = await router.handle(
      {
        type: 'translate.batch',
        request: { requestId: 'r', task: 'webpage', chunks: ['hello'] },
      },
      uiSender,
    );
    expect(translation).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });

    const report = await router.handle(
      {
        type: 'tab.stateReport',
        page: { status: 'idle' } as never,
        subtitle: {} as never,
        url: 'https://example.com',
        title: 'x',
      },
      uiSender,
    );
    expect(report).toMatchObject({ ok: false, error: { code: 'PERMISSION_DENIED' } });
  });

  it('allows extension UI to read the full settings and save a model', async () => {
    const { router } = await makeRouter();
    const full = await router.handle({ type: 'settings.getFull' }, uiSender);
    expect(full.ok).toBe(true);
    if (full.ok) {
      expect(JSON.stringify(full.data)).toContain('sk-router-secret-12345');
    }
    const saved = await router.handle(
      { type: 'settings.saveModel', model: input({ name: 'Second' }) },
      uiSender,
    );
    expect(saved.ok).toBe(true);
  });
});