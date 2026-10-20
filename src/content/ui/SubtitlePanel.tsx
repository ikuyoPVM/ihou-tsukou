import { useEffect, useRef, useState } from 'react';
import type { SubtitleSourceKind } from '../../shared/types';
import type { UiActions, UiState } from './store';

interface Props {
  state: UiState;
  actions: UiActions;
}

const SOURCE_LABELS: Record<SubtitleSourceKind, string> = {
  native: '原生字幕轨道',
  file: '导入的字幕文件',
  asr: '语音识别（实验）',
};

export function SubtitlePanel({ state, actions }: Props) {
  const subtitle = state.subtitleState;
  const fileInput = useRef<HTMLInputElement>(null);
  const [trackIndex, setTrackIndex] = useState<number | null>(
    subtitle?.selectedTrackIndex ?? subtitle?.tracks[0]?.index ?? null,
  );

  useEffect(() => {
    if (!subtitle) return;
    if (subtitle.selectedTrackIndex !== null) {
      setTrackIndex(subtitle.selectedTrackIndex);
      return;
    }
    setTrackIndex((current) => {
      if (current !== null && subtitle.tracks.some((track) => track.index === current)) return current;
      return subtitle.tracks[0]?.index ?? null;
    });
  }, [subtitle?.selectedTrackIndex, subtitle?.tracks]);

  const chatModels = state.models.filter((model) => model.enabled && model.protocol === 'openai-chat');
  const hasSource = Boolean(subtitle?.source);
  const cueCount = subtitle?.cueCount ?? 0;
  const statusMessage = subtitle?.error?.message || subtitle?.message;
  const mode = subtitle?.mode ?? 'bilingual';
  const style = subtitle?.style;

  return (
    <section className="pgp-panel" aria-label="Polyglot AI 视频字幕控制面板">
      <header className="pgp-panel-header">
        <div className="pgp-brand">
          <div className="pgp-mark">译</div>
          <div>
            <div className="pgp-title">视频字幕</div>
            <div className="pgp-subtitle">Polyglot AI · 原生字幕 / SRT / VTT</div>
          </div>
        </div>
        <button
          type="button"
          className="pgp-icon-button"
          title="关闭字幕面板"
          onClick={() => actions.openPanel(false)}
        >
          ×
        </button>
      </header>

      {!subtitle || subtitle.videoCount === 0 ? (
        <div className="pgp-empty">
          当前页面未检测到可处理视频。请开始播放视频，或滚动页面后点击下方“重新检测”。
          <div style={{ marginTop: 8 }}>
            <button type="button" className="pgp-btn" onClick={() => actions.refreshVideos()}>
              重新检测视频
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="pgp-row pgp-between" style={{ marginBottom: 10 }}>
            <label className="pgp-switch">
              <input
                type="checkbox"
                checked={subtitle.enabled}
                onChange={(event) => actions.toggleSubtitles(event.target.checked)}
              />
              显示字幕
            </label>
            <div className="pgp-row" style={{ gap: 5 }}>
              <span className="pgp-chip">
                <strong>{subtitle.videoCount}</strong> 个视频
              </span>
              {subtitle.asrRunning && <span className="pgp-chip">识别中</span>}
            </div>
          </div>

          <div className="pgp-section" style={{ marginTop: 0 }}>
            <div className="pgp-section-title">视频与字幕源</div>
            <div className="pgp-stack">
              <div className="pgp-field">
                <label className="pgp-label" htmlFor="pgp-video-select">
                  当前视频
                </label>
                <select
                  id="pgp-video-select"
                  className="pgp-select"
                  value={subtitle.selectedVideoId ?? ''}
                  onChange={(event) => actions.selectVideo(event.target.value)}
                >
                  {subtitle.videos.map((video, index) => (
                    <option key={video.id} value={video.id}>
                      {video.label} · {video.width}×{video.height}
                      {video.trackCount ? ` · ${video.trackCount} 条轨道` : ' · 无原生字幕'}
                      {index === 0 ? '（首个）' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {subtitle.tracks.length > 0 ? (
                <div className="pgp-field">
                  <label className="pgp-label" htmlFor="pgp-track-select">
                    原生字幕轨道
                  </label>
                  <div className="pgp-row">
                    <select
                      id="pgp-track-select"
                      className="pgp-select pgp-grow"
                      value={trackIndex ?? ''}
                      onChange={(event) => setTrackIndex(Number(event.target.value))}
                    >
                      {subtitle.tracks.map((track) => (
                        <option key={track.index} value={track.index}>
                          {track.label}
                          {track.language ? ` · ${track.language}` : ''}
                          {track.cueCount ? ` · ${track.cueCount} 条` : ''}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="pgp-btn"
                      disabled={state.busy || trackIndex === null}
                      onClick={() => trackIndex !== null && actions.loadTrack(trackIndex)}
                    >
                      读取
                    </button>
                  </div>
                </div>
              ) : (
                <div className="pgp-small pgp-muted">
                  未检测到原生字幕轨道。可导入本地 SRT / VTT，或在下方尝试实验性语音识别。
                </div>
              )}

              <div className="pgp-row">
                <button
                  type="button"
                  className="pgp-btn pgp-grow"
                  disabled={state.busy || subtitle.asrRunning}
                  onClick={() => fileInput.current?.click()}
                >
                  导入 SRT / VTT
                </button>
                <button
                  type="button"
                  className="pgp-btn"
                  disabled={state.busy}
                  onClick={() => actions.refreshVideos()}
                >
                  重新检测
                </button>
                <input
                  ref={fileInput}
                  className="pgp-file-input"
                  type="file"
                  accept=".srt,.vtt,text/vtt,application/x-subrip"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) actions.importFile(file);
                    event.target.value = '';
                  }}
                />
              </div>

              {hasSource && subtitle && (
                <div className="pgp-success">
                  来源：{subtitle.source ? SOURCE_LABELS[subtitle.source] : '—'} · 共 {cueCount} 条 ·
                  已翻译 {subtitle.translatedCount} · 失败 {subtitle.failedCount}
                </div>
              )}
              {statusMessage && (
                <div className={subtitle?.error ? 'pgp-error' : 'pgp-small pgp-muted'}>
                  {statusMessage}
                </div>
              )}
            </div>
          </div>

          <div className="pgp-section">
            <div className="pgp-section-title">字幕翻译</div>
            <div className="pgp-stack">
              <div className="pgp-field">
                <label className="pgp-label" htmlFor="pgp-subtitle-model">
                  字幕翻译模型
                </label>
                <select
                  id="pgp-subtitle-model"
                  className="pgp-select"
                  value={state.selectedModelId}
                  onChange={(event) => actions.setSelectedModel(event.target.value)}
                >
                  <option value="">跟随设置（字幕任务模型）</option>
                  {chatModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} · {model.modelId}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pgp-row">
                {subtitle.translating && !subtitle.asrRunning ? (
                  <button
                    type="button"
                    className="pgp-btn pgp-btn-danger pgp-grow"
                    onClick={() => actions.stopSubtitles()}
                  >
                    停止翻译
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pgp-btn pgp-btn-primary pgp-grow"
                    disabled={!hasSource || cueCount === 0 || subtitle.asrRunning}
                    onClick={() => actions.translateSubtitles()}
                  >
                    {subtitle.translating ? <span className="pgp-spinner" /> : null}
                    翻译字幕
                  </button>
                )}
                {subtitle.failedCount > 0 && !subtitle.translating && (
                  <button
                    type="button"
                    className="pgp-btn"
                    onClick={() => actions.retryFailedSubtitles()}
                  >
                    重试失败
                  </button>
                )}
              </div>
              <div className="pgp-small pgp-muted">
                按字幕块批量请求；失败时保留原文。译文只显示为纯文本，不执行任何 HTML。
              </div>
            </div>
          </div>

          <div className="pgp-section">
            <div className="pgp-section-title">字幕显示</div>
            <div className="pgp-stack">
              <div className="pgp-segmented" role="group" aria-label="字幕显示模式">
                {[
                  { value: 'translated', label: '仅译文' },
                  { value: 'bilingual', label: '双语' },
                  { value: 'original', label: '仅原文' },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    className="pgp-segment"
                    data-active={mode === item.value}
                    onClick={() => actions.setSubtitleMode(item.value as typeof mode)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {style && (
                <>
                  <div className="pgp-range-row">
                    <span>字号</span>
                    <input
                      className="pgp-range"
                      type="range"
                      min="12"
                      max="48"
                      step="1"
                      value={style.fontSize}
                      onChange={(event) => actions.updateSubtitleStyle({ fontSize: Number(event.target.value) })}
                    />
                    <span>{style.fontSize}px</span>
                  </div>
                  <div className="pgp-range-row">
                    <span>行距</span>
                    <input
                      className="pgp-range"
                      type="range"
                      min="1"
                      max="2.2"
                      step="0.05"
                      value={style.lineHeight}
                      onChange={(event) => actions.updateSubtitleStyle({ lineHeight: Number(event.target.value) })}
                    />
                    <span>{style.lineHeight.toFixed(2)}</span>
                  </div>
                  <div className="pgp-range-row">
                    <span>背景</span>
                    <input
                      className="pgp-range"
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={style.backgroundOpacity}
                      onChange={(event) =>
                        actions.updateSubtitleStyle({ backgroundOpacity: Number(event.target.value) })
                      }
                    />
                    <span>{Math.round(style.backgroundOpacity * 100)}%</span>
                  </div>
                  <div className="pgp-range-row">
                    <span>位置</span>
                    <input
                      className="pgp-range"
                      type="range"
                      min="0"
                      max="35"
                      step="1"
                      value={style.bottomOffset}
                      onChange={(event) =>
                        actions.updateSubtitleStyle({ bottomOffset: Number(event.target.value) })
                      }
                    />
                    <span>{style.bottomOffset}%</span>
                  </div>
                  <div className="pgp-range-row">
                    <span>颜色</span>
                    <input
                      type="color"
                      value={style.color}
                      aria-label="字幕颜色"
                      onChange={(event) => actions.updateSubtitleStyle({ color: event.target.value })}
                      style={{ width: '100%', height: 28, border: 'none', background: 'transparent' }}
                    />
                    <span className="pgp-small">{style.color}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="pgp-section">
            <div className="pgp-section-title">语音识别（实验）</div>
            <div className="pgp-stack">
              <div className="pgp-small pgp-muted">{subtitle.asrNote}</div>
              <div className="pgp-row">
                {subtitle.asrRunning ? (
                  <button
                    type="button"
                    className="pgp-btn pgp-btn-danger pgp-grow"
                    onClick={() => actions.stopAsr()}
                  >
                    停止语音识别
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pgp-btn pgp-grow"
                    disabled={!subtitle.canUseAsr || state.busy}
                    onClick={() => actions.startAsr()}
                  >
                    开始语音识别
                  </button>
                )}
              </div>
              <div className="pgp-small pgp-muted">
                不会绕过 DRM。跨域视频可能只有静音，开始后会明确提示；识别时间轴为近似值。
              </div>
            </div>
          </div>
        </>
      )}

      <div className="pgp-section">
        <div className="pgp-row pgp-between">
          <span className="pgp-small pgp-muted">字幕样式与模型保存在扩展本地</span>
          <button type="button" className="pgp-btn" onClick={() => actions.openOptions()}>
            扩展设置
          </button>
        </div>
      </div>
    </section>
  );
}