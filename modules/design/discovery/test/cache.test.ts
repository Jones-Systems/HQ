import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoFromMs } from '../src/contract.ts';
import { EMPTY_CATALOG, parseSnapshot, reduceCatalog } from '../src/catalog.ts';
import { CATALOG_CACHE_KEY, loadCatalogCache, PreviewCache, serializeCatalogCache } from '../src/cache.ts';
import { FAKE_HOSTS, fixturePreview, fixtureSnapshot, MemoryCachePort, MemoryWorkspacePort } from '../src/fakes.ts';

const NOW = isoFromMs(Date.UTC(2026, 9, 20, 12));

async function sampleCatalog() {
  const snapshot = await fixtureSnapshot(FAKE_HOSTS.laptop, 1, [{ path: 'one', name: 'One', revision: 'r1' }]);
  const parsed = await parseSnapshot(snapshot, FAKE_HOSTS.laptop);
  assert.ok(parsed.ok);
  return reduceCatalog(EMPTY_CATALOG, { type: 'snapshot', snapshot: parsed.snapshot, at: NOW }).state;
}

test('warm cache round-trips the catalog exactly', async () => {
  const port = new MemoryCachePort();
  const catalog = await sampleCatalog();
  await port.writeDocument(CATALOG_CACHE_KEY, serializeCatalogCache(catalog, NOW));
  const load = await loadCatalogCache(port, NOW);
  assert.equal(load.status, 'warm');
  assert.deepEqual(load.catalog, catalog);
});

test('corrupt cache is rebuilt in the cache namespace without touching the workspace', async () => {
  for (const bad of ['{not json', JSON.stringify({ schema: 'hq.design.discovery-cache/v1', sources: {}, records: { x: { entry: {}, freshness: {} } } }), JSON.stringify({ schema: 'other' })]) {
    const port = new MemoryCachePort();
    const workspace = new MemoryWorkspacePort();
    port.documents.set(CATALOG_CACHE_KEY, bad);
    const load = await loadCatalogCache(port, NOW);
    assert.equal(load.status, 'corrupt-rebuilt');
    assert.deepEqual(load.catalog, EMPTY_CATALOG);
    assert.equal(workspace.writes, 0);
    assert.equal(JSON.parse(port.documents.get(CATALOG_CACHE_KEY)!).schema, 'hq.design.discovery-cache/v1');
  }
});

test('cache tampering with an entry identity is detected as corrupt', async () => {
  const port = new MemoryCachePort();
  const document = JSON.parse(serializeCatalogCache(await sampleCatalog(), NOW));
  const key = Object.keys(document.records)[0]!;
  document.records[key].entry.relativePath = 'renamed';
  port.documents.set(CATALOG_CACHE_KEY, JSON.stringify(document));
  assert.equal((await loadCatalogCache(port, NOW)).status, 'corrupt-rebuilt');
});

test('a cache from a newer schema is left unmodified and not written', async () => {
  const port = new MemoryCachePort();
  const future = JSON.stringify({ schema: 'hq.design.discovery-cache/v9', anything: true });
  port.documents.set(CATALOG_CACHE_KEY, future);
  const load = await loadCatalogCache(port, NOW);
  assert.equal(load.status, 'future-readonly');
  assert.equal(load.writable, false);
  assert.equal(port.writes, 0);
  assert.equal(port.documents.get(CATALOG_CACHE_KEY), future);
});

test('preview cache enforces its byte budget with LRU eviction and verifies digests', async () => {
  const port = new MemoryCachePort();
  const one = await fixturePreview('one');
  const two = await fixturePreview('two');
  const three = await fixturePreview('three');
  const size = one.bytes.byteLength;
  const cache = new PreviewCache(port, { budgetBytes: size * 2 + 2, maxItemBytes: 1024 });
  assert.equal(await cache.put(one.ref.digest, one.bytes), true);
  assert.equal(await cache.put(two.ref.digest, two.bytes), true);
  assert.ok(await cache.get(one.ref.digest), 'touch one so two becomes least recently used');
  assert.equal(await cache.put(three.ref.digest, three.bytes), true);
  assert.equal(cache.has(two.ref.digest), false);
  assert.equal(cache.has(one.ref.digest), true);
  assert.ok(cache.totalBytes <= size * 2 + 2);
  assert.equal(await cache.put(one.ref.digest, two.bytes), false, 'digest mismatch is not admitted');
  assert.equal(await cache.put((await fixturePreview('x'.repeat(2000))).ref.digest, (await fixturePreview('x'.repeat(2000))).bytes), false, 'over per-item limit');
  // A corrupted stored blob is dropped on read rather than served.
  port.blobs.set(three.ref.digest, new Uint8Array([1, 2, 3]));
  assert.equal(await cache.get(three.ref.digest), null);
  assert.equal(cache.has(three.ref.digest), false);
});

test('evidence adoption copies bytes into the workspace before eviction can drop them', async () => {
  const port = new MemoryCachePort();
  const workspace = new MemoryWorkspacePort();
  const one = await fixturePreview('adopt');
  const cache = new PreviewCache(port, { budgetBytes: 1024, maxItemBytes: 1024 });
  await cache.put(one.ref.digest, one.bytes);
  await cache.adopt(one.ref.digest, one.ref.mediaType, workspace);
  assert.equal(workspace.writes, 1);
  assert.deepEqual(workspace.blobs.get(one.ref.digest)!.bytes, one.bytes);
  await assert.rejects(cache.adopt((await fixturePreview('missing')).ref.digest, 'image/png', workspace));
  assert.equal(workspace.writes, 1);
});
