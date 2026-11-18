import type { CanvasArrangement, Point, Rect } from './contract.ts';
import { movableIds, selectionBounds } from './arrangement.ts';
import { translateRect } from './geometry.ts';

/** A visible alignment guide, in world units. `axis: 'x'` is a vertical line at x = `at`. */
export interface SnapGuide { readonly axis: 'x' | 'y'; readonly at: number; readonly from: number; readonly to: number }

export interface SnapResult { readonly delta: Point; readonly guides: readonly SnapGuide[] }

export interface SnapOptions {
  /** Snap distance in screen pixels; converted to world units with `zoom`. */
  readonly thresholdPx?: number;
  readonly zoom: number;
  /** Disable all snapping for this gesture (e.g. while a modifier is held). */
  readonly disabled?: boolean;
}

const lines = (rect: Rect, axis: 'x' | 'y'): readonly number[] => axis === 'x'
  ? [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
  : [rect.y, rect.y + rect.height / 2, rect.y + rect.height];

/**
 * Snap a proposed move of `ids` by `delta`. Object edges and centers win over
 * the grid; the grid aligns the moving bounds' top-left corner. Guides
 * describe which object lines matched.
 */
export function snapMove(arrangement: CanvasArrangement, ids: readonly string[], delta: Point, options: SnapOptions): SnapResult {
  const moving = movableIds(arrangement, ids);
  const bounds = selectionBounds(arrangement, [...moving]);
  if (!bounds || options.disabled) return { delta, guides: [] };
  const threshold = (options.thresholdPx ?? 6) / options.zoom;
  const proposed = translateRect(bounds, delta.x, delta.y);
  const targets: Rect[] = [
    ...arrangement.artboards.filter((board) => !moving.has(board.id)).map((board) => board.frame),
    ...arrangement.items.filter((item) => !moving.has(item.id) && !item.hidden).map((item) => item.frame),
  ];

  const solve = (axis: 'x' | 'y'): { offset: number; at: number | null } => {
    let best: { offset: number; at: number } | null = null;
    for (const target of targets) {
      for (const targetLine of lines(target, axis)) {
        for (const movingLine of lines(proposed, axis)) {
          const offset = targetLine - movingLine;
          if (Math.abs(offset) <= threshold && (!best || Math.abs(offset) < Math.abs(best.offset))) best = { offset, at: targetLine };
        }
      }
    }
    if (best) return best;
    if (!arrangement.grid.snap) return { offset: 0, at: null };
    const start = axis === 'x' ? proposed.x : proposed.y;
    return { offset: Math.round(start / arrangement.grid.size) * arrangement.grid.size - start, at: null };
  };

  const x = solve('x');
  const y = solve('y');
  const snapped = translateRect(proposed, x.offset, y.offset);
  const guides: SnapGuide[] = [];
  const span = (axis: 'x' | 'y', at: number): SnapGuide => {
    const related = targets.filter((target) => lines(target, axis).includes(at));
    const all = [snapped, ...related];
    return axis === 'x'
      ? { axis, at, from: Math.min(...all.map((rect) => rect.y)), to: Math.max(...all.map((rect) => rect.y + rect.height)) }
      : { axis, at, from: Math.min(...all.map((rect) => rect.x)), to: Math.max(...all.map((rect) => rect.x + rect.width)) };
  };
  if (x.at !== null) guides.push(span('x', x.at));
  if (y.at !== null) guides.push(span('y', y.at));
  return { delta: { x: delta.x + x.offset, y: delta.y + y.offset }, guides };
}
