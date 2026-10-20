import assert from 'node:assert/strict';
import test from 'node:test';
import { websiteTree } from '../../../references/test/graph-fixtures.ts';
import { parsePacket } from '../../../references/src/packet.ts';
import { createReferencesEnvironment } from '../references/env.ts';
import { compareSlot, doubles, sent, source } from './doubles.ts';

test('reference library, graph, project pins and packet round trip survive environment rebuild', async () => {
  const { d, runs, session, dispatchId } = await sent();
  const options = { storage: d.referenceStorage, clock: d.clock, ids: d.ids, compareSlot, previewUrl: () => null };
  const refs = await createReferencesEnvironment(options);
  const imported = await refs.library.importReference({
    kind: 'screenshot', source: { kind: 'url', url: 'https://example.com/synthetic' },
    capturedAt: d.clock.now(), capturedBy: 'agent-reported', title: 'Synthetic reference',
    asset: { bytes: new TextEncoder().encode('synthetic-image'), mediaType: 'image/png', w: 1, h: 1 },
  });
  assert.ok('id' in imported);
  assert.equal((await refs.library.useInProject(imported.id, source.projectId)).ok, true);
  assert.equal((await refs.graph.importTree(websiteTree())).ok, true);
  const capture = Object.values(refs.graph.state.captures)[0]!;
  assert.equal((await refs.graph.pin(capture.id, source.projectId)).ok, true);
  const exported = await refs.graph.exportPacket({ mode: 'internal', projectId: source.projectId });
  assert.ok(exported.ok);
  const parsed = await parsePacket(exported.value.packet);
  assert.equal(parsed.status, 'ok');
  const candidate = await runs.pipeline.simulateReturn(session, dispatchId);
  assert.ok(candidate);
  assert.equal((await runs.pipeline.review(session, candidate, 'accept'))?.decision, 'accept');
  const rebuilt = await createReferencesEnvironment(options);
  assert.equal(Object.keys(rebuilt.library.state.references).length, 1);
  assert.deepEqual(rebuilt.graph.state, refs.graph.state);
  const again = await rebuilt.graph.exportPacket({ mode: 'internal', projectId: source.projectId });
  assert.deepEqual(again, exported);
  const other = doubles();
  const receiving = await createReferencesEnvironment({ ...options, storage: other.referenceStorage });
  assert.equal((await receiving.graph.adoptPacket(exported.value.packet)).ok, true);
  assert.equal(d.writes.filter((entry) => entry === 'outbox:accepted').length, 1);
});

test('reference unknown write fences mutations, then recovers the durable record', async () => {
  const d = doubles();
  const options = { storage: d.referenceStorage, clock: d.clock, ids: d.ids, compareSlot, previewUrl: () => null };
  const env = await createReferencesEnvironment(options);
  d.referenceStorage.failNextWrite = 'after-apply';
  const result = await env.library.createCollection('Synthetic collection');
  assert.equal(result.ok, false);
  assert.equal(env.library.access.mode, 'fenced');
  const rebuilt = await createReferencesEnvironment(options);
  assert.equal(rebuilt.library.access.mode, 'writable');
  assert.equal(Object.keys(rebuilt.library.state.collections).length, 1);
});
