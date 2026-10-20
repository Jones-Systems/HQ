import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PreviewCache } from '../src/cache.ts';
import { PreviewError, PreviewLoader, planPreviewWindow } from '../src/previews.ts';
import { FAKE_HOSTS, FakeSourceAdapter, fixturePreview, MemoryCachePort } from '../src/fakes.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle(rounds = 5) { for (let i = 0; i < rounds; i += 1) await tick(); }

test('concurrent requests for the same digest coalesce into one transport call', async () => {
  const adapter = new FakeSourceAdapter();
  const preview = await fixturePreview('shared');
  adapter.previews.set(preview.ref.digest, preview.bytes);
  adapter.holdPreviews = true;
  const loader = new PreviewLoader({ adapterFor: () => adapter });
  const requests = [loader.load(FAKE_HOSTS.laptop, preview.ref), loader.load(FAKE_HOSTS.studio, preview.ref), loader.load(FAKE_HOSTS.laptop, preview.ref, { priority: 'prefetch' })];
  await settle();
  adapter.releasePreview(preview.ref.digest);
  const results = await Promise.all(requests);
  assert.equal(adapter.previewCalls.length, 1);
  for (const bytes of results) assert.deepEqual(bytes, preview.bytes);
});

test('one subscriber cancelling keeps the shared fetch; the last cancellation aborts transport', async () => {
  const adapter = new FakeSourceAdapter();
  const preview = await fixturePreview('cancel');
  adapter.previews.set(preview.ref.digest, preview.bytes);
  adapter.holdPreviews = true;
  const loader = new PreviewLoader({ adapterFor: () => adapter });
  const first = new AbortController();
  const second = new AbortController();
  const a = loader.load(FAKE_HOSTS.laptop, preview.ref, { signal: first.signal });
  const b = loader.load(FAKE_HOSTS.laptop, preview.ref, { signal: second.signal });
  await settle();
  first.abort();
  await assert.rejects(a, (error: unknown) => error instanceof PreviewError && error.reason === 'aborted');
  assert.deepEqual(adapter.aborted, [], 'transport continues for the remaining subscriber');
  second.abort();
  await assert.rejects(b, (error: unknown) => error instanceof PreviewError && error.reason === 'aborted');
  assert.deepEqual(adapter.aborted, [`preview:${preview.ref.digest}`]);
  assert.equal(loader.stats.active, 0, 'the abandoned slot is released');
  // A fresh request after abandonment starts a new transport rather than joining the aborted one.
  adapter.holdPreviews = false;
  assert.deepEqual(await loader.load(FAKE_HOSTS.laptop, preview.ref), preview.bytes);
  assert.equal(adapter.previewCalls.length, 2);
});

test('global and per-host concurrency are bounded and visible tiles go first', async () => {
  const adapter = new FakeSourceAdapter();
  adapter.holdPreviews = true;
  const loader = new PreviewLoader({ adapterFor: () => adapter, limits: { globalConcurrency: 3, perHostConcurrency: 2 } });
  const previews = await Promise.all(Array.from({ length: 12 }, (_, index) => fixturePreview(`tile-${index}`)));
  for (const item of previews) adapter.previews.set(item.ref.digest, item.bytes);
  const hosts = [FAKE_HOSTS.laptop, FAKE_HOSTS.studio];
  const pending: Promise<Uint8Array>[] = [];
  // Prefetch requests arrive first, visible ones later; visible must still start first once slots free.
  previews.slice(0, 6).forEach((item, index) => pending.push(loader.load(hosts[index % 2]!, item.ref, { priority: 'prefetch' })));
  await settle();
  const startedBeforeVisible = adapter.previewCalls.length;
  previews.slice(6).forEach((item, index) => pending.push(loader.load(hosts[index % 2]!, item.ref, { priority: 'visible' })));
  await settle();
  assert.equal(startedBeforeVisible, 3);
  assert.equal(loader.stats.active, 3);
  while (adapter.pendingPreviews.size > 0) {
    const [digest] = adapter.pendingPreviews.keys();
    adapter.releasePreview(digest!);
    await settle();
  }
  await Promise.all(pending);
  assert.ok(loader.stats.peakActive <= 3);
  assert.ok(loader.stats.peakPerHost <= 2);
  const visibleDigests = new Set(previews.slice(6).map((item) => item.ref.digest));
  const order = adapter.previewCalls.slice(3);
  const firstPrefetchAfter = order.findIndex((digest) => !visibleDigests.has(digest));
  const lastVisible = order.map((digest) => visibleDigests.has(digest)).lastIndexOf(true);
  assert.ok(firstPrefetchAfter === -1 || lastVisible < firstPrefetchAfter, `visible-first order violated: ${order.join(',')}`);
});

test('oversized and mismatched previews are rejected; cached previews are not refetched', async () => {
  const adapter = new FakeSourceAdapter();
  const good = await fixturePreview('good');
  const bad = await fixturePreview('bad');
  adapter.previews.set(good.ref.digest, good.bytes);
  adapter.previews.set(bad.ref.digest, good.bytes.slice(0, bad.bytes.byteLength));
  const cache = new PreviewCache(new MemoryCachePort(), { budgetBytes: 1 << 20, maxItemBytes: 1 << 16 });
  const loader = new PreviewLoader({ adapterFor: () => adapter, cache, limits: { maxItemBytes: 1 << 16 } });
  await assert.rejects(loader.load(FAKE_HOSTS.laptop, { ...good.ref, bytes: (1 << 16) + 1 }), (error: unknown) => error instanceof PreviewError && error.reason === 'too-large');
  assert.equal(adapter.previewCalls.length, 0, 'size bound is checked before any transport');
  await assert.rejects(loader.load(FAKE_HOSTS.laptop, bad.ref), (error: unknown) => error instanceof PreviewError && (error.reason === 'digest-mismatch' || error.reason === 'too-large'));
  assert.equal(cache.has(bad.ref.digest), false);
  await loader.load(FAKE_HOSTS.laptop, good.ref);
  await loader.load(FAKE_HOSTS.laptop, good.ref);
  assert.equal(adapter.previewCalls.filter((digest) => digest === good.ref.digest).length, 1);
});

test('500 entries with 24 visible plan only the visible tiles plus a bounded prefetch window', () => {
  const plan = planPreviewWindow(500, 100, 24, 6);
  assert.equal(plan.visible.length, 24);
  assert.equal(plan.prefetch.length, 6);
  assert.deepEqual([plan.visible[0], plan.visible.at(-1), plan.prefetch[0], plan.prefetch.at(-1)], [100, 123, 124, 129]);
  assert.deepEqual(planPreviewWindow(10, 8, 24, 6), { visible: [8, 9], prefetch: [] });
});
