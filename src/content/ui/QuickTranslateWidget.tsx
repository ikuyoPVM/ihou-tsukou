import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { PageState, PageTranslationMode } from '../../shared/types';
import { PANEL_IDLE_MS, isRectAtViewportEdge, shouldArmIdleCollapse } from './panel-idle';
import type { UiActions } from './store';

const STATUS_LABELS: Record<PageState['status'], string> = {
  idle: '准备翻译',
  translating: '正在翻译',
  paused: '已暂停',
  done: '翻译完成',
  error: '翻译出错',
  restored: '已恢复原文',
};

const EDGE_MARGIN = 12;
const SNAP_DISTANCE = 48;
const FALLBACK_PANEL_SIZE = { width: 330, height: 310 };

interface Props {
  page: PageState | null;
  mode: PageTranslationMode;
  open: boolean;
  hasChatModel: boolean;
  actions: UiActions;
}

interface Position {
  left: number;
  top: number;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type DockSide = 'left' | 'right';

interface FabDock {
  side: DockSide;
  top: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  width: number;
  height: number;
  moved: boolean;
}

function viewportWidth(): number {
  return document.documentElement.clientWidth || window.innerWidth;
}

function viewportHeight(): number {
  return document.documentElement.clientHeight || window.innerHeight;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function snapAxis(value: number, min: number, max: number): number {
  if (value <= min + SNAP_DISTANCE) return min;
  if (value >= max - SNAP_DISTANCE) return max;
  return value;
}

function snapPanelPosition(left: number, top: number, width: number, height: number): Position {
  const maxLeft = Math.max(EDGE_MARGIN, viewportWidth() - width - EDGE_MARGIN);
  const maxTop = Math.max(EDGE_MARGIN, viewportHeight() - height - EDGE_MARGIN);
  return {
    left: snapAxis(clamp(left, EDGE_MARGIN, maxLeft), EDGE_MARGIN, maxLeft),
    top: snapAxis(clamp(top, EDGE_MARGIN, maxTop), EDGE_MARGIN, maxTop),
  };
}

function dockTop(top: number, height: number): number {
  const maxTop = Math.max(EDGE_MARGIN, viewportHeight() - height - EDGE_MARGIN);
  return snapAxis(clamp(top, EDGE_MARGIN, maxTop), EDGE_MARGIN, maxTop);
}

function dockSide(rect: Rect): DockSide {
  return rect.left + rect.width / 2 < viewportWidth() / 2 ? 'left' : 'right';
}

/** The pill keeps the panel's side edge and centers on the panel's old middle. */
function collapsedDock(rect: Rect, fabHeight: number): FabDock {
  return {
    side: dockSide(rect),
    top: dockTop(rect.top + rect.height / 2 - fabHeight / 2, fabHeight),
  };
}

/** The panel grows inward from the pill's side edge, centered on the pill. */
function expandedPosition(rect: Rect, panelSize: { width: number; height: number }): Position {
  const side = dockSide(rect);
  const maxLeft = Math.max(EDGE_MARGIN, viewportWidth() - panelSize.width - EDGE_MARGIN);
  const maxTop = Math.max(EDGE_MARGIN, viewportHeight() - panelSize.height - EDGE_MARGIN);
  return {
    left: side === 'left' ? EDGE_MARGIN : maxLeft,
    top: clamp(rect.top + rect.height / 2 - panelSize.height / 2, EDGE_MARGIN, maxTop),
  };
}

/** True when the widget hugs one of the four viewport edges after snapping. */
function isAtEdge(element: HTMLElement | null): boolean {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  return isRectAtViewportEdge(
    rect,
    { width: viewportWidth(), height: viewportHeight() },
    { edgeMargin: EDGE_MARGIN },
  );
}

function progressOf(page: PageState | null): number {
  if (!page || page.total === 0) return 0;
  if (page.status === 'done') return 100;
  return Math.min(99, Math.round((page.completed / page.total) * 100));
}

export function QuickTranslateWidget({ page, mode, open, hasChatModel, actions }: Props) {
  const [panelPosition, setPanelPosition] = useState<Position | null>(null);
  const [fabPosition, setFabPosition] = useState<Position | null>(null);
  const [fabDock, setFabDock] = useState<FabDock | null>(null);
  const [dragging, setDragging] = useState(false);
  const [compact, setCompact] = useState(false);
  const [hovering, setHovering] = useState(false);
  const elementRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const suppressClickRef = useRef(false);
  const panelRectRef = useRef<Rect | null>(null);
  const panelSizeRef = useRef({ ...FALLBACK_PANEL_SIZE });
  const fabHeightRef = useRef(42);
  const wasOpenRef = useRef(open);
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  const status = page?.status ?? 'idle';
  const active = page?.active ?? false;
  const progress = progressOf(page);
  const statusLabel = active || hasChatModel ? STATUS_LABELS[status] : '尚未配置模型';
  const positioned = Boolean(panelPosition || fabPosition || fabDock);
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

  const panelStyle = panelPosition
    ? {
        left: `${panelPosition.left}px`,
        top: `${panelPosition.top}px`,
        right: 'auto',
        bottom: 'auto',
      }
    : undefined;

  const fabStyle =
    dragging && fabPosition
      ? {
          left: `${fabPosition.left}px`,
          top: `${fabPosition.top}px`,
          right: 'auto',
          bottom: 'auto',
        }
      : fabDock
        ? {
            left: fabDock.side === 'left' ? `${EDGE_MARGIN}px` : 'auto',
            right: fabDock.side === 'right' ? `${EDGE_MARGIN}px` : 'auto',
            top: `${fabDock.top}px`,
            bottom: 'auto',
          }
        : undefined;

  function rememberPanelRect(rect: Rect): void {
    panelRectRef.current = rect;
    panelSizeRef.current = { width: rect.width, height: rect.height };
  }

  useLayoutEffect(() => {
    if (!open || !elementRef.current) return;
    const rect = elementRef.current.getBoundingClientRect();
    rememberPanelRect({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
  }, [open, panelPosition]);

  useLayoutEffect(() => {
    if (dragging || !elementRef.current) return;
    const rect = elementRef.current.getBoundingClientRect();
    if (open) {
      if (!panelPosition) return;
      const next = snapPanelPosition(rect.left, rect.top, rect.width, rect.height);
      if (Math.abs(next.left - panelPosition.left) > 0.5 || Math.abs(next.top - panelPosition.top) > 0.5) {
        setPanelPosition(next);
      }
    } else if (fabDock) {
      const top = dockTop(fabDock.top, rect.height);
      if (Math.abs(top - fabDock.top) > 0.5) setFabDock({ ...fabDock, top });
    }
  }, [dragging, fabDock, open, panelPosition]);

  useLayoutEffect(() => {
    if (wasOpenRef.current && !open) {
      const rect = panelRectRef.current;
      if (rect) {
        setFabDock(collapsedDock(rect, fabHeightRef.current));
        setFabPosition(null);
      }
      setHovering(false);
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (open && !panelPosition) return;
    if (!open && !fabDock) return;
    const currentDock = fabDock;
    const onResize = (): void => {
      const element = elementRef.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      if (open) {
        rememberPanelRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
        setPanelPosition(snapPanelPosition(rect.left, rect.top, rect.width, rect.height));
      } else if (currentDock) {
        setFabDock({ side: currentDock.side, top: dockTop(currentDock.top, rect.height) });
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fabDock, open, panelPosition]);

  // Parked against an edge and left alone: shrink into the compact pill after a short pause.
  useEffect(() => {
    if (
      !shouldArmIdleCollapse({
        positioned,
        dragging,
        hovering,
        open,
        compact,
      })
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      if (dragRef.current || hovering) return;
      if (!isAtEdge(elementRef.current)) return;
      setCompact(true);
      if (open) actionsRef.current.openQuick(false);
    }, PANEL_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [compact, dragging, hovering, open, positioned]);

  function startDrag(event: ReactPointerEvent<HTMLElement>): void {
    if (event.button !== 0 || !event.isPrimary || dragRef.current) return;
    const element = elementRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
    setDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can fail if the pointer was released between events.
    }
  }

  function moveDrag(event: ReactPointerEvent<HTMLElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (!drag.moved) return;
    const maxLeft = Math.max(EDGE_MARGIN, viewportWidth() - drag.width - EDGE_MARGIN);
    const maxTop = Math.max(EDGE_MARGIN, viewportHeight() - drag.height - EDGE_MARGIN);
    const next = {
      left: clamp(drag.startLeft + dx, EDGE_MARGIN, maxLeft),
      top: clamp(drag.startTop + dy, EDGE_MARGIN, maxTop),
    };
    if (open) setPanelPosition(next);
    else setFabPosition(next);
  }

  function finishDrag(event: ReactPointerEvent<HTMLElement>): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // The browser may already have released the pointer.
      }
    }
    if (drag.moved) {
      const element = elementRef.current;
      if (element) {
        const rect = element.getBoundingClientRect();
        if (open) {
          rememberPanelRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
          setPanelPosition(snapPanelPosition(rect.left, rect.top, rect.width, rect.height));
        } else {
          setFabDock({ side: dockSide(rect), top: dockTop(rect.top, rect.height) });
          setFabPosition(null);
        }
      }
      suppressClickRef.current = true;
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
    setDragging(false);
  }

  function handleHeaderPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    const target = event.target;
    if (target instanceof Element && target.closest('button, a, input, select, textarea')) return;
    startDrag(event);
  }

  function openFromFab(): void {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const element = elementRef.current;
    if (element) {
      const rect = element.getBoundingClientRect();
      // Keep the initial bottom-right CSS position untouched until the pill has
      // actually been parked. Once parked, the panel grows inward from that edge.
      setPanelPosition(
        fabDock || fabPosition
          ? expandedPosition(rect, panelSizeRef.current)
          : null,
      );
    }
    actions.openQuick(true);
  }

  function closePanel(): void {
    const element = elementRef.current;
    if (element) {
      const rect = element.getBoundingClientRect();
      rememberPanelRect({ left: rect.left, top: rect.top, width: rect.width, height: rect.height });
      setFabDock(collapsedDock(rect, fabHeightRef.current));
      setFabPosition(null);
    }
    actions.openQuick(false);
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

  function handlePointerEnter(): void {
    setHovering(true);
    setCompact(false);
  }

  function handlePointerLeave(): void {
    setHovering(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        ref={(node) => {
          elementRef.current = node;
          if (node) fabHeightRef.current = node.offsetHeight || fabHeightRef.current;
        }}
        className="pgp-quick-fab"
        style={fabStyle}
        data-dragging={dragging}
        data-compact={compact}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={(event) => {
          if (dragRef.current) finishDrag(event);
        }}
        onClick={openFromFab}
        aria-haspopup="dialog"
        aria-expanded={false}
        aria-label="快速翻译"
        title="快速翻译（可拖动，靠近边缘自动吸附，吸附后 3 秒自动收起）"
        data-quick-open="true"
      >
        <span className="pgp-quick-fab-mark">译</span>
        <span className="pgp-quick-fab-label">快速翻译</span>
      </button>
    );
  }

  return (
    <section
      ref={(node) => {
        elementRef.current = node;
      }}
      className="pgp-quick-panel"
      style={panelStyle}
      data-dragging={dragging}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      role="dialog"
      aria-label="快速翻译"
      aria-modal="false"
    >
      <div
        className="pgp-panel-header pgp-quick-header"
        data-dragging={dragging}
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={(event) => {
          if (dragRef.current) finishDrag(event);
        }}
        title="拖动移动悬浮窗，靠近边缘自动吸附"
      >
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
          onPointerDown={(event) => event.stopPropagation()}
          onClick={closePanel}
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
        拖动面板或悬浮按钮可移动，靠近边缘会自动吸附；吸附到边缘后停留 3 秒会自动缩小收起，鼠标移上去即可展开。选中文字可划词翻译；快捷键 Alt+A
        翻译，Alt+Shift+A 恢复原文。
      </div>
    </section>
  );
}