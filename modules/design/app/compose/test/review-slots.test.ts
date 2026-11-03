import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OverlayFrame } from '../../../compare/src/contract.ts';
import { versionId as compareVersionId, panelId } from '../../../compare/src/ids.ts';
import { adaptCompareFrame } from '../review-slots.ts';

const frame = (patch: Partial<OverlayFrame> = {}): OverlayFrame => ({
  panelId: panelId('a'), versionId: compareVersionId('home-v1'), sourceKind: 'static-capture', route: '/home', state: 'default',
  viewport: { w: 390, h: 844, dpr: 2 }, scroll: { x: 0, y: 120 }, contentSize: { width: 390, height: 2000 }, scale: 0.5,
  captureDigest: `sha256:${'a'.repeat(64)}`, ...patch,
});

describe('compare overlay slot -> annotations frames', () => {
  it('carries the exact version, route, viewport and capture digest into the annotation source frame', () => {
    const adapted = adaptCompareFrame(frame());
    assert.equal(adapted.status, 'ready');
    if (adapted.status !== 'ready') return;
    assert.equal(adapted.source.versionId, 'home-v1');
    assert.equal(adapted.source.captureDigest, `sha256:${'a'.repeat(64)}`);
    assert.deepEqual(adapted.source.viewport, { w: 390, h: 844, dpr: 2 });
    assert.deepEqual(adapted.source.scroll, { x: 0, y: 120 });
    assert.equal(adapted.display.versionId, adapted.source.versionId);
  });

  it('spans the whole scaled content: overlay scroll is zero and its zoom is compare\'s fit scale', () => {
    const adapted = adaptCompareFrame(frame());
    assert.equal(adapted.status, 'ready');
    if (adapted.status !== 'ready') return;
    assert.deepEqual(adapted.overlay.scroll, { x: 0, y: 0 });
    assert.equal(adapted.overlay.zoom, 0.5);
    assert.deepEqual(adapted.content, { width: 390, height: 2000 });
  });

  it('refuses to anchor marks to a live preview', () => {
    const adapted = adaptCompareFrame(frame({ sourceKind: 'live-preview', captureDigest: null }));
    assert.deepEqual([adapted.status, adapted.status === 'unavailable' ? adapted.reason : null], ['unavailable', 'live-preview']);
  });

  it('refuses a static capture without a digest and a frame without a usable scale', () => {
    const noDigest = adaptCompareFrame(frame({ captureDigest: null }));
    assert.equal(noDigest.status === 'unavailable' && noDigest.reason, 'no-capture-digest');
    for (const scale of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const bad = adaptCompareFrame(frame({ scale }));
      assert.equal(bad.status === 'unavailable' && bad.reason, 'invalid-frame', String(scale));
    }
  });

  it('copies viewport and scroll so later changes to the compare frame cannot mutate the annotation frame', () => {
    const input = frame();
    const adapted = adaptCompareFrame(input);
    assert.equal(adapted.status, 'ready');
    if (adapted.status !== 'ready') return;
    assert.notEqual(adapted.source.viewport, input.viewport);
    assert.notEqual(adapted.source.scroll, input.scroll);
  });
});
