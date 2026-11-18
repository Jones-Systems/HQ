/**
 * Rendered checks for the card grid, source strip, notices and Explore deck, with the real React 19 renderer
 * (react-dom/server static markup). They prove the first-paint DOM and its accessibility hooks, not browser layout,
 * pointer gestures or motion; those are exercised in the browser walk.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { isoFromMs, type HostId, type SourceEnrollment } from '../src/contract.ts';
import { EMPTY_CATALOG, parseSnapshot, reduceCatalog } from '../src/catalog.ts';
import { CATALOG_CACHE_KEY, serializeCatalogCache } from '../src/cache.ts';
import { DiscoveryService } from '../src/discovery.ts';
import { DiscoveryCatalog, PLAIN_KIT, type DiscoveryCatalogProps } from '../src/CatalogView.ts';
import { FAKE_HOSTS, FakeClock, FakeSourceAdapter, fixturePreview, fixtureSnapshot, MemoryCachePort, type FixtureProject } from '../src/fakes.ts';

const { laptop: A, studio: B } = FAKE_HOSTS;
const NOW = Date.UTC(2026, 9, 20, 12);
const enroll = (host: HostId, label: string, fingerprint?: string): SourceEnrollment => ({
  hostId: host, label, adapterKey: 'fake', enrolledAt: isoFromMs(NOW), ...(fingerprint ? { fingerprint } : {}),
});
const labels = { fake: { label: 'Synthetic fake source', fake: true } };

type Preview = 'png' | 'svg' | 'none';
async function seed(cache: MemoryCachePort, perHost: number, previewFor: (index: number) => Preview = () => 'png') {
  let catalog = EMPTY_CATALOG;
  for (const host of [A, B]) {
    const projects: FixtureProject[] = await Promise.all(Array.from({ length: perHost }, async (_, index) => {
      const kind = previewFor(index);
      return {
        path: `p${String(index).padStart(3, '0')}`, name: `${host === A ? 'Harbour' : 'Atlas'} ${String(index).padStart(3, '0')}`,
        previews: kind === 'none' ? [] : [(await fixturePreview(`${host}-${index}`, kind === 'svg' ? 'image/svg+xml' : 'image/png')).ref],
      };
    }));
    const parsed = await parseSnapshot(await fixtureSnapshot(host, 1, projects), host);
    assert.ok(parsed.ok);
    catalog = reduceCatalog(catalog, { type: 'snapshot', snapshot: parsed.snapshot, at: isoFromMs(NOW - 60 * 60_000) }).state;
  }
  cache.documents.set(CATALOG_CACHE_KEY, serializeCatalogCache(catalog, isoFromMs(NOW)));
}

async function open(perHost: number, options: { adapter?: FakeSourceAdapter; previewFor?: (index: number) => Preview; fingerprint?: string } = {}) {
  const cache = new MemoryCachePort();
  await seed(cache, perHost, options.previewFor);
  const service = new DiscoveryService({
    adapters: { fake: options.adapter ?? new FakeSourceAdapter() }, enrollments: [enroll(A, 'Laptop', options.fingerprint), enroll(B, 'Studio')],
    cache, clock: new FakeClock(NOW), refreshOnOpen: false,
  });
  await service.open();
  return service;
}

const render = (service: DiscoveryService, props: Partial<DiscoveryCatalogProps> = {}) =>
  renderToStaticMarkup(createElement(DiscoveryCatalog, { service, now: () => NOW, adapterLabels: labels, ...props }));
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

test('there is no dead "Link to project…" control: it appears only when the host supplies a handler', async () => {
  const service = await open(2);
  const without = render(service);
  assert.doesNotMatch(without, /Link to project/u, 'no handler, no button');
  assert.doesNotMatch(without, /Save for Taste/u, 'no Taste handler, no save button');

  const linking = render(service, { onRequestLink: () => undefined });
  assert.equal(count(linking, /aria-label="Link to project…"/gu), 4, 'one per card when a handler exists');
  service.dispose();
});

test('with a Taste handler every card offers a labelled Save for Taste button', async () => {
  const service = await open(2);
  const html = render(service, { onSendToTaste: () => undefined });
  assert.equal(count(html, /<button[^>]*aria-label="Save for Taste"/gu), 4);
  assert.doesNotMatch(html, /Link to project/u);
  service.dispose();
});

test('cards are a labelled roving-tabindex list: one tab stop, position and size announced', async () => {
  const service = await open(3);
  const html = render(service, { onSendToTaste: () => undefined });
  assert.equal(count(html, /<li [^>]*class="discovery-row"[^>]*tabindex="0"/gu), 1, 'exactly one card is in the tab order');
  assert.equal(count(html, /<li [^>]*class="discovery-row"[^>]*tabindex="-1"/gu), 5);
  assert.equal(count(html, /<button[^>]*class="discovery-quick-button[^"]*"[^>]*tabindex="-1"/gu), 5, 'inner buttons are tabbable only on the active card');
  assert.match(html, /aria-posinset="1"[^>]*aria-setsize="6"/u);
  assert.match(html, /aria-posinset="6"[^>]*aria-setsize="6"/u);
  assert.match(html, /role="region"[^>]*aria-label="Source project list"/u);
  service.dispose();
});

test('an explicit column count and row height set the grid and the scroll extent', async () => {
  const service = await open(250);
  const html = render(service, { columns: 3, rowHeight: 50, viewportHeight: 1150, prefetchRows: 6 });
  // ceil(1150 / 50) + 1 = 24 visible rows and 6 prefetch rows, three cards each.
  assert.equal(count(html, /class="discovery-row"/gu), (24 + 6) * 3);
  assert.match(html, /height:8350px/u, '500 cards in 167 rows of 50px');
  assert.match(html, /grid-template-columns:repeat\(3, ?minmax\(0, ?1fr\)\)/u);
  assert.match(html, /aria-setsize="500"/u);
  assert.equal(count(html, /data-index="/gu), 90);
  assert.match(html, /data-index="89"/u);
  assert.doesNotMatch(html, /data-index="90"/u);
  service.dispose();
});

test('an unmeasured grid renders one column and a bounded window', async () => {
  const service = await open(250);
  const html = render(service);
  assert.match(html, /grid-template-columns:repeat\(1, ?minmax\(0, ?1fr\)\)/u);
  assert.ok(count(html, /class="discovery-row"/gu) < 40, 'never the whole catalog');
  service.dispose();
});

test('each preview well says what it is: loading, no preview, or unsupported type', async () => {
  const service = await open(3, { previewFor: (index) => (['png', 'svg', 'none'] as const)[index]! });
  const html = render(service);
  assert.equal(count(html, /data-preview="pending"/gu), 2, 'png previews wait on a skeleton');
  assert.equal(count(html, /hq-skeleton--block/gu), 2);
  assert.equal(count(html, /data-preview="unsupported"/gu), 2, 'svg is never loaded or shown');
  assert.equal(count(html, /data-preview="none"/gu), 2);
  assert.equal(count(html, /<img /gu), 0, 'no image is mounted before its bytes have loaded');
  assert.equal(count(html, /No preview/gu), 4, 'unsupported and missing previews share one calm label');
  assert.doesNotMatch(html, /blob:/u);
  service.dispose();
});

test('previews of unsupported types are never requested from the source', async () => {
  const adapter = new FakeSourceAdapter();
  const service = await open(3, { adapter, previewFor: () => 'svg' });
  render(service);
  assert.equal(adapter.previewCalls.length, 0);
  service.dispose();
});

test('a kit from the host replaces the plain stand-ins', async () => {
  const service = await open(1);
  const kit = { ...PLAIN_KIT, Skeleton: () => createElement('i', { 'data-custom-skeleton': '' }) };
  const html = render(service, { kit });
  assert.equal(count(html, /data-custom-skeleton/gu), 2);
  assert.doesNotMatch(html, /hq-skeleton/u);
  service.dispose();
});

test('the source strip is a row of toggle buttons with a status shape, a word and a count', async () => {
  const service = await open(3);
  const html = render(service);
  assert.equal(count(html, /<button[^>]*class="discovery-source[^"]*"[^>]*aria-pressed="false"/gu), 2);
  assert.match(html, /aria-pressed="true"[^>]*>Grid</u, 'the Grid view is the one pressed');
  assert.match(html, /aria-pressed="false"[^>]*>Explore</u);
  assert.match(html, /class="discovery-source-count"[^>]*>3</u);
  assert.match(html, /hq-status-shape/u);
  assert.match(html, /<b class="hq-status-label">Cached</u);
  assert.match(html, /6 source projects/u, 'the result count');
  service.dispose();
});

test('a changed host identity stays a prominent alert with the existing wording', async () => {
  const adapter = new FakeSourceAdapter().on(A,
    { kind: 'snapshot', snapshot: await fixtureSnapshot(A, 2, [{ path: 'one', name: 'One' }], { fingerprint: 'fp-new' }) });
  const service = await open(2, { adapter, fingerprint: 'fp-old' });
  await service.refresh();
  const html = render(service);
  assert.match(html, /<div[^>]*role="alert"[^>]*>.*Host identity changed — re-verify before trusting new data\./u);
  assert.equal(count(html, /role="alert"/gu), 1, 'one alert; the offline Studio is a quiet bar notice');
  assert.equal(count(html, /class="discovery-row"/gu), 4, 'the cached catalog is still on show');
  service.dispose();
});

test('a failed source puts a bar notice with Retry on that source while its cached cards stay readable', async () => {
  // A host with no queued behaviour is offline in the fake, so the Laptop gets a snapshot of its own.
  const laptop = await fixtureSnapshot(A, 2, [{ path: 'p000', name: 'Harbour 000' }, { path: 'p001', name: 'Harbour 001' }]);
  const service = await open(2, { adapter: new FakeSourceAdapter().on(A, { kind: 'snapshot', snapshot: laptop }).on(B, { kind: 'offline' }) });
  await service.refresh();
  const html = render(service);
  assert.match(html, /hq-notice-title">Studio · offline</u);
  assert.match(html, /Fake source is offline\. Showing the saved catalog\./u);
  assert.match(html, /hq-notice--bar/u);
  assert.doesNotMatch(html, /role="alert"/u, 'an offline source is not an assertive alert');
  assert.match(html, /<button[^>]*>Retry<\/button>/u);
  assert.equal(count(html, /class="discovery-row"/gu), 4);
  assert.equal(count(html, /data-status="offline"/gu), 3, 'the Studio chip and its two cards');
  service.dispose();
});

test('Explore opens on one large card with the next peeking, a progress count and the three actions', async () => {
  const service = await open(3);
  const html = render(service, { defaultMode: 'explore', onSendToTaste: () => undefined });
  assert.match(html, /data-mode="explore"/u);
  assert.match(html, /aria-pressed="true"[^>]*>Explore</u);
  assert.equal(count(html, /data-slot="top"/gu), 1);
  assert.equal(count(html, /data-slot="next"/gu), 1);
  assert.match(html, /<article[^>]*data-slot="next"[^>]*inert/u, 'the peeking card is inert');
  assert.match(html, /class="discovery-deck-count">1 of 6</u);
  assert.match(html, /role="progressbar"[^>]*aria-valuemax="6"[^>]*aria-valuenow="0"/u);
  assert.match(html, /role="group"[^>]*aria-roledescription="deck"[^>]*aria-label="Explore deck, card 1 of 6\./u);
  assert.match(html, />Skip<kbd>←<\/kbd>/u);
  assert.match(html, />Details<kbd>Enter<\/kbd>/u);
  assert.match(html, />Save for Taste<kbd>→<\/kbd>/u);
  assert.match(html, /role="status"[^>]*aria-live="polite"/u, 'decisions are announced');
  assert.equal(count(html, /class="discovery-row"/gu), 0, 'the grid is not mounted behind the deck');
  service.dispose();
});

test('without a Taste handler the deck offers Keep, not a Save that goes nowhere', async () => {
  const service = await open(3);
  const html = render(service, { defaultMode: 'explore' });
  assert.match(html, />Keep<kbd>→<\/kbd>/u);
  assert.doesNotMatch(html, /Save for Taste/u);
  service.dispose();
});

test('the last card has nothing peeking behind it, and an empty list shows no deck', async () => {
  const solo = await open(0);
  const none = render(solo, { defaultMode: 'explore' });
  assert.doesNotMatch(none, /data-slot=/u);
  solo.dispose();
  const cache = new MemoryCachePort();
  const one = new DiscoveryService({ adapters: { fake: new FakeSourceAdapter() }, enrollments: [enroll(A, 'Laptop')], cache, clock: new FakeClock(NOW), refreshOnOpen: false });
  await one.open();
  assert.doesNotMatch(render(one, { defaultMode: 'explore' }), /data-slot=/u);
  one.dispose();
});
