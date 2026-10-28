import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { flowId, projectId } from '../src/contract.ts';
import { createFlowCanvasProvider, flowItemKey, parseFlowItemKey } from '../src/canvas.ts';
import { retargetHotspot } from '../src/editor.ts';
import { createFakeFlowStorage } from '../src/fakes.ts';
import { canonicalize, jcsDigest } from '../src/jcs.ts';
import { createFlowRepository, flowKey } from '../src/repository.ts';
import { checkout, checkoutRaw, parsed } from './fixtures.ts';

describe('JCS digest', () => {
  it('canonicalizes key order, escapes and numbers per RFC 8785', () => {
    assert.equal(canonicalize({ b: [true, null, 'x'], a: 1, 'é': 1e21, c: 0.1 }), '{"a":1,"b":[true,null,"x"],"c":0.1,"é":1e+21}');
    assert.equal(canonicalize({ '😀': 1, 'ﬁ': 2 }), '{"😀":1,"ﬁ":2}', 'UTF-16 code unit order');
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, { a: undefined }, new Date(0), () => 1]) assert.throws(() => canonicalize(bad));
  });

  it('matches an independent SHA-256 of the canonical text', async () => {
    const value = { z: 'flow', a: [1, 2.5, { y: false }] };
    assert.equal(await jcsDigest(value), `sha256:${createHash('sha256').update('{"a":[1,2.5,{"y":false}],"z":"flow"}').digest('hex')}`);
  });
});

describe('flow repository', () => {
  it('round-trips through the workspace namespace unchanged', async () => {
    const storage = createFakeFlowStorage();
    const repository = createFlowRepository(storage);
    const flow = checkout();
    await repository.save(flow);
    const loaded = await repository.load(flow.id);
    assert.equal(loaded.status, 'ok');
    assert.equal(await jcsDigest(loaded.status === 'ok' ? loaded.flow : null), await jcsDigest(flow));
    assert.deepEqual(storage.writes, [{ namespace: 'workspace', key: 'design/flows/flow-checkout' }]);
    assert.match(storage.label, /^FAKE/);
  });

  it('reports a future schema as unsupported and never rewrites it', async () => {
    const storage = createFakeFlowStorage();
    await storage.putDocument('workspace', flowKey(flowId('flow-checkout')), { ...checkoutRaw(), schema: 'hq.design.flow/v9' });
    const repository = createFlowRepository(storage);
    assert.equal((await repository.load(flowId('flow-checkout'))).status, 'unsupported');
    assert.deepEqual(await repository.listForProject(projectId('project-synthetic')), []);
    assert.equal(storage.writes.length, 1, 'only the seed write');
  });

  it('skips a malformed stored key instead of failing the whole listing', async () => {
    const storage = createFakeFlowStorage();
    const repository = createFlowRepository(storage);
    await repository.save(checkout());
    await storage.putDocument('workspace', 'design/flows/%E0', checkoutRaw());
    assert.deepEqual((await repository.listForProject(projectId('project-synthetic'))).map((flow) => flow.id), ['flow-checkout']);
    const items = await createFlowCanvasProvider(repository).listItems(projectId('project-synthetic'));
    assert.deepEqual(items.map((item) => item.entityId), ['flow-checkout', 'flow-checkout']);
  });
});

describe('flow CanvasItemProvider', () => {
  it('lists project items with stable keys, intrinsic size and web-approximation evidence, never positions', async () => {
    const storage = createFakeFlowStorage();
    const repository = createFlowRepository(storage);
    await repository.save(checkout());
    await repository.save(parsed({ ...checkoutRaw(), id: 'flow-other', projectId: 'project-elsewhere' }));
    const provider = createFlowCanvasProvider(repository);
    const items = await provider.listItems(projectId('project-synthetic'));
    assert.deepEqual(items.map((item) => item.key), ['hq.design.flows/flow-map/flow-checkout', 'hq.design.flows/flow-player/flow-checkout']);
    for (const item of items) {
      assert.equal(item.evidence, 'web-approximation');
      assert.ok(item.intrinsicSize.width > 0 && item.intrinsicSize.height > 0);
      assert.ok(!('x' in item) && !('position' in item));
    }
    assert.deepEqual(items[1]!.intrinsicSize, { width: 390, height: 844 });
    const writes = storage.writes.length;
    await provider.listItems(projectId('project-synthetic'));
    assert.equal(storage.writes.length, writes, 'listing never writes');
  });

  it('pins sourceRevision to the exact document and reports missing keys', async () => {
    const repository = createFlowRepository(createFakeFlowStorage());
    const flow = checkout();
    await repository.save(flow);
    const provider = createFlowCanvasProvider(repository);
    const key = flowItemKey('flow-map', flow.id);
    const first = await provider.resolveItem(key);
    const edited = retargetHotspot(flow, flow.hotspots[0]!.id, { ...flow.hotspots[0]!.transition, durationMs: 400 });
    assert.ok(edited.ok);
    await repository.save(edited.flow);
    const second = await provider.resolveItem(key);
    assert.ok(first.status === 'ok' && second.status === 'ok');
    assert.notEqual(first.item.sourceRevision, second.item.sourceRevision);
    assert.deepEqual(await provider.resolveItem('hq.design.flows/flow-map/absent'), { status: 'missing', key: 'hq.design.flows/flow-map/absent' });
    assert.deepEqual(await provider.resolveItem('other/provider/key'), { status: 'missing', key: 'other/provider/key' });
    assert.deepEqual(parseFlowItemKey(flowItemKey('flow-player', flowId('a/b c'))), { kind: 'flow-player', flowId: 'a/b c' });
  });
});
