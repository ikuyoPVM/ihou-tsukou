import { createRoot } from 'react-dom/client';
import { AppError, normalizeError, type ErrorCode } from '../shared/errors';
import { LANGUAGE_LABELS } from '../shared/constants';
import type { ContentCommand } from '../shared/messages';
import type {
  ApiResult,
  ContentPageSnapshot,
  PublicSettings,
  SubtitleDisplayMode,
  SubtitlePrefs,
  SubtitleStylePrefs,
  TranslateBatchData,
} from '../shared/types';
import { clamp, throttle } from '../shared/utils';
import { arrayBufferToBase64 } from '../shared/wav';
import { PageTranslator } from '../webpage/translator';
import { SubtitleController } from '../subtitles/controller';
import { OverlayApp } from './ui/OverlayApp';
import { createInitialUiState, UiStore, type SelectionView, type UiActions } from './ui/store';
import { CONTENT_UI_CSS } from './ui/styles';

declare global {
  interface Window {
    __polyglotAiLoaded?: boolean;
  }
}

const CONTENT_COMMANDS = new Set<ContentCommand['type']>([
  'page:start',
  'page:pause',
  'page:resume',
  'page:restore',
  'page:retranslate',
  'page:retryFailed',
  'page:getState',
  'subtitles:getState',
  'subtitles:enable',
  'subtitles:openPanel',
  'subtitles:selectVideo',
  'subtitles:selectTrack',
  'subtitles:setMode',
  'subtitles:loadFile',
  'subtitles:translate',
  'subtitles:stop',
  'subtitles:startAsr',
  'subtitles:applySubtitlePrefs',
  'ui:showPanel',
]);

if (!window.__polyglotAiLoaded) {
  window.__polyglotAiLoaded = true;
  void initialize();
}

async function initialize(): Promise<void> {
  const store = new UiStore(createInitialUiState());
  let settings: PublicSettings | null = null;
  let selectionRequestId: string | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingStyle: Partial<SubtitleStylePrefs> = {};
  let styleTimer: ReturnType<typeof setTimeout> | null = null;
  let mountedRoot: ReturnType<typeof createRoot> | null = null;

  const host = document.createElement('div');
  host.id = 'polyglot-ai-ui-host';
  host.className = 'polyglot-ai-ui';
  host.setAttribute('data-polyglot-ai-ui', 'true');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CONTENT_UI_CSS;
  shadow.appendChild(style);
  const mountPoint = document.createElement('div');
  mountPoint.className = 'pgp-mount';
  shadow.appendChild(mountPoint);
  document.documentElement.appendChild(host);

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = (): void => {
    const preference = settings?.ui.theme ?? 'system';
    const dark = preference === 'dark' || (preference === 'system' && systemDark.matches);
    store.update({ theme: dark ? 'dark' : 'light' });
    host.dataset.theme = dark ? 'dark' : 'light';
  };

  function showToast(kind: 'info' | 'success' | 'error', message: string): void {
    const id = Date.now();
    store.update({ toast: { id, kind, message } });
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      if (store.get().toast?.id === id) store.update({ toast: null });
    }, 4500);
  }

  async function request<T>(message: unknown): Promise<T> {
    let response: ApiResult<T> | undefined;
    try {
      response = (await chrome.runtime.sendMessage(message)) as ApiResult<T> | undefined;
    } catch (error) {
      throw new AppError(
        'CONTENT_UNAVAILABLE',
        '扩展后台暂时不可用。请刷新页面；如果扩展刚更新，请重新加载扩展。',
        { cause: error },
      );
    }
    if (!response) {
      throw new AppError('CONTENT_UNAVAILABLE', '扩展后台返回了空响应。请刷新页面后重试。');
    }
    if (!response.ok) {
      throw new AppError(response.error.code as ErrorCode, response.error.message, {
        retryable: response.error.retryable,
        status: response.error.status,
      });
    }
    return response.data;
  }

  const reportNow = throttle(() => {
    void sendStateReport().catch(() => undefined);
  }, 300);

  async function sendStateReport(): Promise<void> {
    const snapshot = currentSnapshot();
    try {
      await chrome.runtime.sendMessage({
        type: 'tab.stateReport',
        page: snapshot.page,
        subtitle: snapshot.subtitle,
        url: snapshot.url,
        title: snapshot.title,
      });
    } catch {
      // The extension can be reloaded while a page is open; state reporting is best effort.
    }
  }

  const pageTranslator = new PageTranslator(document, {
    translate: async (chunks, options) => {
      const data = await request<TranslateBatchData>({
        type: 'translate.batch',
        request: {
          requestId: options.requestId,
          task: 'webpage',
          chunks,
          bypassCache: options.bypassCache,
          context: document.title.slice(0, 300),
        },
      });
      return { translations: data.translations, modelName: data.modelName };
    },
    cancel: (requestId) => {
      void chrome.runtime
        .sendMessage({ type: 'translate.cancel', requestId })
        .catch(() => undefined);
    },
    onState: () => {
      reportNow();
    },
  });

  const subtitleController = new SubtitleController(document, {
    getSettings: () => settings,
    translate: async ({ requestId, cues, modelId, bypassCache }) => {
      const data = await request<TranslateBatchData>({
        type: 'translate.subtitles',
        request: {
          requestId,
          cues,
          ...(modelId ? { modelId } : {}),
          bypassCache,
        },
      });
      return {
        translations: data.translations.map((text, index) => ({
          id: cues[index]?.id ?? '',
          text,
        })),
        modelName: data.modelName,
      };
    },
    cancel: (requestId) => {
      void chrome.runtime
        .sendMessage({ type: 'translate.cancel', requestId })
        .catch(() => undefined);
    },
    transcribe: async (audio, mimeType) => {
      const data = await request<{ text: string }>({
        type: 'asr.transcribe',
        audioBase64: arrayBufferToBase64(audio),
        mimeType,
        ...(settings?.languages.source && settings.languages.source !== 'auto'
          ? { language: settings.languages.source }
          : {}),
      });
      return data.text;
    },
    onState: (state) => {
      store.update({ subtitleState: state, panelOpen: state.panelOpen });
      reportNow();
    },
    onOverlay: (overlay) => {
      store.update({ overlay });
    },
  });

  async function refreshSettings(): Promise<void> {
    const next = await request<PublicSettings>({ type: 'settings.getPublic' });
    settings = next;
    pageTranslator.setSettings(next);
    subtitleController.setSettings(next);
    const selectedModel = store.get().selectedModelId;
    store.update({
      models: next.models,
      selectedModelId:
        selectedModel && next.models.some((model) => model.id === selectedModel) ? selectedModel : '',
      targetLanguage: LANGUAGE_LABELS[next.languages.target] ?? next.languages.target,
    });
    applyTheme();
  }

  function currentSnapshot(): ContentPageSnapshot {
    return {
      page: pageTranslator.getState(),
      subtitle: subtitleController.getState(),
      url: location.href,
      title: document.title,
    };
  }

  function persistStyleSoon(): void {
    if (styleTimer !== null) clearTimeout(styleTimer);
    styleTimer = setTimeout(() => {
      const stylePatch = pendingStyle;
      pendingStyle = {};
      styleTimer = null;
      if (Object.keys(stylePatch).length === 0) return;
      void (async () => {
        try {
          const prefs = await request<SubtitlePrefs>({
            type: 'settings.updateSubtitlePrefs',
            style: stylePatch,
          });
          if (settings) {
            settings = { ...settings, subtitle: prefs };
            subtitleController.setSettings(settings);
          }
        } catch (error) {
          showToast('error', normalizeError(error).message);
        }
      })();
    }, 350);
  }

  function applyStyle(patch: Partial<SubtitleStylePrefs>): void {
    subtitleController.applySubtitleStyle(patch);
    if (settings) {
      settings = {
        ...settings,
        subtitle: {
          ...settings.subtitle,
          style: { ...settings.subtitle.style, ...patch },
        },
      };
    }
    pendingStyle = { ...pendingStyle, ...patch };
    persistStyleSoon();
  }

  function copyText(text: string): void {
    void (async () => {
      try {
        await navigator.clipboard.writeText(text);
        showToast('success', '已复制译文。');
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        textarea.style.pointerEvents = 'none';
        document.body.appendChild(textarea);
        textarea.select();
        try {
          document.execCommand('copy');
          showToast('success', '已复制译文。');
        } catch {
          showToast('error', '复制失败，请手动选择文本。');
        } finally {
          textarea.remove();
        }
      }
    })();
  }

  async function runSelectionTranslation(): Promise<void> {
    const current = store.get().selection;
    if (!current || current.status === 'loading') return;
    const requestId = `selection-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    selectionRequestId = requestId;
    const loading: SelectionView = { ...current, status: 'loading', error: undefined, translation: undefined };
    store.update({ selection: loading, trigger: null });
    try {
      const data = await request<TranslateBatchData>({
        type: 'translate.batch',
        request: {
          requestId,
          task: 'webpage',
          chunks: [current.source],
          context: document.title.slice(0, 300),
        },
      });
      if (selectionRequestId !== requestId) return;
      store.update({
        selection: {
          ...loading,
          status: 'done',
          translation: data.translations[0] ?? '',
        },
      });
    } catch (error) {
      if (selectionRequestId !== requestId) return;
      const normalized = normalizeError(error);
      store.update({
        selection: { ...loading, status: 'error', error: normalized.message },
      });
    }
  }

  function selectText(event: MouseEvent): void {
    if (!settings?.ui.selectionEnabled) return;
    if (event.composedPath().some((target) => target === host)) return;
    window.setTimeout(() => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
      const text = selection.toString().trim();
      if (!text || text.length > 5000) return;
      const anchor = selection.anchorNode;
      if (anchor && isInsideInteractiveEditor(anchor)) return;
      if (anchor && rootHost(anchor) === host) return;
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const source = text.slice(0, 5000);
      const left = clamp(rect.left + rect.width / 2 - 17, 8, window.innerWidth - 42);
      const top = clamp(rect.bottom + 7, 8, window.innerHeight - 42);
      store.update({ trigger: { left, top }, selection: null });
      selectionStorage = source;
    }, 10);
  }

  let selectionStorage = '';
  const actions: UiActions = {
    translateSelection: () => {
      const state = store.get();
      if (state.selection) {
        void runSelectionTranslation();
        return;
      }
      if (!selectionStorage) return;
      const selection = window.getSelection();
      const rect = selection && selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null;
      store.update({
        trigger: null,
        selection: {
          rect: rect
            ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
            : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 },
          source: selectionStorage,
          sourceLanguage:
            settings?.languages.source === 'auto'
              ? '自动检测'
              : LANGUAGE_LABELS[settings?.languages.source ?? ''] ?? '源语言',
          targetLanguage: LANGUAGE_LABELS[settings?.languages.target ?? ''] ?? '目标语言',
          status: 'done',
        },
      });
      void runSelectionTranslation();
    },
    retrySelection: () => {
      void runSelectionTranslation();
    },
    closeSelection: () => {
      if (selectionRequestId) {
        void chrome.runtime
          .sendMessage({ type: 'translate.cancel', requestId: selectionRequestId })
          .catch(() => undefined);
        selectionRequestId = null;
      }
      selectionStorage = '';
      store.update({ trigger: null, selection: null });
    },
    copyText,
    toggleSubtitles: (enabled) => {
      void subtitleController.toggleEnabled(enabled).catch((error) => {
        showToast('error', normalizeError(error).message);
      });
    },
    openPanel: (open) => {
      subtitleController.openPanel(open);
      store.update({ panelOpen: open });
      if (open) void subtitleController.refreshVideosNow().catch(() => undefined);
    },
    refreshVideos: () => {
      store.update({ busy: true });
      void subtitleController
        .refreshVideosNow()
        .catch((error) => showToast('error', normalizeError(error).message))
        .finally(() => store.update({ busy: false }));
    },
    selectVideo: (videoId) => {
      store.update({ busy: true });
      void subtitleController
        .selectVideo(videoId)
        .catch((error) => showToast('error', normalizeError(error).message))
        .finally(() => store.update({ busy: false }));
    },
    loadTrack: (trackIndex) => {
      store.update({ busy: true });
      void subtitleController
        .selectTrack(trackIndex)
        .catch((error) => showToast('error', normalizeError(error).message))
        .finally(() => store.update({ busy: false }));
    },
    importFile: (file) => {
      void (async () => {
        if (file.size > 2 * 1024 * 1024) {
          showToast('error', '字幕文件超过 2 MB，无法导入。');
          return;
        }
        try {
          const text = await file.text();
          subtitleController.importSubtitleFile(text, file.name);
          showToast('success', `已导入 ${file.name}`);
        } catch (error) {
          showToast('error', normalizeError(error).message);
        }
      })();
    },
    translateSubtitles: () => {
      void (async () => {
        try {
          await refreshSettings();
          await subtitleController.startTranslation({
            ...(store.get().selectedModelId ? { modelId: store.get().selectedModelId } : {}),
          });
        } catch (error) {
          showToast('error', normalizeError(error).message);
        }
      })();
    },
    retryFailedSubtitles: () => {
      void subtitleController
        .retryFailed(store.get().selectedModelId || undefined)
        .catch((error) => showToast('error', normalizeError(error).message));
    },
    stopSubtitles: () => {
      void subtitleController.stopTranslation();
    },
    startAsr: () => {
      void subtitleController.startAsr().catch((error) => {
        showToast('error', normalizeError(error).message);
      });
    },
    stopAsr: () => {
      void subtitleController.stopAsr();
    },
    setSubtitleMode: (mode: SubtitleDisplayMode) => {
      subtitleController.setMode(mode);
      applyStyle({ mode });
    },
    updateSubtitleStyle: (patch) => applyStyle(patch),
    setSelectedModel: (modelId) => store.update({ selectedModelId: modelId }),
    openOptions: () => {
      void chrome.runtime.openOptionsPage().catch(() => {
        showToast('error', '无法打开设置页，请从扩展管理页面进入。');
      });
    },
  };

  mountedRoot = createRoot(mountPoint);
  mountedRoot.render(<OverlayApp store={store} actions={actions} />);

  document.addEventListener('mouseup', selectText);
  document.addEventListener('mousedown', (event) => {
    if (event.composedPath().some((target) => target === host)) return;
    if (store.get().trigger) store.update({ trigger: null });
    if (store.get().selection) actions.closeSelection();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      actions.closeSelection();
      if (store.get().panelOpen) actions.openPanel(false);
    }
  });
  window.addEventListener('scroll', () => {
    if (store.get().trigger) store.update({ trigger: null });
    if (store.get().selection) actions.closeSelection();
  }, { passive: true });
  window.addEventListener('resize', () => {
    if (store.get().trigger) store.update({ trigger: null });
  });
  const refreshOnFocus = () => {
    void refreshSettings().catch(() => undefined);
  };
  window.addEventListener('focus', refreshOnFocus);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshOnFocus();
  });
  const onSystemTheme = () => applyTheme();
  systemDark.addEventListener('change', onSystemTheme);
  document.addEventListener('fullscreenchange', () => {
    const fullscreen = document.fullscreenElement;
    if (fullscreen && fullscreen.tagName !== 'VIDEO') {
      fullscreen.appendChild(host);
    } else if (host.parentElement !== document.documentElement) {
      document.documentElement.appendChild(host);
    }
  });

  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false;
    const command = message as ContentCommand;
    if (typeof command.type !== 'string' || !CONTENT_COMMANDS.has(command.type)) return false;
    void handleCommand(command)
      .then((snapshot) => sendResponse({ ok: true, data: snapshot } satisfies ApiResult<ContentPageSnapshot>))
      .catch((error) =>
        sendResponse({ ok: false, error: normalizeError(error).toShape() } satisfies ApiResult<never>),
      );
    return true;
  });

  async function handleCommand(command: ContentCommand): Promise<ContentPageSnapshot> {
    switch (command.type) {
      case 'page:start':
        await refreshSettings().catch(() => undefined);
        pageTranslator.start(command.mode ?? 'bilingual', command.bypassCache ?? false);
        break;
      case 'page:pause':
        pageTranslator.pause();
        break;
      case 'page:resume':
        pageTranslator.resume();
        break;
      case 'page:restore':
        pageTranslator.restore();
        break;
      case 'page:retranslate':
        await refreshSettings().catch(() => undefined);
        pageTranslator.retranslate(command.mode ?? pageTranslator.getState().mode);
        break;
      case 'page:retryFailed':
        pageTranslator.retryFailed();
        break;
      case 'page:getState':
        break;
      case 'subtitles:getState':
        await subtitleController.refreshVideosNow();
        break;
      case 'subtitles:enable':
        await subtitleController.toggleEnabled(command.enabled);
        break;
      case 'subtitles:openPanel':
        subtitleController.openPanel(true);
        store.update({ panelOpen: true });
        await subtitleController.refreshVideosNow();
        break;
      case 'subtitles:selectVideo':
        store.update({ busy: true });
        try {
          await subtitleController.selectVideo(command.videoId);
        } finally {
          store.update({ busy: false });
        }
        break;
      case 'subtitles:selectTrack':
        store.update({ busy: true });
        try {
          await subtitleController.selectTrack(command.trackIndex);
        } finally {
          store.update({ busy: false });
        }
        break;
      case 'subtitles:setMode':
        subtitleController.setMode(command.mode);
        applyStyle({ mode: command.mode });
        break;
      case 'subtitles:loadFile':
        subtitleController.importSubtitleFile(command.text, command.filename);
        break;
      case 'subtitles:translate':
        void subtitleController.startTranslation({
          ...(command.modelId ? { modelId: command.modelId } : {}),
        });
        break;
      case 'subtitles:stop':
        await subtitleController.stopTranslation();
        break;
      case 'subtitles:startAsr':
        void subtitleController.startAsr().catch((error) => showToast('error', normalizeError(error).message));
        break;
      case 'subtitles:applySubtitlePrefs':
        subtitleController.applySubtitleStyle(command.style);
        pendingStyle = { ...pendingStyle, ...command.style };
        persistStyleSoon();
        break;
      case 'ui:showPanel':
        subtitleController.openPanel(command.open);
        store.update({ panelOpen: command.open });
        break;
    }
    store.update({
      subtitleState: subtitleController.getState(),
      panelOpen: subtitleController.getState().panelOpen,
    });
    reportNow();
    return currentSnapshot();
  }

  window.addEventListener('pagehide', () => {
    subtitleController.dispose();
    pageTranslator.dispose();
    mountedRoot?.unmount();
    host.remove();
    window.removeEventListener('focus', refreshOnFocus);
    systemDark.removeEventListener('change', onSystemTheme);
  }, { once: true });

  try {
    await refreshSettings();
  } catch (error) {
    showToast('error', normalizeError(error).message);
  }
  applyTheme();
  reportNow();
}

function isInsideInteractiveEditor(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  if (!element) return false;
  try {
    return Boolean(
      element.closest(
        'input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"], [role="textbox"], [data-polyglot-ai-ui]',
      ),
    );
  } catch {
    return false;
  }
}

function rootHost(node: Node): Node | null {
  const root = node.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}