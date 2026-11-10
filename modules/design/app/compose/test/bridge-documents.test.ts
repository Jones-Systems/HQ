import assert from 'node:assert/strict';
import { it } from 'node:test';
import { createBridgeWorkspaceDocuments, DesignBridgeError, DesignBridgeConflictError } from '../bridge-documents.ts';
import { createProjectsStorage, createCanvasStorage, CanvasWriteConflictError } from '../../storage/index.ts';
import { StorageConflictError } from '../../../projects/src/contract.ts';
import { createTransportDouble } from './bridge-double.ts';

it('round trips, lists with the exact prefix, and omits absent expectedRevision for overwrites', async () => {
  const double = createTransportDouble();
  const docs = createBridgeWorkspaceDocuments(double.transport);
  assert.equal(await docs.getDocument('a'), null);
  const first = await docs.putDocument('a', { n: 1 });
  assert.deepEqual(await docs.getDocument('a'), first);
  assert.deepEqual(await docs.listDocuments(), ['a']);
  await docs.putDocument('a', { n: 2 }, {});
  assert.deepEqual((await docs.getDocument('a'))?.value, { n: 2 });
  assert.deepEqual(await docs.listDocuments('z/'), []);
  assert.ok(double.calls.filter((call) => call.route === 'doc.put').every((call) => !Object.hasOwn(call.params, 'expectedRevision')));
  assert.deepEqual(double.calls.filter((call) => call.route === 'doc.list').map((call) => call.params), [{ prefix: '' }, { prefix: 'z/' }]);
  assert.equal(double.calls.length, 7);
});

it('maps create-only and stale CAS conflicts without retries, including both F1 adapters', async () => {
  const double = createTransportDouble();
  const docs = createBridgeWorkspaceDocuments(double.transport);
  await docs.putDocument('a', {}, { expectedRevision: null });
  await assert.rejects(docs.putDocument('a', {}, { expectedRevision: null }), DesignBridgeConflictError);
  await docs.putDocument('a', {}, { expectedRevision: 1 });
  await assert.rejects(docs.putDocument('a', {}, { expectedRevision: 1 }), { name: 'StoreError', code: 'conflict' });
  const projects = createProjectsStorage(docs);
  await projects.writeDocument('workspace', 'record', {}, { expectedRevision: null });
  await assert.rejects(projects.writeDocument('workspace', 'record', {}, { expectedRevision: null }), StorageConflictError);
  const a = createCanvasStorage(docs), b = createCanvasStorage(docs);
  const key = 'design.canvas.arrangement.v1/canvas';
  await a.readDocument('workspace', key);
  await b.readDocument('workspace', key);
  await a.writeDocument('workspace', key, '{}');
  await assert.rejects(b.writeDocument('workspace', key, '{}'), (error: unknown) => error instanceof CanvasWriteConflictError && error.reason === 'revision-changed');
  assert.equal(double.calls.length, 10);
});

for (const kind of ['read-only', 'invalid', 'unavailable', 'unknown'] as const) {
  it(`preserves the explicit ${kind} failure and makes one call`, async () => {
    const double = createTransportDouble();
    double.failWith(() => ({ ok: false, kind }));
    await assert.rejects(createBridgeWorkspaceDocuments(double.transport).putDocument('a', {}), (error: unknown) => error instanceof DesignBridgeError && error.kind === kind);
    assert.equal(double.calls.length, 1);
  });
}

for (const bad of [undefined, null, {}, { ok: true }, { ok: false, kind: 'other' }, { ok: true, value: null, extra: true }]) {
  it(`classifies malformed envelopes ${JSON.stringify(bad)}`, async () => {
    for (const route of ['doc.get', 'doc.list', 'doc.put'] as const) {
      let calls = 0;
      const docs = createBridgeWorkspaceDocuments({ async call() { calls++; return bad as never; } });
      const action = route === 'doc.get' ? docs.getDocument('a') : route === 'doc.list' ? docs.listDocuments() : docs.putDocument('a', {});
      await assert.rejects(action, { kind: route === 'doc.put' ? 'unknown' : 'unavailable' });
      assert.equal(calls, 1);
    }
  });
}
it('classifies rejected calls without retrying', async () => {
  let calls = 0;
  const docs = createBridgeWorkspaceDocuments({ async call() { calls++; throw new Error('lost response'); } });
  await assert.rejects(docs.getDocument('a'), { kind: 'unavailable' });
  await assert.rejects(docs.listDocuments(), { kind: 'unavailable' });
  await assert.rejects(docs.putDocument('a', {}), { kind: 'unknown' });
  assert.equal(calls, 3);
});
it('validates every document field before branding, and list prefixes', async () => {
  const good = { namespace: 'workspace', key: 'a', revision: 1, valueDigest: `sha256:${'a'.repeat(64)}`, updatedAt: '', value: null };
  const invalid = [null, [], { ...good, extra: true }, { ...good, namespace: 'cache' }, { ...good, key: 'b' },
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1'].map((revision) => ({ ...good, revision })),
    ...['SHA256:' + 'a'.repeat(64), 'sha256:' + 'A'.repeat(64), 'sha256:aa'].map((valueDigest) => ({ ...good, valueDigest })),
    { ...good, updatedAt: 0 }, { ...good, value: undefined }, { ...good, value: [1, , 3] }, { ...good, value: new Date() },
    { ...good, value: { x: undefined } }, { ...good, value: { [Symbol('bad')]: 1 } }, { ...good, value: NaN }, Object.assign(Object.create({ other: true }), good)];
  for (const value of invalid) {
    const docs = createBridgeWorkspaceDocuments({ async call() { return { ok: true, value } as never; } });
    if (value !== null) await assert.rejects(docs.getDocument('a'), { kind: 'unavailable' });
    await assert.rejects(docs.putDocument('a', {}), { kind: 'unknown' });
  }
  for (const value of [['other'], [2], [,'prefix/a'], Object.defineProperty([], '0', { get() { throw new Error('bad accessor'); } }), null]) {
    const docs = createBridgeWorkspaceDocuments({ async call() { return { ok: true, value } as never; } });
    await assert.rejects(docs.listDocuments('prefix/'), { kind: 'unavailable' });
  }
});
