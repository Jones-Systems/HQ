import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildGalleryItems, DEFAULT_GALLERY_FILTERS, queryGallery, type GalleryFilters, type GalleryItem } from '../src/gallery.ts';
import { layoutGrid, planThumbnails, visibleBlocks } from '../src/grid.ts';
import { createThumbnailLoader, LazyLoader, verifiedDataUrl, type LoadState } from '../src/loader.ts';
import { hostId, projectId, sourceProjectId } from '../src/ids.ts';
import type { ProjectSummary } from '../src/content.ts';
import { createFakeThumbnailPort, previewRefFor, syntheticCatalogEntry, syntheticPng } from '../fakes/index.ts';

const at = '2026-01-01T00:00:00.000Z';
const filters = (change: Partial<GalleryFilters> = {}): GalleryFilters => ({ ...DEFAULT_GALLERY_FILTERS, ...change });
const flat = (groups: ReturnType<typeof queryGallery>) => groups.flatMap((group) => group.items);

function fixture(): GalleryItem[] {
  const remote = 'github.com/example/checkout';
  return buildGalleryItems({
    projects: [
      { id: projectId('p-checkout'), name: 'Checkout', createdAt: at },
      { id: projectId('p-atlas'), name: 'Atlas', createdAt: at },
    ],
    summaries: new Map<ReturnType<typeof projectId>, ProjectSummary>(),
    catalog: [
      syntheticCatalogEntry(1, { displayName: 'Checkout', remote, status: 'fresh' }),
      syntheticCatalogEntry(2, { displayName: 'Checkout', remote, status: 'stale', host: 'fake-host-b', hostLabel: 'Synthetic host B' }),
      syntheticCatalogEntry(3, { displayName: 'Ledger', status: 'missing-at-source' }),
    ],
    links: new Map([[sourceProjectId('fake-source-1'), [projectId('p-checkout')]]]),
  });
}

describe('gallery model', () => {
  test('matching titles and remotes never merge workspace and source records', () => {
    const items = flat(queryGallery(fixture(), filters({ query: 'checkout', groupBy: 'none' }), new Set()));
    assert.equal(items.length, 3);
    assert.deepEqual(items.map((item) => item.key).sort(), ['source:fake-source-1', 'source:fake-source-2', 'workspace:p-checkout']);
    const linked = items.find((item) => item.key === 'source:fake-source-1');
    assert.deepEqual(linked?.kind === 'source' ? linked.linkedProjectIds : null, ['p-checkout'], 'only the explicit link is shown');
    const unlinked = items.find((item) => item.key === 'source:fake-source-2');
    assert.deepEqual(unlinked?.kind === 'source' ? unlinked.linkedProjectIds : null, []);
  });

  test('filters by origin, host and freshness; host/freshness filters exclude workspace projects', () => {
    const items = fixture();
    assert.equal(flat(queryGallery(items, filters({ origin: 'workspace' }), new Set())).length, 2);
    assert.equal(flat(queryGallery(items, filters({ origin: 'source' }), new Set())).length, 3);
    assert.deepEqual(flat(queryGallery(items, filters({ hosts: [hostId('fake-host-b')] }), new Set())).map((item) => item.key), ['source:fake-source-2']);
    assert.deepEqual(flat(queryGallery(items, filters({ freshness: ['missing-at-source'] }), new Set())).map((item) => item.title), ['Ledger']);
  });

  test('groups collapse and expand while reporting their hidden counts', () => {
    const groups = queryGallery(fixture(), filters({ groupBy: 'origin' }), new Set(['origin:source']));
    assert.deepEqual(groups.map((group) => [group.key, group.total, group.items.length, group.collapsed]),
      [['origin:workspace', 2, 2, false], ['origin:source', 3, 0, true]]);
    const byHost = queryGallery(fixture(), filters({ groupBy: 'host' }), new Set());
    assert.deepEqual(byHost.map((group) => group.label), ['This workspace', 'Synthetic host A', 'Synthetic host B']);
  });

  test('name sort is stable and deterministic', () => {
    const titles = flat(queryGallery(fixture(), filters({ groupBy: 'none' }), new Set())).map((item) => item.title);
    assert.deepEqual(titles, ['Atlas', 'Checkout', 'Checkout', 'Checkout', 'Ledger']);
  });
});

describe('virtual grid', () => {
  const groups = (count: number) => queryGallery(buildGalleryItems({
    projects: Array.from({ length: count }, (_, index) => ({ id: projectId(`p-${index}`), name: `P${String(index).padStart(4, '0')}`, createdAt: at })),
    summaries: new Map(), catalog: [], links: new Map(),
  }), filters({ groupBy: 'none' }), new Set());

  test('lays out columns from width and returns only intersecting blocks', () => {
    const layout = layoutGrid(groups(100), { width: 1000, minTileWidth: 220, tileHeight: 200, gap: 20, headerHeight: 40 });
    assert.equal(layout.columns, 4);
    const visible = visibleBlocks(layout, 0, 500);
    assert.equal(visible[0]?.type, 'header');
    assert.equal(visible.filter((block) => block.type === 'tile').length, 12, '3 rows × 4 columns intersect 0..500');
    const lower = visibleBlocks(layout, 2000, 500);
    assert.ok(lower.every((block) => block.y < 2500 && block.y + block.height > 2000));
  });

  test('collapsed groups contribute only their header', () => {
    const collapsed = queryGallery(buildGalleryItems({ projects: [{ id: projectId('p'), name: 'P', createdAt: at }], summaries: new Map(), catalog: [], links: new Map() }),
      filters({ groupBy: 'none' }), new Set(['all']));
    const layout = layoutGrid(collapsed, { width: 800, minTileWidth: 200, tileHeight: 200, gap: 10, headerHeight: 40 });
    assert.deepEqual(layout.blocks.map((block) => block.type), ['header']);
    assert.equal(layout.totalHeight, 40);
  });

  test('thumbnail plan requests visible tiles then a bounded, deduplicated prefetch window', async () => {
    const shared = await previewRefFor(syntheticPng(1));
    const unique = await Promise.all(Array.from({ length: 60 }, (_, index) => previewRefFor(syntheticPng(index + 2))));
    const items = buildGalleryItems({
      projects: [], summaries: new Map(), links: new Map(),
      catalog: unique.map((ref, index) => syntheticCatalogEntry(index, { displayName: `S${String(index).padStart(3, '0')}`, preview: index % 5 === 0 ? shared : ref })),
    });
    const layout = layoutGrid(queryGallery(items, filters({ groupBy: 'none' }), new Set()), { width: 1000, minTileWidth: 220, tileHeight: 200, gap: 20, headerHeight: 40 });
    const plan = planThumbnails(layout, 0, 500, { prefetchRows: 2, maxPrefetch: 5 });
    assert.ok(plan.visible.length <= 12);
    assert.equal(new Set(plan.visible.map((ref) => ref.digest)).size, plan.visible.length, 'visible digests are deduplicated');
    assert.ok(plan.prefetch.length <= 5);
    assert.ok(plan.prefetch.every((ref) => !plan.visible.some((other) => other.digest === ref.digest)));
  });
});

describe('lazy loader', () => {
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  test('duplicate digests fetch once and abort only after every subscriber cancels', async () => {
    const port = createFakeThumbnailPort();
    port.mode = 'manual';
    const bytes = syntheticPng(9);
    const ref = await previewRefFor(bytes);
    port.add(ref, bytes);
    const loader = createThumbnailLoader(port, { concurrency: 2, retain: 10, maxBytesPerItem: 1 << 20 });
    const first = loader.subscribe(ref, 'visible', () => {});
    const second = loader.subscribe(ref, 'prefetch', () => {});
    assert.equal(port.requested.length, 1);
    first();
    assert.equal(port.aborted.length, 0, 'one subscriber remains');
    second();
    await tick();
    assert.deepEqual(port.aborted, [ref.digest]);
  });

  test('visible requests run before prefetch and concurrency is bounded', async () => {
    const order: string[] = [];
    const resolvers: Array<() => void> = [];
    const loader = new LazyLoader<string>({ concurrency: 1, retain: 0 });
    const load = (key: string) => () => new Promise<string>((resolve) => { order.push(key); resolvers.push(() => resolve(key)); });
    loader.subscribe({ key: 'running', priority: 'prefetch', load: load('running') }, () => {});
    loader.subscribe({ key: 'later-prefetch', priority: 'prefetch', load: load('later-prefetch') }, () => {});
    loader.subscribe({ key: 'visible', priority: 'visible', load: load('visible') }, () => {});
    assert.equal(loader.stats().running, 1);
    resolvers.shift()!();
    await tick();
    resolvers.shift()!();
    await tick();
    assert.deepEqual(order, ['running', 'visible', 'later-prefetch']);
  });

  test('oversized or unsupported previews fail without a transport call; mismatched bytes are rejected', async () => {
    const port = createFakeThumbnailPort();
    const loader = createThumbnailLoader(port, { concurrency: 2, retain: 10, maxBytesPerItem: 100 });
    const big = await previewRefFor(syntheticPng(1, 64, 64));
    const states: LoadState<string>[] = [];
    loader.subscribe(big, 'visible', (state) => states.push(state));
    loader.subscribe({ ...big, digest: `sha256:${'0'.repeat(64)}`, mediaType: 'image/svg+xml', bytes: 10 }, 'visible', (state) => states.push(state));
    assert.equal(port.requested.length, 0);
    assert.deepEqual(states.map((state) => state.status), ['error', 'error']);
    const bytes = syntheticPng(2);
    const ref = await previewRefFor(bytes);
    await assert.rejects(verifiedDataUrl(ref, { mediaType: 'image/png', bytes: syntheticPng(3) }, 1 << 20), /size|digest/u);
    assert.match(await verifiedDataUrl(ref, { mediaType: 'image/png', bytes }, 1 << 20), /^data:image\/png;base64,/u);
  });

  test('a late result after cancellation is discarded', async () => {
    let resolve: (value: string) => void = () => {};
    const loader = new LazyLoader<string>({ concurrency: 1, retain: 5 });
    const seen: LoadState<string>[] = [];
    const release = loader.subscribe({ key: 'k', priority: 'visible', load: () => new Promise((done) => { resolve = done; }) }, (state) => seen.push(state));
    release();
    resolve('late');
    await tick();
    assert.equal(seen.length, 0);
    assert.equal(loader.peek('k'), undefined);
    assert.equal(loader.stats().aborted, 1);
  });
});
