/**
 * Rendered checks with the real React 19 renderer (react-dom/server static markup). This proves the
 * rendered DOM structure and first-paint behaviour, not browser layout, scrolling or Electron capture.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isoFromMs, type HostId, type SourceEnrollment } from '../src/contract.ts';
import { EMPTY_CATALOG, parseSnapshot, reduceCatalog } from '../src/catalog.ts';
import { CATALOG_CACHE_KEY, serializeCatalogCache } from '../src/cache.ts';
import { DiscoveryService } from '../src/discovery.ts';
import { DiscoveryCatalog } from '../src/CatalogView.ts';
import { buildCatalogView } from '../src/view-model.ts';
import { FAKE_HOSTS, FakeClock, FakeSourceAdapter, fixturePreview, fixtureSnapshot, MemoryCachePort } from '../src/fakes.ts';

const { laptop: A, studio: B } = FAKE_HOSTS;
const NOW = Date.UTC(2026, 9, 20, 12);
const enroll = (host: HostId, label: string): SourceEnrollment => ({ hostId: host, label, adapterKey: 'fake', enrolledAt: isoFromMs(NOW) });
const labels = { fake: { label: 'Synthetic fake source', fake: true } };

async function seed(cache: MemoryCachePort, perHost: number) {
  let catalog = EMPTY_CATALOG;
  for (const host of [A, B]) {
    const projects = await Promise.all(Array.from({ length: perHost }, async (_, index) => ({
      path: `p${String(index).padStart(3, '0')}`, name: index === 0 ? 'Shared title' : `Project ${host.slice(5, 9)} ${String(index).padStart(3, '0')}`,
      previews: [(await fixturePreview(`${host}-${index}`)).ref],
    })));
    const parsed = await parseSnapshot(await fixtureSnapshot(host, 1, projects), host);
    assert.ok(parsed.ok);
    catalog = reduceCatalog(catalog, { type: 'snapshot', snapshot: parsed.snapshot, at: isoFromMs(NOW - 60 * 60_000) }).state;
  }
  cache.documents.set(CATALOG_CACHE_KEY, serializeCatalogCache(catalog, isoFromMs(NOW)));
}

test('warm cache first paint renders source rows with host and freshness badges while sources hang', async () => {
  const cache = new MemoryCachePort();
  await seed(cache, 3);
  const adapter = new FakeSourceAdapter().on(A, { kind: 'hang', honourAbort: false }).on(B, { kind: 'hang', honourAbort: false });
  const service = new DiscoveryService({ adapters: { fake: adapter }, enrollments: [enroll(A, 'Laptop'), enroll(B, 'Studio')], cache, clock: new FakeClock(NOW), refreshOnOpen: false });
  await service.open();
  const html = renderToStaticMarkup(createElement(DiscoveryCatalog, { service, now: () => NOW, adapterLabels: labels, onRequestLink: () => undefined }));
  assert.equal((html.match(/class="discovery-row"/gu) ?? []).length, 6);
  assert.match(html, /Showing cached catalog/u);
  assert.equal((html.match(/<strong>Shared title<\/strong>/gu) ?? []).length, 2, 'same title on two hosts renders as two rows');
  assert.match(html, /Same name elsewhere/u);
  assert.match(html, />Laptop</u);
  assert.match(html, />Studio</u);
  assert.match(html, />Fake source</u);
  assert.match(html, />Cached</u);
  assert.match(html, /read-only source project/u);
  assert.match(html, /Link to project…/u);
  assert.equal(adapter.listCalls.length, 0, 'render made no source request');
  assert.equal(adapter.previewCalls.length, 0, 'previews are lazy: nothing fetched during first paint');
  service.dispose();
});

test('500 cached entries render only the visible window plus bounded prefetch rows', async () => {
  const cache = new MemoryCachePort();
  await seed(cache, 250);
  const service = new DiscoveryService({ adapters: { fake: new FakeSourceAdapter() }, enrollments: [enroll(A, 'Laptop'), enroll(B, 'Studio')], cache, clock: new FakeClock(NOW), refreshOnOpen: false });
  await service.open();
  assert.equal(Object.keys(service.getState().catalog.records).length, 500);
  const html = renderToStaticMarkup(createElement(DiscoveryCatalog, { service, now: () => NOW, rowHeight: 50, viewportHeight: 1150, prefetchRows: 6 }));
  const rows = (html.match(/class="discovery-row"/gu) ?? []).length;
  assert.equal(rows, 24 + 6, '24 visible (incl. one partial) + 6 prefetch');
  assert.match(html, /height:25000px/u, 'full scroll extent is preserved without mounting every row');
  service.dispose();
});

test('view model shows per-source errors, conflicts and stale aging without hiding cached rows', async () => {
  const cache = new MemoryCachePort();
  await seed(cache, 1);
  const service = new DiscoveryService({ adapters: { fake: new FakeSourceAdapter().on(B, { kind: 'offline' }) }, enrollments: [enroll(A, 'Laptop'), enroll(B, 'Studio')], cache, clock: new FakeClock(NOW), refreshOnOpen: false });
  await service.open();
  await service.refresh();
  const view = buildCatalogView(service.getState(), { now: NOW, adapterLabels: labels });
  assert.equal(view.rows.length, 2);
  const studio = view.sources.find((source) => source.hostId === B)!;
  assert.equal(studio.statusLabel, 'Offline');
  assert.equal(studio.error, 'Fake source is offline');
  assert.equal(view.rows.find((row) => row.hostId === B)!.status, 'offline');
  assert.equal(view.rows.find((row) => row.hostId === B)!.updatedLabel, 'updated 1 h ago');
  const html = renderToStaticMarkup(createElement(DiscoveryCatalog, { service, now: () => NOW, adapterLabels: labels }));
  assert.match(html, /Fake source is offline/u);
  assert.match(html, /data-status="offline"/u);
  const empty = buildCatalogView({ ...service.getState(), enrollments: [] }, { now: NOW });
  assert.equal(empty.emptyLabel, 'No sources are enrolled. Enroll a source to see its projects.');
  service.dispose();
});
