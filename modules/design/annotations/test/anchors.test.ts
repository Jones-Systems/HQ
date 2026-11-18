import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { reduce } from '../src/editor.ts';
import {
  overlayToSourcePoint,
  sourceToDeviceRect,
  sourceToOverlayPoint,
  sourceToOverlayRect,
} from '../src/geometry.ts';
import type { OverlayFrame } from '../src/geometry.ts';
import { resolveAll, resolveForDisplay, resolveRequestFor } from '../src/resolution.ts';
import { V1, V2, citeEvent, frame, freshEditor, nextId, pickEvent, withTool } from './fixtures.ts';

// Node geometry checks prove the frame arithmetic only, not rendered layout.

describe('anchors survive a re-render at a different dpr and scroll', () => {
  test('a drawn box captured at one frame lands on the same document spot in another', () => {
    const captureFrame: OverlayFrame = { viewport: { w: 1280, h: 800, dpr: 1 }, scroll: { x: 0, y: 300 }, zoom: 1 };
    const a = overlayToSourcePoint({ x: 100, y: 50 }, captureFrame);
    const b = overlayToSourcePoint({ x: 260, y: 130 }, captureFrame);
    let state = withTool(freshEditor(), 'box');
    state = reduce(state, { type: 'draw', id: nextId(), kind: 'box', points: [a, b], frame: frame({ scroll: captureFrame.scroll }) }).state;
    const [box] = state.document.annotations;
    assert.deepEqual(box?.anchor.target, { kind: 'region', rect: { x: 100, y: 350, width: 160, height: 80 } });
    assert.deepEqual(box?.anchor.scroll, { x: 0, y: 300 });

    // Re-render at dpr 2, scrolled to 120, shown in a half-size compare panel.
    const later: OverlayFrame = { viewport: { w: 1280, h: 800, dpr: 2 }, scroll: { x: 0, y: 120 }, zoom: 0.5 };
    const [resolved] = resolveAll(state.document.annotations, { versionId: V1, viewport: later.viewport });
    assert.equal(resolved?.status, 'exact', 'DPR alone never reflows CSS layout');
    assert.deepEqual(sourceToOverlayRect(resolved!.rects[0]!, later), { x: 50, y: 115, width: 80, height: 40 });
    // Back-projecting the drawn overlay position recovers the stored source rect.
    assert.deepEqual(overlayToSourcePoint({ x: 50, y: 115 }, later), { x: 100, y: 350 });
    // Capture bytes at dpr 2 use device pixels; the anchor itself is unchanged.
    assert.deepEqual(sourceToDeviceRect(resolved!.rects[0]!, 2), { x: 200, y: 700, width: 320, height: 160 });
  });

  test('overlay/source projection round-trips across scroll, zoom and dpr', () => {
    for (const scroll of [{ x: 0, y: 0 }, { x: 13, y: 977 }, { x: 250, y: 4 }]) {
      for (const zoom of [0.25, 0.5, 1, 1.5, 2]) {
        for (const dpr of [1, 1.25, 2, 3]) {
          const f: OverlayFrame = { viewport: { w: 1024, h: 768, dpr }, scroll, zoom };
          const source = { x: 321.5, y: 1200.25 };
          const back = overlayToSourcePoint(sourceToOverlayPoint(source, f), f);
          assert.ok(Math.abs(back.x - source.x) < 1e-9 && Math.abs(back.y - source.y) < 1e-9);
        }
      }
    }
  });

  test('picked element re-resolved by the agent at a new dpr and scroll stays exact', () => {
    let state = withTool(freshEditor(), 'pick');
    state = reduce(state, { type: 'agent-event', id: nextId(), event: pickEvent, frame: frame() }).state;
    const [pick] = state.document.annotations;
    assert.deepEqual(pick?.anchor.scroll, { x: 0, y: 300 }, 'live agent frame is recorded');
    assert.deepEqual(resolveRequestFor(pick!), { kind: 'element', path: 'html > body > main > div > button:nth-of-type(1)', textHash: 'fnv1a32:00000001' });
    // The agent reports document coordinates, so scroll/dpr changes do not move them.
    const live = { found: true as const, rects: [{ x: 20, y: 500, width: 80, height: 32 }], textHash: 'fnv1a32:00000001' };
    const shown = resolveForDisplay(pick!, { versionId: V1, viewport: { w: 1280, h: 800, dpr: 2 } }, live);
    assert.equal(shown.status, 'exact');
    const overlay = sourceToOverlayRect(shown.rects[0]!, { viewport: { w: 1280, h: 800, dpr: 2 }, scroll: { x: 0, y: 450 }, zoom: 1 });
    assert.deepEqual(overlay, { x: 20, y: 50, width: 80, height: 32 });
  });

  test('a reflowed element is drawn where the agent finds it and flagged', () => {
    let state = withTool(freshEditor(), 'pick');
    state = reduce(state, { type: 'agent-event', id: nextId(), event: pickEvent, frame: frame() }).state;
    const narrow = { versionId: V1, viewport: { w: 600, h: 800, dpr: 3 } };
    const moved = resolveForDisplay(state.document.annotations[0]!, narrow, { found: true, rects: [{ x: 10, y: 900, width: 580, height: 40 }], textHash: 'fnv1a32:00000001' });
    assert.equal(moved.status, 'reflowed');
    assert.deepEqual(moved.rects, [{ x: 10, y: 900, width: 580, height: 40 }]);
    const changed = resolveForDisplay(state.document.annotations[0]!, narrow, { found: true, rects: [{ x: 10, y: 900, width: 580, height: 40 }], textHash: 'fnv1a32:ffffffff' });
    assert.equal(changed.status, 'changed');
    const missing = resolveForDisplay(state.document.annotations[0]!, narrow, { found: false });
    assert.equal(missing.status, 'missing');
  });

  test('drawn marks at a different layout width are flagged, never moved', () => {
    let state = withTool(freshEditor(), 'ink');
    state = reduce(state, { type: 'draw', id: nextId(), kind: 'ink', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], frame: frame() }).state;
    const shown = resolveForDisplay(state.document.annotations[0]!, { versionId: V1, viewport: { w: 390, h: 844, dpr: 3 } });
    assert.equal(shown.status, 'frame-mismatch');
    assert.deepEqual(shown.points, [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  });

  test('another version is never drawn or rebound', () => {
    let state = withTool(freshEditor(), 'cite');
    state = reduce(state, { type: 'agent-event', id: nextId(), event: citeEvent, frame: frame() }).state;
    const shown = resolveForDisplay(state.document.annotations[0]!, { versionId: V2, viewport: { w: 1280, h: 800, dpr: 1 } });
    assert.equal(shown.status, 'other-version');
    assert.deepEqual(shown.rects, []);
    assert.equal(state.document.annotations[0]!.anchor.versionId, V1);
  });

  test('resolveAll pairs live results only with element/text anchors, in order', () => {
    let state = withTool(freshEditor(), 'pick');
    state = reduce(state, { type: 'agent-event', id: nextId(), event: pickEvent, frame: frame() }).state;
    state = withTool(state, 'box');
    state = reduce(state, { type: 'draw', id: nextId(), kind: 'box', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], frame: frame() }).state;
    state = withTool(state, 'cite');
    state = reduce(state, { type: 'agent-event', id: nextId(), event: citeEvent, frame: frame() }).state;
    const results = resolveAll(state.document.annotations, { versionId: V1, viewport: { w: 1280, h: 800, dpr: 2 } }, [
      { found: false },
      { found: true, rects: [{ x: 140, y: 400, width: 120, height: 16 }] },
    ]);
    assert.deepEqual(results.map((r) => r.status), ['missing', 'exact', 'exact']);
  });
});
