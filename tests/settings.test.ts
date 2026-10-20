import { describe, expect, it } from 'vitest';
import { ModelService } from '../src/background/model-service';
import { MemoryStorageArea, SettingsRepository } from '../src/settings/repository';
import { createDefaultSettings } from '../src/settings/defaults';
import {
  buildPublicSettings,
  normalizeSettings,
  taskAsrModel,
  taskChatModel,
  validateBaseUrl,
} from '../src/settings/validation';
import type { ModelConfigInput } from '../src/shared/types';

function modelInput(overrides: Partial<ModelConfigInput> = {}): ModelConfigInput {
  return {
    name: '测试模型',
    providerName: 'Mock',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'sk-secret-value-12345',
    protocol: 'openai-chat',
    modelId: 'mock-model',
    headers: {},
    params: {},
    enabled: true,
    ...overrides,
  };
}

describe('settings and model persistence', () => {
  it('persists model CRUD, default model and task switches across repository instances', async () => {
    const storage = new MemoryStorageArea();
    const repository = new SettingsRepository(storage);
    await repository.save(createDefaultSettings());
    const models = new ModelService(repository);

    const first = await models.save(modelInput());
    const second = await models.save(
      modelInput({ name: '字幕模型', modelId: 'subtitle-model', protocol: 'openai-chat' }),
    );
    const audio = await models.save(
      modelInput({ name: '语音模型', protocol: 'openai-audio', modelId: 'whisper-local' }),
    );

    expect(first.apiKey).toBe('sk-secret-value-12345');
    expect(second.id).not.toBe(first.id);
    await models.setDefault(first.id);
    await models.setTaskModel('webpage', first.id);
    await models.setTaskModel('subtitles', second.id);
    await models.setTaskModel('asr', audio.id);

    const reloaded = await new SettingsRepository(storage).load();
    expect(reloaded.models).toHaveLength(3);
    expect(reloaded.defaultModelId).toBe(first.id);
    expect(reloaded.taskModels.webpage).toBe(first.id);
    expect(reloaded.taskModels.subtitles).toBe(second.id);
    expect(reloaded.taskModels.asr).toBe(audio.id);
    expect(reloaded.models.find((model) => model.id === first.id)?.apiKey).toBe(
      'sk-secret-value-12345',
    );

    const publicSettings = buildPublicSettings(reloaded);
    expect(JSON.stringify(publicSettings)).not.toContain('sk-secret-value-12345');
    expect(publicSettings.models[0]).not.toHaveProperty('apiKey');

    const copy = await models.duplicate(first.id);
    expect(copy.name).toContain('副本');
    expect(copy.id).not.toBe(first.id);
    expect(copy.apiKey).toBe(first.apiKey);

    expect(await models.delete(second.id)).toBe(true);
    const afterDelete = await repository.load();
    expect(afterDelete.models.some((model) => model.id === second.id)).toBe(false);
    expect(afterDelete.taskModels.subtitles).toBeNull();
    expect(() => taskChatModel(afterDelete, 'subtitles')).not.toThrow();
  });

  it('serializes concurrent updates without losing models', async () => {
    const storage = new MemoryStorageArea();
    const repository = new SettingsRepository(storage);
    await repository.save(createDefaultSettings());
    const models = new ModelService(repository);

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        models.save(modelInput({ name: `并发 ${index}`, modelId: `model-${index}` })),
      ),
    );

    const settings = await repository.load();
    expect(settings.models).toHaveLength(8);
    expect(new Set(settings.models.map((model) => model.id)).size).toBe(8);
  });

  it('keeps an existing API key when saving an edit with a blank key', async () => {
    const storage = new MemoryStorageArea();
    const repository = new SettingsRepository(storage);
    await repository.save(createDefaultSettings());
    const models = new ModelService(repository);
    const saved = await models.save(modelInput());

    const edited = await models.save({
      ...modelInput(),
      id: saved.id,
      name: '改名后',
      apiKey: '',
    });
    expect(edited.apiKey).toBe('sk-secret-value-12345');
    expect(edited.name).toBe('改名后');
  });

  it('rejects unsupported task/model protocol combinations', async () => {
    const storage = new MemoryStorageArea();
    const repository = new SettingsRepository(storage);
    await repository.save(createDefaultSettings());
    const models = new ModelService(repository);
    const chat = await models.save(modelInput());
    const audio = await models.save(
      modelInput({ name: 'audio', protocol: 'openai-audio', modelId: 'audio-model' }),
    );

    await expect(models.setTaskModel('asr', chat.id)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
    await expect(models.setTaskModel('webpage', audio.id)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });

  it('falls back by protocol and never returns a disabled model', async () => {
    const settings = normalizeSettings({
      models: [
        {
          ...modelInput({ id: 'model-chat', name: 'chat', modelId: 'chat' }),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          ...modelInput({
            id: 'model-audio',
            name: 'audio',
            modelId: 'audio',
            protocol: 'openai-audio',
          }),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          ...modelInput({ id: 'model-off', name: 'off', modelId: 'off', enabled: false }),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ],
      defaultModelId: 'model-audio',
    });

    expect(taskChatModel(settings, 'webpage').id).toBe('model-chat');
    expect(taskAsrModel(settings).id).toBe('model-audio');
    expect(() => taskChatModel({ ...settings, models: [] }, 'webpage')).toThrow(
      expect.objectContaining({ code: 'NO_MODEL' }),
    );
  });
});

describe('input validation', () => {
  it('allows HTTPS and localhost HTTP but rejects remote plaintext HTTP', () => {
    expect(validateBaseUrl('https://api.example.com/v1/')).toBe('https://api.example.com/v1');
    expect(validateBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
    expect(validateBaseUrl('http://127.0.0.1:8080/v1')).toBe('http://127.0.0.1:8080/v1');
    expect(() => validateBaseUrl('http://api.example.com/v1')).toThrow(
      expect.objectContaining({ code: 'INVALID_BASE_URL' }),
    );
  });

  it('rejects dangerous custom headers and protected request params', async () => {
    const storage = new MemoryStorageArea();
    const repository = new SettingsRepository(storage);
    await repository.save(createDefaultSettings());
    const models = new ModelService(repository);

    await expect(
      models.save(modelInput({ headers: { Cookie: 'session=secret' } })),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(
      models.save(modelInput({ params: { messages: [] } })),
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('normalizes invalid persisted values instead of throwing', () => {
    const settings = normalizeSettings({
      languages: { source: 'en', target: 'not-a-language' },
      subtitle: { enabled: true, style: { fontSize: 1000, color: 'red', backgroundOpacity: 9 } },
      ui: { theme: 'neon' },
      cache: { maxEntries: -12 },
    });
    expect(settings.languages.target).toBe('zh-CN');
    expect(settings.subtitle.style.fontSize).toBe(56);
    expect(settings.subtitle.style.color).toBe('#ffffff');
    expect(settings.subtitle.style.backgroundOpacity).toBe(1);
    expect(settings.ui.theme).toBe('system');
    expect(settings.cache.maxEntries).toBe(0);
  });
});