import type { Camera, Point, Rect, Size } from './contract.ts';

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 32;
export const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Viewport-relative CSS pixel position of a world point. */
export function worldToScreen(camera: Camera, point: Point): Point {
  return { x: (point.x - camera.x) * camera.zoom, y: (point.y - camera.y) * camera.zoom };
}

/** World point under a viewport-relative CSS pixel position. */
export function screenToWorld(camera: Camera, point: Point): Point {
  return { x: point.x / camera.zoom + camera.x, y: point.y / camera.zoom + camera.y };
}

/** Set zoom while keeping the world point under `anchor` (viewport pixels) fixed. */
export function zoomTo(camera: Camera, anchor: Point, zoom: number): Camera {
  const next = clampZoom(zoom);
  const world = screenToWorld(camera, anchor);
  return { x: world.x - anchor.x / next, y: world.y - anchor.y / next, zoom: next };
}

export function zoomAt(camera: Camera, anchor: Point, factor: number): Camera {
  return zoomTo(camera, anchor, camera.zoom * factor);
}

/** Move the view content by a screen-pixel delta (positive dx moves the view right). */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { x: camera.x + dx / camera.zoom, y: camera.y + dy / camera.zoom, zoom: camera.zoom };
}

/** Camera that fits `rect` into `viewport` with `padding` screen pixels, never above `maxZoom`. */
export function fitRect(rect: Rect, viewport: Size, padding = 48, maxZoom = 1): Camera {
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const zoom = clampZoom(Math.min(maxZoom, availableWidth / Math.max(rect.width, 1), availableHeight / Math.max(rect.height, 1)));
  const center = rectCenter(rect);
  return { x: center.x - viewport.width / 2 / zoom, y: center.y - viewport.height / 2 / zoom, zoom };
}

/** Smallest pan that brings `rect` (world) inside the viewport with a screen `margin`. */
export function ensureVisible(camera: Camera, viewport: Size, rect: Rect, margin = 24): Camera {
  const m = margin / camera.zoom;
  const viewWidth = viewport.width / camera.zoom;
  const viewHeight = viewport.height / camera.zoom;
  const axis = (start: number, size: number, viewStart: number, viewSize: number): number => {
    if (size + m * 2 > viewSize) return start - m;
    if (start - m < viewStart) return start - m;
    if (start + size + m > viewStart + viewSize) return start + size + m - viewSize;
    return viewStart;
  };
  const x = axis(rect.x, rect.width, camera.x, viewWidth);
  const y = axis(rect.y, rect.height, camera.y, viewHeight);
  return x === camera.x && y === camera.y ? camera : { x, y, zoom: camera.zoom };
}

export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function translateRect(rect: Rect, dx: number, dy: number): Rect {
  return { x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height };
}

export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.x); top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width); bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function containsPoint(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/** World rectangle currently visible in the viewport. */
export function visibleWorld(camera: Camera, viewport: Size): Rect {
  return { x: camera.x, y: camera.y, width: viewport.width / camera.zoom, height: viewport.height / camera.zoom };
}
