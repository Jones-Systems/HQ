import type { PreviewViewport } from '@hq/contracts/preview';
import { pixelDigest, type CapturePixels, type CaptureReading, type Coherence } from './coherence.js';

export const FULL_PAGE_CAPTURE_ENABLED = false as const;
export const MAX_DEVICE_EDGE = 16384;
export const MAX_DEVICE_PIXELS = 33554432;
export const FULL_DEADLINE_MS = 10000;
const MAX_PNG_BYTES = 12 * 1024 * 1024;

export interface StabilityReading {
  readonly windowResizeEvents: number;
  readonly visualViewportResizeEvents: number;
  readonly windowScrollEvents: number;
  readonly visualViewportScrollEvents: number;
  readonly runningAnimations: number;
  readonly fontsStatus: 'loaded' | 'loading';
  readonly imagesComplete: boolean;
}

export function planFullExtent(reading: CaptureReading, viewport: PreviewViewport, displayScaleFactor: number) {
  const { w, h } = reading.contentSize, { dpr } = viewport;
  if (reading.frame.scroll.x !== 0 || reading.frame.scroll.y !== 0) return { ok: false, reason: 'scroll-origin' } as const;
  if (dpr !== 1 && dpr !== 2 && dpr !== 3) return { ok: false, reason: 'dpr' } as const;
  if (!Number.isFinite(viewport.w) || viewport.w <= 0 || !Number.isFinite(viewport.h) || viewport.h <= 0
    || reading.frame.viewport.w !== viewport.w || reading.frame.viewport.h !== viewport.h || reading.frame.viewport.dpr !== dpr
    || !Number.isFinite(displayScaleFactor) || displayScaleFactor <= 0) return { ok: false, reason: 'dpr' } as const;
  if (!Number.isSafeInteger(w) || w < 1 || !Number.isSafeInteger(h) || h < 1) return { ok: false, reason: 'extent-oversize' } as const;
  if (w !== viewport.w) return { ok: false, reason: 'horizontal-extent' } as const;
  if (h < viewport.h) return { ok: false, reason: 'extent-changed' } as const;
  if (w * dpr > MAX_DEVICE_EDGE || h * dpr > MAX_DEVICE_EDGE || w * dpr * h * dpr > MAX_DEVICE_PIXELS) {
    return { ok: false, reason: 'extent-oversize' } as const;
  }
  const scale = dpr / displayScaleFactor;
  const size = { width: Math.round(w * scale), height: Math.round(h * scale) };
  if (!Number.isFinite(scale) || !Number.isSafeInteger(size.width) || size.width < 1
    || !Number.isSafeInteger(size.height) || size.height < 1) return { ok: false, reason: 'dpr' } as const;
  return {
    ok: true, extent: { w, h }, held: { size, scale },
    shot: { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width: w, height: h, scale: 1 } },
  } as const;
}

export function acceptFullExtent(
  readings: readonly [CaptureReading, CaptureReading, CaptureReading, CaptureReading],
  stability: readonly [StabilityReading, StabilityReading, StabilityReading],
  first: CapturePixels,
  second: CapturePixels,
  expected: { generation: number; viewport: PreviewViewport; extent: { w: number; h: number } },
): Coherence {
  const [initial, , , post] = readings;
  if (readings.some(reading => reading.generation !== expected.generation || reading.url !== initial.url)) return { ok: false, reason: 'navigation' };
  const plan = planFullExtent(initial, expected.viewport, 1);
  if (!plan.ok) return plan;
  if (readings.some(reading => reading.frame.scroll.x !== 0 || reading.frame.scroll.y !== 0)
    || stability.some(value => value.windowScrollEvents !== 0 || value.visualViewportScrollEvents !== 0)) return { ok: false, reason: 'scroll' };
  if (readings.some(reading => JSON.stringify(reading.results) !== JSON.stringify(initial.results))) return { ok: false, reason: 'target-changed' };
  if (readings.some(reading => reading.mutationCounter !== initial.mutationCounter)) return { ok: false, reason: 'mutation' };
  if (readings.some(reading => reading.frame.viewport.w !== expected.viewport.w || reading.frame.viewport.h !== expected.viewport.h
    || reading.frame.viewport.dpr !== expected.viewport.dpr)) return { ok: false, reason: 'dpr' };
  if (readings.some(reading => reading.contentSize.w !== expected.extent.w || reading.contentSize.h !== expected.extent.h)) return { ok: false, reason: 'extent-changed' };
  if (stability.some(value => value.windowResizeEvents !== 0 || value.visualViewportResizeEvents !== 0)) return { ok: false, reason: 'layout-resized' };
  // Readiness is required at R0 and R2; S3 retains event counters through restoration.
  const readiness = stability.slice(0, 2);
  if (readiness.some(value => value.runningAnimations !== 0)) return { ok: false, reason: 'animating' };
  if (readiness.some(value => value.fontsStatus !== 'loaded')) return { ok: false, reason: 'fonts-pending' };
  if (readiness.some(value => !value.imagesComplete)) return { ok: false, reason: 'media-pending' };
  if ([first, second].some(image => image.width !== expected.extent.w * expected.viewport.dpr
    || image.height !== expected.extent.h * expected.viewport.dpr)) return { ok: false, reason: 'dpr' };
  if (first.bytes.byteLength > MAX_PNG_BYTES || second.bytes.byteLength > MAX_PNG_BYTES) return { ok: false, reason: 'bytes-oversize' };
  const digest = pixelDigest(first.bytes);
  if (digest !== pixelDigest(second.bytes)) return { ok: false, reason: 'pixels-unstable' };
  return { ok: true, bytes: first.bytes, digest, reading: post };
}
