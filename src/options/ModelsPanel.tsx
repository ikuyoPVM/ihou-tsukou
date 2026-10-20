import { useMemo, useState } from 'react';
import { TASK_LABELS } from '../shared/constants';
import type {
  ModelConfig,
  ModelConfigInput,
  Settings,
  TaskKind,
  TestModelResult,
} from '../shared/types';
import { messageOf, request } from './api';
import { ModelEditor } from './ModelEditor';

interface Props {
  settings: Settings;
  onReload: () => Promise<void>;
  notify: (tone: 'success' | 'error' | 'info', message: string) => void;
  onError: (message: string | null) => void;
}

const TASK_HINTS: Record<TaskKind, string> = {
  webpage: '普通网页与划词翻译，速度和成本优先。',
  quality: '长文或质量优先场景；未设置时回退网页模型。',
  subtitles: '视频字幕批量翻译；未设置时回退高质量/网页模型。',
  asr: '仅接受 Audio Transcriptions 协议模型。',
};

function toInput(model: ModelConfig, patch: Partial<ModelConfigInput> = {}): ModelConfigInput {
  return {
    id: model.id,
    name: model.name,
    providerName: model.providerName,
    baseUrl: model.baseUrl,
    apiKey: '',
    protocol: model.protocol,
    modelId: model.modelId,
    headers: model.headers,
    params: model.params,
    ...(model.temperature === undefined ? {} : { temperature: model.temperature }),
    ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
    maxTokensField: model.maxTokensField,
    enabled: model.enabled,
    ...patch,
  };
}

export function ModelsPanel({ settings, onReload, notify, onError }: Props) {
  const [editor, setEditor] = useState<{ mode: 'new' } | { mode: 'edit'; model: ModelConfig } | null>(
    null,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, TestModelResult>>({});
  const [assigning, setAssigning] = useState<TaskKind | null>(null);

  const chatModels = useMemo(
    () => settings.models.filter((model) => model.protocol === 'openai-chat'),
    [settings.models],
  );
  const audioModels = useMemo(
    () => settings.models.filter((model) => model.protocol === 'openai-audio'),
    [settings.models],
  );
  const defaultModel = chatModels.find((model) => model.id === settings.defaultModelId);
  const taskWarnings = useMemo(() => {
    const warnings: string[] = [];
    for (const task of Object.keys(settings.taskModels) as TaskKind[]) {
      const id = settings.taskModels[task];
      if (!id) continue;
      const model = settings.models.find((item) => item.id === id);
      if (!model) {
        warnings.push(`${TASK_LABELS[task]} 指向已删除的模型，请重新分配。`);
      } else if (task === 'asr' && model.protocol !== 'openai-audio') {
        warnings.push(`${TASK_LABELS[task]} 需要 Audio 模型，但当前指向 Chat 模型。`);
      } else if (task !== 'asr' && model.protocol !== 'openai-chat') {
        warnings.push(`${TASK_LABELS[task]} 需要 Chat 模型，但当前指向 Audio 模型。`);
      } else if (!model.enabled) {
        warnings.push(`${TASK_LABELS[task]} 指向已停用的模型。`);
      }
    }
    return warnings;
  }, [settings.models, settings.taskModels]);

  async function testModel(model: ModelConfig): Promise<void> {
    setTestingId(model.id);
    onError(null);
    try {
      const result = await request<TestModelResult>({ type: 'models.test', modelId: model.id });
      setTestResults((previous) => ({ ...previous, [model.id]: result }));
    } catch (error) {
      setTestResults((previous) => ({
        ...previous,
        [model.id]: {
          ok: false,
          latencyMs: 0,
          message: messageOf(error),
          model: model.modelId,
        },
      }));
    } finally {
      setTestingId(null);
    }
  }

  async function toggleEnabled(model: ModelConfig): Promise<void> {
    setBusyId(model.id);
    onError(null);
    try {
      await request<ModelConfig>({
        type: 'settings.saveModel',
        model: toInput(model, { enabled: !model.enabled }),
      });
      await onReload();
      notify('success', model.enabled ? '模型已停用。' : '模型已启用。');
    } catch (error) {
      onError(messageOf(error));
    } finally {
      setBusyId(null);
    }
  }

  async function setDefault(id: string | null): Promise<void> {
    onError(null);
    try {
      await request<{ defaultModelId: string | null }>({
        type: 'settings.setDefaultModel',
        id,
      });
      await onReload();
      notify('success', id ? '已设为默认翻译模型。' : '已取消默认模型。');
    } catch (error) {
      onError(messageOf(error));
    }
  }

  async function assignTask(task: TaskKind, id: string | null): Promise<void> {
    setAssigning(task);
    onError(null);
    try {
      await request<{ taskModels: Settings['taskModels'] }>({
        type: 'settings.setTaskModel',
        task,
        id,
      });
      await onReload();
      notify('success', `${TASK_LABELS[task]} 的模型已更新。`);
    } catch (error) {
      onError(messageOf(error));
    } finally {
      setAssigning(null);
    }
  }

  async function duplicate(model: ModelConfig): Promise<void> {
    setBusyId(model.id);
    onError(null);
    try {
      const copy = await request<ModelConfig>({ type: 'settings.duplicateModel', id: model.id });
      await onReload();
      setEditor({ mode: 'edit', model: copy });
      notify('success', '已创建模型副本；请检查名称、密钥与启用状态。');
    } catch (error) {
      onError(messageOf(error));
    } finally {
      setBusyId(null);
    }
  }

  async function remove(model: ModelConfig): Promise<void> {
    if (
      !window.confirm(
        `确定删除“${model.name}”吗？相关任务分配和默认模型设置会被清空，此操作不可撤销。`,
      )
    ) {
      return;
    }
    setBusyId(model.id);
    onError(null);
    try {
      await request<{ deleted: boolean }>({ type: 'settings.deleteModel', id: model.id });
      await onReload();
      notify('success', '模型配置已删除。');
    } catch (error) {
      onError(messageOf(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="panel-stack">
      <header className="panel-head">
        <div>
          <div className="eyebrow">PROVIDERS</div>
          <h2>模型与 API</h2>
          <p className="muted">
            所有模型都通过 OpenAI 兼容适配器调用；支持自定义 Base URL、模型 ID、请求头和附加参数。
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setEditor({ mode: 'new' })}
        >
          + 添加模型
        </button>
      </header>

      <div className="notice">
        扩展不内置、猜测或伪造任何密钥与模型 ID。请根据服务商文档手动填写，并用“测试连接”验证。
        API 密钥仅保存在本地 <code>chrome.storage.local</code>，不会注入网页。
      </div>

      {editor && (
        <ModelEditor
          key={editor.mode === 'edit' ? editor.model.id : 'new'}
          existing={editor.mode === 'edit' ? editor.model : null}
          onCancel={() => setEditor(null)}
          onReload={onReload}
          notify={notify}
          onSaved={() => {
            setEditor(null);
            void onReload();
          }}
        />
      )}

      <section className="sub-card">
        <div className="sub-card-head">
          <div>
            <h3>模型配置</h3>
            <p className="small muted">
              共 {settings.models.length} 个；Chat {chatModels.length} 个，Audio {audioModels.length} 个。
            </p>
          </div>
        </div>

        {settings.models.length === 0 ? (
          <div className="empty-state">
            <div className="empty-mark">◆</div>
            <h3>还没有模型配置</h3>
            <p className="muted">
              添加一个 OpenAI Chat Completions 兼容模型后即可翻译网页；视频语音识别还需要单独的 Audio
              Transcription 模型。
            </p>
            <button type="button" className="btn btn-primary" onClick={() => setEditor({ mode: 'new' })}>
              添加第一个模型
            </button>
          </div>
        ) : (
          <div className="model-list">
            {settings.models.map((model) => {
              const isDefault = settings.defaultModelId === model.id;
              const assignedTasks = (Object.keys(settings.taskModels) as TaskKind[]).filter(
                (task) => settings.taskModels[task] === model.id,
              );
              const result = testResults[model.id];
              return (
                <article className="model-card" key={model.id}>
                  <div className="model-card-head">
                    <div className="model-title-row">
                      <h4>{model.name}</h4>
                      {isDefault && <span className="chip" data-tone="success">默认</span>}
                      <span className="chip">{model.protocol === 'openai-chat' ? 'Chat' : 'Audio'}</span>
                      <span className="chip" data-tone={model.enabled ? 'success' : 'danger'}>
                        {model.enabled ? '已启用' : '已停用'}
                      </span>
                    </div>
                    <div className="row">
                      <span className="chip" data-tone={model.apiKey ? 'success' : undefined}>
                        {model.apiKey ? '已保存密钥' : '无密钥'}
                      </span>
                    </div>
                  </div>
                  <div className="model-meta">
                    <span>{model.providerName || '自定义服务商'}</span>
                    <span className="mono">{model.modelId}</span>
                    <span className="mono ellipsis" title={model.baseUrl}>{model.baseUrl}</span>
                  </div>
                  <div className="model-task-row">
                    {assignedTasks.length > 0 ? (
                      assignedTasks.map((task) => (
                        <span className="chip" key={task}>{TASK_LABELS[task]}</span>
                      ))
                    ) : (
                      <span className="tiny faint">未分配任务</span>
                    )}
                  </div>
                  {result && (
                    <div className="notice" data-tone={result.ok ? 'success' : 'error'}>
                      {result.ok ? '连接成功' : '连接失败'} · {result.message}
                      <span className="tiny faint">
                        {' '}
                        · {result.latencyMs} ms · {result.model}
                        {result.code ? ` · ${result.code}` : ''}
                      </span>
                    </div>
                  )}
                  <div className="model-actions">
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={testingId === model.id}
                      onClick={() => void testModel(model)}
                    >
                      {testingId === model.id ? <span className="spinner" /> : null}
                      测试连接
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setEditor({ mode: 'edit', model })}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busyId === model.id}
                      onClick={() => void toggleEnabled(model)}
                    >
                      {model.enabled ? '停用' : '启用'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={model.protocol !== 'openai-chat' || !model.enabled || isDefault}
                      onClick={() => void setDefault(model.id)}
                    >
                      设为默认
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={busyId === model.id}
                      onClick={() => void duplicate(model)}
                    >
                      复制
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      disabled={busyId === model.id}
                      onClick={() => void remove(model)}
                    >
                      删除
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="sub-card">
        <div className="sub-card-head">
          <div>
            <h3>任务角色分配</h3>
            <p className="small muted">
              每个任务可使用不同模型。留空时按内置回退顺序选择可用 Chat 模型；Audio 任务必须指定 Audio 模型。
            </p>
          </div>
        </div>
        <div className="mapping-grid">
          {(Object.keys(TASK_LABELS) as TaskKind[]).map((task) => {
            const pool = task === 'asr' ? audioModels : chatModels;
            return (
              <div className="field" key={task}>
                <label className="field-label" htmlFor={`task-${task}`}>
                  {TASK_LABELS[task]}
                </label>
                <select
                  id={`task-${task}`}
                  className="select"
                  value={settings.taskModels[task] ?? ''}
                  disabled={assigning !== null}
                  onChange={(event) => void assignTask(task, event.target.value || null)}
                >
                  <option value="">自动回退</option>
                  {pool.map((model) => (
                    <option key={model.id} value={model.id} disabled={!model.enabled}>
                      {model.name}
                      {model.enabled ? '' : '（已停用）'}
                    </option>
                  ))}
                </select>
                <span className="field-hint">{TASK_HINTS[task]}</span>
              </div>
            );
          })}
          <div className="field">
            <label className="field-label" htmlFor="default-model">
              默认翻译模型
            </label>
            <select
              id="default-model"
              className="select"
              value={settings.defaultModelId ?? ''}
              onChange={(event) => void setDefault(event.target.value || null)}
            >
              <option value="">不设置</option>
              {chatModels.map((model) => (
                <option key={model.id} value={model.id} disabled={!model.enabled}>
                  {model.name}
                  {model.enabled ? '' : '（已停用）'}
                </option>
              ))}
            </select>
            <span className="field-hint">
              当前默认：{defaultModel?.name ?? '未设置'}。
            </span>
          </div>
        </div>
        {taskWarnings.length > 0 && (
          <div className="notice" data-tone="warning">
            {taskWarnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}