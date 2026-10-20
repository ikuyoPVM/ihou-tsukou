import { useEffect, useMemo, useState } from 'react';
import type { CacheStats, Settings } from '../shared/types';
import { applyTheme, watchSystemTheme } from '../ui/theme';
import { messageOf, request } from './api';
import { ModelsPanel } from './ModelsPanel';
import { TranslationPanel } from './TranslationPanel';
import { SubtitlePanel } from './SubtitlePanel';
import { GeneralPanel } from './GeneralPanel';

type OptionsTab = 'models' | 'translation' | 'subtitle' | 'general';
type ToastTone = 'success' | 'error' | 'info';

const TABS: Array<{ id: OptionsTab; label: string; hint: string; icon: string }> = [
  { id: 'models', label: '模型与 API', hint: '连接、任务分配、默认模型', icon: '◆' },
  { id: 'translation', label: '翻译设置', hint: '语言、风格、术语表', icon: '文' },
  { id: 'subtitle', label: '视频字幕', hint: '样式、模式、语音识别', icon: 'CC' },
  { id: 'general', label: '通用与隐私', hint: '主题、缓存、快捷键', icon: '⚙' },
];

export function OptionsApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<OptionsTab>('models');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ tone: ToastTone; message: string } | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
  const [version, setVersion] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const chatModelCount = useMemo(
    () => settings?.models.filter((model) => model.protocol === 'openai-chat').length ?? 0,
    [settings],
  );
  const audioModelCount = useMemo(
    () => settings?.models.filter((model) => model.protocol === 'openai-audio').length ?? 0,
    [settings],
  );

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (!settings) return;
    applyTheme(settings.ui.theme);
    return watchSystemTheme(() => applyTheme(settings.ui.theme));
  }, [settings?.ui.theme]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  async function loadAll(): Promise<void> {
    setLoading(true);
    try {
      const [nextSettings, nextVersion, nextCache] = await Promise.all([
        request<Settings>({ type: 'settings.getFull' }),
        request<{ version: string }>({ type: 'app.getVersion' }),
        request<CacheStats>({ type: 'cache.stats' }),
      ]);
      setSettings(nextSettings);
      setVersion(nextVersion.version);
      setCacheStats(nextCache);
      applyTheme(nextSettings.ui.theme);
      setError(null);
    } catch (loadError) {
      setError(messageOf(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function reloadSettings(): Promise<void> {
    setRefreshing(true);
    try {
      const next = await request<Settings>({ type: 'settings.getFull' });
      setSettings(next);
      applyTheme(next.ui.theme);
      setError(null);
    } catch (reloadError) {
      setError(messageOf(reloadError));
    } finally {
      setRefreshing(false);
    }
  }

  async function refreshCache(): Promise<void> {
    try {
      setCacheStats(await request<CacheStats>({ type: 'cache.stats' }));
    } catch (cacheError) {
      setError(messageOf(cacheError));
    }
  }

  function notify(tone: ToastTone, message: string): void {
    setToast({ tone, message });
  }

  if (loading) {
    return (
      <div className="options-splash">
        <div className="mark">译</div>
        <div className="row" style={{ marginTop: 14 }}>
          <span className="spinner" /> 正在读取设置…
        </div>
      </div>
    );
  }

  return (
    <div className="options-page">
      <header className="topbar">
        <div className="brand">
          <div className="mark">译</div>
          <div>
            <h1>Polyglot AI</h1>
            <p className="small muted">AI 网页与视频字幕翻译 · 设置</p>
          </div>
        </div>
        <div className="topbar-meta">
          <span className="chip">
            <strong>{chatModelCount}</strong> 个 Chat 模型
          </span>
          <span className="chip">
            <strong>{audioModelCount}</strong> 个 Audio 模型
          </span>
          <span className="chip" data-tone="success">
            密钥仅本地
          </span>
          {version && <span className="tiny faint">v{version}</span>}
          <button
            type="button"
            className="btn btn-sm"
            disabled={refreshing}
            onClick={() => void reloadSettings()}
          >
            {refreshing ? <span className="spinner" /> : '刷新'}
          </button>
        </div>
      </header>

      <div className="options-layout">
        <nav className="sidenav" aria-label="设置导航">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="nav-item"
              data-active={tab === item.id}
              onClick={() => setTab(item.id)}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-copy">
                <span className="nav-label">{item.label}</span>
                <span className="nav-hint">{item.hint}</span>
              </span>
            </button>
          ))}
          <div className="sidenav-note">
            <strong>隐私提示</strong>
            <p>
              API 密钥保存在此浏览器的 <code>chrome.storage.local</code> 中，不会写入网页，也不会写入日志。
              但本地存储并非加密保险箱：共用电脑请谨慎保存密钥。
            </p>
          </div>
        </nav>

        <main className="options-content">
          {error && (
            <div className="notice" data-tone="error">
              {error}
              <button type="button" className="btn btn-sm" onClick={() => void loadAll()}>
                重试
              </button>
            </div>
          )}
          {settings && (
            <>
              {tab === 'models' && (
                <ModelsPanel
                  settings={settings}
                  onReload={reloadSettings}
                  notify={notify}
                  onError={setError}
                />
              )}
              {tab === 'translation' && (
                <TranslationPanel
                  settings={settings}
                  onReload={reloadSettings}
                  notify={notify}
                  onError={setError}
                />
              )}
              {tab === 'subtitle' && (
                <SubtitlePanel
                  settings={settings}
                  onReload={reloadSettings}
                  notify={notify}
                  onError={setError}
                />
              )}
              {tab === 'general' && (
                <GeneralPanel
                  settings={settings}
                  cacheStats={cacheStats}
                  version={version}
                  onReload={reloadSettings}
                  onCacheChanged={refreshCache}
                  notify={notify}
                  onError={setError}
                />
              )}
            </>
          )}
        </main>
      </div>

      {toast && (
        <div className="options-toast" data-tone={toast.tone}>
          {toast.message}
        </div>
      )}
    </div>
  );
}