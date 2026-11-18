import type { PreviewRect, PreviewViewport } from '@hq/contracts/preview';

export interface NativePlacement { readonly bounds: { x: number; y: number; width: number; height: number }; readonly scale: number }

/**
 * Converts a renderer placeholder (CSS px of the HQ renderer) to native view bounds in window DIP.
 * The bounds are the largest box with the logical viewport's aspect inside the placeholder, centred,
 * so the view never paints background beside the page. The emulated page scale fits those bounds.
 */
export function fitPlacement(rect: PreviewRect, viewport: PreviewViewport, zoomFactor = 1): NativePlacement {
  const zoom = Number.isFinite(zoomFactor) && zoomFactor > 0 ? zoomFactor : 1;
  const outer = { x: rect.x * zoom, y: rect.y * zoom, width: rect.width * zoom, height: rect.height * zoom };
  const fit = Math.max(0, Math.min(outer.width / viewport.w, outer.height / viewport.h));
  const width = Math.min(Math.floor(outer.width), Math.round(viewport.w * fit));
  const height = Math.min(Math.floor(outer.height), Math.round(viewport.h * fit));
  return {
    bounds: { x: Math.round(outer.x + (outer.width - width) / 2), y: Math.round(outer.y + (outer.height - height) / 2), width, height },
    scale: Math.max(0.01, Math.min(width / viewport.w, height / viewport.h)),
  };
}
