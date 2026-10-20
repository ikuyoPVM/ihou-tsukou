import { useEffect, useState } from 'react';
import type { CacheStats, PublicSettings, Settings, ThemePreference } from '../shared/types';
import { messageOf, request } from './api';

interface Props {
  settings: Settings;
  cacheStats: CacheStats | null;
  version: string;
  onReload: () => Promise<void>;
  onCacheChanged: () => Promise<void>;
  notify: (tone: 'success' | 'error' | 'info', message: string) => void;
  onError: (message: string | null) => void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function GeneralPanel({
  settings,
  cacheStats,
  version,
  onReload,
  onCacheChanged,
  notify,
  onError,
}: Props) {
  const [theme, setTheme] = useState<ThemePreference>(settings.ui.theme);
  const [autoTranslate, setAutoTranslate] = useState(settings.ui.autoTranslateNewContent);
  const [selectionEnabled, setSelectionEnabled] = useState(settings.ui.selectionEnabled);
  const [cacheMaxEntries, setCacheMaxEntries] = useState(String(settings.cache.maxEntries));
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    setTheme(settings.ui.theme);
    setAutoTranslate(settings.ui.autoTranslateNewContent);
    setSelectionEnabled(settings.ui.selectionEnabled);
    setCacheMaxEntries(String(settings.cache.maxEntries));
  }, [settings]);

  async function save(): Promise<void> {
    const maxEntries = Number(cacheMaxEntries);
    if (!Number.isInteger(maxEntries) || maxEntries < 0 || maxEntries > 5000) {
      onError('缓存条目数必须是 0 到 5000 之间的整数。');
      return;
    }
    setSaving(true);
    onError(null);
    try {
      await request<PublicSettings>({
        type: 'settings.updatePrefs',
        patch: {
          ui: { theme, autoTranslateNewContent: autoTranslate, selectionEnabled },
          cache: { maxEntries },
        },
      });
      await onReload();
      await onCacheChanged();
      notify('success', '通用设置已保存。');
    } catch (error) {
      onError(messageOf(error));
    } finally {
      setSaving(false);
    }
  }

  async function clearCache(): Promise<void> {
    if (!window.confirm('确定清空本地翻译缓存吗？缓存只保存已翻译文本，不会删除模型或密钥。')) return;
    setClearing(true);
    onError(null);
    try {
      const result = await request<{ cleared: number }>({ type: 'cache.clear' });
      await onCacheChanged();
      notify('success', `已清空 ${result.cleared} 条翻译缓存。`);
    } catch (error) {
      onError(messageOf(error));
    } finally {
      setClearing(false);
    }
  }

  async function clearAllData(): Promise<void> {
    if (
      !window.confirm(
        '确定清空扩展的全部本地数据吗？这会删除所有模型配置、API 密钥、偏好设置和翻译缓存。此操作不可撤销。',
      )
    ) {
      return;
    }
    setClearing(true);
    onError(null);
    try {
      await request<{ cleared: true }>({ type: 'data.clear' });
      await onReload();
      await onCacheChanged();
      notify('success', '扩展本地数据已清空。请重新配置模型。');
    } catch (error) {
      onError(messageOf(error));
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="panel-stack">
      <header className="panel-head">
        <div>
          <div className="eyebrow">GENERAL</div>
          <h2>通用与隐私</h2>
          <p className="muted">外观、页面行为、本地缓存与数据清理。</p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? <span className="spinner" /> : null}
          保存通用设置
        </button>
      </header>

      <section className="sub-card">
        <div className="sub-card-head">
          <div>
            <h3>外观</h3>
            <p className="small muted">适用于弹出窗口、设置页和视频字幕面板。</p>
          </div>
        </div>
        <div className="theme-grid">
          {[
            { value: 'system' as const, label: '跟随系统', hint: '自动匹配浅色 / 深色' },
            { value: 'light' as const, label: '浅色', hint: '明亮界面' },
            { value: 'dark' as const, label: '深色', hint: '低光环境' },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              className="theme-card"
              data-active={theme === item.value}
              data-theme-preview={item.value}
              onClick={() => setTheme(item.value)}
            >
              <span className="theme-swatch" />
              <span className="style-label">{item.label}</span>
              <span className="style-hint">{item.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="sub-card">
        <div className="sub-card-head">
          <div>
            <h3>页面行为</h3>
            <p className="small muted">只影响用户主动开始翻译后的行为。</p>
          </div>
        </div>
        <div className="setting-list">
          <label className="setting-row">
            <span>
              <strong>自动翻译新增内容</strong>
              <span className="field-hint">
                页面翻译进行中时，用 MutationObserver 发现新增文本并自动加入队列。不会在未开始翻译时上传页面。
              </span>
            </span>
            <input
              type="checkbox"
              checked={autoTranslate}
              onChange={(event) => setAutoTranslate(event.target.checked)}
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>划词翻译入口</strong>
              <span className="field-hint">
                选中文本后显示小按钮，点击才发送选中文本。可在设置中关闭。
              </span>
            </span>
            <input
              type="checkbox"
              checked={selectionEnabled}
              onChange={(event) => setSelectionEnabled(event.target.checked)}
            />
          </label>
        </div>
      </section>

      <section className="sub-card">
        <div className="sub-card-head">
          <div>
            <h3>本地翻译缓存</h3>
            <p className="small muted">
              按模型指纹、语言、风格、提示词、上下文和术语表生成键；不包含 API 密钥。
            </p>
          </div>
          <span className="chip">
            {cacheStats ? `${cacheStats.entries} / ${cacheStats.maxEntries}` : '未读取'}
          </span>
        </div>
        <div className="cache-stats">
          <div>
            <span className="stat-big">{cacheStats?.entries ?? 0}</span>
            <span className="stat-caption">缓存条目</span>
          </div>
          <div>
            <span className="stat-big">{formatBytes(cacheStats?.approxBytes ?? 0)}</span>
            <span className="stat-caption">约占空间</span>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="cache-max">
              最大条目数（0 表示不缓存）
            </label>
            <input
              id="cache-max"
              className="input"
              type="number"
              min="0"
              max="5000"
              value={cacheMaxEntries}
              onChange={(event) => setCacheMaxEntries(event.target.value)}
            />
          </div>
        </div>
        <div className="row">
          <button type="button" className="btn" disabled={clearing} onClick={() => void clearCache()}>
            {clearing ? <span className="spinner" /> : null}
            清空翻译缓存
          </button>
          <span className="tiny faint">缓存内容为原文与译文片段，保存在本地。</span>
        </div>
      </section>

      <section className="sub-card">
        <div className="sub-card-head">
          <div>
            <h3>快捷键</h3>
            <p className="small muted">
              可在 <code>chrome://extensions/shortcuts</code> 中修改；页面按钮与弹出窗口同样可用。
            </p>
          </div>
        </div>
        <div className="shortcut-list">
          <div><kbd className="kbd">Alt+A</kbd><span>翻译 / 暂停当前页面</span></div>
          <div><kbd className="kbd">Alt+Shift+A</kbd><span>恢复当前页面原文</span></div>
          <div><kbd className="kbd">Alt+S</kbd><span>打开视频字幕面板</span></div>
        </div>
      </section>

      <section className="sub-card danger-zone">
        <div className="sub-card-head">
          <div>
            <h3>数据与密钥</h3>
            <p className="small muted">
              模型配置、API 密钥、偏好和缓存都保存在 <code>chrome.storage.local</code>。本地存储并不等同于加密保险箱。
            </p>
          </div>
        </div>
        <div className="notice" data-tone="warning">
          扩展仅向你在模型配置中填写的 Base URL 发送请求。网页脚本无法读取扩展存储，API 密钥也不会下发到内容脚本。删除浏览器配置或卸载扩展会移除本地数据。
        </div>
        <button type="button" className="btn btn-danger" disabled={clearing} onClick={() => void clearAllData()}>
          清空全部扩展数据
        </button>
      </section>

      <section className="sub-card">
        <div className="sub-card-head">
          <div>
            <h3>已知限制</h3>
          </div>
          <span className="chip">v{version || '0.1.0'}</span>
        </div>
        <ul className="limit-list">
          <li>翻译依赖 OpenAI Chat Completions 兼容接口；不同服务商对字段、模型列表、流式输出支持不同，扩展不假设完全一致。</li>
          <li>网页翻译只处理可见文本节点，跳过脚本、样式、代码、输入框和可编辑区域；Canvas、图片与视频内硬字幕无法翻译。</li>
          <li>原生视频字幕取决于网站是否暴露 TextTrack 及跨域策略；DRM 内容不会被绕过。</li>
          <li>语音识别为实验功能，使用音频分块上传，时间轴近似，可能受跨域静音与播放器实现影响。</li>
          <li>扩展没有内置密钥，首次使用必须自行配置并测试模型连接。</li>
        </ul>
      </section>
    </div>
  );
}