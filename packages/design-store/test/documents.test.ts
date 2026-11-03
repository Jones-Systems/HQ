import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { DocumentKey } from '../src/contract.ts';
import { isStoreError } from '../src/errors.ts';
import { createFaultInjectingFs } from '../src/fault-fs.ts';
import { nodeFs } from '../src/fs.ts';
import { documentKey } from '../src/ids.ts';
import { digestOfJson } from '../src/jcs.ts';
import { liveGenerationDir, open, scratch, treeState, WORKSPACE } from './helpers.ts';

const key = (value: string): DocumentKey => documentKey(value);

describe('documents', () => {
  it('round-trips, revises, lists by prefix and deletes', async (t) => {
    const root = join(scratch(t), 'store');
    const { store, report } = await open(root);
    assert.equal(report.createdStore, true);
    const first = await store.putDocument(WORKSPACE, key('projects/a'), { title: 'A', views: [1, 2] });
    assert.equal(first.revision, 1);
    assert.equal(first.valueDigest, digestOfJson({ title: 'A', views: [1, 2] }));
    const second = await store.putDocument(WORKSPACE, key('projects/a'), { title: 'A2' }, { expectedRevision: 1 });
    assert.equal(second.revision, 2);
    await store.putDocument(WORKSPACE, key('projects/b'), { title: 'B' }, { expectedRevision: null });
    await store.putDocument(WORKSPACE, key('drafts/x'), { body: 'draft' });
    assert.deepEqual(await store.listDocuments(WORKSPACE, { prefix: 'projects/' }), ['projects/a', 'projects/b']);
    assert.equal(await store.deleteDocument(WORKSPACE, key('projects/b')), true);
    assert.equal(await store.deleteDocument(WORKSPACE, key('projects/b')), false);
    await store.close();

    const reopened = (await open(root)).store;
    assert.deepEqual((await reopened.getDocument(WORKSPACE, key('projects/a')))?.value, { title: 'A2' });
    assert.equal(await reopened.getDocument(WORKSPACE, key('projects/b')), null);
    assert.deepEqual(await reopened.listDocuments(WORKSPACE), ['drafts/x', 'projects/a']);
    await reopened.close();
  });

  it('enforces optimistic revisions without writing on conflict', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root);
    await store.putDocument(WORKSPACE, key('doc'), { v: 1 });
    const before = treeState(root);
    await assert.rejects(store.putDocument(WORKSPACE, key('doc'), { v: 2 }, { expectedRevision: null }), (error) => isStoreError(error, 'conflict'));
    await assert.rejects(store.putDocument(WORKSPACE, key('doc'), { v: 2 }, { expectedRevision: 7 }), (error) => isStoreError(error, 'conflict'));
    await assert.rejects(store.deleteDocument(WORKSPACE, key('doc'), { expectedRevision: 2 }), (error) => isStoreError(error, 'conflict'));
    assert.deepEqual(treeState(root), before);
    await store.close();
  });

  it('keeps keys distinct on case-insensitive volumes and supports long keys', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root);
    const long = `views/${'Ä'.repeat(200)}`;
    await store.putDocument(WORKSPACE, key('Doc'), { v: 'upper' });
    await store.putDocument(WORKSPACE, key('doc'), { v: 'lower' });
    await store.putDocument(WORKSPACE, key(long), { v: 'long' });
    const names = readdirSync(join(liveGenerationDir(root), 'ns', 'workspace', 'docs'));
    assert.equal(new Set(names.map((name) => name.toLowerCase())).size, names.length);
    assert.ok(names.every((name) => name.length < 200));
    assert.deepEqual((await store.getDocument(WORKSPACE, key('Doc')))?.value, { v: 'upper' });
    assert.deepEqual((await store.getDocument(WORKSPACE, key(long)))?.value, { v: 'long' });
    assert.deepEqual(await store.listDocuments(WORKSPACE), ['Doc', 'doc', long].sort());
    await store.close();
  });

  it('rejects invalid values, keys and namespaces before writing', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root);
    const before = treeState(root);
    await assert.rejects(store.putDocument(WORKSPACE, key('doc'), { bad: Number.NaN }), (error) => isStoreError(error, 'invalid-argument'));
    await assert.rejects(store.putDocument(WORKSPACE, key('doc'), { bad: undefined } as never), (error) => isStoreError(error, 'invalid-argument'));
    await assert.rejects(store.putDocument('drafts' as never, key('doc'), {}), (error) => isStoreError(error, 'invalid-argument'));
    assert.throws(() => documentKey(''), (error) => isStoreError(error, 'invalid-argument'));
    assert.throws(() => documentKey('line\nbreak'), (error) => isStoreError(error, 'invalid-argument'));
    assert.deepEqual(treeState(root), before);
    await store.close();
  });

  it('returns detached values', async (t) => {
    const { store } = await open(join(scratch(t), 'store'));
    const value = { list: [1] };
    const stored = await store.putDocument(WORKSPACE, key('doc'), value);
    value.list.push(2);
    (stored.value as { list: number[] }).list.push(3);
    const read = await store.getDocument(WORKSPACE, key('doc'));
    (read?.value as { list: number[] }).list.push(4);
    assert.deepEqual((await store.getDocument(WORKSPACE, key('doc')))?.value, { list: [1] });
    await store.close();
  });

  it('reports corrupt authoritative documents without repairing them', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root);
    await store.putDocument(WORKSPACE, key('doc'), { v: 1 });
    const file = join(liveGenerationDir(root), 'ns', 'workspace', 'docs', 'doc.json');
    const tampered = readFileSync(file, 'utf8').replace('"v":1', '"v":2');
    writeFileSync(file, tampered);
    await assert.rejects(store.getDocument(WORKSPACE, key('doc')), (error) => isStoreError(error, 'integrity'));
    assert.equal(readFileSync(file, 'utf8'), tampered);
    await store.close();
  });

  it('orders durability steps: temp write, file fsync, rename, directory fsync', async (t) => {
    const root = join(scratch(t), 'store');
    await (await open(root)).store.close();
    const fs = createFaultInjectingFs(nodeFs);
    const { store } = await open(root, { fs });
    const start = fs.trace.length;
    await store.putDocument(WORKSPACE, key('doc'), { v: 1 });
    await store.close();
    const ops = fs.trace.slice(start).map((entry) => entry.op);
    const write = ops.indexOf('writeNew');
    assert.ok(write >= 0);
    assert.deepEqual(ops.slice(write, write + 4), ['writeNew', 'fsyncFile', 'rename', 'fsyncDir']);
    const rename = fs.trace.slice(start).find((entry) => entry.op === 'rename');
    assert.match(rename?.path ?? '', /\.tmp-[0-9a-f]+$/u);
    assert.match(rename?.to ?? '', /docs\/doc\.json$/u);
  });

  it('orders a transaction: staged files durable before the manifest, manifest before any target', async (t) => {
    const root = join(scratch(t), 'store');
    await (await open(root)).store.close();
    const fs = createFaultInjectingFs(nodeFs);
    const { store } = await open(root, { fs });
    const start = fs.trace.length;
    await store.commit([
      { op: 'put', namespace: WORKSPACE, key: key('a'), value: 1 },
      { op: 'put', namespace: WORKSPACE, key: key('b'), value: 2 },
    ]);
    await store.close();
    const trace = fs.trace.slice(start);
    const manifestRename = trace.findIndex((entry) => entry.op === 'rename' && (entry.to ?? '').endsWith('.commit'));
    const stagedSyncs = trace.filter((entry) => entry.op === 'fsyncFile' && entry.path.includes('.stage-')).map((entry) => trace.indexOf(entry));
    const targetRenames = trace.filter((entry) => entry.op === 'rename' && entry.path.includes('.stage-')).map((entry) => trace.indexOf(entry));
    assert.equal(stagedSyncs.length, 2);
    assert.equal(targetRenames.length, 2);
    assert.ok(stagedSyncs.every((index) => index < manifestRename));
    assert.ok(targetRenames.every((index) => index > manifestRename));
    const unlinkManifest = trace.findIndex((entry) => entry.op === 'unlink' && entry.path.endsWith('.commit'));
    assert.ok(unlinkManifest > Math.max(...targetRenames));
  });

  it('commits multi-document transactions with revision checks', async (t) => {
    const { store } = await open(join(scratch(t), 'store'));
    await store.putDocument(WORKSPACE, key('a'), 1);
    await assert.rejects(store.commit([
      { op: 'put', namespace: WORKSPACE, key: key('a'), value: 2, expectedRevision: 5 },
      { op: 'put', namespace: WORKSPACE, key: key('b'), value: 2 },
    ]), (error) => isStoreError(error, 'conflict'));
    assert.equal(await store.getDocument(WORKSPACE, key('b')), null);
    await assert.rejects(store.commit([
      { op: 'put', namespace: WORKSPACE, key: key('a'), value: 2 },
      { op: 'delete', namespace: WORKSPACE, key: key('a') },
    ]), (error) => isStoreError(error, 'invalid-argument'));
    const result = await store.commit([
      { op: 'put', namespace: WORKSPACE, key: key('a'), value: 2, expectedRevision: 1 },
      { op: 'delete', namespace: WORKSPACE, key: key('missing') },
    ]);
    assert.equal(result.documents[0]?.revision, 2);
    assert.deepEqual((await store.getDocument(WORKSPACE, key('a')))?.value, 2);
    await store.close();
  });

  it('refuses to initialize over unrecognized data or an unknown pointer format', async (t) => {
    const dir = scratch(t);
    writeFileSync(join(dir, 'notes.txt'), 'owner data');
    const before = treeState(dir);
    await assert.rejects(open(dir), (error) => isStoreError(error, 'unsupported-format'));
    assert.deepEqual(treeState(dir), before);

    const root = join(dir, 'store');
    await (await open(root)).store.close();
    writeFileSync(join(root, 'CURRENT'), JSON.stringify({ format: 'hq.design.store.current/v9', generation: 'g000001' }));
    const pinned = treeState(root);
    await assert.rejects(open(root), (error) => isStoreError(error, 'unsupported-format'));
    assert.deepEqual(treeState(root), pinned);
  });
});
