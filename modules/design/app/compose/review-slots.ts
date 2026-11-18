/**
 * Compare (T4) -> annotations (T5) overlay slot adapter.
 *
 * Compare exposes `renderOverlay(frame: OverlayFrame)`: a source-CSS-pixel coordinate frame per panel,
 * with the exact `versionId`, route, state, viewport, scroll and (for static captures only) the capture
 * digest. Annotations anchor to an exact version and capture. This module turns the compare frame into the
 * annotation frames, and refuses to anchor marks to a live preview, which has no frozen bytes.
 */
import type { OverlayFrame as CompareFrame } from '../../compare/src/contract.ts';
import type { SourceFrame } from '../../annotations/src/contract.ts';
import { versionId } from '../../annotations/src/contract.ts';
import type { OverlayFrame as AnnotationFrame } from '../../annotations/src/geometry.ts';
import type { DisplayFrame } from '../../annotations/src/resolution.ts';

export type OverlayAdaptation =
  | {
    readonly status: 'ready';
    /** What the host is showing, for `AnnotationController.setFrame`. */
    readonly source: SourceFrame;
    /**
     * Overlay geometry for `AnnotationOverlay`. Compare's overlay slot spans the whole scaled content (the
     * panel's scroller moves it), so the overlay's own scroll is zero and its zoom is compare's fit scale.
     */
    readonly overlay: AnnotationFrame;
    /** Full scrollable content extent in source CSS pixels, for sizing the counter-scaled overlay box. */
    readonly content: { readonly width: number; readonly height: number };
    readonly display: DisplayFrame;
  }
  | { readonly status: 'unavailable'; readonly reason: 'live-preview' | 'no-capture-digest' | 'invalid-frame'; readonly message: string };

const MESSAGE: Readonly<Record<'live-preview' | 'no-capture-digest' | 'invalid-frame', string>> = {
  'live-preview': 'Marks attach to a static capture. A live preview has no frozen bytes to anchor to.',
  'no-capture-digest': 'This capture has no digest, so marks cannot be tied to its exact bytes.',
  'invalid-frame': 'This panel has no usable frame yet.',
};

export function adaptCompareFrame(frame: CompareFrame): OverlayAdaptation {
  const unavailable = (reason: 'live-preview' | 'no-capture-digest' | 'invalid-frame'): OverlayAdaptation => ({ status: 'unavailable', reason, message: MESSAGE[reason] });
  if (frame.sourceKind === 'live-preview') return unavailable('live-preview');
  if (frame.captureDigest === null || frame.captureDigest === '') return unavailable('no-capture-digest');
  if (!(frame.scale > 0) || !Number.isFinite(frame.scale)) return unavailable('invalid-frame');
  let id;
  try { id = versionId(frame.versionId); } catch { return unavailable('invalid-frame'); }
  const viewport = { w: frame.viewport.w, h: frame.viewport.h, dpr: frame.viewport.dpr };
  return {
    status: 'ready',
    source: { versionId: id, route: frame.route, state: frame.state, viewport, scroll: { x: frame.scroll.x, y: frame.scroll.y }, captureDigest: frame.captureDigest },
    overlay: { viewport, scroll: { x: 0, y: 0 }, zoom: frame.scale },
    content: { width: frame.contentSize.width, height: frame.contentSize.height },
    display: { versionId: id, viewport },
  };
}
