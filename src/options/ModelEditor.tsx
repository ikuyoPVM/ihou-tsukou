import { useMemo, useState } from 'react';
import type {
  ApiProtocol,
  ModelConfig,
  ModelConfigInput,
  TestModelResult,
} from '../shared/types';
import { messageOf, request } from './api';

interface Props {
  existing: ModelConfig | null;
  onSaved: (model: ModelConfig) => void;
  onCancel: () => void;
  onReload: () => Promise<void>;
  notify: (tone: 'success' | 'error' | 'info', message: string) => void;
}

function parseObject(text: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = text.trim() ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${label}必须是合法 JSON。`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}必须是一个 JSON 对象。`);
  }
  return value as Record<string, unknown>;
}

export function ModelEditor({ existing, onSaved, onCancel, onReload, notify }: Props) {
  const [name, setName] = useState(existing?.name ?? '');
  const [providerName, setProviderName] = useState(existing?.providerName ?? '');
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [protocol, setProtocol] = useState<ApiProtocol>(existing?.protocol ?? 'openai-chat');
  const [modelId, setModelId] = useState(existing?.modelId ?? '');
  const [headersText, setHeadersText] = useState(
    JSON.stringify(existing?.headers ?? {}, null, 2),
  );
  const [paramsText, setParamsText] = useState(JSON.stringify(existing?.params ?? {}, null, 2));
  const [temperature, setTemperature] = useState(
    existing?.temperature === undefined ? '' : String(existing.temperature),
  );
  const [maxTokens, setMaxTokens] = useState(
    existing?.maxTokens === undefined ? '' : String(existing.maxTokens),
  );
  const [maxTokensField, setMaxTokensField] = useState<'max_tokens' | 'max_completion_tokens'>(
    existing?.maxTokensField ?? 'max_tokens',
  );
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [listing, setListing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestModelResult | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  const title = useMemo(() => (existing ? '编辑模型配置' : '添加模型配置'), [existing]);
  const hasSavedKey = Boolean(existing?.apiKey);

  function buildInput(): ModelConfigInput {
    const headers = parseObject(headersText, '自定义请求头');
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value !== 'string') throw new Error(`请求头 ${key} 的值必须是字符串。`);
    }
    const params = parseObject(paramsText, '自定义参数');
    if (temperature.trim()) {
      const value = Number(temperature);
      if (!Number.isFinite(value)) throw new Error('温度必须是数字。');
    }
    if (maxTokens.trim()) {
      const value = Number(maxTokens);
      if (!Number.isInteger(value)) throw new Error('最大输出长度必须是整数。');
    }
    const input: ModelConfigInput = {
      ...(existing ? { id: existing.id } : {}),
      name: name.trim(),
      providerName: providerName.trim(),
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim(),
      protocol,
      modelId: modelId.trim(),
      headers: headers as Record<string, string>,
      params,
      enabled,
      maxTokensField,
      ...(temperature.trim() ? { temperature: Number(temperature) } : {}),
      ...(maxTokens.trim() ? { maxTokens: Number(maxTokens) } : {}),
    };
    return input;
  }

  async function test(): Promise<void> {
    setTesting(true);
    setFormError(null);
    setTestResult(null);
    try {
      const result = await request<TestModelResult>({ type: 'models.test', draft: buildInput() });
      setTestResult(result);
    } catch (error) {
      setFormError(messageOf(error));
    } finally {
      setTesting(false);
    }
  }

  async function listModels(): Promise<void> {
    setListing(true);
    setFormError(null);
    setAvailableModels([]);
    try {
      const result = await request<{ models: string[] }>({
        type: 'models.list',
        draft: buildInput(),
      });
      setAvailableModels(result.models);
      if (result.models.length === 0) {
        notify('info', '接口返回了空模型列表；可手动填写模型 ID。');
      }
    } catch (error) {
      setFormError(`获取模型列表失败：${messageOf(error)}`);
    } finally {
      setListing(false);
    }
  }

  async function save(): Promise<void> {
    setSaving(true);
    setFormError(null);
    try {
      const saved = await request<ModelConfig>({
        type: 'settings.saveModel',
        model: buildInput(),
      });
      onSaved(saved);
      notify('success', existing ? '模型配置已更新。' : '模型配置已添加。');
    } catch (error) {
      setFormError(messageOf(error));
    } finally {
      setSaving(false);
    }
  }

  async function clearKey(): Promise<void> {
    if (!existing || !hasSavedKey) return;
    if (!window.confirm('确定删除这个模型已保存的 API 密钥吗？删除后需要重新填写才能调用接口。')) return;
    try {
      await request<{ cleared: true }>({ type: 'settings.clearModelKey', id: existing.id });
      notify('success', '已删除保存的 API 密钥。请重新编辑模型以填写新密钥。');
      await onReload();
      onCancel();
    } catch (error) {
      setFormError(messageOf(error));
    }
  }

  return (
    <section className="editor-card">
      <div className="editor-head">
        <div>
          <div className="eyebrow">MODEL</div>
          <h2>{title}</h2>
        </div>
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          返回列表
        </button>
      </div>

      <div className="editor-grid">
        <div className="field">
          <label className="field-label" htmlFor="model-name">
            配置名称 <span className="required">*</span>
          </label>
          <input
            id="model-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="例如：主力翻译模型"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="model-provider">
            服务商名称（自定义）
          </label>
          <input
            id="model-provider"
            className="input"
            value={providerName}
            onChange={(event) => setProviderName(event.target.value)}
            placeholder="仅用于区分配置，不会影响请求"
          />
        </div>

        <div className="field span-2">
          <label className="field-label" htmlFor="model-base-url">
            API Base URL <span className="required">*</span>
          </label>
          <input
            id="model-base-url"
            className="input mono"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://your-api.example.com/v1"
            autoComplete="off"
            spellCheck={false}
          />
          <span className="field-hint">
            只允许 HTTPS；本机调试可使用 http://localhost 或 http://127.0.0.1。扩展会在该地址后拼接
            Chat Completions 或 Audio Transcriptions 路径，请填写到版本根路径（通常以 /v1 结尾）。
          </span>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="model-protocol">
            API 协议
          </label>
          <select
            id="model-protocol"
            className="select"
            value={protocol}
            onChange={(event) => setProtocol(event.target.value as ApiProtocol)}
          >
            <option value="openai-chat">OpenAI Chat Completions（文本翻译）</option>
            <option value="openai-audio">OpenAI Audio Transcriptions（语音识别）</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="model-id">
            模型 ID <span className="required">*</span>
          </label>
          <input
            id="model-id"
            className="input mono"
            value={modelId}
            onChange={(event) => setModelId(event.target.value)}
            placeholder="手动填写服务商文档中的模型 ID"
            spellCheck={false}
          />
          <span className="field-hint">不假设所有服务商提供相同模型列表，可手动填写。</span>
        </div>

        <div className="field span-2">
          <label className="field-label" htmlFor="model-key">
            API Key
          </label>
          <div className="row">
            <input
              id="model-key"
              className="input mono grow"
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={
                hasSavedKey
                  ? '已保存密钥；留空保持不变'
                  : '填写 API Key（本地服务可留空，取决于服务商）'
              }
              autoComplete="new-password"
              spellCheck={false}
            />
            <button type="button" className="btn btn-sm" onClick={() => setShowKey((value) => !value)}>
              {showKey ? '隐藏' : '显示'}
            </button>
            {hasSavedKey && (
              <button type="button" className="btn btn-sm btn-danger" onClick={() => void clearKey()}>
                删除密钥
              </button>
            )}
          </div>
          <span className="field-hint">
            密钥只会由扩展后台发送给上面填写的 API 地址；不会注入网页，调试日志也会脱敏。
          </span>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="model-temperature">
            温度（可选，0–2）
          </label>
          <input
            id="model-temperature"
            className="input"
            type="number"
            min="0"
            max="2"
            step="0.1"
            value={temperature}
            onChange={(event) => setTemperature(event.target.value)}
            placeholder="留空则使用服务商默认值"
          />
        </div>
        <div className="field">
          <label className="field-label" htmlFor="model-max-tokens">
            最大输出 tokens（可选）
          </label>
          <input
            id="model-max-tokens"
            className="input"
            type="number"
            min="1"
            step="1"
            value={maxTokens}
            onChange={(event) => setMaxTokens(event.target.value)}
            placeholder="例如：4096"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="max-tokens-field">
            max tokens 字段
          </label>
          <select
            id="max-tokens-field"
            className="select"
            value={maxTokensField}
            onChange={(event) =>
              setMaxTokensField(event.target.value as 'max_tokens' | 'max_completion_tokens')
            }
          >
            <option value="max_tokens">max_tokens（多数兼容接口）</option>
            <option value="max_completion_tokens">max_completion_tokens（部分新接口）</option>
          </select>
          <span className="field-hint">仅影响文本翻译请求，不对所有服务商做兼容性假设。</span>
        </div>
        <div className="field">
          <span className="field-label">启用状态</span>
          <label className="checkbox-line">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            启用此配置（可被任务选择）
          </label>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="model-headers">
            自定义请求头（JSON 对象）
          </label>
          <textarea
            id="model-headers"
            className="textarea mono"
            value={headersText}
            onChange={(event) => setHeadersText(event.target.value)}
            spellCheck={false}
            rows={5}
          />
          <span className="field-hint">
            例如附加服务商要求的版本头。Host、Cookie、Origin、Referer 等安全头禁止设置。
          </span>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="model-params">
            自定义请求参数（JSON 对象）
          </label>
          <textarea
            id="model-params"
            className="textarea mono"
            value={paramsText}
            onChange={(event) => setParamsText(event.target.value)}
            spellCheck={false}
            rows={5}
          />
          <span className="field-hint">
            会与请求体合并，不能覆盖 model / messages / stream 等关键字段。
          </span>
        </div>
      </div>

      {formError && <div className="notice" data-tone="error">{formError}</div>}

      {testResult && (
        <div className="notice" data-tone={testResult.ok ? 'success' : 'error'}>
          {testResult.ok ? '连接成功' : '连接失败'} · {testResult.message}
          <span className="tiny faint">
            {' '}
            · {testResult.latencyMs} ms · {testResult.model}
            {testResult.code ? ` · ${testResult.code}` : ''}
          </span>
        </div>
      )}

      {availableModels.length > 0 && (
        <div className="field">
          <label className="field-label" htmlFor="model-suggestion">
            接口返回的模型（选择后填入模型 ID）
          </label>
          <select
            id="model-suggestion"
            className="select mono"
            value={availableModels.includes(modelId) ? modelId : ''}
            onChange={(event) => {
              if (event.target.value) setModelId(event.target.value);
            }}
          >
            <option value="">选择一个模型…</option>
            {availableModels.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="editor-actions">
        <button type="button" className="btn" disabled={testing || saving} onClick={() => void test()}>
          {testing ? <span className="spinner" /> : null}
          测试连接
        </button>
        <button
          type="button"
          className="btn"
          disabled={listing || saving}
          onClick={() => void listModels()}
        >
          {listing ? <span className="spinner" /> : null}
          获取模型列表
        </button>
        <div className="grow" />
        <button type="button" className="btn" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? <span className="spinner" /> : null}
          保存配置
        </button>
      </div>
      <div className="tiny faint">
        测试连接会向真实接口发起一次最小请求；音频配置会发送 0.25 秒静音 WAV。不同服务商可能不支持模型列表接口。
      </div>
    </section>
  );
}