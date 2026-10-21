import { describe, expect, it } from 'vitest';
import {
  PANEL_IDLE_MS,
  isRectAtViewportEdge,
  shouldArmIdleCollapse,
} from '../src/content/ui/panel-idle';

const VIEWPORT = { width: 1280, height: 800 };
const OPTIONS = { edgeMargin: 12 };

function rect(left: number, top: number, width = 300, height = 200) {
  return { left, top, right: left + width, bottom: top + height };
}

describe('edge parking detection', () => {
  it('waits three seconds before shrinking', () => {
    expect(PANEL_IDLE_MS).toBe(3000);
  });

  it('recognises a widget flush against the left edge', () => {
    expect(isRectAtViewportEdge(rect(12, 300), VIEWPORT, OPTIONS)).toBe(true);
  });

  it('recognises a widget flush against the right edge', () => {
    // 1280 - 12 - 300 = 968
    expect(isRectAtViewportEdge(rect(968, 300), VIEWPORT, OPTIONS)).toBe(true);
  });

  it('recognises a widget flush against the top edge', () => {
    expect(isRectAtViewportEdge(rect(400, 12), VIEWPORT, OPTIONS)).toBe(true);
  });

  it('recognises a widget flush against the bottom edge', () => {
    // 800 - 12 - 200 = 588
    expect(isRectAtViewportEdge(rect(400, 588), VIEWPORT, OPTIONS)).toBe(true);
  });

  it('treats a floating widget as not parked', () => {
    expect(isRectAtViewportEdge(rect(400, 300), VIEWPORT, OPTIONS)).toBe(false);
  });

  it('ignores a widget that only comes close to the edge', () => {
    expect(isRectAtViewportEdge(rect(90, 300), VIEWPORT, OPTIONS)).toBe(false);
    expect(isRectAtViewportEdge(rect(400, 90), VIEWPORT, OPTIONS)).toBe(false);
  });

  it('accepts sub-pixel rounding at the edge', () => {
    expect(isRectAtViewportEdge(rect(13, 300), VIEWPORT, OPTIONS)).toBe(true);
  });
});

describe('idle collapse arming', () => {
  const base = {
    positioned: true,
    dragging: false,
    hovering: false,
    open: false,
    compact: false,
  };

  it('arms for a parked pill', () => {
    expect(shouldArmIdleCollapse(base)).toBe(true);
  });

  it('arms for a parked open panel', () => {
    expect(shouldArmIdleCollapse({ ...base, open: true })).toBe(true);
  });

  it('never arms before the widget has a position', () => {
    expect(shouldArmIdleCollapse({ ...base, positioned: false })).toBe(false);
  });

  it('pauses while dragging', () => {
    expect(shouldArmIdleCollapse({ ...base, dragging: true })).toBe(false);
  });

  it('pauses while the pointer rests on the widget', () => {
    expect(shouldArmIdleCollapse({ ...base, hovering: true })).toBe(false);
  });

  it('does not re-arm once the pill is already compact', () => {
    expect(shouldArmIdleCollapse({ ...base, compact: true })).toBe(false);
  });

  it('still arms while the panel is open and marked compact', () => {
    expect(shouldArmIdleCollapse({ ...base, open: true, compact: true })).toBe(true);
  });
});
