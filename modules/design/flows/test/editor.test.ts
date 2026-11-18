import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hotspotId, screenId } from '../src/contract.ts';
import { addHotspot, removeScreen, retargetHotspot } from '../src/editor.ts';
import { jcsDigest } from '../src/jcs.ts';
import { validateFlow } from '../src/model.ts';
import { checkout } from './fixtures.ts';

describe('flow editing', () => {
  it('removing a screen keeps incoming hotspots and reports them broken', async () => {
    const flow = checkout();
    const before = await jcsDigest(flow);
    const removal = removeScreen(flow, screenId('done'));
    assert.ok(removal.result.ok);
    assert.deepEqual(removal.removedHotspots, ['h-receipt', 'h-promo']);
    assert.deepEqual(removal.brokenIncoming, ['h-pay']);
    const next = removal.result.ok ? removal.result.flow : flow;
    assert.ok(next.hotspots.some((hotspot) => hotspot.id === 'h-pay'), 'incoming hotspot survives');
    assert.ok(validateFlow(next).some((issue) => issue.code === 'broken-target' && issue.subject.id === 'h-pay'));
    assert.equal(await jcsDigest(flow), before, 'the original document is unchanged');
  });

  it('removing a route-targeted screen breaks the route target too', () => {
    const removal = removeScreen(checkout(), screenId('cart-empty'));
    assert.deepEqual(removal.brokenIncoming, ['h-clear']);
  });

  it('retargeting repairs a broken hotspot; invalid edits are rejected with no partial result', () => {
    const flow = checkout();
    const repaired = retargetHotspot(flow, hotspotId('h-receipt'), { target: { kind: 'screen', screenId: screenId('cart') }, animation: 'dismiss', durationMs: 200 });
    assert.ok(repaired.ok && !validateFlow(repaired.flow).some((issue) => issue.subject.id === 'h-receipt'));
    const duplicate = addHotspot(flow, flow.hotspots[0]!);
    assert.equal(duplicate.ok, false);
  });
});
