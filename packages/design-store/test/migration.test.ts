import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import type { DocumentKey, JsonValue, Migration, StoragePort } from '../src/contract.ts';
import { isStoreError } from '../src/errors.ts';
import { createFaultInjectingFs } from '../src/fault-fs.ts';
import { nodeFs } from '../src/fs.ts';
import { documentKey, streamId } from '../src/ids.ts';
import { canonicalize } from '../src/jcs.ts';
import { bytes, liveGenerationDir, open, scratch, treeContent, WORKSPACE } from './helpers.ts';

const key = (value: string): DocumentKey => documentKey(value);

/** v1 → v2 renames `name` to `title` on every project document. */
const renameTitle: Migration = {
  from: 1,
  to: 2,
  description: 'rename project name to title',
  run: async ({ store }) => {
    for (const id of await store.listDocuments(WORKSPACE, { prefix: 'projects/' })) {
      const document = await store.getDocument(WORKSPACE, id);
      const value = document?.value as { name: string };
      await store.putDocument(WORKSPACE, id, { title: value.name });
    }
  },
};

async function seedV1(t: TestContext): Promise<string> {
  const root = join(scratch(t), 'store');
  const { store } = await open(root, { schemaVersion: 1 });
  await store.putDocument(WORKSPACE, key('projects/a'), { name: 'Alpha' });
  await store.putDocument(WORKSPACE, key('projects/b'), { name: 'Beta' });
  await store.putBlob(WORKSPACE, bytes('capture'));
  await store.appendEvent(WORKSPACE, streamId('requests/1'), { type: 'frozen', payload: { packet: 'p1' } });
  await store.close();
  return root;
}

async function projects(store: StoragePort): Promise<JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const id of await store.listDocuments(WORKSPACE, { prefix: 'projects/' })) out[id] = (await store.getDocument(WORKSPACE, id))?.value ?? null;
  return out;
}

describe('schema migrations', () => {
  it('snapshots before migrating, migrates a working copy and switches atomically', async (t) => {
    const root = await seedV1(t);
    const before = treeContent(liveGenerationDir(root));
    const { store, report } = await open(root, { schemaVersion: 2, migrations: [renameTitle] });
    assert.equal(report.migration?.from, 1);
    assert.equal(report.migration?.to, 2);
    assert.deepEqual(store.health().storedSchemaVersion, 2);
    assert.equal(store.health().generation, 'g000002');
    assert.deepEqual(await projects(store), { 'projects/a': { title: 'Alpha' }, 'projects/b': { title: 'Beta' } });
    assert.equal((await store.readEvents(WORKSPACE, streamId('requests/1'))).events.length, 1, 'journal carried forward untruncated');
    await store.close();
    const snapshotId = report.migration?.snapshotId ?? '';
    assert.deepEqual(treeContent(join(root, 'snapshots', snapshotId, 'data')), before, 'snapshot is an exact pre-migration copy');
    assert.deepEqual(treeContent(join(root, 'generations', 'g000001')), before, 'previous generation is untouched');
    const manifest = JSON.parse(readFileSync(join(root, 'snapshots', snapshotId, 'SNAPSHOT.json'), 'utf8')) as { schemaVersion: number };
    assert.equal(manifest.schemaVersion, 1);
    assert.equal(existsSync(join(root, 'MIGRATION.json')), false);
    const again = await open(root, { schemaVersion: 2, migrations: [renameTitle] });
    assert.equal(again.report.migration, null);
    await again.store.close();
  });

  it('a failed migration restores the snapshot exactly and retains it', async (t) => {
    const root = await seedV1(t);
    const pointer = readFileSync(join(root, 'CURRENT'));
    const before = treeContent(liveGenerationDir(root));
    const failing: Migration = {
      ...renameTitle,
      run: async (context) => {
        await renameTitle.run(context);
        await context.store.putDocument(WORKSPACE, key('half-done'), true);
        throw new Error('synthetic migration bug');
      },
    };
    await assert.rejects(open(root, { schemaVersion: 2, migrations: [failing] }), (error) => {
      assert.ok(isStoreError(error, 'migration-failed'));
      assert.equal(error.details.restoration, 'verified-unchanged');
      assert.equal(error.details.failedStep, '1->2');
      assert.equal((error.cause as Error).message, 'synthetic migration bug');
      return true;
    });
    assert.deepEqual(readFileSync(join(root, 'CURRENT')), pointer);
    assert.deepEqual(treeContent(liveGenerationDir(root)), before);
    const snapshots = readdirSync(join(root, 'snapshots'));
    assert.equal(snapshots.length, 1);
    assert.deepEqual(treeContent(join(root, 'snapshots', snapshots[0] ?? '', 'data')), before);
    assert.equal(readdirSync(join(root, 'quarantine')).length, 1, 'failed working copy kept for diagnosis');
    const { store } = await open(root, { schemaVersion: 1 });
    assert.deepEqual(await projects(store), { 'projects/a': { name: 'Alpha' }, 'projects/b': { name: 'Beta' } });
    assert.equal(await store.getDocument(WORKSPACE, key('half-done')), null);
    await store.close();
  });

  it('restores from the snapshot when a failing migration damaged live data outside its port', async (t) => {
    const root = await seedV1(t);
    const live = liveGenerationDir(root);
    const before = treeContent(live);
    const errant: Migration = {
      ...renameTitle,
      run: async () => {
        writeFileSync(join(live, 'ns', 'workspace', 'docs', 'projects~2fa.json'), '{"damaged":true}');
        throw new Error('errant migration');
      },
    };
    await assert.rejects(open(root, { schemaVersion: 2, migrations: [errant] }), (error) => {
      assert.ok(isStoreError(error, 'migration-failed'));
      assert.equal(error.details.restoration, 'restored-from-snapshot');
      return true;
    });
    assert.notEqual(liveGenerationDir(root), live);
    assert.deepEqual(treeContent(liveGenerationDir(root)), before, 'restored generation equals the snapshot byte for byte');
    const { store } = await open(root, { schemaVersion: 1 });
    assert.deepEqual(await projects(store), { 'projects/a': { name: 'Alpha' }, 'projects/b': { name: 'Beta' } });
    await store.close();
  });

  it('a missing migration step is rejected before any write', async (t) => {
    const root = await seedV1(t);
    const before = treeContent(root);
    await assert.rejects(open(root, { schemaVersion: 3, migrations: [renameTitle] }), (error) => isStoreError(error, 'migration-failed'));
    assert.deepEqual(treeContent(root), before);
  });

  it('a crash at any point of a migration leaves exact v1 data or completed v2 data', async (t) => {
    const reference = await seedV1(t);
    const v1Tree = canonicalize(treeContent(liveGenerationDir(reference)));
    let points = 0;
    for (let crashAt = 0; ; crashAt += 1) {
      const root = await seedV1(t);
      const fs = createFaultInjectingFs(nodeFs, { crashAt, tear: crashAt % 2 === 0 });
      try {
        const { store } = await open(root, { schemaVersion: 2, migrations: [renameTitle], fs });
        await store.close();
      } catch (error) {
        if (!fs.crashed) throw error;
      }
      const observed = await open(root, { schemaVersion: 2, readOnly: true });
      const version = observed.store.health().storedSchemaVersion;
      const state = await projects(observed.store);
      await observed.store.close();
      if (version === 1) {
        // Interrupted before the switch: live data is still exactly the v1 tree.
        assert.equal(canonicalize(treeContent(liveGenerationDir(root))), v1Tree, `crash ${crashAt} changed v1 data`);
      } else {
        assert.equal(version, 2);
        assert.deepEqual(state, { 'projects/a': { title: 'Alpha' }, 'projects/b': { title: 'Beta' } });
      }
      const resumed = await open(root, { schemaVersion: 2, migrations: [renameTitle] });
      assert.deepEqual(await projects(resumed.store), { 'projects/a': { title: 'Alpha' }, 'projects/b': { title: 'Beta' } });
      await resumed.store.close();
      points += 1;
      if (!fs.crashed) break;
    }
    t.diagnostic(`${points} migration crash points`);
    assert.ok(points > 20);
  });
});
