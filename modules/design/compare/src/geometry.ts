import type { ContentSize, ScrollPosition, Viewport } from './contract.ts';

export const MIN_PANEL_WIDTH = 200;
export const MAX_PANEL_WIDTH = 4000;
export const DEFAULT_PANEL_WIDTH = 420;
/** Horizontal inset between a panel edge and its device frame, per side. */
export const PANEL_INSET = 12;
export const MIN_SCALE = 0.05;

export function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_PANEL_WIDTH;
  return Math.round(Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width)));
}

/** Scale that fits the device viewport into the panel; never upscales captured pixels. */
export function fitScale(panelWidth: number, viewport: Viewport): number {
  const inner = Math.max(1, panelWidth - PANEL_INSET * 2);
  return Math.max(MIN_SCALE, Math.min(1, inner / viewport.w));
}

/** Maximum scroll offset in source CSS pixels: content beyond the device viewport. */
export function scrollRange(content: ContentSize, viewport: Viewport): ScrollPosition {
  return { x: Math.max(0, content.width - viewport.w), y: Math.max(0, content.height - viewport.h) };
}

export function clampScroll(position: ScrollPosition, range: ScrollPosition): ScrollPosition {
  const axis = (value: number, max: number) => (Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : 0);
  return { x: axis(position.x, range.x), y: axis(position.y, range.y) };
}

/** Fraction of the scrollable range per axis; 0 on an axis that cannot scroll. */
export function scrollRatio(position: ScrollPosition, range: ScrollPosition): ScrollPosition {
  return { x: range.x > 0 ? position.x / range.x : 0, y: range.y > 0 ? position.y / range.y : 0 };
}

/**
 * Synced scroll maps by ratio, not by absolute pixels, so a short and a long
 * page reach their ends together.
 */
export function mapScroll(position: ScrollPosition, from: ScrollPosition, to: ScrollPosition): ScrollPosition {
  const ratio = scrollRatio(clampScroll(position, from), from);
  return { x: ratio.x * to.x, y: ratio.y * to.y };
}
