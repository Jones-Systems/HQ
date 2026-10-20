import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isoFromMs, projectId, type HostId, type SourceEnrollment } from '../src/contract.ts';
import { EMPTY_CATALOG, parseSnapshot, reduceCatalog } from '../src/catalog.ts';
import { CATALOG_CACHE_KEY, serializeCatalogCache } from '../src/cache.ts';
import { DiscoveryService } from '../src/discovery.ts';
import { linkWorkspaceProject } from '../src/enrollment.ts';
import {
  deferred, FAKE_HOSTS, FAKE_LABEL, FakeClock, FakeSourceAdapter, fixturePreview, fixtureSnapshot, MemoryCachePort, MemoryWorkspacePort,
} from '../src/fakes.ts';

const { laptop: A, studio: B, server: C } = FAKE_HOSTS;
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle(rounds = 8) { for (let i = 0; i < rounds; i += 1) await tick(); }

function enrollment(host: HostId, label: string, fingerprint?: string): SourceEnrollment {
  return { hostId: host, label, adapterKey: 'fake', enrolledAt: isoFromMs(Date.UTC(2026, 9, 1)), ...(fingerprint ? { fingerprint } : {}) };
}

async function warmCache(port: MemoryCachePort, hosts: readonly HostId[]) {
  let catalog = EMPTY_CATALOG;
  for (const host of hosts) {
    const parsed = await parseSnapshot(await fixtureSnapshot(host, 1, [{ path: 'app', name: `App on ${host}` }, { path: 'site', name: 'Shared title' }]), host);
    assert.ok(parsed.ok);
    catalog = reduceCatalog(catalog, { type: 'snapshot', snapshot: parsed.snapshot, at: isoFromMs(Date.UTC(2026, 9, 20, 11)) }).state;
  }
  port.documents.set(CATALOG_CACHE_KEY, serializeCatalogCache(catalog, isoFromMs(Date.UTC(2026, 9, 20, 11))));
  return catalog;
}

test('warm cache renders immediately while every source hangs forever', async () => {
  const cache = new MemoryCachePort();
  await warmCache(cache, [A, B]);
  const adapter = new FakeSourceAdapter().on(A, { kind: 'hang', honourAbort: false }).on(B, { kind: 'hang', honourAbort: false });
  const clock = new FakeClock();
  const service = new DiscoveryService({ adapters: { fake: adapter }, enrollments: [enrollment(A, 'Laptop'), enrollment(B, 'Studio')], cache, clock });
  const opened = await Promise.race([service.open(), new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 200))]);
  assert.notEqual(opened, 'blocked', 'open must not wait on any source');
  const state = service.getState();
  assert.equal(state.cacheStatus, 'warm');
  assert.equal(Object.keys(state.catalog.records).length, 4);
  assert.ok(Object.values(state.catalog.records).every((record) => record.freshness.status === 'stale'));
  await settle();
  assert.deepEqual([...adapter.listCalls].sort(), [A, B].sort(), 'background refresh started');
  service.dispose();
});

test('cold refresh times out per host and returns useful partial results', async () => {
  const cache = new MemoryCachePort();
  const clock = new FakeClock();
  const adapter = new FakeSourceAdapter()
    .on(A, { kind: 'snapshot', snapshot: await fixtureSnapshot(A, 1, [{ path: 'one', name: 'One' }]) })
    .on(B, { kind: 'hang', honourAbort: false })
    .on(C, { kind: 'offline' });
  const service = new DiscoveryService({
    adapters: { fake: adapter }, enrollments: [enrollment(A, 'Laptop'), enrollment(B, 'Studio'), enrollment(C, 'Server')],
    cache, clock, refresh: { timeoutMs: 5_000, maxConcurrentHosts: 3 }, refreshOnOpen: false,
  });
  await service.open();
  assert.equal(service.getState().cacheStatus, 'cold');
  const running = service.refresh();
  await settle();
  assert.equal(Object.keys(service.getState().catalog.records).length, 1, 'fast host data is visible before the slow host settles');
  clock.advance(5_000);
  const report = await running;
  const outcome = Object.fromEntries(report.results.map((item) => [item.hostId, item.outcome]));
  assert.deepEqual(outcome, { [A]: 'applied', [B]: 'timeout', [C]: 'offline' });
  const sources = service.getState().catalog.sources;
  assert.equal(sources[B]!.status, 'timeout');
  assert.match(sources[B]!.error!.message, /5000 ms/u);
  assert.equal(sources[C]!.error!.kind, 'offline');
  assert.equal(clock.pendingTimers, 0, 'timeouts are cleared');
  assert.ok(adapter.aborted.includes(`list:${B}`), 'timed-out request is aborted');
  service.dispose();
});

test('partial source failure on refresh keeps cached records with per-source freshness and error', async () => {
  const cache = new MemoryCachePort();
  await warmCache(cache, [A, B]);
  const adapter = new FakeSourceAdapter()
    .on(A, { kind: 'snapshot', snapshot: await fixtureSnapshot(A, 2, [{ path: 'app', name: `App on ${A}` }, { path: 'site', name: 'Shared title' }]) })
    .on(B, { kind: 'error', message: 'synthetic failure' });
  const service = new DiscoveryService({ adapters: { fake: adapter }, enrollments: [enrollment(A, 'Laptop'), enrollment(B, 'Studio')], cache, clock: new FakeClock(), refreshOnOpen: false });
  await service.open();
  await service.refresh();
  const state = service.getState();
  const byHost = (host: HostId) => Object.values(state.catalog.records).filter((record) => record.entry.hostId === host);
  assert.equal(byHost(A).length, 2);
  assert.equal(byHost(B).length, 2, 'failed host keeps its cached records');
  assert.ok(byHost(A).every((record) => record.freshness.status === 'fresh'));
  assert.ok(byHost(B).every((record) => record.freshness.status === 'error' && record.freshness.lastSuccessAt !== null));
  assert.equal(state.catalog.sources[B]!.error!.message, 'synthetic failure');
  await service.flushCache();
  // The refreshed state is cached for the next warm start.
  assert.match(cache.documents.get(CATALOG_CACHE_KEY)!, /synthetic failure/u);
  service.dispose();
});

test('rapid A/B/C context changes apply only C and abort earlier work', async () => {
  const cache = new MemoryCachePort();
  const pending = { A: deferred<Awaited<ReturnType<typeof fixtureSnapshot>>>(), B: deferred<Awaited<ReturnType<typeof fixtureSnapshot>>>(), C: deferred<Awaited<ReturnType<typeof fixtureSnapshot>>>() };
  const adapter = new FakeSourceAdapter()
    .on(A, { kind: 'deferred', deferred: pending.A })
    .on(B, { kind: 'deferred', deferred: pending.B })
    .on(C, { kind: 'deferred', deferred: pending.C });
  const service = new DiscoveryService({
    adapters: { fake: adapter }, enrollments: [enrollment(A, 'Laptop'), enrollment(B, 'Studio'), enrollment(C, 'Server')],
    cache, clock: new FakeClock(), context: { id: 'none', hostIds: [] },
  });
  await service.open();
  const reportA = service.setContext({ id: 'A', hostIds: [A] })!;
  await settle();
  const reportB = service.setContext({ id: 'B', hostIds: [B] })!;
  await settle();
  const reportC = service.setContext({ id: 'C', hostIds: [C] })!;
  await settle();
  assert.ok(adapter.aborted.includes(`list:${A}`) && adapter.aborted.includes(`list:${B}`), 'superseded requests are aborted');
  assert.ok(!adapter.aborted.includes(`list:${C}`));
  // Late responses arrive out of order: C first, then the stale A and B.
  pending.C.resolve(await fixtureSnapshot(C, 1, [{ path: 'c', name: 'From C' }]));
  pending.A.resolve(await fixtureSnapshot(A, 1, [{ path: 'a', name: 'From A' }]));
  pending.B.resolve(await fixtureSnapshot(B, 1, [{ path: 'b', name: 'From B' }]));
  const [ra, rb, rc] = await Promise.all([reportA, reportB, reportC]);
  await settle();
  assert.deepEqual(Object.values(service.getState().catalog.records).map((record) => record.entry.displayName), ['From C']);
  assert.equal(ra.superseded, true);
  assert.equal(rb.superseded, true);
  assert.deepEqual(ra.results.map((item) => item.outcome), ['cancelled']);
  assert.deepEqual(rc.results.map((item) => item.outcome), ['applied']);
  assert.equal(rc.superseded, false);
  service.dispose();
});

test('context change withdraws in-flight preview requests and aborts their transport', async () => {
  const cache = new MemoryCachePort();
  const preview = await fixturePreview('ctx');
  const adapter = new FakeSourceAdapter().on(A, { kind: 'snapshot', snapshot: await fixtureSnapshot(A, 1, [{ path: 'p', name: 'P', previews: [preview.ref] }]) });
  adapter.previews.set(preview.ref.digest, preview.bytes);
  adapter.holdPreviews = true;
  const service = new DiscoveryService({ adapters: { fake: adapter }, enrollments: [enrollment(A, 'Laptop')], cache, clock: new FakeClock(), refreshOnOpen: false });
  await service.open();
  const loading = service.loadPreview(A, preview.ref);
  await settle();
  service.setContext({ id: 'other', hostIds: [] });
  await assert.rejects(loading);
  assert.ok(adapter.aborted.includes(`preview:${preview.ref.digest}`));
  service.dispose();
});

test('duplicate digests across hosts fetch once through the service and land only in the cache namespace', async () => {
  const cache = new MemoryCachePort();
  const workspace = new MemoryWorkspacePort();
  const preview = await fixturePreview('dup');
  const adapter = new FakeSourceAdapter();
  adapter.previews.set(preview.ref.digest, preview.bytes);
  adapter.holdPreviews = true;
  const service = new DiscoveryService({ adapters: { fake: adapter }, enrollments: [enrollment(A, 'Laptop'), enrollment(B, 'Studio')], cache, clock: new FakeClock(), refreshOnOpen: false });
  await service.open();
  const both = Promise.all([service.loadPreview(A, preview.ref), service.loadPreview(B, preview.ref)]);
  await settle();
  adapter.releasePreview(preview.ref.digest);
  await both;
  assert.equal(adapter.previewCalls.length, 1);
  assert.ok(cache.blobs.has(preview.ref.digest));
  assert.equal(workspace.writes, 0);
  await service.adoptPreview(preview.ref, workspace);
  assert.equal(workspace.writes, 1, 'only explicit adoption writes the workspace');
  service.dispose();
});

test('background refresh is bounded: one cycle at a time on the injected clock, and stops cleanly', async () => {
  const cache = new MemoryCachePort();
  const clock = new FakeClock();
  const adapter = new FakeSourceAdapter().on(A, { kind: 'hang', honourAbort: true });
  const service = new DiscoveryService({ adapters: { fake: adapter }, enrollments: [enrollment(A, 'Laptop')], cache, clock, refresh: { timeoutMs: 1_000 }, refreshOnOpen: false });
  await service.open();
  const stop = service.startBackgroundRefresh(60_000);
  assert.equal(adapter.listCalls.length, 0, 'nothing runs before the interval');
  clock.advance(60_000);
  await settle();
  assert.equal(adapter.listCalls.length, 1);
  clock.advance(500);
  await settle();
  assert.equal(adapter.listCalls.length, 1, 'no overlapping cycle while one is in flight');
  clock.advance(500);
  await settle();
  assert.equal(service.getState().catalog.sources[A]!.status, 'timeout');
  clock.advance(60_000);
  await settle();
  assert.equal(adapter.listCalls.length, 2);
  stop();
  clock.advance(10 * 60_000);
  await settle();
  assert.ok(adapter.listCalls.length <= 3);
  service.dispose();
});

test('enrollment is explicit and fakes stay labelled; qualified adapters need a qualification reference', async () => {
  const adapter = new FakeSourceAdapter();
  // A non-fake adapter without a qualification reference must not be enrollable.
  const unqualified = { label: 'Real host', qualification: 'qualified' as const, listSnapshot: adapter.listSnapshot, readPreview: adapter.readPreview };
  const service = new DiscoveryService({ adapters: { fake: adapter, real: unqualified }, cache: new MemoryCachePort(), clock: new FakeClock(), refreshOnOpen: false });
  assert.equal(adapter.qualification, 'fake');
  assert.equal(adapter.label, FAKE_LABEL);
  assert.deepEqual(service.enroll({ hostId: A, label: 'Laptop', adapterKey: 'fake', confirmation: 'auto' as 'user-confirmed' }), { ok: false, reason: 'not-confirmed' });
  assert.deepEqual(service.enroll({ hostId: A, label: 'Laptop', adapterKey: 'real', confirmation: 'user-confirmed' }), { ok: false, reason: 'adapter-not-qualified' });
  assert.deepEqual(service.enroll({ hostId: A, label: 'Laptop', adapterKey: 'missing', confirmation: 'user-confirmed' }), { ok: false, reason: 'unknown-adapter' });
  const result = service.enroll({ hostId: A, label: 'Laptop', adapterKey: 'fake', confirmation: 'user-confirmed' });
  assert.equal(result.ok, true);
  assert.deepEqual(service.enroll({ hostId: A, label: 'Again', adapterKey: 'fake', confirmation: 'user-confirmed' }), { ok: false, reason: 'already-enrolled' });
  assert.equal(adapter.listCalls.length, 0, 'enrollment does not contact the source');
});

test('host fingerprint change is held through the service until explicit re-verification', async () => {
  const cache = new MemoryCachePort();
  const adapter = new FakeSourceAdapter().on(A,
    { kind: 'snapshot', snapshot: await fixtureSnapshot(A, 1, [{ path: 'one', name: 'One' }], { fingerprint: 'fp-new' }) },
    { kind: 'snapshot', snapshot: await fixtureSnapshot(A, 2, [{ path: 'one', name: 'One' }], { fingerprint: 'fp-new' }) });
  const service = new DiscoveryService({ adapters: { fake: adapter }, enrollments: [enrollment(A, 'Laptop', 'fp-old')], cache, clock: new FakeClock(), refreshOnOpen: false });
  await service.open();
  const first = await service.refresh();
  assert.equal(first.results[0]!.outcome, 'held-conflict');
  assert.equal(Object.keys(service.getState().catalog.records).length, 0);
  service.updateEnrollment(enrollment(A, 'Laptop', 'fp-new'));
  const second = await service.refresh();
  assert.equal(second.results[0]!.outcome, 'applied');
  service.dispose();
});

test('workspace links are explicit and never inferred from titles', async () => {
  const cache = new MemoryCachePort();
  await warmCache(cache, [A, B]);
  const service = new DiscoveryService({ adapters: { fake: new FakeSourceAdapter() }, enrollments: [enrollment(A, 'Laptop'), enrollment(B, 'Studio')], cache, clock: new FakeClock(), refreshOnOpen: false });
  await service.open();
  const shared = Object.values(service.getState().catalog.records).filter((record) => record.entry.displayName === 'Shared title');
  assert.equal(shared.length, 2, 'same title on two hosts stays two entries');
  assert.throws(() => linkWorkspaceProject(projectId('p1'), shared[0]!, isoFromMs(0), 'implicit' as 'user-confirmed'));
  const link = linkWorkspaceProject(projectId('p1'), shared[0]!, isoFromMs(0), 'user-confirmed');
  assert.deepEqual(link, { projectId: 'p1', sourceProjectId: shared[0]!.entry.sourceProjectId, linkedAt: isoFromMs(0), observedRevision: null });
  service.dispose();
});
