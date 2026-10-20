import type { CSSProperties } from 'react';
import type { SelectionTriggerView, SelectionView, UiActions } from './store';

interface Props {
  trigger: SelectionTriggerView | null;
  selection: SelectionView | null;
  actions: UiActions;
}

function popoverPosition(selection: SelectionView): CSSProperties {
  const width = Math.min(350, window.innerWidth - 24);
  const left = Math.max(12, Math.min(selection.rect.left, window.innerWidth - width - 12));
  const estimatedHeight = 250;
  const below = selection.rect.top + selection.rect.height + 10;
  const top =
    below + estimatedHeight > window.innerHeight
      ? Math.max(12, selection.rect.top - estimatedHeight - 8)
      : below;
  return { left, top, width };
}

export function SelectionPopover({ trigger, selection, actions }: Props) {
  return (
    <>
      {trigger && !selection && (
        <button
          type="button"
          className="pgp-trigger"
          style={{ left: trigger.left, top: trigger.top }}
          title="翻译选中文本"
          onClick={() => actions.translateSelection()}
        >
          译
        </button>
      )}
      {selection && (
        <div className="pgp-selection" style={popoverPosition(selection)}>
          <div className="pgp-selection-head">
            <div>
              <div className="pgp-title">划词翻译</div>
              <div className="pgp-selection-source">
                {selection.sourceLanguage} → {selection.targetLanguage}
              </div>
            </div>
            <button
              type="button"
              className="pgp-icon-button"
              title="关闭"
              onClick={() => actions.closeSelection()}
            >
              ×
            </button>
          </div>
          <div className="pgp-selection-original">{selection.source}</div>
          {selection.status === 'loading' && (
            <div className="pgp-selection-translation pgp-muted">
              <span className="pgp-spinner" /> 正在请求模型…
            </div>
          )}
          {selection.status === 'done' && (
            <div className="pgp-selection-translation">{selection.translation}</div>
          )}
          {selection.status === 'error' && (
            <div className="pgp-error" style={{ marginTop: 8 }}>
              {selection.error || '翻译失败，请重试。'}
            </div>
          )}
          <div className="pgp-selection-actions">
            {selection.status === 'error' && (
              <button type="button" className="pgp-btn" onClick={() => actions.retrySelection()}>
                重试
              </button>
            )}
            <button
              type="button"
              className="pgp-btn"
              disabled={!selection.translation}
              onClick={() => selection.translation && actions.copyText(selection.translation)}
            >
              复制译文
            </button>
          </div>
        </div>
      )}
    </>
  );
}