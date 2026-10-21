import type { PageState, PageTranslationMode } from '../../shared/types';
import type { UiActions } from './store';

const STATUS_LABELS: Record<PageState['status'], string> = {
  idle: '准备翻译',
  translating: '正在翻译',
  paused: '已暂停',
  done: '翻译完成',
  error: '翻译出错',
  restored: '已恢复原文',
};

interface Props {
  page: PageState | null;
  mode: PageTranslationMode;
  open: boolean;
  hasChatModel: boolean;
  actions: UiActions;
}

function progressOf(page: PageState | null): number {
  if (!page || page.total === 0) return 0;
  if (page.status === 'done') return 100;
  return Math.min(99, Math.round((page.completed / page.total) * 100));
}

export function QuickTranslateWidget({ page, mode, open, hasChatModel, actions }: Props) {
  const status = page?.status ?? 'idle';
  const active = page?.active ?? false;
  const progress = progressOf(page);
  const statusLabel = active || hasChatModel ? STATUS_LABELS[status] : '尚未配置模型';

  let primaryLabel: string;
  if (!active) {
    primaryLabel = hasChatModel ? '翻译本页' : '配置模型';
  } else if (status === 'translating') {
    primaryLabel = '暂停翻译';
  } else if (status === 'paused') {
    primaryLabel = '继续翻译';
  } else {
    primaryLabel = hasChatModel ? '重新翻译' : '配置模型';
  }

  function handlePrimary(): void {
    if (active) {
      if (status === 'translating') {
        actions.pauseQuickTranslation();
        return;
      }
      if (status === 'paused') {
        actions.resumeQuickTranslation();
        return;
      }
    }
    if (!hasChatModel) {
      actions.openOptions();
      return;
    }
    if (!active) {
      actions.startQuickTranslation();
      return;
    }
    actions.retranslateQuickTranslation();
  }

  if (!open) {
    return (
      <button
        type="button"
        className="pgp-quick-fab"
        onClick={() => actions.openQuick(true)}
        aria-haspopup="dialog"
        aria-expanded={false}
        title="打开意方通行快速翻译"
        data-quick-open="true"
      >
        <span className="pgp-quick-fab-mark">译</span>
        <span>快速翻译</span>
      </button>
    );
  }

  return (
    <section className="pgp-quick-panel" role="dialog" aria-label="快速翻译" aria-modal="false">
      <div className="pgp-panel-header pgp-quick-header">
        <div className="pgp-brand">
          <span className="pgp-mark">译</span>
          <div>
            <div className="pgp-title">快速翻译</div>
            <div className="pgp-subtitle">当前网页 · 默认译文替换</div>
          </div>
        </div>
        <button
          type="button"
          className="pgp-icon-button"
          onClick={() => actions.openQuick(false)}
          aria-label="收起快速翻译"
          title="收起"
        >
          ×
        </button>
      </div>

      <div className="pgp-quick-status" aria-live="polite">
        <div className="pgp-row pgp-between">
          <span className="pgp-small pgp-muted">{statusLabel}</span>
          <span className="pgp-small pgp-muted">
            {page && page.total > 0 ? `${page.completed} / ${page.total}` : '—'}
          </span>
        </div>
        <div
          className="pgp-quick-progress"
          role="progressbar"
          aria-label="网页翻译进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        {page?.modelName && <div className="pgp-quick-model">模型：{page.modelName}</div>}
      </div>

      <div className="pgp-segmented pgp-quick-modes" role="group" aria-label="翻译显示方式">
        <button
          type="button"
          className="pgp-segment"
          data-active={mode === 'replace'}
          aria-pressed={mode === 'replace'}
          onClick={() => actions.setQuickMode('replace')}
          data-quick-mode="replace"
        >
          译文替换
        </button>
        <button
          type="button"
          className="pgp-segment"
          data-active={mode === 'bilingual'}
          aria-pressed={mode === 'bilingual'}
          onClick={() => actions.setQuickMode('bilingual')}
          data-quick-mode="bilingual"
        >
          双语对照
        </button>
      </div>

      <button
        type="button"
        className="pgp-btn pgp-btn-primary pgp-btn-block pgp-quick-primary"
        onClick={handlePrimary}
        data-quick-primary="true"
      >
        {primaryLabel}
      </button>

      <div className="pgp-row pgp-quick-secondary">
        <button
          type="button"
          className="pgp-btn pgp-grow"
          onClick={() => actions.restoreQuickTranslation()}
          disabled={!active}
          data-quick-restore="true"
        >
          恢复原文
        </button>
        <button type="button" className="pgp-btn" onClick={() => actions.openOptions()}>
          设置
        </button>
      </div>

      {active && (page?.failed ?? 0) > 0 && (
        <button
          type="button"
          className="pgp-btn pgp-btn-block"
          onClick={() => actions.retryFailedQuickTranslation()}
        >
          重试失败片段（{page?.failed}）
        </button>
      )}

      {page?.error && (
        <div className="pgp-error" role="alert">
          {page.error.message}
        </div>
      )}
      {!page?.error && page?.message && <div className="pgp-success">{page.message}</div>}

      <div className="pgp-quick-tip">
        选中文字可划词翻译；快捷键 Alt+A 翻译，Alt+Shift+A 恢复原文。
      </div>
    </section>
  );
}