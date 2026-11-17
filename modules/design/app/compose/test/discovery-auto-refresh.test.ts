import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isoFromMs, type HostId, type SourceEnrollment } from '../../../discovery/src/contract.ts';
import { DiscoveryService } from '../../../discovery/src/discovery.ts';
import { FAKE_HOSTS, FakeClock, FakeSourceAdapter, fixtureSnapshot, MemoryCachePort, type FakeBehaviour } from '../../../discovery/src/fakes.ts';
import {
  autoRefreshedDiscovery, DISCOVERY_AUTO_REFRESH, discoveryRefreshInterval, withDiscoveryAutoRefresh, type DiscoveryEnvLike,
} from '../discovery-auto-refresh.ts';

const HOST: HostId = FAKE_HOSTS.laptop;
const MINUTE = 60_000;
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle(rounds = 8) { for (let i = 0; i < rounds; i += 1) await tick(); }
/** Waits for work that crosses real async boundaries (snapshot hashing); bounded, so a regression fails instead of hanging. */
async function until(condition: () => boolean, what: string) {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await tick();
  }
}

const enrollment: SourceEnrollment = { hostId: HOST, label: 'Laptop', adapterKey: 'fake', enrolledAt: isoFromMs(Date.UTC(2026, 9, 1)) };

/** A stand-in for the bridged environment: it rebuilds its service on choose and forget, as the real one does. */
function createEnv(options: { roots?: number; behaviours?: readonly FakeBehaviour[]; timeoutMs?: number } = {}) {
  const clock = new FakeClock();
  const cache = new MemoryCachePort();
  const services: Array<{ service: DiscoveryService; adapter: FakeSourceAdapter }> = [];
  const build = () => {
    const adapter = new FakeSourceAdapter().on(HOST, ...(options.behaviours ?? [{ kind: 'offline' }]));
    const service = new DiscoveryService({ adapters: { fake: adapter }, enrollments: [enrollment], cache, clock, refreshOnOpen: false,
      ...(options.timeoutMs ? { refresh: { timeoutMs: options.timeoutMs } } : {}) });
    services.push({ service, adapter });
    return service;
  };
  let roots = options.roots ?? 1;
  let service = build();
  const control = { reject: false, noop: false };
  const env = {
    get service() { return service; },
    roots: () => new Array<unknown>(roots).fill({}),
    async chooseRoot(): Promise<void> {
      if (control.reject) throw new Error('A project folder operation is already in progress');
      if (control.noop) return;
      roots += 1;
      service.dispose();
      service = build();
    },
    async forget(): Promise<void> {
      roots = 0;
      service.dispose();
      service = build();
    },
  };
  return { env, clock, cache, services, control, live: () => services[services.length - 1]! };
}

const calls = (entry: { adapter: FakeSourceAdapter }) => entry.adapter.listCalls.length;

test('arms the background loop only when a folder is enrolled, and never refreshes on open', async () => {
  const none = createEnv({ roots: 0 });
  const quiet = withDiscoveryAutoRefresh(none.env);
  await quiet.service.open();
  assert.equal(none.clock.pendingTimers, 0, 'no enrolled folder, nothing scheduled');
  none.clock.advance(120 * MINUTE);
  await settle();
  assert.equal(calls(none.live()), 0);

  const one = createEnv({ roots: 1 });
  const armed = withDiscoveryAutoRefresh(one.env);
  await armed.service.open();
  assert.equal(calls(one.live()), 0, 'opening never refreshes');
  assert.equal(one.clock.pendingTimers, 1);
  armed.stopAutoRefresh();
  assert.equal(one.clock.pendingTimers, 0, 'stopping disposes the timer');
});

test('the first cycle runs one full interval after arming, not before', async () => {
  const fixture = createEnv();
  const env = withDiscoveryAutoRefresh(fixture.env);
  await env.service.open();
  fixture.clock.advance(5 * MINUTE - 1);
  await settle();
  assert.equal(calls(fixture.live()), 0);
  fixture.clock.advance(1);
  await settle();
  assert.equal(calls(fixture.live()), 1);
  env.stopAutoRefresh();
});

test('choosing a folder arms the new service and stops the old one; forgetting the last folder arms nothing', async () => {
  const fixture = createEnv({ roots: 0 });
  const env = withDiscoveryAutoRefresh(fixture.env);
  assert.equal(fixture.clock.pendingTimers, 0);
  const first = fixture.live();
  await env.chooseRoot();
  const second = fixture.live();
  assert.notEqual(first.service, second.service);
  await second.service.open();
  assert.equal(fixture.clock.pendingTimers, 1, 'only the new service is armed');
  fixture.clock.advance(5 * MINUTE);
  await settle();
  assert.equal(calls(first), 0);
  assert.equal(calls(second), 1);

  await env.forget();
  assert.equal(fixture.clock.pendingTimers, 0, 'nothing is armed once no folder remains');
  fixture.clock.advance(60 * MINUTE);
  await settle();
  assert.equal(calls(second), 1);
  assert.equal(calls(fixture.live()), 0);
});

test('a rejected or no-op choose leaves the running schedule untouched', async () => {
  const fixture = createEnv();
  const env = withDiscoveryAutoRefresh(fixture.env);
  await env.service.open();
  fixture.clock.advance(3 * MINUTE);
  fixture.control.reject = true;
  await assert.rejects(env.chooseRoot!(), /already in progress/);
  fixture.control.reject = false;
  fixture.control.noop = true;
  await env.chooseRoot!();
  assert.equal(fixture.services.length, 1, 'the service was not rebuilt');
  fixture.clock.advance(2 * MINUTE - 1);
  await settle();
  assert.equal(calls(fixture.live()), 0);
  fixture.clock.advance(1);
  await settle();
  assert.equal(calls(fixture.live()), 1, 'the cycle fired at the original time');
  env.stopAutoRefresh();
});

test('a choose that fails after the service was replaced still arms the live service', async () => {
  const fixture = createEnv({ roots: 0 });
  const original = fixture.env.chooseRoot;
  fixture.env.chooseRoot = async () => { await original(); throw new Error('Project refresh did not complete. Cached projects remain available.'); };
  const env = withDiscoveryAutoRefresh(fixture.env);
  await assert.rejects(env.chooseRoot!(), /did not complete/);
  assert.equal(fixture.clock.pendingTimers, 1);
  env.stopAutoRefresh();
  assert.equal(fixture.clock.pendingTimers, 0);
});

test('one cycle at a time: a hanging source holds the loop until the 8 s timeout ends it', async () => {
  const fixture = createEnv({ behaviours: [{ kind: 'hang', honourAbort: true }] });
  const env = withDiscoveryAutoRefresh(fixture.env);
  await env.service.open();
  fixture.clock.advance(5 * MINUTE);
  await settle();
  assert.equal(calls(fixture.live()), 1);
  fixture.clock.advance(7_999);
  await settle();
  assert.equal(calls(fixture.live()), 1, 'no second cycle while the first is in flight');
  fixture.clock.advance(1);
  await settle();
  assert.equal(env.service.getState().catalog.sources[HOST]!.status, 'timeout');
  fixture.clock.advance(5 * MINUTE - 1);
  await settle();
  assert.equal(calls(fixture.live()), 1, 'the next cycle waits a full interval after the previous one ended');
  fixture.clock.advance(1);
  await settle();
  assert.equal(calls(fixture.live()), 2);
  env.stopAutoRefresh();
});

test('an offline cycle keeps the previous records and their freshness (last good)', async () => {
  const snapshot = await fixtureSnapshot(HOST, 1, [{ path: 'app', name: 'App' }, { path: 'site', name: 'Site' }], { observedAtMs: Date.UTC(2026, 9, 20, 12, 0, 0) });
  const fixture = createEnv({ behaviours: [{ kind: 'snapshot', snapshot }, { kind: 'offline' }] });
  const env = withDiscoveryAutoRefresh(fixture.env);
  await env.service.open();
  fixture.clock.advance(5 * MINUTE);
  await until(() => Object.keys(env.service.getState().catalog.records).length === 2 && env.service.getState().refreshing.length === 0, 'the first snapshot');
  const good = structuredClone(env.service.getState().catalog.records);
  fixture.clock.advance(5 * MINUTE);
  await until(() => env.service.getState().catalog.sources[HOST]!.status === 'offline', 'the offline cycle');
  assert.equal(calls(fixture.live()), 2, 'the second cycle ran and failed');
  const state = env.service.getState();
  assert.equal(state.catalog.sources[HOST]!.status, 'offline');
  assert.deepEqual(Object.keys(state.catalog.records).sort(), Object.keys(good).sort());
  for (const [key, record] of Object.entries(state.catalog.records)) {
    assert.equal(record.freshness.lastSuccessAt, good[key]!.freshness.lastSuccessAt, 'last successful read is kept');
  }
  env.stopAutoRefresh();
});

test('the interval is clamped to 1–60 minutes; non-finite values use the default; enabled:false schedules nothing', async () => {
  assert.equal(discoveryRefreshInterval(), DISCOVERY_AUTO_REFRESH.intervalMs);
  assert.equal(discoveryRefreshInterval(Number.NaN), 5 * MINUTE);
  assert.equal(discoveryRefreshInterval(Infinity), 5 * MINUTE);
  assert.equal(discoveryRefreshInterval(1), MINUTE);
  assert.equal(discoveryRefreshInterval(500 * MINUTE), 60 * MINUTE);
  assert.equal(discoveryRefreshInterval(10 * MINUTE), 10 * MINUTE);

  const low = createEnv();
  const a = withDiscoveryAutoRefresh(low.env, { intervalMs: 5 });
  low.clock.advance(MINUTE - 1);
  await settle();
  assert.equal(calls(low.live()), 0);
  await low.live().service.open();
  low.clock.advance(1);
  await settle();
  assert.equal(calls(low.live()), 1, 'a value below the minimum runs after one minute');
  a.stopAutoRefresh();

  const high = createEnv();
  const b = withDiscoveryAutoRefresh(high.env, { intervalMs: 1000 * MINUTE });
  await high.live().service.open();
  high.clock.advance(60 * MINUTE);
  await settle();
  assert.equal(calls(high.live()), 1, 'a value above the maximum runs after one hour');
  b.stopAutoRefresh();

  const off = createEnv();
  const c = withDiscoveryAutoRefresh(off.env, { enabled: false });
  await c.service.open();
  assert.equal(off.clock.pendingTimers, 0);
  await c.chooseRoot();
  assert.equal(off.clock.pendingTimers, 0, 'a disabled policy stays disabled after the folder changes');
});

test('the decorated environment keeps the live service getter and the optional operations', async () => {
  const fixture = createEnv();
  const env = withDiscoveryAutoRefresh(fixture.env);
  assert.equal(env.service, fixture.env.service);
  assert.ok('chooseRoot' in env && 'forget' in env);
  await env.chooseRoot();
  assert.equal(env.service, fixture.env.service, 'the getter follows the rebuilt service');
  assert.equal(env.roots().length, 2);
  env.stopAutoRefresh();

  const bare = { service: createEnv().env.service, roots: () => [{}] } satisfies DiscoveryEnvLike;
  const plain = withDiscoveryAutoRefresh(bare);
  assert.equal('chooseRoot' in plain, false, 'only the operations the environment has are present');
  assert.equal('forget' in plain, false);
  plain.stopAutoRefresh();
});

test('autoRefreshedDiscovery keeps promise identity per source promise and passes rejections through', async () => {
  const fixture = createEnv();
  const source = Promise.resolve(fixture.env);
  const lazy = autoRefreshedDiscovery(() => source);
  assert.equal(lazy(), lazy());
  const env = await lazy();
  assert.equal(env.service, fixture.env.service);
  assert.equal(fixture.clock.pendingTimers, 1, 'decorated once, so armed once');
  env.stopAutoRefresh();

  const other = createEnv();
  let current = Promise.resolve(fixture.env);
  const rebuilt = autoRefreshedDiscovery(() => current);
  const before = rebuilt();
  current = Promise.resolve(other.env);
  const after = rebuilt();
  assert.notEqual(before, after, 'a rebuilt source promise gets a fresh decoration');
  (await before).stopAutoRefresh();
  (await after).stopAutoRefresh();

  const failure = new Error('Project catalog: unavailable');
  const rejecting = Promise.reject<DiscoveryEnvLike>(failure);
  rejecting.catch(() => {});
  const failing = autoRefreshedDiscovery(() => rejecting);
  const first = failing();
  assert.equal(first, failing());
  await assert.rejects(first, (error) => error === failure);
});
