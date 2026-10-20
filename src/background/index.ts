import { LEGACY_STORAGE_KEY, STORAGE_KEY, TAB_STATE_PREFIX } from '../shared/constants';
import { AppError } from '../shared/errors';
import { isRuntimeRequest } from '../shared/messages';
import type { ApiResult, ContentPageSnapshot } from '../shared/types';
import { ChromeStorageArea, SettingsRepository } from '../settings/repository';
import { createDefaultSettings } from '../settings/defaults';
import { TranslationCache } from '../translation/cache';
import { TranslationService } from '../translation/service';
import { BackgroundRouter } from './router';
import { ModelService } from './model-service';
import { progressFromState } from './state';

const storage = new ChromeStorageArea(chrome.storage.local);
const repository = new SettingsRepository(storage);
const cache = new TranslationCache(storage);
const translation = new TranslationService(repository, cache);
const models = new ModelService(repository);

const uiPorts = new Set<chrome.runtime.Port>();

const router = new BackgroundRouter({
  repository,
  cache,
  translation,
  models,
  onStateReport: (tabId, snapshot) => {
    updateBadge(tabId, snapshot);
    broadcastState(tabId, snapshot);
  },
});

function updateBadge(tabId: number, snapshot: ContentPageSnapshot): void {
  const progress = progressFromState(snapshot.page);
  try {
    void chrome.action.setBadgeText({ tabId, text: progress?.text ?? '' });
    if (progress) {
      void chrome.action.setBadgeBackgroundColor({ tabId, color: progress.color });
      void chrome.action.setTitle({
        tabId,
        title: `意方通行 · ${snapshot.page.completed}/${snapshot.page.total} 段${
          snapshot.page.failed ? ` · ${snapshot.page.failed} 失败` : ''
        }`,
      });
    } else {
      void chrome.action.setTitle({ tabId, title: '意方通行' });
    }
  } catch {
    // Badge updates are cosmetic and must not break translation.
  }
}

function broadcastState(tabId: number, snapshot: ContentPageSnapshot): void {
  const message = { type: 'tabState', tabId, snapshot };
  for (const port of uiPorts) {
    try {
      port.postMessage(message);
    } catch {
      uiPorts.delete(port);
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ihou-ui') return;
  uiPorts.add(port);
  port.onDisconnect.addListener(() => uiPorts.delete(port));
  port.onMessage.addListener((message: unknown) => {
    if (
      message &&
      typeof message === 'object' &&
      (message as { type?: unknown }).type === 'ping'
    ) {
      port.postMessage({ type: 'pong' });
    }
  });
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (!isRuntimeRequest(message)) {
    const error: ApiResult<never> = {
      ok: false,
      error: new AppError('INVALID_REQUEST', '扩展消息格式无效。').toShape(),
    };
    sendResponse(error);
    return false;
  }
  void router.handle(message, sender).then(sendResponse);
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void initializeExtension();
});

chrome.runtime.onStartup.addListener(() => {
  void applyStorageAccessLevel();
});

chrome.commands.onCommand.addListener((command) => {
  void (async () => {
    try {
      if (command === 'translate-page') await router.togglePageTranslation();
      else if (command === 'restore-page') await router.restoreActivePage();
      else if (command === 'toggle-subtitles') await router.openSubtitlePanel();
    } catch (error) {
      console.warn(`[意方通行] Command ${command} failed.`);
    }
  })();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  router.abortTab(tabId);
  void chrome.storage.session.remove(`${TAB_STATE_PREFIX}${tabId}`).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    router.abortTab(tabId);
    void chrome.storage.session.remove(`${TAB_STATE_PREFIX}${tabId}`).catch(() => undefined);
    void chrome.action.setBadgeText({ tabId, text: '' }).catch(() => undefined);
  }
});

async function applyStorageAccessLevel(): Promise<void> {
  try {
    if (chrome.storage.local.setAccessLevel) {
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    }
  } catch {
    console.warn('[意方通行] Could not restrict storage.local access level.');
  }
}

async function initializeExtension(): Promise<void> {
  await applyStorageAccessLevel();
  try {
    const existing = await storage.get([STORAGE_KEY, LEGACY_STORAGE_KEY]);
    if (!existing[STORAGE_KEY] && !existing[LEGACY_STORAGE_KEY]) {
      await repository.save(createDefaultSettings());
    }
  } catch (error) {
    console.warn('[意方通行] Settings initialization failed.');
  }
}

void initializeExtension();