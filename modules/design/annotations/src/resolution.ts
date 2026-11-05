import type {
  AnnotationRef,
  Point,
  Rect,
  ResolveRequest,
  ResolveResult,
  VersionId,
  Viewport,
} from './contract.ts';
import { rectsClose } from './geometry.ts';

/**
 * How an anchor relates to the frame currently shown:
 * - exact: geometry matches the captured anchor.
 * - reflowed: the agent re-found the element/text at a different position.
 * - changed: the element was re-found but its text no longer matches.
 * - frame-mismatch: a drawn mark whose layout width differs from capture;
 *   it is drawn in its captured coordinates and flagged, never silently moved.
 * - missing: the agent could not re-find the element/text.
 * - other-version: the frame shows another version; nothing is drawn.
 */
export type AnchorStatus = 'exact' | 'reflowed' | 'changed' | 'frame-mismatch' | 'missing' | 'other-version';

export interface DisplayFrame {
  readonly versionId: VersionId;
  readonly viewport: Viewport;
}

export interface ResolvedAnnotation {
  readonly annotation: AnnotationRef;
  readonly status: AnchorStatus;
  /** Source CSS px rects to draw; empty when nothing should be drawn. */
  readonly rects: readonly Rect[];
  /** Source CSS px points for ink/arrow marks. */
  readonly points: readonly Point[];
}

/** The re-resolution request for live anchors, or null for drawn marks. */
export function resolveRequestFor(annotation: AnnotationRef): ResolveRequest | null {
  const { target } = annotation.anchor;
  if (target.kind === 'element') return { kind: 'element', path: target.path, ...(target.textHash === undefined ? {} : { textHash: target.textHash }) };
  if (target.kind === 'text') return { kind: 'text', quote: target.quote, prefix: target.prefix, suffix: target.suffix };
  return null;
}

function sameLayout(a: Viewport, b: Viewport): boolean {
  // DPR does not change CSS layout; only the layout width can reflow content.
  return a.w === b.w;
}

/**
 * Computes what to draw for an annotation in the current frame. `live` is the
 * agent's result for this annotation's resolve request, when a live preview
 * is available; a static capture has none.
 */
export function resolveForDisplay(annotation: AnnotationRef, frame: DisplayFrame, live?: ResolveResult): ResolvedAnnotation {
  const { anchor } = annotation;
  const { target } = anchor;
  if (anchor.versionId !== frame.versionId) return { annotation, status: 'other-version', rects: [], points: [] };

  if (target.kind === 'region') {
    return { annotation, status: sameLayout(anchor.viewport, frame.viewport) ? 'exact' : 'frame-mismatch', rects: [target.rect], points: [] };
  }
  if (target.kind === 'ink') {
    return { annotation, status: sameLayout(anchor.viewport, frame.viewport) ? 'exact' : 'frame-mismatch', rects: [], points: target.points };
  }

  const stored = target.kind === 'element' ? [target.rect] : target.rects;
  if (live === undefined) {
    return { annotation, status: sameLayout(anchor.viewport, frame.viewport) ? 'exact' : 'frame-mismatch', rects: stored, points: [] };
  }
  if (!live.found) return { annotation, status: 'missing', rects: stored, points: [] };
  if (target.kind === 'element' && target.textHash !== undefined && live.textHash !== undefined && live.textHash !== target.textHash) {
    return { annotation, status: 'changed', rects: live.rects, points: [] };
  }
  const same = live.rects.length === stored.length && live.rects.every((rect, i) => rectsClose(rect, stored[i]!));
  return { annotation, status: same ? 'exact' : 'reflowed', rects: live.rects, points: [] };
}

/**
 * Resolves a list of annotations against an agent resolution. `requests`
 * must have been built with `resolveRequestFor` in the same order; drawn
 * marks are skipped in that list.
 */
export function resolveAll(
  annotations: readonly AnnotationRef[],
  frame: DisplayFrame,
  liveResults?: readonly ResolveResult[],
): ResolvedAnnotation[] {
  let cursor = 0;
  return annotations.map((annotation) => {
    const request = resolveRequestFor(annotation);
    const live = request !== null && liveResults !== undefined ? liveResults[cursor++] : undefined;
    return resolveForDisplay(annotation, frame, live);
  });
}
