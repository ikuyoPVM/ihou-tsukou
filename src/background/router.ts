import { SUPPORTED_PAGE_PROTOCOLS, TAB_STATE_PREFIX } from '../shared/constants';
import { AppError, normalizeError, type ErrorCode } from '../shared/errors';
import type {
  ActiveTabState,
  ApiResult,
  AppErrorShape,
  ContentPageSnapshot,
  ModelConfigInput,
  Settings,
  SubtitlePrefs,
  SubtitleTranslationRequest,
  TranslateBatchRequest,
} from '../shared/types';
import type { ContentCommand, PrefsPatch, RuntimeRequest, RuntimeResponses } from '../shared/messages';
import { base64ToBytes } from '../shared/wav';
import { isHttpUrl } from '../shared/utils';
import type { AudioApiProvider } from '../providers/types';
import { createAudioProvider } from '../providers/factory';
import type { SettingsRepository } from '../settings/repository';
import {
  buildPublicSettings,
  mergePrefs,
  mergeSubtitleStyle,
  taskAsrModel,
} from '../settings/validation';
import type { PublicSettings } from '../shared/types';
import type { TranslationCache } from '../translation/cache';
import type { TranslationService } from '../translation/service';
import type { ModelService } from './model-service';
import { sanitizePageState, sanitizeSnapshot, sanitizeSubtitleState } from './state';

export interface RouterDeps {
  repository: SettingsRepository;
  cache: TranslationCache;
  translation: TranslationService;
  models: ModelService;
  onStateReport?: (tabId: number, snapshot: ContentPageSnapshot) => void;
  runtimeId?: string;
}

type Sender = chrome.runtime.MessageSender;

export function isExtensionUiSender(sender: Sender, runtimeId: string): boolean {
  return Boolean(sender.id === runtimeId && sender.url?.startsWith(`chrome-extension://${runtimeId}/`));
}

export function isContentSender(sender: Sender, runtimeId: string): boolean {
  return Boolean(
    sender.id === runtimeId &&
      sender.tab?.id !== undefined &&
      sender.url &&
      isHttpUrl(sender.url) &&
      !sender.url.startsWith(`chrome-extension://${runtimeId}/`),
  );
}

function errorResult(error: unknown): ApiResult<never> {
  const normalized = normalizeError(error);
  return { ok: false, error: normalized.toShape() };
}

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

function appErrorFromShape(shape: AppErrorShape): AppError {
  return new AppError(shape.code as ErrorCode, shape.message, {
    retryable: shape.retryable,
    status: shape.status,
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new AppError('CONTENT_UNAVAILABLE', message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isReceiverMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Receiving end does not exist|Could not establish connection|The message port closed/i.test(message);
}

export class BackgroundRouter {
  private readonly abortControllers = new Map<string, AbortController>();
  private readonly runtimeId: string;

  constructor(private readonly deps: RouterDeps) {
    this.runtimeId = deps.runtimeId ?? chrome.runtime.id;
  }

  async handle(message: RuntimeRequest, sender: Sender): Promise<ApiResult<unknown>> {
    try {
      const ui = isExtensionUiSender(sender, this.runtimeId);
      const content = isContentSender(sender, this.runtimeId);
      switch (message.type) {
        case 'settings.getPublic':
          return ok(buildPublicSettings(await this.deps.repository.load()));
        case 'settings.getFull':
          this.requireUi(ui);
          return ok(await this.deps.repository.load());
        case 'settings.saveModel':
          this.requireUi(ui);
          return ok(await this.deps.models.save(this.requireObject<ModelConfigInput>(message.model)));
        case 'settings.deleteModel':
          this.requireUi(ui);
          return ok({ deleted: await this.deps.models.delete(String(message.id)) });
        case 'settings.clearModelKey':
          this.requireUi(ui);
          return ok(await this.clearModelKey(String(message.id)));
        case 'settings.duplicateModel':
          this.requireUi(ui);
          return ok(await this.deps.models.duplicate(String(message.id)));
        case 'settings.setDefaultModel':
          this.requireUi(ui);
          return ok({ defaultModelId: await this.deps.models.setDefault(message.id) });
        case 'settings.setTaskModel':
          this.requireUi(ui);
          return ok({ taskModels: await this.deps.models.setTaskModel(message.task, message.id) });
        case 'settings.updatePrefs':
          this.requireUi(ui);
          return ok(await this.updatePrefs(message.patch));
        case 'settings.updateSubtitlePrefs':
          if (!ui && !content) throw new AppError('PERMISSION_DENIED');
          return ok(await this.updateSubtitlePrefs(message.style));
        case 'models.test':
          this.requireUi(ui);
          return ok(await this.deps.models.test(message.modelId, message.draft));
        case 'models.list':
          this.requireUi(ui);
          return ok({ models: await this.deps.models.list(message.modelId, message.draft) });
        case 'translate.batch':
          if (!content) throw new AppError('PERMISSION_DENIED');
          return ok(await this.translate(message.request, sender));
        case 'translate.cancel':
          if (!content) throw new AppError('PERMISSION_DENIED');
          return ok({ cancelled: this.cancel(sender.tab?.id, message.requestId) });
        case 'translate.subtitles':
          if (!content) throw new AppError('PERMISSION_DENIED');
          return ok(await this.translateSubtitles(message.request, sender));
        case 'asr.transcribe':
          if (!content) throw new AppError('PERMISSION_DENIED');
          return ok(await this.transcribe(message));
        case 'tab.getState':
          this.requireUi(ui);
          return ok(await this.getActiveTabState());
        case 'tab.command':
          this.requireUi(ui);
          return ok(await this.runActiveTabCommand(message.command));
        case 'tab.stateReport':
          if (!content || sender.tab?.id === undefined) throw new AppError('PERMISSION_DENIED');
          return ok(this.reportState(sender.tab.id, message.page, message.subtitle, message.url, message.title));
        case 'cache.stats': {
          this.requireUi(ui);
          const settings = await this.deps.repository.load();
          this.deps.cache.setMaxEntries(settings.cache.maxEntries);
          await this.deps.cache.init();
          return ok(this.deps.cache.stats());
        }
        case 'cache.clear':
          this.requireUi(ui);
          return ok({ cleared: await this.deps.cache.clear() });
        case 'data.clear':
          this.requireUi(ui);
          await this.deps.repository.clear();
          await this.deps.cache.clear();
          await chrome.storage.session.clear();
          this.abortAll();
          return ok({ cleared: true });
        case 'app.getVersion':
          return ok({ version: chrome.runtime.getManifest().version });
        default:
          throw new AppError('INVALID_REQUEST', '未知的扩展消息类型。');
      }
    } catch (error) {
      const normalized = normalizeError(error);
      console.warn(`[意方通行] ${message.type} failed: ${normalized.code}`);
      return errorResult(normalized);
    }
  }

  private requireUi(ui: boolean): void {
    if (!ui) throw new AppError('PERMISSION_DENIED', '该设置只能由扩展设置页面读取。');
  }

  private requireObject<T>(value: unknown): T {
    if (!value || typeof value !== 'object') throw new AppError('INVALID_REQUEST');
    return value as T;
  }

  private async clearModelKey(id: string): Promise<{ cleared: true }> {
    await this.deps.repository.update((settings) => {
      if (!settings.models.some((model) => model.id === id)) {
        throw new AppError('NOT_FOUND', '模型不存在。');
      }
      return {
        settings: {
          ...settings,
          models: settings.models.map((model) =>
            model.id === id ? { ...model, apiKey: '', updatedAt: Date.now() } : model,
          ),
        },
        result: true,
      };
    });
    return { cleared: true };
  }

  private async updatePrefs(patch: PrefsPatch): Promise<PublicSettings> {
    return this.deps.repository.update((settings) => {
      const next = mergePrefs(settings, patch);
      return { settings: next, result: buildPublicSettings(next) };
    });
  }

  private async updateSubtitlePrefs(style: Partial<SubtitlePrefs['style']>): Promise<SubtitlePrefs> {
    return this.deps.repository.update((settings) => {
      const nextStyle = mergeSubtitleStyle(settings.subtitle.style, style as Record<string, unknown>);
      const next: Settings = {
        ...settings,
        subtitle: { ...settings.subtitle, style: nextStyle },
      };
      return { settings: next, result: next.subtitle };
    });
  }

  private async translate(
    request: TranslateBatchRequest,
    sender: Sender,
  ): Promise<RuntimeResponses['translate.batch']> {
    if (!request || typeof request.requestId !== 'string' || request.requestId.length > 100) {
      throw new AppError('INVALID_REQUEST', '翻译请求缺少有效 requestId。');
    }
    const tabId = sender.tab?.id;
    if (tabId === undefined) throw new AppError('PERMISSION_DENIED');
    const key = `${tabId}:${request.requestId}`;
    this.abortControllers.get(key)?.abort();
    const controller = new AbortController();
    this.abortControllers.set(key, controller);
    try {
      return await this.deps.translation.translateBatch(request, controller.signal);
    } finally {
      this.abortControllers.delete(key);
    }
  }

  private async translateSubtitles(
    request: SubtitleTranslationRequest,
    sender: Sender,
  ): Promise<RuntimeResponses['translate.subtitles']> {
    if (!request || !Array.isArray(request.cues) || request.cues.length === 0) {
      throw new AppError('INVALID_REQUEST', '没有可翻译的字幕。');
    }
    if (request.cues.length > 6000) {
      throw new AppError('INVALID_REQUEST', '字幕条目过多。');
    }
    const tabId = sender.tab?.id;
    if (tabId === undefined) throw new AppError('PERMISSION_DENIED');
    const key = `${tabId}:${request.requestId}`;
    this.abortControllers.get(key)?.abort();
    const controller = new AbortController();
    this.abortControllers.set(key, controller);
    try {
      const data = await this.deps.translation.translateBatch(
        {
          requestId: request.requestId,
          task: 'subtitles',
          chunks: request.cues.map((cue) => cue.text),
          modelId: request.modelId,
          sourceLanguage: request.sourceLanguage,
          targetLanguage: request.targetLanguage,
          bypassCache: request.bypassCache,
        },
        controller.signal,
      );
      return data;
    } finally {
      this.abortControllers.delete(key);
    }
  }

  private async transcribe(
    message: RuntimeRequest & { type: 'asr.transcribe' },
  ): Promise<RuntimeResponses['asr.transcribe']> {
    if (!message.audioBase64 || message.audioBase64.length > 30_000_000) {
      throw new AppError('INVALID_REQUEST', '音频数据为空或过大。');
    }
    const settings = await this.deps.repository.load();
    const model = taskAsrModel(settings, message.modelId);
    const provider = createAudioProvider(model) as AudioApiProvider;
    const bytes = base64ToBytes(message.audioBase64);
    if (bytes.byteLength === 0) throw new AppError('INVALID_REQUEST', '音频数据为空。');
    return provider.transcribe(bytes, message.mimeType || 'audio/wav', {
      language: message.language,
    });
  }

  private cancel(tabId: number | undefined, requestId: string): boolean {
    if (tabId === undefined) return false;
    const key = `${tabId}:${requestId}`;
    const controller = this.abortControllers.get(key);
    if (!controller) return false;
    controller.abort();
    this.abortControllers.delete(key);
    return true;
  }

  private abortAll(): void {
    for (const controller of this.abortControllers.values()) controller.abort();
    this.abortControllers.clear();
  }

  abortTab(tabId: number): void {
    for (const [key, controller] of this.abortControllers) {
      if (key.startsWith(`${tabId}:`)) {
        controller.abort();
        this.abortControllers.delete(key);
      }
    }
  }

  private reportState(
    tabId: number,
    page: unknown,
    subtitle: unknown,
    url: unknown,
    title: unknown,
  ): { stored: boolean } {
    const snapshot: ContentPageSnapshot = {
      page: sanitizePageState(page),
      subtitle: sanitizeSubtitleState(subtitle),
      url: typeof url === 'string' ? url.slice(0, 2048) : '',
      title: typeof title === 'string' ? title.slice(0, 300) : '',
    };
    void chrome.storage.session.set({ [`${TAB_STATE_PREFIX}${tabId}`]: snapshot }).catch(() => {
      // Session state is best-effort UI cache only.
    });
    this.deps.onStateReport?.(tabId, snapshot);
    return { stored: true };
  }

  private async queryActiveTab(): Promise<chrome.tabs.Tab | undefined> {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs[0];
  }

  private supportReason(tab: chrome.tabs.Tab): string | null {
    if (tab.id === undefined) return '无法识别当前标签页。';
    let protocol = '';
    try {
      protocol = tab.url ? new URL(tab.url).protocol : '';
    } catch {
      return '当前标签页地址无效。';
    }
    if (!protocol) return '当前标签页没有可访问的 URL。';
    if (!SUPPORTED_PAGE_PROTOCOLS.has(protocol)) {
      return '浏览器内置页面、扩展页面和本地文件不允许内容脚本运行。请打开普通网页后重试。';
    }
    return null;
  }

  private async sendToTab(tabId: number, command: ContentCommand): Promise<ContentPageSnapshot> {
    let response: ApiResult<ContentPageSnapshot>;
    try {
      response = await withTimeout(
        chrome.tabs.sendMessage(tabId, command) as Promise<ApiResult<ContentPageSnapshot>>,
        12_000,
        '内容脚本响应超时。请刷新页面后重试。',
      );
    } catch (error) {
      if (!isReceiverMissing(error)) throw normalizeError(error);
      try {
        await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
        await new Promise((resolve) => setTimeout(resolve, 350));
        response = await withTimeout(
          chrome.tabs.sendMessage(tabId, command) as Promise<ApiResult<ContentPageSnapshot>>,
          12_000,
          '内容脚本注入后仍未响应。请刷新页面后重试。',
        );
      } catch (injectionError) {
        throw new AppError(
          'CONTENT_UNAVAILABLE',
          '无法连接当前页面。请刷新页面，或确认该站点允许扩展运行。',
          { diagnostic: injectionError instanceof Error ? injectionError.message.slice(0, 200) : undefined },
        );
      }
    }
    if (!response) throw new AppError('CONTENT_UNAVAILABLE', '内容脚本返回了空响应。请刷新页面。');
    if (!response.ok) throw appErrorFromShape(response.error);
    return sanitizeSnapshot(response.data);
  }

  private async getActiveTabState(): Promise<ActiveTabState> {
    const tab = await this.queryActiveTab();
    if (!tab) {
      return {
        supported: false,
        tabId: null,
        url: '',
        title: '',
        page: null,
        subtitle: null,
        reason: '没有找到活动标签页。',
      };
    }
    const reason = this.supportReason(tab);
    const base: ActiveTabState = {
      supported: reason === null,
      tabId: tab.id ?? null,
      url: tab.url ?? '',
      title: tab.title ?? '',
      page: null,
      subtitle: null,
      ...(reason ? { reason } : {}),
    };
    if (reason !== null || tab.id === undefined) return base;
    try {
      const snapshot = await this.sendToTab(tab.id, { type: 'page:getState' });
      return {
        ...base,
        url: snapshot.url || base.url,
        title: snapshot.title || base.title,
        page: snapshot.page,
        subtitle: snapshot.subtitle,
      };
    } catch (error) {
      return {
        ...base,
        supported: true,
        reason: normalizeError(error).message,
      };
    }
  }

  private async runActiveTabCommand(command: ContentCommand): Promise<ContentPageSnapshot> {
    const tab = await this.queryActiveTab();
    if (!tab || tab.id === undefined) throw new AppError('UNSUPPORTED_PAGE', '没有找到活动标签页。');
    const reason = this.supportReason(tab);
    if (reason) throw new AppError('UNSUPPORTED_PAGE', reason);
    return this.sendToTab(tab.id, command);
  }

  async togglePageTranslation(): Promise<void> {
    const tab = await this.queryActiveTab();
    if (!tab?.id) return;
    if (this.supportReason(tab)) return;
    const snapshot = await this.sendToTab(tab.id, { type: 'page:getState' });
    if (snapshot.page.status === 'translating' && snapshot.page.active) {
      await this.sendToTab(tab.id, { type: 'page:pause' });
    } else if (snapshot.page.status === 'paused') {
      await this.sendToTab(tab.id, { type: 'page:resume' });
    } else if (snapshot.page.status === 'error' && snapshot.page.active) {
      await this.sendToTab(tab.id, { type: 'page:retryFailed' });
    } else if (snapshot.page.status === 'done' && snapshot.page.active) {
      await this.sendToTab(tab.id, { type: 'page:retranslate' });
    } else {
      await this.sendToTab(tab.id, { type: 'page:start' });
    }
  }

  async restoreActivePage(): Promise<void> {
    const tab = await this.queryActiveTab();
    if (!tab?.id || this.supportReason(tab)) return;
    await this.sendToTab(tab.id, { type: 'page:restore' });
  }

  async openSubtitlePanel(): Promise<void> {
    const tab = await this.queryActiveTab();
    if (!tab?.id || this.supportReason(tab)) return;
    await this.sendToTab(tab.id, { type: 'subtitles:openPanel' });
  }
}