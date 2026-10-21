/**
 * Rules for parking the quick-translate widget against a viewport edge.
 *
 * The widget is "parked" when it hugs one of the four edges after snapping. A
 * parked widget that receives no interaction for {@link PANEL_IDLE_MS} shrinks
 * into its compact pill, and an open panel collapses back to that pill first.
 * The decision is kept pure so the timing rules stay testable without a DOM.
 */

/** How long a parked widget may sit untouched before it shrinks. */
export const PANEL_IDLE_MS = 3000;

/** Rounding slack for the edge comparison, in CSS pixels. */
export const EDGE_TOLERANCE_PX = 1.5;

export interface RectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ViewportLike {
  width: number;
  height: number;
}

export interface EdgeOptions {
  /** Distance from the viewport edge that counts as flush. */
  edgeMargin: number;
  tolerance?: number;
}

/** True when the rect touches any of the four viewport edges. */
export function isRectAtViewportEdge(
  rect: RectLike,
  viewport: ViewportLike,
  options: EdgeOptions,
): boolean {
  const { edgeMargin, tolerance = EDGE_TOLERANCE_PX } = options;
  return (
    rect.left <= edgeMargin + tolerance ||
    viewport.width - rect.right <= edgeMargin + tolerance ||
    rect.top <= edgeMargin + tolerance ||
    viewport.height - rect.bottom <= edgeMargin + tolerance
  );
}

export interface IdleCollapseInput {
  /** The widget has a measured position; before that there is nothing to park. */
  positioned: boolean;
  dragging: boolean;
  hovering: boolean;
  /** The full panel is open rather than the pill. */
  open: boolean;
  /** The pill is already in its shrunk form. */
  compact: boolean;
}

/**
 * Whether the idle countdown should run right now.
 *
 * Dragging and hovering both count as interaction, and a compact pill that is
 * already tucked away needs no further timer.
 */
export function shouldArmIdleCollapse(input: IdleCollapseInput): boolean {
  if (!input.positioned || input.dragging || input.hovering) return false;
  if (!input.open && input.compact) return false;
  return true;
}
