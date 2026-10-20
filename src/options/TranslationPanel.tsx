import { useEffect, useState } from 'react';
import {
  SOURCE_LANGUAGES,
  TARGET_LANGUAGES,
  TRANSLATION_STYLES,
} from '../shared/constants';
import type {
  GlossaryEntry,
  PublicSettings,
  Settings,
  TranslationStyle,
} from '../shared/types';
import { createId } from '../shared/utils';
import { messageOf, request } from './api';

interface Props {
  settings: Settings;
  onReload: () => Promise<void>;
  notify: (tone: 'success' | 'error' | 'info', message: string) => void;
  onError: (message: string | null) => void;
}

export function TranslationPanel({ settings, onReload, notify, onError }: Props) {
  const [source, setSource] = useState(settings.languages.source);
  const [target, setTarget] = useState(settings.languages.target);
  const [style, setStyle] = useState<TranslationStyle>(settings.translation.style);
  const [customPrompt, setCustomPrompt] = useState(settings.translation.customPrompt);
  const [context, setContext] = useState(settings.translation.context);
  const [glossary, setGlossary] = useState<GlossaryEntry[]>(settings.translation.glossary);
  const [useGlossary, setUseGlossary] = useState(settings.translation.useGlossary);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSource(settings.languages.source);
    setTarget(settings.languages.target);
    setStyle(settings.translation.style);
    setCustomPrompt(settings.translation.customPrompt);
    setContext(settings.translation.context);
    setGlossary(settings.translation.glossary);
    setUseGlossary(settings.translation.useGlossary);
  }, [settings]);

  function addTerm(): void {
    setGlossary((entries) => [
      ...entries,
      { id: createId('term'), source: '', target: '', caseSensitive: false },
    ]);
  }

  function updateTerm(id: string, patch: Partial<GlossaryEntry>): void {
    setGlossary((entries) =>
      entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    );
  }

  function removeTerm(id: string): void {
    setGlossary((entries) => entries.filter((entry) => entry.id !== id));
  }

  async function save(): Promise<void> {
    setSaving(true);
    onError(null);
    try {
      const cleaned = glossary
        .map((entry) => ({
          ...entry,
          source: entry.source.trim(),
          target: entry.target.trim(),
        }))
        .filter((entry) => entry.source && entry.target);
      const next = await request<PublicSettings>({
        type: 'settings.updatePrefs',
        patch: {
          languages: { source, target },
          translation: {
            style,
            customPrompt,
            context,
            glossary: cleaned,
            useGlossary,
          },
        },
      });
      await onReload();
      notify(
        'success',
        `翻译设置已保存${next.translation.glossaryCount ? `，${next.translation.glossaryCount} 条术语生效` : ''}。`,
      );
    } catch (error) {
      onError(messageOf(error));
    } finally {
      setSaving(false);
    }
  }

  const sameLanguage = source !== 'auto' && source === target;

  return (
    <div className="panel-stack">
      <header className="panel-head">
        <div>
          <div className="eyebrow">TRANSLATION</div>
          <h2>翻译设置</h2>
          <p className="muted">
            语言、风格、术语与上下文会随每次翻译请求发送给所选模型；不包含 API 密钥。
          </p>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? <span className="spinner" /> : null}
          保存翻译设置
        </button>
      </header>

      <section className="sub-card">
        <div className="sub-card-head">
          <div>
            <h3>语言</h3>
            <p className="small muted">“自动检测”会要求模型自行识别源语言。</p>
          </div>
        </div>
        <div className="two-grid">
          <div className="field">
            <label className="field-label" htmlFor="translation-source">
              源语言
            </label>
            <select
              id="translation-source"
              className="select"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              {SOURCE_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="translation-target">
              目标语言
            </label>
            <select
              id="translation-target"
              className="select"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              {TARGET_LANGUAGES.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {sameLanguage && (
          <div className="notice" data-tone="warning">
            源语言与目标语言相同。扩展仍会请求模型，但通常没有翻译意义。
          </div>
        )}
      </section>

      <section className="sub-card">
        <div className="sub-card-head">
          <div>
            <h3>翻译风格</h3>
            <p className="small muted">影响提示词，不会改变模型或接口参数。</p>
          </div>
        </div>
        <div className="style-grid">
          {TRANSLATION_STYLES.map((item) => (
            <button
              key={item.value}
              type="button"
              className="style-card"
              data-active={style === item.value}
              onClick={() => setStyle(item.value)}
            >
              <span className="style-label">{item.label}</span>
              <span className="style-hint">{item.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="sub-card">
        <div className="sub-card-head">
          <div>
            <h3>自定义提示与上下文</h3>
            <p className="small muted">
              自定义提示会追加到系统提示词；上下文只作为背景信息，不应包含机密。
            </p>
          </div>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="custom-prompt">
            自定义翻译要求（最多 4000 字）
          </label>
          <textarea
            id="custom-prompt"
            className="textarea"
            rows={4}
            value={customPrompt}
            maxLength={4000}
            onChange={(event) => setCustomPrompt(event.target.value)}
            placeholder="例如：保留产品名不翻译；面向开发者，术语保持一致；不要添加解释。"
          />
          <span className="field-hint">{customPrompt.length} / 4000</span>
        </div>
        <div className="field">
          <label className="field-label" htmlFor="translation-context">
            页面/领域上下文（最多 3000 字）
          </label>
          <textarea
            id="translation-context"
            className="textarea"
            rows={3}
            value={context}
            maxLength={3000}
            onChange={(event) => setContext(event.target.value)}
            placeholder="例如：这是一份医疗器械法规文档，目标读者为临床工程师。"
          />
          <span className="field-hint">{context.length} / 3000</span>
        </div>
      </section>

      <section className="sub-card">
        <div className="sub-card-head">
          <div>
            <h3>术语表</h3>
            <p className="small muted">
              术语会以占位符保护后发送，要求模型按指定译法输出；不会修改页面原有链接或邮箱。
            </p>
          </div>
          <div className="row">
            <label className="switch">
              <input
                type="checkbox"
                checked={useGlossary}
                onChange={(event) => setUseGlossary(event.target.checked)}
              />
              启用术语表
            </label>
            <button type="button" className="btn btn-sm" onClick={addTerm}>
              + 新增术语
            </button>
          </div>
        </div>

        {glossary.length === 0 ? (
          <div className="empty-state compact">
            <p className="muted">尚未添加术语。术语表为空时不会发送术语提示。</p>
          </div>
        ) : (
          <div className="glossary-list">
            <div className="glossary-head">
              <span>原文</span>
              <span>指定译法</span>
              <span>区分大小写</span>
              <span />
            </div>
            {glossary.map((entry) => (
              <div className="glossary-row" key={entry.id}>
                <input
                  className="input"
                  value={entry.source}
                  maxLength={200}
                  onChange={(event) => updateTerm(entry.id, { source: event.target.value })}
                  placeholder="原文术语"
                />
                <input
                  className="input"
                  value={entry.target}
                  maxLength={200}
                  onChange={(event) => updateTerm(entry.id, { target: event.target.value })}
                  placeholder="目标译法"
                />
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={entry.caseSensitive}
                    onChange={(event) =>
                      updateTerm(entry.id, { caseSensitive: event.target.checked })
                    }
                  />
                  区分
                </label>
                <button
                  type="button"
                  className="icon-btn"
                  title="删除术语"
                  onClick={() => removeTerm(entry.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="tiny faint">
          最多保存 200 条术语。空白的原文或译法会在保存时被丢弃。
        </div>
      </section>

      <div className="panel-footer">
        <span className="small muted">当前风格：{TRANSLATION_STYLES.find((item) => item.value === style)?.label}</span>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? <span className="spinner" /> : null}
          保存翻译设置
        </button>
      </div>
    </div>
  );
}