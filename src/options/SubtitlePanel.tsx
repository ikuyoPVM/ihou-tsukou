import { useEffect, useState } from 'react';
import type {
  PublicSettings,
  Settings,
  SubtitleDisplayMode,
  SubtitleStylePrefs,
} from '../shared/types';
import { messageOf, request } from './api';

interface Props {
  settings: Settings;
  onReload: () => Promise<void>;
  notify: (tone: 'success' | 'error' | 'info', message: string) => void;
  onError: (message: string | null) => void;
}

export function SubtitlePanel({ settings, onReload, notify, onError }: Props) {
  const [enabled, setEnabled] = useState(settings.subtitle.enabled);
  const [style, setStyle] = useState<SubtitleStylePrefs>(settings.subtitle.style);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEnabled(settings.subtitle.enabled);
    setStyle(settings.subtitle.style);
  }, [settings]);

  function patchStyle(patch: Partial<SubtitleStylePrefs>): void {
    setStyle((current) => ({ ...current, ...patch }));
  }

  async function save(): Promise<void> {
    setSaving(true);
    onError(null);
    try {
      await request<PublicSettings>({
        type: 'settings.updatePrefs',
        patch: {
          subtitle: {
            enabled,
            style,
          },
        },
      });
      await onReload();
      notify('success', '字幕设置已保存。已打开的视频页会继续使用当前会话设置，刷新后完全应用。');
    } catch (error) {
      onError(messageOf(error));
    } finally {
      setSaving(false);
    }
  }

  const previewStyle = {
    fontSize: `${Math.min(style.fontSize, 32)}px`,
    lineHeight: style.lineHeight,
    color: style.color,
    background: `rgba(0, 0, 0, ${style.backgroundOpacity})`,
    maxWidth: `${style.maxWidth}%`,
  };

  return (
    <div className="panel-stack">
      <header className="panel-head">
        <div>
          <div className="eyebrow">SUBTITLES</div>
          <h2>视频字幕</h2>
          <p className="muted">
            原生 TextTrack 优先，其次本地 SRT/VTT 导入，最后才是实验性语音识别。扩展不会绕过 DRM。
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? <span className="spinner" /> : null}
          保存字幕设置
        </button>
      </header>

      <section className="sub-card">
        <div className="sub-card-head">
          <div>
            <h3>默认行为</h3>
            <p className="small muted">新打开的页面是否默认处理视频字幕。</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            默认启用字幕
          </label>
        </div>
        <div className="notice">
          视频内会显示一个“CC 字幕”浮动按钮；点击后打开字幕面板。写入字幕不会修改视频文件或原始字幕轨道。
        </div>
      </section>

      <section className="sub-card">
        <div className="sub-card-head">
          <div>
            <h3>显示模式与样式</h3>
            <p className="small muted">样式仅作用于扩展渲染的叠加字幕，不修改网页 CSS。</p>
          </div>
        </div>

        <div className="subtitle-preview" aria-label="字幕样式预览">
          <div className="preview-video">
            <span className="preview-badge">字幕预览</span>
            <div className="preview-caption" style={previewStyle}>
              <div>This is a translated subtitle line.</div>
              <div style={{ fontWeight: 600 }}>这是一行翻译后的字幕示例。</div>
            </div>
          </div>
        </div>

        <div className="segmented" role="group" aria-label="字幕显示模式">
          {[
            { value: 'translated', label: '仅译文' },
            { value: 'bilingual', label: '双语' },
            { value: 'original', label: '仅原文' },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              className="segment"
              data-active={style.mode === item.value}
              onClick={() => patchStyle({ mode: item.value as SubtitleDisplayMode })}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="range-grid">
          <label className="range-field">
            <span>字号</span>
            <input
              type="range"
              min="12"
              max="56"
              step="1"
              value={style.fontSize}
              onChange={(event) => patchStyle({ fontSize: Number(event.target.value) })}
            />
            <strong>{style.fontSize}px</strong>
          </label>
          <label className="range-field">
            <span>行距</span>
            <input
              type="range"
              min="1"
              max="2.4"
              step="0.05"
              value={style.lineHeight}
              onChange={(event) => patchStyle({ lineHeight: Number(event.target.value) })}
            />
            <strong>{style.lineHeight.toFixed(2)}</strong>
          </label>
          <label className="range-field">
            <span>背景不透明度</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={style.backgroundOpacity}
              onChange={(event) => patchStyle({ backgroundOpacity: Number(event.target.value) })}
            />
            <strong>{Math.round(style.backgroundOpacity * 100)}%</strong>
          </label>
          <label className="range-field">
            <span>距视频底部</span>
            <input
              type="range"
              min="0"
              max="40"
              step="1"
              value={style.bottomOffset}
              onChange={(event) => patchStyle({ bottomOffset: Number(event.target.value) })}
            />
            <strong>{style.bottomOffset}%</strong>
          </label>
          <label className="range-field">
            <span>最大宽度</span>
            <input
              type="range"
              min="40"
              max="100"
              step="1"
              value={style.maxWidth}
              onChange={(event) => patchStyle({ maxWidth: Number(event.target.value) })}
            />
            <strong>{style.maxWidth}%</strong>
          </label>
          <label className="range-field">
            <span>文字颜色</span>
            <input
              type="color"
              value={style.color}
              onChange={(event) => patchStyle({ color: event.target.value })}
            />
            <strong className="mono">{style.color}</strong>
          </label>
        </div>
      </section>

      <section className="sub-card">
        <div className="sub-card-head">
          <div>
            <h3>字幕翻译与语音识别</h3>
            <p className="small muted">任务模型在“模型与 API”中分配。</p>
          </div>
        </div>
        <div className="notice">
          <strong>处理顺序：</strong>网站原生字幕轨道 → 用户导入 SRT/VTT → 实验性音频识别。
          原生字幕受网站实现与跨域限制影响；部分播放器不会暴露字幕轨道。
        </div>
        <div className="notice" data-tone="warning">
          <strong>语音识别限制：</strong>通过 Web Audio 捕获当前标签页播放的音频，按约 8 秒分块发送到所选的
          Audio Transcription 模型。时间轴为近似值；DRM 视频无法读取；跨域媒体可能只捕获到静音。需要独立
          Audio 模型，且会产生额外 API 费用。该功能仅在用户点击“开始语音识别”后才上传音频。
        </div>
        <div className="notice">
          <strong>隐私：</strong>导入的字幕文件只在本地解析；只有字幕文本会发送给所选 Chat 模型。译文始终以纯文本渲染，不执行模型返回的
          HTML 或脚本。
        </div>
      </section>

      <div className="panel-footer">
        <span className="small muted">字幕样式保存在本地；每个视频页可在面板中临时调整。</span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? <span className="spinner" /> : null}
          保存字幕设置
        </button>
      </div>
    </div>
  );
}