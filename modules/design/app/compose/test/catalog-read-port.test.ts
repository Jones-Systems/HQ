import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CATALOG_CACHE_KEY, serializeCatalogCache } from '../../../discovery/src/cache.ts';
import { EMPTY_CATALOG, parseSnapshot, reduceCatalog } from '../../../discovery/src/catalog.ts';
import { isoFromMs, type HostId } from '../../../discovery/src/contract.ts';
import { FAKE_HOSTS, MemoryCachePort, fixturePreview, fixtureSnapshot } from '../../../discovery/src/fakes.ts';
import { createProjectsSection, createProvisionalLocalRegistry } from '../../../projects/src/index.ts';
import { createFakeClock, createFakeThumbnailPort, createSpyStorage, sequentialIds } from '../../../projects/fakes/index.ts';
import { createCachedCatalogReadPort } from '../catalog-read-port.ts';
import { CACHED_TAG, SYNTHETIC_TAG } from '../labels.ts';

const NOW = Date.UTC(2026, 9, 20, 12);

async function seeded(cache: MemoryCachePort, hosts: readonly HostId[] = [FAKE_HOSTS.laptop, FAKE_HOSTS.studio], sharedName = 'Shared title') {
  let catalog = EMPTY_CATALOG;
  for (const host of hosts) {
    const projects = await Promise.all([0, 1].map(async (index) => ({
      path: `p${index}`, name: index === 0 ? sharedName : `Project ${index}`, previews: [(await fixturePreview(`${host}-${index}`)).ref],
    })));
    const parsed = await parseSnapshot(await fixtureSnapshot(host, 1, projects), host);
    assert.ok(parsed.ok);
    if (parsed.ok) catalog = reduceCatalog(catalog, { type: 'snapshot', snapshot: parsed.snapshot, at: isoFromMs(NOW - 3_600_000) }).state;
  }
  cache.documents.set(CATALOG_CACHE_KEY, serializeCatalogCache(catalog, isoFromMs(NOW)));
}

/** The only thing the port may hold: a read function. Writes are not representable, and any attempt would throw. */
const readOnly = (cache: MemoryCachePort) => ({ readDocument: (key: string) => cache.readDocument(key) });

describe('discovery cache -> projects read port', () => {
  it('projects a warm cache without any write, network, adapter or refresh', async () => {
    const cache = new MemoryCachePort();
    await seeded(cache);
    const port = createCachedCatalogReadPort({ cache: readOnly(cache), hostLabels: { [FAKE_HOSTS.laptop]: 'Laptop' }, dataTag: SYNTHETIC_TAG });
    assert.deepEqual(port.current(), [], 'nothing before load');
    const status = await port.load();
    assert.deepEqual([status.cache, status.entries, status.hosts, status.tag], ['warm', 4, 2, SYNTHETIC_TAG]);
    assert.equal(cache.writes, 0);
    assert.ok(port.current().length === 4);
  });

  it('shows cached fresh records as stale and keeps identity unchanged', async () => {
    const cache = new MemoryCachePort();
    await seeded(cache);
    const port = createCachedCatalogReadPort({ cache: readOnly(cache), hostLabels: { [FAKE_HOSTS.laptop]: 'Laptop' } });
    await port.load();
    for (const entry of port.current()) {
      assert.equal(entry.freshness.status, 'stale');
      assert.match(entry.sourceProjectId, /^[0-9a-f]{64}$/u);
      assert.equal(entry.freshness.generation, 1);
      assert.ok(entry.freshness.lastSuccessAt);
    }
    const labels = new Set(port.current().map((entry) => entry.hostLabel));
    assert.ok(labels.has('Laptop'));
    assert.ok([...labels].some((label) => label.startsWith('Host ')), 'unlabelled hosts show their opaque id, not an address');
  });

  it('never merges records that share a title across hosts', async () => {
    const cache = new MemoryCachePort();
    await seeded(cache);
    const port = createCachedCatalogReadPort({ cache: readOnly(cache) });
    await port.load();
    const shared = port.current().filter((entry) => entry.displayName === 'Shared title');
    assert.equal(shared.length, 2);
    assert.notEqual(shared[0]!.sourceProjectId, shared[1]!.sourceProjectId);
    assert.notEqual(shared[0]!.hostId, shared[1]!.hostId);
  });

  it('reports a cold, corrupt, future-schema or unreadable cache and shows nothing, writing nothing', async () => {
    const cold = new MemoryCachePort();
    assert.equal((await createCachedCatalogReadPort({ cache: readOnly(cold) }).load()).cache, 'cold');

    const corrupt = new MemoryCachePort();
    corrupt.documents.set(CATALOG_CACHE_KEY, '{not json');
    const corruptPort = createCachedCatalogReadPort({ cache: readOnly(corrupt) });
    assert.equal((await corruptPort.load()).cache, 'corrupt');

    const future = new MemoryCachePort();
    future.documents.set(CATALOG_CACHE_KEY, JSON.stringify({ schema: 'hq.design.discovery-cache/v9', sources: {}, records: {} }));
    assert.equal((await createCachedCatalogReadPort({ cache: readOnly(future) }).load()).cache, 'future-schema');

    const unreadable = createCachedCatalogReadPort({ cache: { readDocument: () => Promise.reject(new Error('disk')) } });
    assert.equal((await unreadable.load()).cache, 'unreadable');

    assert.deepEqual([cold.writes, corrupt.writes, future.writes], [0, 0, 0]);
    assert.equal(corrupt.documents.get(CATALOG_CACHE_KEY), '{not json', 'a corrupt cache is left for discovery to rebuild');
    assert.deepEqual(corruptPort.current(), []);
  });

  it('reloads only on request and notifies subscribers, so a later cache write shows without a refresh', async () => {
    const cache = new MemoryCachePort();
    await seeded(cache, [FAKE_HOSTS.laptop]);
    const port = createCachedCatalogReadPort({ cache: readOnly(cache) });
    let notified = 0;
    port.subscribe(() => { notified += 1; });
    await port.load();
    await port.load();
    assert.equal(notified, 1, 'load() is a no-op once loaded');
    await seeded(cache, [FAKE_HOSTS.laptop, FAKE_HOSTS.studio]);
    assert.equal(port.current().length, 2);
    await port.reload();
    assert.equal(port.current().length, 4);
    assert.equal(notified, 2);
  });

  it('satisfies the Projects section\'s CatalogReadPort so the catalog renders from cache', async () => {
    const cache = new MemoryCachePort();
    await seeded(cache);
    const port = createCachedCatalogReadPort({ cache: readOnly(cache), dataTag: CACHED_TAG });
    await port.load();
    const storage = createSpyStorage();
    const clock = createFakeClock();
    const ids = sequentialIds('t');
    const registry = createProvisionalLocalRegistry({ storage, clock, ids });
    const { controller, ready } = createProjectsSection({ registry, storage, thumbnails: createFakeThumbnailPort(), catalog: port, clock, ids });
    await ready;
    assert.equal(controller.getSnapshot().catalog.length, 4);
    assert.equal(storage.writes().length, 0, 'opening Projects over the cached catalog writes nothing');
  });
});
