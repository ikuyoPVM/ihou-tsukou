import {
  REQUEST_HEADER_BLOCKLIST,
  SETTINGS_SCHEMA_VERSION,
  TASK_LABELS,
  TARGET_LANGUAGES,
  TRANSLATION_STYLES,
} from '../shared/constants';
import { AppError } from '../shared/errors';
import type {
  ApiProtocol,
  GlossaryEntry,
  ModelConfig,
  ModelConfigInput,
  PublicSettings,
  Settings,
  SubtitleDisplayMode,
  TaskKind,
  ThemePreference,
  TranslationStyle,
  UserPrefs,
} from '../shared/types';
import { createId, isPlainObject } from '../shared/utils';
import { createDefaultSettings } from './defaults';

const PROTOCOLS: readonly ApiProtocol[] = ['openai-chat', 'openai-audio'];
const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];
const SUBTITLE_MODES: readonly SubtitleDisplayMode[] = ['translated', 'original', 'bilingual'];
const TASK_KINDS: readonly TaskKind[] = ['webpage', 'quality', 'subtitles', 'asr'];
const STYLE_VALUES = TRANSLATION_STYLES.map((style) => style.value);
const TARGET_CODES = new Set<string>(TARGET_LANGUAGES.map((language) => language.code));

export function validateBaseUrl(input: string): string {
  const raw = input.trim();
  if (!raw) {
    throw new AppError('INVALID_BASE_URL', '请填写 API Base URL。');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('INVALID_BASE_URL', 'API Base URL 不是合法 URL。');
  }
  if (url.username || url.password) {
    throw new AppError('INVALID_BASE_URL', 'Base URL 不允许包含用户名或密码。');
  }
  if (url.protocol === 'https:') {
    // Allowed.
  } else if (url.protocol === 'http:') {
    const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
    if (!localHosts.has(url.hostname.toLowerCase())) {
      throw new AppError(
        'INVALID_BASE_URL',
        '出于密钥安全考虑，仅允许 HTTPS；本机调试可使用 HTTP localhost / 127.0.0.1。',
      );
    }
  } else {
    throw new AppError('INVALID_BASE_URL', '只允许 HTTPS 或本机 HTTP 地址。');
  }
  if (url.search || url.hash) {
    throw new AppError('INVALID_BASE_URL', 'Base URL 不应包含查询参数或 # 片段。');
  }
  return url.toString().replace(/\/+$/, '');
}

export function normalizeHeaders(input: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = rawName.trim();
    if (!name) continue;
    if (REQUEST_HEADER_BLOCKLIST.has(name.toLowerCase())) {
      throw new AppError('INVALID_REQUEST', `不允许设置请求头：${name}`);
    }
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name)) {
      throw new AppError('INVALID_REQUEST', `请求头名称不合法：${name}`);
    }
    const value = String(rawValue);
    if (/[\r\n]/.test(value)) {
      throw new AppError('INVALID_REQUEST', `请求头 ${name} 包含非法换行符。`);
    }
    headers[name] = value;
  }
  return headers;
}

export function normalizeParams(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const blocked = new Set(['messages', 'model', 'stream', '__proto__', 'constructor', 'prototype']);
  for (const [key, value] of Object.entries(input)) {
    if (blocked.has(key)) {
      throw new AppError('INVALID_REQUEST', `自定义参数不允许覆盖字段：${key}`);
    }
    result[key] = value;
  }
  return result;
}

export function normalizeModelInput(
  input: ModelConfigInput,
  existing?: ModelConfig,
): ModelConfig {
  if (!isPlainObject(input)) {
    throw new AppError('INVALID_REQUEST', '模型配置格式无效。');
  }
  const name = String(input.name ?? '').trim();
  if (!name) throw new AppError('INVALID_REQUEST', '请填写配置名称。');
  const providerName = String(input.providerName ?? '').trim() || 'OpenAI Compatible';
  const baseUrl = validateBaseUrl(String(input.baseUrl ?? ''));
  const protocol = input.protocol ?? 'openai-chat';
  if (!PROTOCOLS.includes(protocol)) {
    throw new AppError('INVALID_REQUEST', '不支持的 API 协议。');
  }
  const modelId = String(input.modelId ?? '').trim();
  if (!modelId) throw new AppError('INVALID_REQUEST', '请填写模型 ID。');
  const now = Date.now();
  const apiKey = String(input.apiKey ?? '').trim() || existing?.apiKey || '';
  const headers = normalizeHeaders(isPlainObject(input.headers) ? (input.headers as Record<string, string>) : {});
  const params = normalizeParams(isPlainObject(input.params) ? input.params : {});
  const temperature =
    input.temperature === undefined || input.temperature === null
      ? existing?.temperature
      : Number(input.temperature);
  if (temperature !== undefined && (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)) {
    throw new AppError('INVALID_REQUEST', '温度必须在 0 到 2 之间。');
  }
  const maxTokens =
    input.maxTokens === undefined || input.maxTokens === null
      ? existing?.maxTokens
      : Number(input.maxTokens);
  if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 200_000)) {
    throw new AppError('INVALID_REQUEST', '最大输出长度必须是 1 到 200000 的整数。');
  }
  const maxTokensField = input.maxTokensField ?? existing?.maxTokensField ?? 'max_tokens';
  if (maxTokensField !== 'max_tokens' && maxTokensField !== 'max_completion_tokens') {
    throw new AppError('INVALID_REQUEST', '不支持的 max tokens 字段名。');
  }
  return {
    id: existing?.id ?? input.id ?? createId('model'),
    name,
    providerName,
    baseUrl,
    apiKey: apiKey ?? '',
    protocol,
    modelId,
    headers,
    params,
    ...(temperature === undefined ? {} : { temperature }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
    maxTokensField,
    enabled: input.enabled ?? existing?.enabled ?? true,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function normalizeModel(raw: unknown): ModelConfig | null {
  if (!isPlainObject(raw)) return null;
  try {
    return normalizeModelInput(raw as unknown as ModelConfigInput);
  } catch {
    return null;
  }
}

export function normalizeGlossary(raw: unknown): GlossaryEntry[] {
  if (!Array.isArray(raw)) return [];
  const result: GlossaryEntry[] = [];
  for (const entry of raw.slice(0, 200)) {
    if (!isPlainObject(entry)) continue;
    const source = String(entry.source ?? '').trim();
    const target = String(entry.target ?? '').trim();
    if (!source || !target) continue;
    if (source.length > 200 || target.length > 200) continue;
    result.push({
      id: typeof entry.id === 'string' && entry.id ? entry.id : createId('term'),
      source,
      target,
      caseSensitive: Boolean(entry.caseSensitive),
    });
  }
  return result;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalizeStyle(value: unknown): TranslationStyle {
  return STYLE_VALUES.includes(value as TranslationStyle) ? (value as TranslationStyle) : 'natural';
}

function normalizeTheme(value: unknown): ThemePreference {
  return THEMES.includes(value as ThemePreference) ? (value as ThemePreference) : 'system';
}

function normalizeSubtitleMode(value: unknown): SubtitleDisplayMode {
  return SUBTITLE_MODES.includes(value as SubtitleDisplayMode)
    ? (value as SubtitleDisplayMode)
    : 'bilingual';
}

export function normalizeSettings(raw: unknown): Settings {
  const defaults = createDefaultSettings();
  if (!isPlainObject(raw)) return defaults;
  const models = Array.isArray(raw.models)
    ? raw.models.map(normalizeModel).filter((model): model is ModelConfig => model !== null)
    : [];
  const modelIds = new Set(models.map((model) => model.id));
  const defaultModelId =
    typeof raw.defaultModelId === 'string' && modelIds.has(raw.defaultModelId)
      ? raw.defaultModelId
      : null;
  const rawTaskModels = isPlainObject(raw.taskModels) ? raw.taskModels : {};
  const taskModels = { ...defaults.taskModels };
  for (const task of TASK_KINDS) {
    const id = rawTaskModels[task];
    taskModels[task] = typeof id === 'string' && modelIds.has(id) ? id : null;
  }
  const rawLanguages = isPlainObject(raw.languages) ? raw.languages : {};
  const target =
    typeof rawLanguages.target === 'string' && TARGET_CODES.has(rawLanguages.target)
      ? rawLanguages.target
      : defaults.languages.target;
  const source = typeof rawLanguages.source === 'string' && rawLanguages.source ? rawLanguages.source : 'auto';

  const rawTranslation = isPlainObject(raw.translation) ? raw.translation : {};
  const rawSubtitle = isPlainObject(raw.subtitle) ? raw.subtitle : {};
  const rawSubtitleStyle = isPlainObject(rawSubtitle.style) ? rawSubtitle.style : {};
  const rawUi = isPlainObject(raw.ui) ? raw.ui : {};
  const rawCache = isPlainObject(raw.cache) ? raw.cache : {};
  const color =
    typeof rawSubtitleStyle.color === 'string' && /^#[0-9a-f]{6}$/i.test(rawSubtitleStyle.color)
      ? rawSubtitleStyle.color
      : defaults.subtitle.style.color;

  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    models,
    defaultModelId,
    taskModels,
    languages: { source, target },
    translation: {
      style: normalizeStyle(rawTranslation.style),
      customPrompt: typeof rawTranslation.customPrompt === 'string' ? rawTranslation.customPrompt.slice(0, 4000) : '',
      context: typeof rawTranslation.context === 'string' ? rawTranslation.context.slice(0, 3000) : '',
      glossary: normalizeGlossary(rawTranslation.glossary),
      useGlossary: rawTranslation.useGlossary !== false,
    },
    subtitle: {
      enabled: rawSubtitle.enabled === true,
      style: {
        mode: normalizeSubtitleMode(rawSubtitleStyle.mode),
        fontSize: clampNumber(rawSubtitleStyle.fontSize, defaults.subtitle.style.fontSize, 12, 56),
        color,
        backgroundOpacity: clampNumber(
          rawSubtitleStyle.backgroundOpacity,
          defaults.subtitle.style.backgroundOpacity,
          0,
          1,
        ),
        bottomOffset: clampNumber(
          rawSubtitleStyle.bottomOffset,
          defaults.subtitle.style.bottomOffset,
          0,
          40,
        ),
        lineHeight: clampNumber(rawSubtitleStyle.lineHeight, defaults.subtitle.style.lineHeight, 1, 2.4),
        maxWidth: clampNumber(rawSubtitleStyle.maxWidth, defaults.subtitle.style.maxWidth, 40, 100),
      },
    },
    ui: {
      theme: normalizeTheme(rawUi.theme),
      autoTranslateNewContent: rawUi.autoTranslateNewContent !== false,
      selectionEnabled: rawUi.selectionEnabled !== false,
    },
    cache: {
      maxEntries: Math.round(clampNumber(rawCache.maxEntries, defaults.cache.maxEntries, 0, 5000)),
    },
  };
}

export function mergePrefs(settings: Settings, patch: unknown): Settings {
  if (!isPlainObject(patch)) throw new AppError('INVALID_REQUEST', '偏好设置格式无效。');
  const next: Settings = {
    ...settings,
    languages: { ...settings.languages },
    translation: { ...settings.translation, glossary: [...settings.translation.glossary] },
    subtitle: { ...settings.subtitle, style: { ...settings.subtitle.style } },
    ui: { ...settings.ui },
    cache: { ...settings.cache },
  };
  if (isPlainObject(patch.languages)) {
    if (typeof patch.languages.source === 'string' && patch.languages.source) {
      next.languages.source = patch.languages.source;
    }
    if (typeof patch.languages.target === 'string' && TARGET_CODES.has(patch.languages.target)) {
      next.languages.target = patch.languages.target;
    }
  }
  if (isPlainObject(patch.translation)) {
    const translation = patch.translation;
    if (typeof translation.style === 'string') next.translation.style = normalizeStyle(translation.style);
    if (typeof translation.customPrompt === 'string') {
      next.translation.customPrompt = translation.customPrompt.slice(0, 4000);
    }
    if (typeof translation.context === 'string') {
      next.translation.context = translation.context.slice(0, 3000);
    }
    if (translation.glossary !== undefined) {
      next.translation.glossary = normalizeGlossary(translation.glossary);
    }
    if (typeof translation.useGlossary === 'boolean') {
      next.translation.useGlossary = translation.useGlossary;
    }
  }
  if (isPlainObject(patch.subtitle)) {
    if (typeof patch.subtitle.enabled === 'boolean') next.subtitle.enabled = patch.subtitle.enabled;
    if (isPlainObject(patch.subtitle.style)) {
      next.subtitle.style = mergeSubtitleStyle(next.subtitle.style, patch.subtitle.style);
    }
  }
  if (isPlainObject(patch.ui)) {
    if (typeof patch.ui.theme === 'string') next.ui.theme = normalizeTheme(patch.ui.theme);
    if (typeof patch.ui.autoTranslateNewContent === 'boolean') {
      next.ui.autoTranslateNewContent = patch.ui.autoTranslateNewContent;
    }
    if (typeof patch.ui.selectionEnabled === 'boolean') {
      next.ui.selectionEnabled = patch.ui.selectionEnabled;
    }
  }
  if (isPlainObject(patch.cache)) {
    next.cache.maxEntries = Math.round(clampNumber(patch.cache.maxEntries, next.cache.maxEntries, 0, 5000));
  }
  return normalizeSettings(next);
}

export function mergeSubtitleStyle(
  current: UserPrefs['subtitle']['style'],
  patch: Record<string, unknown>,
): UserPrefs['subtitle']['style'] {
  return {
    mode:
      typeof patch.mode === 'string' ? normalizeSubtitleMode(patch.mode) : current.mode,
    fontSize: clampNumber(patch.fontSize, current.fontSize, 12, 56),
    color:
      typeof patch.color === 'string' && /^#[0-9a-f]{6}$/i.test(patch.color)
        ? patch.color
        : current.color,
    backgroundOpacity: clampNumber(patch.backgroundOpacity, current.backgroundOpacity, 0, 1),
    bottomOffset: clampNumber(patch.bottomOffset, current.bottomOffset, 0, 40),
    lineHeight: clampNumber(patch.lineHeight, current.lineHeight, 1, 2.4),
    maxWidth: clampNumber(patch.maxWidth, current.maxWidth, 40, 100),
  };
}

export function buildPublicSettings(settings: Settings): PublicSettings {
  return {
    schemaVersion: settings.schemaVersion,
    models: settings.models.map((model) => ({
      id: model.id,
      name: model.name,
      providerName: model.providerName,
      protocol: model.protocol,
      modelId: model.modelId,
      enabled: model.enabled,
    })),
    defaultModelId: settings.defaultModelId,
    taskModels: { ...settings.taskModels },
    languages: { ...settings.languages },
    translation: {
      style: settings.translation.style,
      glossaryCount: settings.translation.glossary.length,
      customPromptEnabled: Boolean(settings.translation.customPrompt.trim()),
    },
    subtitle: {
      enabled: settings.subtitle.enabled,
      style: { ...settings.subtitle.style },
    },
    ui: { ...settings.ui },
    cache: { ...settings.cache },
  };
}

export function activeChatModel(settings: Settings, preferredId?: string): ModelConfig {
  const byId = (id: string | null | undefined) =>
    id ? settings.models.find((model) => model.id === id) : undefined;
  const candidates = [
    byId(preferredId),
    byId(settings.taskModels.webpage),
    byId(settings.defaultModelId),
    settings.models.find((model) => model.enabled && model.protocol === 'openai-chat'),
  ];
  const model = candidates.find(
    (candidate): candidate is ModelConfig =>
      Boolean(candidate?.enabled) && candidate?.protocol === 'openai-chat',
  );
  if (!model) {
    throw new AppError('NO_MODEL', '请先在设置页添加并启用一个 OpenAI Chat 兼容模型。');
  }
  return model;
}

export function taskChatModel(settings: Settings, task: TaskKind, preferredId?: string): ModelConfig {
  if (task === 'asr') {
    throw new AppError('UNSUPPORTED_PROTOCOL', '语音识别任务需要使用 Audio 协议模型。');
  }
  const byId = (id: string | null | undefined) =>
    id ? settings.models.find((model) => model.id === id) : undefined;
  const preferred = byId(preferredId);
  const taskModel = byId(settings.taskModels[task]);
  const fallbackTask =
    task === 'quality'
      ? byId(settings.taskModels.webpage)
      : task === 'subtitles'
        ? byId(settings.taskModels.quality) ?? byId(settings.taskModels.webpage)
        : null;
  const model = [preferred, taskModel, fallbackTask, byId(settings.defaultModelId), settings.models.find((item) => item.enabled)].find(
    (candidate): candidate is ModelConfig =>
      Boolean(candidate?.enabled) && candidate?.protocol === 'openai-chat',
  );
  if (!model) {
    throw new AppError('NO_MODEL', `请先在设置页为“${TASK_LABELS[task] ?? task}”配置一个可用模型。`);
  }
  return model;
}

export function taskAsrModel(settings: Settings, preferredId?: string): ModelConfig {
  const byId = (id: string | null | undefined) =>
    id ? settings.models.find((model) => model.id === id) : undefined;
  const model = [byId(preferredId), byId(settings.taskModels.asr), byId(settings.defaultModelId), settings.models.find((item) => item.enabled)].find(
    (candidate): candidate is ModelConfig =>
      Boolean(candidate?.enabled) && candidate?.protocol === 'openai-audio',
  );
  if (!model) {
    throw new AppError('NO_MODEL', '语音识别需要在设置中启用一个 OpenAI Audio Transcription 兼容模型。');
  }
  return model;
}