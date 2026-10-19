import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { DocumentKey, Projection } from '../src/contract.ts';
import { isStoreError } from '../src/errors.ts';
import { createFaultInjectingFs } from '../src/fault-fs.ts';
import { nodeFs } from '../src/fs.ts';
import { documentKey, streamId } from '../src/ids.ts';
import { bytes, CACHE, open, scratch, treeState, WORKSPACE } from './helpers.ts';

const key = (value: string): DocumentKey => documentKey(value);
const STREAM = streamId('journal');
const count: Projection<number> = { name: 'count', version: 1, initial: () => 0, reduce: (state) => state + 1 };

describe('unknown future schema', () => {
  it('opens read-only, serves reads and is not modified', async (t) => {
    const root = join(scratch(t), 'store');
    const future = await open(root, { schemaVersion: 3 });
    await future.store.putDocument(WORKSPACE, key('projects/a'), { title: 'from a newer build' });
    const blob = await future.store.putBlob(WORKSPACE, bytes('capture'));
    await future.store.putBlob(CACHE, bytes('cached'));
    await future.store.appendEvent(WORKSPACE, STREAM, { type: 'x', payload: 1 });
    await future.store.close();
    const before = treeState(root);

    const fs = createFaultInjectingFs(nodeFs);
    const { store, report } = await open(root, { schemaVersion: 2, fs, migrations: [{ from: 2, to: 3, description: 'never runs', run: async () => assert.fail('migration ran') }] });
    assert.deepEqual(store.health().mode, 'read-only');
    assert.equal(store.health().readOnlyReason, 'future-schema');
    assert.equal(store.health().storedSchemaVersion, 3);
    assert.equal(report.migration, null);

    assert.deepEqual((await store.getDocument(WORKSPACE, key('projects/a')))?.value, { title: 'from a newer build' });
    assert.deepEqual(await store.getBlob(WORKSPACE, blob.digest), bytes('capture'));
    assert.equal((await store.readEvents(WORKSPACE, STREAM)).events.length, 1);
    assert.equal((await store.project(WORKSPACE, STREAM, count)).state, 1);
    assert.equal((await store.usage(CACHE)).items, 1);

    const writes: Promise<unknown>[] = [
      store.putDocument(WORKSPACE, key('projects/a'), {}),
      store.deleteDocument(WORKSPACE, key('projects/a')),
      store.commit([{ op: 'put', namespace: WORKSPACE, key: key('b'), value: 1 }]),
      store.putBlob(WORKSPACE, bytes('new')),
      store.adoptBlob(CACHE, WORKSPACE, blob.digest),
      store.appendEvent(WORKSPACE, STREAM, { type: 'y', payload: 2 }),
      store.repairTornTail(WORKSPACE, STREAM),
    ];
    for (const write of writes) await assert.rejects(write, (error) => isStoreError(error, 'read-only'));
    await store.close();

    assert.equal(fs.mutatingCalls, 0, 'no mutating filesystem call was made');
    assert.deepEqual(treeState(root), before, 'files, contents and mtimes unchanged');
  });

  it('presents a committed-but-unapplied transaction consistently without recovering it', async (t) => {
    const root = join(scratch(t), 'store');
    const seed = await open(root);
    await seed.store.putDocument(WORKSPACE, key('a'), 'old-a');
    await seed.store.putDocument(WORKSPACE, key('gone'), 'old');
    await seed.store.close();
    // Find the first call after the manifest commit point and crash there.
    const probe = createFaultInjectingFs(nodeFs);
    const probeRoot = join(scratch(t), 'probe');
    const probeSeed = await open(probeRoot);
    await probeSeed.store.putDocument(WORKSPACE, key('a'), 'old-a');
    await probeSeed.store.putDocument(WORKSPACE, key('gone'), 'old');
    await probeSeed.store.close();
    const traced = await open(probeRoot, { fs: probe });
    const ops = [
      { op: 'put' as const, namespace: WORKSPACE, key: key('a'), value: 'new-a' },
      { op: 'put' as const, namespace: WORKSPACE, key: key('b'), value: 'new-b' },
      { op: 'delete' as const, namespace: WORKSPACE, key: key('gone') },
    ];
    await traced.store.commit(ops);
    await traced.store.close();
    const commitPoint = probe.trace.findIndex((entry) => entry.op === 'rename' && (entry.to ?? '').endsWith('.commit'));
    const crashing = createFaultInjectingFs(nodeFs, { crashAt: commitPoint + 2 });
    try {
      const { store } = await open(root, { fs: crashing });
      await store.commit(ops).finally(() => store.close().catch(() => undefined));
    } catch (error) {
      assert.ok(crashing.crashed, String(error));
    }
    const before = treeState(root);
    const fs = createFaultInjectingFs(nodeFs);
    const { store } = await open(root, { readOnly: true, fs });
    assert.equal(store.health().pendingRecovery, true);
    assert.equal(store.health().readOnlyReason, 'requested');
    assert.equal((await store.getDocument(WORKSPACE, key('a')))?.value, 'new-a');
    assert.equal((await store.getDocument(WORKSPACE, key('b')))?.value, 'new-b');
    assert.equal(await store.getDocument(WORKSPACE, key('gone')), null);
    assert.deepEqual(await store.listDocuments(WORKSPACE), ['a', 'b']);
    await store.close();
    assert.equal(fs.mutatingCalls, 0);
    assert.deepEqual(treeState(root), before);

    const writer = await open(root);
    assert.equal(writer.report.recoveredTransactions, 1);
    assert.deepEqual(await writer.store.listDocuments(WORKSPACE), ['a', 'b']);
    await writer.store.close();
  });
});
