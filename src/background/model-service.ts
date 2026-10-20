import { AppError } from '../shared/errors';
import type {
  ModelConfig,
  ModelConfigInput,
  TaskKind,
  TestModelResult,
} from '../shared/types';
import { createId } from '../shared/utils';
import type { ProviderDeps } from '../providers/factory';
import { createProvider } from '../providers/factory';
import type { SettingsRepository } from '../settings/repository';
import { normalizeModelInput } from '../settings/validation';

const MAX_MODELS = 30;

export class ModelService {
  constructor(
    private readonly repository: SettingsRepository,
    private readonly deps: ProviderDeps = {},
  ) {}

  async save(input: ModelConfigInput): Promise<ModelConfig> {
    return this.repository.update((settings) => {
      const existing = input.id
        ? settings.models.find((model) => model.id === input.id)
        : undefined;
      if (input.id && !existing) throw new AppError('NOT_FOUND', '要编辑的模型不存在。');
      const normalized = normalizeModelInput(input, existing);
      const duplicateName = settings.models.find(
        (model) => model.id !== normalized.id && model.name.trim() === normalized.name.trim(),
      );
      if (duplicateName) {
        throw new AppError('INVALID_REQUEST', '已存在同名模型配置，请换一个名称。');
      }
      const models = existing
        ? settings.models.map((model) => (model.id === normalized.id ? normalized : model))
        : [...settings.models, normalized];
      if (models.length > MAX_MODELS) {
        throw new AppError('INVALID_REQUEST', `最多只能保存 ${MAX_MODELS} 个模型配置。`);
      }
      let defaultModelId = settings.defaultModelId;
      if (!defaultModelId && normalized.enabled && normalized.protocol === 'openai-chat') {
        defaultModelId = normalized.id;
      }
      if (defaultModelId === normalized.id && normalized.protocol !== 'openai-chat') {
        defaultModelId = null;
      }
      return {
        settings: { ...settings, models, defaultModelId },
        result: normalized,
      };
    });
  }

  async duplicate(id: string): Promise<ModelConfig> {
    return this.repository.update((settings) => {
      if (settings.models.length >= MAX_MODELS) {
        throw new AppError('INVALID_REQUEST', `最多只能保存 ${MAX_MODELS} 个模型配置。`);
      }
      const source = settings.models.find((model) => model.id === id);
      if (!source) throw new AppError('NOT_FOUND', '要复制的模型不存在。');
      const now = Date.now();
      const copy: ModelConfig = {
        ...source,
        id: createId('model'),
        name: `${source.name} 副本`,
        createdAt: now,
        updatedAt: now,
      };
      return {
        settings: { ...settings, models: [...settings.models, copy] },
        result: copy,
      };
    });
  }

  async delete(id: string): Promise<boolean> {
    return this.repository.update((settings) => {
      const exists = settings.models.some((model) => model.id === id);
      if (!exists) throw new AppError('NOT_FOUND', '要删除的模型不存在。');
      const models = settings.models.filter((model) => model.id !== id);
      const taskModels = { ...settings.taskModels };
      for (const task of Object.keys(taskModels) as TaskKind[]) {
        if (taskModels[task] === id) taskModels[task] = null;
      }
      return {
        settings: {
          ...settings,
          models,
          defaultModelId: settings.defaultModelId === id ? null : settings.defaultModelId,
          taskModels,
        },
        result: true,
      };
    });
  }

  async setDefault(id: string | null): Promise<string | null> {
    return this.repository.update((settings) => {
      if (id !== null) {
        const model = settings.models.find((item) => item.id === id);
        if (!model) throw new AppError('NOT_FOUND', '模型不存在。');
        if (model.protocol !== 'openai-chat') {
          throw new AppError('INVALID_REQUEST', '默认翻译模型必须是 Chat Completions 协议。');
        }
        if (!model.enabled) throw new AppError('MODEL_DISABLED');
      }
      return {
        settings: { ...settings, defaultModelId: id },
        result: id,
      };
    });
  }

  async setTaskModel(task: TaskKind, id: string | null): Promise<Record<TaskKind, string | null>> {
    return this.repository.update((settings) => {
      if (id !== null) {
        const model = settings.models.find((item) => item.id === id);
        if (!model) throw new AppError('NOT_FOUND', '模型不存在。');
        if (!model.enabled) throw new AppError('MODEL_DISABLED');
        if (task === 'asr' && model.protocol !== 'openai-audio') {
          throw new AppError('INVALID_REQUEST', '语音识别任务需要 Audio Transcription 协议模型。');
        }
        if (task !== 'asr' && model.protocol !== 'openai-chat') {
          throw new AppError('INVALID_REQUEST', '该任务需要 Chat Completions 协议模型。');
        }
      }
      const taskModels = { ...settings.taskModels, [task]: id };
      return { settings: { ...settings, taskModels }, result: taskModels };
    });
  }

  async test(modelId?: string, draft?: ModelConfigInput): Promise<TestModelResult> {
    const settings = await this.repository.load();
    let model: ModelConfig;
    if (draft) {
      const existing = draft.id ? settings.models.find((item) => item.id === draft.id) : undefined;
      model = normalizeModelInput(draft, existing);
    } else {
      if (!modelId) throw new AppError('INVALID_REQUEST', '请先选择要测试的模型。');
      const found = settings.models.find((item) => item.id === modelId);
      if (!found) throw new AppError('NOT_FOUND', '模型不存在。');
      model = found;
    }
    const start = Date.now();
    try {
      const provider = createProvider(model, this.deps);
      return await provider.testConnection();
    } catch (error) {
      const normalized = error instanceof AppError ? error : new AppError('UNKNOWN');
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: normalized.message,
        model: model.modelId,
        code: normalized.code,
      };
    }
  }

  async list(modelId?: string, draft?: ModelConfigInput): Promise<string[]> {
    const settings = await this.repository.load();
    let model: ModelConfig;
    if (draft) {
      const existing = draft.id ? settings.models.find((item) => item.id === draft.id) : undefined;
      model = normalizeModelInput(draft, existing);
    } else {
      if (!modelId) throw new AppError('INVALID_REQUEST', '请先选择模型配置。');
      const found = settings.models.find((item) => item.id === modelId);
      if (!found) throw new AppError('NOT_FOUND', '模型不存在。');
      model = found;
    }
    if (model.protocol !== 'openai-chat' && model.protocol !== 'openai-audio') {
      throw new AppError('UNSUPPORTED_PROTOCOL');
    }
    return createProvider(model, this.deps).listModels();
  }
}