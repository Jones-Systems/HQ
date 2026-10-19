import assert from 'node:assert/strict';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { isStoreError } from '../src/errors.ts';
import { blobDigest, documentKey } from '../src/ids.ts';
import { digestOfBytes } from '../src/jcs.ts';
import { bytes, CACHE, liveGenerationDir, namespaces, open, scratch, treeContent, treeState, WORKSPACE } from './helpers.ts';

function blobPath(root: string, namespace: string, digest: string): string {
  const hex = digest.slice(7);
  return join(liveGenerationDir(root), 'ns', namespace, 'blobs', hex.slice(0, 2), hex);
}

describe('content-addressed blobs', () => {
  it('rejects a blob whose bytes do not match the expected digest, writing nothing', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root);
    const claimed = digestOfBytes(bytes('the capture the caller meant'));
    const before = treeState(root);
    await assert.rejects(store.putBlob(WORKSPACE, bytes('different bytes'), { expectedDigest: claimed }), (error) => {
      assert.ok(isStoreError(error, 'digest-mismatch'));
      assert.equal(error.details.expected, claimed);
      assert.equal(error.details.actual, digestOfBytes(bytes('different bytes')));
      return true;
    });
    assert.deepEqual(treeState(root), before);
    assert.equal(await store.hasBlob(WORKSPACE, claimed), false);
    assert.equal(await store.hasBlob(WORKSPACE, digestOfBytes(bytes('different bytes'))), false);
    await assert.rejects(store.putBlob(WORKSPACE, bytes('x'), { expectedDigest: 'sha256:XYZ' as never }), (error) => isStoreError(error, 'invalid-argument'));
    await store.close();
  });

  it('stores by digest, deduplicates and verifies on read', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root);
    const data = bytes('png bytes');
    const ref = await store.putBlob(WORKSPACE, data);
    assert.deepEqual(ref, { digest: digestOfBytes(data), bytes: data.length });
    assert.deepEqual(await store.putBlob(WORKSPACE, data, { expectedDigest: ref.digest }), ref);
    assert.deepEqual(await store.getBlob(WORKSPACE, ref.digest), data);
    assert.equal(await store.getBlob(WORKSPACE, blobDigest(`sha256:${'0'.repeat(64)}`)), null);
    assert.equal(readdirSync(join(liveGenerationDir(root), 'ns', 'workspace', 'blobs', ref.digest.slice(7, 9))).length, 1);
    await store.close();
  });

  it('never repairs a corrupt authoritative blob silently, but a verified re-put restores it and keeps the bad bytes', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root);
    const data = bytes('evidence');
    const ref = await store.putBlob(WORKSPACE, data);
    writeFileSync(blobPath(root, 'workspace', ref.digest), 'bit rot');
    await assert.rejects(store.getBlob(WORKSPACE, ref.digest), (error) => isStoreError(error, 'integrity'));
    assert.ok(existsSync(blobPath(root, 'workspace', ref.digest)));
    await store.putBlob(WORKSPACE, data, { expectedDigest: ref.digest });
    assert.deepEqual(await store.getBlob(WORKSPACE, ref.digest), data);
    const quarantine = readdirSync(join(root, 'quarantine'));
    assert.equal(quarantine.length, 1);
    await store.close();
  });

  it('drops a corrupt cache entry as a miss without touching workspace', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root);
    const ws = await store.putBlob(WORKSPACE, bytes('same bytes'));
    const cached = await store.putBlob(CACHE, bytes('same bytes'));
    await store.putDocument(WORKSPACE, documentKey('project'), { title: 'kept' });
    await store.putDocument(CACHE, documentKey('catalog/host-a'), { entries: [1] });
    const workspaceBefore = treeContent(join(liveGenerationDir(root), 'ns', 'workspace'));
    writeFileSync(blobPath(root, 'cache', cached.digest), 'corrupt');
    const docFile = join(liveGenerationDir(root), 'ns', 'cache', 'docs', 'catalog~2fhost-a.json');
    writeFileSync(docFile, '{"truncated');
    assert.equal(await store.getBlob(CACHE, cached.digest), null);
    assert.equal(await store.getDocument(CACHE, documentKey('catalog/host-a')), null);
    assert.equal(existsSync(blobPath(root, 'cache', cached.digest)), false);
    assert.equal(existsSync(docFile), false);
    assert.deepEqual(treeContent(join(liveGenerationDir(root), 'ns', 'workspace')), workspaceBefore);
    assert.deepEqual(await store.getBlob(WORKSPACE, ws.digest), bytes('same bytes'));
    await store.putDocument(CACHE, documentKey('catalog/host-a'), { entries: [1, 2] });
    assert.deepEqual((await store.getDocument(CACHE, documentKey('catalog/host-a')))?.value, { entries: [1, 2] });
    await store.close();
  });
});

describe('bounded evictable cache', () => {
  it('evicts least-recently-used cache items within budget and never evicts workspace', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root, { namespaces: namespaces(100) });
    const a = await store.putBlob(CACHE, bytes('a'.repeat(40)));
    const b = await store.putBlob(CACHE, bytes('b'.repeat(40)));
    const kept = await store.putBlob(WORKSPACE, bytes('w'.repeat(500)));
    assert.ok(await store.getBlob(CACHE, a.digest)); // a is now more recent than b
    const c = await store.putBlob(CACHE, bytes('c'.repeat(40)));
    assert.equal(await store.hasBlob(CACHE, b.digest), false);
    assert.equal(await store.hasBlob(CACHE, a.digest), true);
    assert.equal(await store.hasBlob(CACHE, c.digest), true);
    assert.equal(await store.hasBlob(WORKSPACE, kept.digest), true);
    const usage = await store.usage(CACHE);
    assert.equal(usage.bytes, 80);
    assert.equal(usage.budgetBytes, 100);
    assert.equal((await store.usage(WORKSPACE)).budgetBytes, null);
    await assert.rejects(store.putBlob(CACHE, new Uint8Array(101)), (error) => isStoreError(error, 'too-large'));
    await store.close();
  });

  it('rebuilds its index from disk after reopen and still honours the budget', async (t) => {
    const root = join(scratch(t), 'store');
    const first = (await open(root, { namespaces: namespaces(100) })).store;
    await first.putBlob(CACHE, bytes('1'.repeat(45)));
    await first.putBlob(CACHE, bytes('2'.repeat(45)));
    await first.close();
    const second = (await open(root, { namespaces: namespaces(100) })).store;
    await second.putBlob(CACHE, bytes('3'.repeat(45)));
    assert.ok((await second.usage(CACHE)).bytes <= 100);
    await second.close();
  });

  it('adopts a cached preview into workspace before eviction can drop it', async (t) => {
    const root = join(scratch(t), 'store');
    const { store } = await open(root, { namespaces: namespaces(50) });
    const preview = await store.putBlob(CACHE, bytes('p'.repeat(40)));
    const adopted = await store.adoptBlob(CACHE, WORKSPACE, preview.digest);
    assert.deepEqual(adopted, preview);
    await store.putBlob(CACHE, bytes('q'.repeat(40)));
    assert.equal(await store.hasBlob(CACHE, preview.digest), false);
    assert.deepEqual(await store.getBlob(WORKSPACE, preview.digest), bytes('p'.repeat(40)));
    await assert.rejects(store.adoptBlob(CACHE, WORKSPACE, preview.digest), (error) => isStoreError(error, 'not-found'));
    await store.close();
  });
});
