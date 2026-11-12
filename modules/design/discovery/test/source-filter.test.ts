import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoFromMs, type HostId, type SourceEnrollment } from '../src/contract.ts';
import { EMPTY_CATALOG, parseSnapshot, reduceCatalog } from '../src/catalog.ts';
import { CATALOG_CACHE_KEY, serializeCatalogCache } from '../src/cache.ts';
import { DiscoveryService } from '../src/discovery.ts';
import { buildCatalogView, statusTone } from '../src/view-model.ts';
import { FAKE_HOSTS, FakeClock, FakeSourceAdapter, fixturePreview, fixtureSnapshot, MemoryCachePort } from '../src/fakes.ts';

const { laptop: A, studio: B } = FAKE_HOSTS;
const NOW = Date.UTC(2026, 9, 20, 12);
const enroll = (host: HostId, label: string): SourceEnrollment => ({ hostId: host, label, adapterKey: 'fake', enrolledAt: isoFromMs(NOW) });
const labels = { fake: { label: 'Synthetic fake source', fake: true } };

async function opened(counts: { readonly [host: string]: number }, adapter: FakeSourceAdapter = new FakeSourceAdapter()) {
  const cache = new MemoryCachePort();
  let catalog = EMPTY_CATALOG;
  for (const host of [A, B]) {
    const projects = await Promise.all(Array.from({ length: counts[host] ?? 0 }, async (_, index) => ({
      path: `p${index}`, name: index === 0 ? 'Shared title' : `${host === A ? 'Laptop' : 'Studio'} ${index}`, previews: [(await fixturePreview(`${host}-${index}`)).ref],
    })));
    const parsed = await parseSnapshot(await fixtureSnapshot(host, 1, projects), host);
    assert.ok(parsed.ok);
    catalog = reduceCatalog(catalog, { type: 'snapshot', snapshot: parsed.snapshot, at: isoFromMs(NOW - 60 * 60_000) }).state;
  }
  cache.documents.set(CATALOG_CACHE_KEY, serializeCatalogCache(catalog, isoFromMs(NOW)));
  const service = new DiscoveryService({ adapters: { fake: adapter }, enrollments: [enroll(A, 'Laptop'), enroll(B, 'Studio')], cache, clock: new FakeClock(NOW), refreshOnOpen: false });
  await service.open();
  return service;
}

test('a source filter keeps one host\'s projects and the strip still lists every source', async () => {
  const service = await opened({ [A]: 3, [B]: 2 });
  const state = service.getState();
  const all = buildCatalogView(state, { now: NOW, adapterLabels: labels });
  assert.equal(all.rows.length, 5);
  assert.equal(all.totalCount, 5);
  assert.equal(all.countLabel, '5 source projects');

  const studio = buildCatalogView(state, { now: NOW, adapterLabels: labels, hostFilter: B });
  assert.deepEqual([...new Set(studio.rows.map((row) => row.hostId))], [B]);
  assert.equal(studio.rows.length, 2);
  assert.equal(studio.totalCount, 5, 'the total ignores the host filter');
  assert.equal(studio.countLabel, '2 of 5 source projects');
  assert.deepEqual(studio.sources.map((source) => [source.hostId, source.projectCount]), [[A, 3], [B, 2]], 'both chips stay, each with its own count');

  const laptop = buildCatalogView(state, { now: NOW, adapterLabels: labels, hostFilter: A });
  assert.deepEqual(laptop.rows.map((row) => row.hostId), [A, A, A]);
  assert.equal(laptop.countLabel, '3 of 5 source projects');
  assert.equal(buildCatalogView(state, { now: NOW, hostFilter: null }).rows.length, 5, 'null clears the filter');
  service.dispose();
});

test('the same title on another source is still flagged while one source is filtered', async () => {
  const service = await opened({ [A]: 2, [B]: 2 });
  const view = buildCatalogView(service.getState(), { now: NOW, hostFilter: B });
  const shared = view.rows.find((row) => row.displayName === 'Shared title')!;
  assert.equal(shared.hostId, B);
  assert.equal(shared.sameTitleCount, 1, 'the Laptop project of that name is not merged, and not forgotten');
  service.dispose();
});

test('search and source filter combine, and the counts follow both', async () => {
  const service = await opened({ [A]: 4, [B]: 3 });
  const state = service.getState();
  const search = buildCatalogView(state, { now: NOW, query: 'studio' });
  assert.equal(search.rows.length, 2);
  assert.equal(search.totalCount, 2);
  assert.equal(search.countLabel, '2 of 2 source projects');
  const both = buildCatalogView(state, { now: NOW, query: 'shared', hostFilter: A });
  assert.deepEqual(both.rows.map((row) => row.displayName), ['Shared title']);
  assert.equal(both.countLabel, '1 of 2 source projects', 'two hosts have a project of that name; one is shown');
  assert.deepEqual(both.sources.map((source) => source.projectCount), [1, 1], 'chip counts follow the search, not the filter');
  assert.equal(buildCatalogView(state, { now: NOW, query: '  SHARED ' }).rows.length, 2, 'search ignores case and surrounding space');
  service.dispose();
});

test('empty results say why: no match, no projects from that source, or no sources', async () => {
  const service = await opened({ [A]: 2, [B]: 0 });
  const state = service.getState();
  assert.equal(buildCatalogView(state, { now: NOW, query: 'zzz' }).emptyLabel, 'No source projects match this search.');
  const quiet = buildCatalogView(state, { now: NOW, hostFilter: B });
  assert.equal(quiet.rows.length, 0);
  assert.equal(quiet.emptyLabel, 'No source projects from Studio yet.');
  assert.equal(quiet.countLabel, '0 of 2 source projects');
  assert.equal(buildCatalogView({ ...state, enrollments: [] }, { now: NOW }).emptyLabel, 'No sources are enrolled. Enroll a source to see its projects.');
  assert.equal(buildCatalogView(state, { now: NOW }).emptyLabel, null, 'a populated catalog has no empty label');
  service.dispose();
});

test('the header stops calling the catalog "cached" once every source has confirmed it', async () => {
  const one = [{ path: 'p0', name: 'Shared title' }];
  const adapter = new FakeSourceAdapter()
    .on(A, { kind: 'snapshot', snapshot: await fixtureSnapshot(A, 2, one, { observedAtMs: NOW }) }, { kind: 'offline' })
    .on(B, { kind: 'snapshot', snapshot: await fixtureSnapshot(B, 2, one, { observedAtMs: NOW }) }, { kind: 'offline' });
  const service = await opened({ [A]: 1, [B]: 1 }, adapter);
  assert.equal(buildCatalogView(service.getState(), { now: NOW }).cacheLabel, 'Showing cached catalog');
  await service.refresh();
  assert.equal(buildCatalogView(service.getState(), { now: NOW }).cacheLabel, 'Catalog is up to date');
  await service.refresh();
  assert.equal(buildCatalogView(service.getState(), { now: NOW }).cacheLabel, 'Showing cached catalog', 'a source that fails again takes it back');
  service.dispose();
});

test('every status gets a tone, so a shape and a word are always shown', () => {
  assert.equal(statusTone('fresh'), 'success');
  assert.equal(statusTone('stale'), 'neutral', 'cached data is calm, not a warning');
  for (const status of ['partial', 'offline', 'timeout'] as const) assert.equal(statusTone(status), 'warning', status);
  for (const status of ['error', 'missing-at-source'] as const) assert.equal(statusTone(status), 'danger', status);
  for (const status of ['never', 'refreshing'] as const) assert.equal(statusTone(status), 'neutral', status);
});
