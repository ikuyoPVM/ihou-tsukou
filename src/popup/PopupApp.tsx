import { useEffect, useMemo, useRef, useState } from 'react';
import { SOURCE_LANGUAGES, TARGET_LANGUAGES } from '../shared/constants';
import { AppError, normalizeError, type ErrorCode } from '../shared/errors';
import type { ContentCommand } from '../shared/messages';
import type {
  ActiveTabState,
  ApiResult,
  ContentPageSnapshot,
  PageState,
  PublicSettings,
  TaskKind,
} from '../shared/types';
import { applyTheme, watchSystemTheme } from '../ui/theme';

async function request<T>(message: unknown): Promise<T> {
  const response = (await chrome.runtime.sendMessage(message)) as ApiResult<T> | undefined;
  if (!response) throw new AppError('UNKNOWN', '扩展后台没有响应，请重试。');
  if (!response.ok) {
    throw new AppError(response.error.code as ErrorCode, response.error.message, {
      retryable: response.error.retryable,
      status: response.error.status,
    });
  }
  return response.data;
}

function pageProgress(page: PageState | null): number {
  if (!page || page.total === 0) return 0;
  if (page.status === 'done') return 100;
  return Math.min(99, Math.round((page.completed / page.total) * 100));
}

const STATUS_LABELS: Record<PageState['status'], string> = {
  idle: '尚未翻译',
  translating: '正在翻译',
  paused: '已暂停',
  done: '翻译完成',
  error: '翻译出错',
  restored: '已恢复原文',
};

export function PopupApp() {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [tab, setTab] = useState<ActiveTabState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<'replace' | 'bilingual'>('bilingual');
  const tabRef = useRef<ActiveTabState | null>(null);
  const settingsRef = useRef<PublicSettings | null>(null);
  tabRef.current = tab;
  settingsRef.current = settings;

  const chatModels = useMemo(
    () => settings?.models.filter((model) => model.enabled && model.protocol === 'openai-chat') ?? [],
    [settings],
  );
  const currentModelId = useMemo(() => {
    if (!settings) return '';
    const configured = settings.taskModels.webpage;
    if (configured && chatModels.some((model) => model.id === configured)) return configured;
    if (settings.defaultModelId && chatModels.some((model) => model.id === settings.defaultModelId)) {
      return settings.defaultModelId;
    }
    return chatModels[0]?.id ?? '';
  }, [settings, chatModels]);
  const currentModel = chatModels.find((model) => model.id === currentModelId);
  const page = tab?.page ?? null;
  const subtitle = tab?.subtitle ?? null;
  const progress = pageProgress(page);
  const hasModel = Boolean(currentModelId);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [nextTab, nextSettings] = await Promise.all([
          request<ActiveTabState>({ type: 'tab.getState' }),
          request<PublicSettings>({ type: 'settings.getPublic' }),
        ]);
        if (cancelled) return;
        setTab(nextTab);
        setSettings(nextSettings);
        setMode(nextTab.page?.mode ?? 'bilingual');
        applyTheme(nextSettings.ui.theme);
      } catch (loadError) {
        if (!cancelled) setError(normalizeError(loadError).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!settings) return;
    applyTheme(settings.ui.theme);
    return watchSystemTheme(() => applyTheme(settings.ui.theme));
  }, [settings?.ui.theme]);

  useEffect(() => {
    let port: chrome.runtime.Port | null = null;
    try {
      port = chrome.runtime.connect({ name: 'ihou-ui' });
      port.onMessage.addListener((message: unknown) => {
        if (!message || typeof message !== 'object') return;
        const event = message as {
          type?: string;
          tabId?: number;
          snapshot?: ContentPageSnapshot;
        };
        if (event.type !== 'tabState' || !event.snapshot) return;
        const current = tabRef.current;
        if (current?.tabId != null && event.tabId != null && current.tabId !== event.tabId) return;
        setTab((previous) =>
          previous
            ? {
                ...previous,
                page: event.snapshot?.page ?? previous.page,
                subtitle: event.snapshot?.subtitle ?? previous.subtitle,
                url: event.snapshot?.url ?? previous.url,
                title: event.snapshot?.title ?? previous.title,
              }
            : previous,
        );
      });
      port.onDisconnect.addListener(() => {
        port = null;
      });
    } catch {
      // The polling fallback below still refreshes state when ports are unavailable.
    }
    return () => {
      try {
        port?.disconnect();
      } catch {
        // Ignore an already-closed port.
      }
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.hidden || busy) return;
      void refreshTabState();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    if (page?.mode) setMode(page.mode);
  }, [page?.mode]);

  useEffect(() => {
    const onFocus = () => {
      void refreshSettings();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  async function refreshTabState(): Promise<void> {
    try {
      const next = await request<ActiveTabState>({ type: 'tab.getState' });
      setTab(next);
      setMode((current) => next.page?.mode ?? current);
    } catch {
      // Polling is best-effort; explicit actions surface errors.
    }
  }

  async function refreshSettings(): Promise<void> {
    try {
      const next = await request<PublicSettings>({ type: 'settings.getPublic' });
      setSettings(next);
      applyTheme(next.ui.theme);
    } catch {
      // Keep the previously loaded settings.
    }
  }

  async function runCommand(command: ContentCommand, closeAfter = false): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const snapshot = await request<ContentPageSnapshot>({ type: 'tab.command', command });
      setTab((previous) =>
        previous
          ? {
              ...previous,
              page: snapshot.page,
              subtitle: snapshot.subtitle,
              url: snapshot.url,
              title: snapshot.title,
            }
          : previous,
      );
      if (closeAfter) window.setTimeout(() => window.close(), 120);
    } catch (commandError) {
      setError(normalizeError(commandError).message);
    } finally {
      setBusy(false);
    }
  }

  async function handlePrimary(): Promise<void> {
    if (!hasModel) {
      await chrome.runtime.openOptionsPage();
      return;
    }
    if (!page || !page.active) {
      await runCommand({ type: 'page:start', mode });
      return;
    }
    if (page.status === 'translating') {
      await runCommand({ type: 'page:pause' });
      return;
    }
    if (page.status === 'paused') {
      await runCommand({ type: 'page:resume' });
      return;
    }
    await runCommand({ type: 'page:retranslate', mode });
  }

  async function selectMode(next: 'replace' | 'bilingual'): Promise<void> {
    setMode(next);
    if (page?.active) await runCommand({ type: 'page:start', mode: next });
  }

  async function selectTaskModel(task: TaskKind, modelId: string): Promise<void> {
    if (!settings) return;
    try {
      setError(null);
      const result = await request<{ taskModels: PublicSettings['taskModels'] }>({
        type: 'settings.setTaskModel',
        task,
        id: modelId || null,
      });
      setSettings({ ...settings, taskModels: result.taskModels });
      setNotice('网页翻译模型已切换。已翻译页面需要重新翻译才会使用新模型。');
    } catch (modelError) {
      setError(normalizeError(modelError).message);
    }
  }

  async function updateLanguages(patch: { source?: string; target?: string }): Promise<void> {
    if (!settings) return;
    try {
      setError(null);
      const next = await request<PublicSettings>({
        type: 'settings.updatePrefs',
        patch: { languages: { ...settings.languages, ...patch } },
      });
      setSettings(next);
      setNotice('语言设置已保存。对当前页面重新翻译后生效。');
    } catch (languageError) {
      setError(normalizeError(languageError).message);
    }
  }

  async function openSubtitlePanel(): Promise<void> {
    await runCommand({ type: 'subtitles:openPanel' }, true);
  }

  async function openOptions(): Promise<void> {
    await chrome.runtime.openOptionsPage();
  }

  if (loading) {
    return (
      <main className="popup">
        <header className="popup-header">
          <div className="mark">译</div>
          <div>
            <h1>意方通行</h1>
            <p className="small muted">网页与视频字幕翻译</p>
          </div>
        </header>
        <div className="loading-panel">
          <span className="spinner" />
          <span>正在读取当前页面…</span>
        </div>
      </main>
    );
  }

  return (
    <main className="popup">
      <header className="popup-header">
        <div className="mark">译</div>
        <div className="popup-heading">
          <h1>意方通行</h1>
          <p className="small muted">当前页面翻译</p>
        </div>
        <button type="button" className="icon-btn" title="打开扩展设置" onClick={() => void openOptions()}>
          ⚙
        </button>
      </header>

      <div className="page-context">
        <div className="page-title" title={tab?.title || ''}>
          {tab?.title || '当前标签页'}
        </div>
        <div className="tiny faint page-url" title={tab?.url || ''}>
          {tab?.url || ''}
        </div>
      </div>

      {error && <div className="notice" data-tone="error">{error}</div>}
      {notice && <div className="notice" data-tone="success">{notice}</div>}
      {tab?.supported && tab.reason && (
        <div className="notice" data-tone="warning">
          {tab.reason}
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => void refreshTabState()}>
              重新连接页面
            </button>
          </div>
        </div>
      )}

      {!tab?.supported ? (
        <div className="notice" data-tone="warning">
          {tab?.reason || '此页面不支持翻译。请在普通 HTTP/HTTPS 网页中使用。'}
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => void refreshTabState()}>
              重新检测
            </button>
          </div>
        </div>
      ) : (
        <>
          <section className="card">
            <div className="card-head">
              <div>
                <div className="card-title">整页翻译</div>
                <div className="tiny muted">
                  {currentModel ? `${currentModel.name} · ${currentModel.modelId}` : '尚未配置聊天模型'}
                </div>
              </div>
              <span className="chip" data-tone={page?.status === 'error' ? 'danger' : undefined}>
                {page ? STATUS_LABELS[page.status] : '尚未翻译'}
              </span>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="popup-model">
                翻译模型
              </label>
              <select
                id="popup-model"
                className="select"
                value={currentModelId}
                onChange={(event) => void selectTaskModel('webpage', event.target.value)}
              >
                {chatModels.length === 0 && <option value="">未配置模型</option>}
                {chatModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} · {model.modelId}
                  </option>
                ))}
              </select>
            </div>

            <div className="language-grid">
              <div className="field">
                <label className="field-label" htmlFor="popup-source">
                  源语言
                </label>
                <select
                  id="popup-source"
                  className="select"
                  value={settings?.languages.source ?? 'auto'}
                  onChange={(event) => void updateLanguages({ source: event.target.value })}
                >
                  {SOURCE_LANGUAGES.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="field-label" htmlFor="popup-target">
                  目标语言
                </label>
                <select
                  id="popup-target"
                  className="select"
                  value={settings?.languages.target ?? 'zh-CN'}
                  onChange={(event) => void updateLanguages({ target: event.target.value })}
                >
                  {TARGET_LANGUAGES.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="segmented" role="group" aria-label="翻译显示方式">
              <button
                type="button"
                className="segment"
                data-active={mode === 'replace'}
                onClick={() => void selectMode('replace')}
              >
                译文替换
              </button>
              <button
                type="button"
                className="segment"
                data-active={mode === 'bilingual'}
                onClick={() => void selectMode('bilingual')}
              >
                双语对照
              </button>
            </div>

            {page && page.total > 0 && (
              <div className="progress-block">
                <div className="row row-between tiny muted">
                  <span>
                    {page.completed} / {page.total} 个文本片段
                    {page.failed > 0 ? ` · ${page.failed} 个失败` : ''}
                  </span>
                  <span>{progress}%</span>
                </div>
                <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                  <span style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {page?.error && <div className="notice" data-tone="error">{page.error.message}</div>}
            {!page?.error && page?.message && <div className="notice">{page.message}</div>}
            {!hasModel && (
              <div className="notice" data-tone="warning">
                需要先在设置中添加一个 OpenAI 兼容聊天模型，才能翻译网页。
              </div>
            )}

            <div className="action-row">
              <button
                type="button"
                className="btn btn-primary grow"
                disabled={busy || !tab.supported}
                onClick={() => void handlePrimary()}
              >
                {(busy || page?.status === 'translating') && <span className="spinner" />}
                {!hasModel
                  ? '配置模型'
                  : !page || !page.active
                    ? '翻译此页'
                    : page.status === 'translating'
                      ? '暂停翻译'
                      : page.status === 'paused'
                        ? '继续翻译'
                        : '重新翻译'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy || !page?.active}
                onClick={() => void runCommand({ type: 'page:restore' })}
                title="移除扩展插入的译文，恢复原文"
              >
                恢复
              </button>
            </div>

            {page && page.canRetry && (
              <button
                type="button"
                className="btn btn-sm btn-block"
                disabled={busy}
                onClick={() => void runCommand({ type: 'page:retryFailed' })}
              >
                重试 {page.failed} 个失败片段
              </button>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <div>
                <div className="card-title">视频字幕</div>
                <div className="tiny muted">
                  {subtitle && subtitle.videoCount > 0
                    ? `检测到 ${subtitle.videoCount} 个视频`
                    : '当前页面未检测到视频'}
                </div>
              </div>
              {subtitle && subtitle.videoCount > 0 && (
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={subtitle.enabled}
                    disabled={busy}
                    onChange={(event) =>
                      void runCommand({ type: 'subtitles:enable', enabled: event.target.checked })
                    }
                  />
                  字幕
                </label>
              )}
            </div>

            {subtitle && subtitle.videoCount > 0 ? (
              <>
                <div className="subtitle-stats">
                  <div>
                    <span className="stat-value">{subtitle.cueCount}</span>
                    <span className="stat-label">条字幕</span>
                  </div>
                  <div>
                    <span className="stat-value">{subtitle.translatedCount}</span>
                    <span className="stat-label">已翻译</span>
                  </div>
                  <div>
                    <span className="stat-value">{subtitle.failedCount}</span>
                    <span className="stat-label">失败</span>
                  </div>
                </div>
                {subtitle.message && <div className="tiny muted">{subtitle.message}</div>}
                {subtitle.error && <div className="notice" data-tone="error">{subtitle.error.message}</div>}
                <button
                  type="button"
                  className="btn btn-block"
                  disabled={busy}
                  onClick={() => void openSubtitlePanel()}
                >
                  打开字幕控制面板
                </button>
                <div className="tiny faint">
                  支持原生字幕、SRT/VTT 导入；语音识别为实验功能，需 Audio 模型。
                </div>
              </>
            ) : (
              <div className="tiny muted">
                播放视频后可打开站内字幕面板，读取原生字幕或导入本地 SRT / VTT。
              </div>
            )}
          </section>
        </>
      )}

      <footer className="popup-footer">
        <div className="row">
          <span className="tiny faint">快捷键</span>
          <span className="kbd">Alt+A</span>
          <span className="tiny faint">翻译 / 暂停</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void openOptions()}>
          全部设置
        </button>
      </footer>
    </main>
  );
}