import type { AnchorTarget, Point, Rect, Viewport } from './contract.ts';

/**
 * Coordinate frames:
 * - source: document CSS pixels (what anchors store); independent of scroll and DPR.
 * - viewport: CSS pixels relative to the preview's visible top-left.
 * - overlay: viewport pixels multiplied by the host's display zoom.
 * - device: source CSS pixels multiplied by DPR (capture bytes).
 */
export interface OverlayFrame {
  readonly viewport: Viewport;
  readonly scroll: Point;
  /** Overlay pixels per source CSS pixel, e.g. 0.5 for a half-size compare panel. */
  readonly zoom: number;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function sourceToOverlayPoint(point: Point, frame: OverlayFrame): Point {
  return { x: (point.x - frame.scroll.x) * frame.zoom, y: (point.y - frame.scroll.y) * frame.zoom };
}

export function overlayToSourcePoint(point: Point, frame: OverlayFrame): Point {
  if (!(frame.zoom > 0)) throw new RangeError('Overlay zoom must be positive');
  return { x: point.x / frame.zoom + frame.scroll.x, y: point.y / frame.zoom + frame.scroll.y };
}

export function sourceToOverlayRect(rect: Rect, frame: OverlayFrame): Rect {
  const origin = sourceToOverlayPoint(rect, frame);
  return { x: origin.x, y: origin.y, width: rect.width * frame.zoom, height: rect.height * frame.zoom };
}

/** Maps a source rect into capture-byte pixels for a capture taken at `dpr`. */
export function sourceToDeviceRect(rect: Rect, dpr: number): Rect {
  if (!(dpr > 0)) throw new RangeError('DPR must be positive');
  return { x: rect.x * dpr, y: rect.y * dpr, width: rect.width * dpr, height: rect.height * dpr };
}

/** Normalizes a drag between two points into a rect with non-negative size. */
export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function rectsClose(a: Rect, b: Rect, tolerance = 0.5): boolean {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance
    && Math.abs(a.width - b.width) <= tolerance && Math.abs(a.height - b.height) <= tolerance;
}

export function rectDistance(point: Point, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

export function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** Distance from a source point to a target's stored geometry, in source CSS px. */
export function targetDistance(point: Point, target: AnchorTarget): number {
  switch (target.kind) {
    case 'element':
    case 'region':
      return rectDistance(point, target.rect);
    case 'text':
      return target.rects.reduce((best, rect) => Math.min(best, rectDistance(point, rect)), Infinity);
    case 'ink': {
      const [first] = target.points;
      if (first === undefined) return Infinity;
      if (target.points.length === 1) return Math.hypot(point.x - first.x, point.y - first.y);
      let best = Infinity;
      for (let i = 1; i < target.points.length; i += 1) {
        best = Math.min(best, segmentDistance(point, target.points[i - 1]!, target.points[i]!));
      }
      return best;
    }
  }
}

/** Bounding rect of a target in source CSS px, or null for an empty target. */
export function targetBounds(target: AnchorTarget): Rect | null {
  switch (target.kind) {
    case 'element':
    case 'region':
      return target.rect;
    case 'text':
      return unionRects(target.rects);
    case 'ink': {
      if (target.points.length === 0) return null;
      const xs = target.points.map((p) => p.x);
      const ys = target.points.map((p) => p.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
  }
}

export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}
