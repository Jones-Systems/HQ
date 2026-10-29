import { afterEach, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import type { PreparedCandidate } from '@hq/contracts/updates';
import { createUpdateHost, type UpdateClock } from './host.js';
import { candidate, installed, installation, manifest } from './fixtures.test-support.js';
import type { SavedState, UpdateStorage } from './storage.js';
import { UpdateFailure } from './contract.js';

const hosts: ReturnType<typeof createUpdateHost>[] = [];
afterEach(async () => { for (const host of hosts.splice(0)) await host.dispose(); });
function fixture() {
  const root = join(import.meta.dirname, 'unread-fixture'), record = installation(root), selected = candidate();
  let persisted: SavedState | null = null, now = Date.parse('2026-10-22T12:00:00.000Z'), handle = 0;
  const timers = new Map<number, { callback: () => void; milliseconds: number }>();
  const clock: UpdateClock = {
    now: () => now, random: () => 0.5,
    setTimeout(callback, milliseconds) { const id = ++handle; timers.set(id, { callback, milliseconds }); return id; },
    clearTimeout(value) { timers.delete(value as number); },
  };
  const storage = {
    trustCache: join(record.stateRoot, 'trust-cache'), initialize: vi.fn(async () => {}), read: vi.fn(async (): Promise<unknown> => persisted),
    write: vi.fn(async (value: SavedState) => { persisted = structuredClone(value); }),
    prepare: vi.fn<UpdateStorage['prepare']>(async value => ({ schemaVersion: 1, candidateId: value.candidateId, manifest: value.manifest, bundlePath: join(record.stateRoot, 'download-cache', value.candidateId, 'extracted/HQ.app') })),
    validatePrepared: vi.fn(async () => {}), discard: vi.fn(async () => {}),
  } satisfies UpdateStorage;
  const discover = vi.fn(async () => selected), schedule = vi.fn(async (_candidate: PreparedCandidate) => {}), cancelScheduled = vi.fn(async () => {});
  function make() {
    const host = createUpdateHost({ installed: installed(), record, schedule, cancelScheduled, platform: 'darwin', architecture: 'arm64', adapters: { storage, discover, clock } });
    hosts.push(host); return host;
  }
  return { host: make(), make, record, storage, discover, schedule, cancelScheduled, selected, timers, clock, advance: (milliseconds: number) => { now += milliseconds; } };
}

it('keeps an unconfigured or non-macOS host inert without touching storage or the network', async () => {
  const storage = { initialize: vi.fn() } as unknown as UpdateStorage, transport = vi.fn();
  for (const platform of ['darwin', 'linux']) {
    const host = createUpdateHost({ installed: installed(), record: platform === 'darwin' ? null : installation('/unread'), schedule: vi.fn(), cancelScheduled: vi.fn(), platform, architecture: 'arm64', adapters: { storage, transport } });
    hosts.push(host); host.start();
    expect(host.status()).toMatchObject({ supported: false, phase: 'unavailable' });
    expect(await host.call('check', {})).toMatchObject({ ok: false, code: 'unavailable' });
  }
  expect(storage.initialize).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
});
it('requires consent for the exact current candidate and keeps scheduling cancellable without ending the session', async () => {
  const f = fixture();
  expect(await f.host.call('check', {})).toMatchObject({ ok: true, status: { phase: 'available' } });
  expect(await f.host.call('download', { candidateId: '0'.repeat(64) })).toMatchObject({ ok: false, code: 'stale-candidate' });
  expect(await f.host.call('schedule', { candidateId: f.selected.candidateId })).toMatchObject({ ok: false, code: 'invalid' });
  expect(await f.host.call('download', { candidateId: f.selected.candidateId })).toMatchObject({ ok: true, status: { phase: 'ready' } });
  expect(f.schedule).not.toHaveBeenCalled();
  expect(await f.host.call('schedule', { candidateId: f.selected.candidateId })).toMatchObject({ ok: true, status: { phase: 'scheduled' } });
  expect(f.schedule).toHaveBeenCalledOnce(); expect(f.storage.validatePrepared).toHaveBeenCalledOnce();
  expect(await f.host.call('cancelScheduled', {})).toMatchObject({ ok: true, status: { phase: 'ready' } });
  expect(f.cancelScheduled).toHaveBeenCalledOnce();
  const next = candidate(manifest({ buildSequence: 3, runId: '3', sourceSha: '1'.repeat(40) }));
  f.discover.mockResolvedValueOnce(next);
  await f.host.call('check', {});
  expect(f.storage.discard).toHaveBeenCalledOnce();
  expect(await f.host.call('schedule', { candidateId: f.selected.candidateId })).toMatchObject({ ok: false, code: 'stale-candidate' });
  expect(f.schedule).toHaveBeenCalledOnce();
});
it('allows only one check or transfer and fully awaits cancellation before returning', async () => {
  const f = fixture();
  await f.host.call('check', {});
  f.storage.prepare.mockImplementationOnce(async (_selected, signal, progress) => {
    progress(1);
    await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new UpdateFailure('cancelled')), { once: true }));
    throw Error('unreachable');
  });
  const download = f.host.call('download', { candidateId: f.selected.candidateId });
  await Promise.resolve(); await Promise.resolve();
  expect(await f.host.call('check', {})).toMatchObject({ ok: false, code: 'busy' });
  expect(await f.host.call('download', { candidateId: f.selected.candidateId })).toMatchObject({ ok: false, code: 'busy' });
  expect(await f.host.call('cancelDownload', {})).toMatchObject({ ok: true, status: { phase: 'available', progress: null } });
  expect(await download).toMatchObject({ ok: false, code: 'cancelled' });
  expect(f.schedule).not.toHaveBeenCalled();
});
it('persists preferences and ready state, with automatic download disabled by default', async () => {
  const f = fixture();
  expect(f.host.status().preferences.backgroundDownload).toBe(false);
  await f.host.call('preferences', { automaticChecks: false, backgroundDownload: true });
  await f.host.call('check', {}); await f.host.call('download', { candidateId: f.selected.candidateId });
  const resumed = f.make();
  expect(await resumed.call('status', {})).toMatchObject({ ok: true, status: { phase: 'ready', preferences: { automaticChecks: false, backgroundDownload: true } } });
});
it('delays automatic checks with jitter and releases timers, listeners and transfers on disposal', async () => {
  const f = fixture(), listener = vi.fn();
  f.host.subscribe(listener); f.host.start(); await f.host.call('status', {});
  expect(f.discover).not.toHaveBeenCalled();
  expect([...f.timers.values()].some(timer => timer.milliseconds === 60000)).toBe(true);
  expect(f.host.status().nextCheckAt).toBe('2026-10-22T12:01:00.000Z');
  await f.host.call('check', {});
  f.storage.prepare.mockImplementationOnce(async (_selected, signal) => {
    await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new UpdateFailure('cancelled')), { once: true }));
    throw Error('unreachable');
  });
  const pending = f.host.call('download', { candidateId: f.selected.candidateId });
  await Promise.resolve(); await Promise.resolve();
  const count = listener.mock.calls.length;
  await f.host.dispose(); await pending;
  expect(f.timers.size).toBe(0); expect(listener).toHaveBeenCalledTimes(count);
  expect(await f.host.call('check', {})).toMatchObject({ ok: false, code: 'unavailable' });
});
it('rejects extra payloads and redacts transport errors and recovery paths', async () => {
  const f = fixture();
  for (const [route, params] of [['status', { path: '/private' }], ['preferences', { automaticChecks: true, backgroundDownload: false, url: 'https://attacker' }], ['download', { candidateId: f.selected.candidateId, path: '/private' }], ['quit', {}]] as const) expect(await f.host.call(route, params)).toMatchObject({ ok: false, code: 'invalid' });
  f.discover.mockRejectedValueOnce(Error('/private/profile/password'));
  const result = await f.host.call('check', {});
  expect(JSON.stringify(result)).not.toContain('/private');
  const recovery = createUpdateHost({ installed: installed(), record: f.record, schedule: f.schedule, cancelScheduled: f.cancelScheduled, platform: 'darwin', architecture: 'arm64', recovery: { state: '/private/state', message: '/private/profile' }, adapters: { storage: f.storage } });
  hosts.push(recovery);
  expect(JSON.stringify(recovery.status())).not.toContain('/private');
});
it('holds ambiguous scheduling failures instead of blindly scheduling again', async () => {
  const f = fixture();
  await f.host.call('check', {}); await f.host.call('download', { candidateId: f.selected.candidateId });
  f.schedule.mockRejectedValueOnce(Error('unknown durable result'));
  expect(await f.host.call('schedule', { candidateId: f.selected.candidateId })).toMatchObject({ ok: false, code: 'recovery-required', status: { phase: 'held' } });
  expect(await f.host.call('schedule', { candidateId: f.selected.candidateId })).toMatchObject({ ok: false, code: 'recovery-required' });
  expect(f.schedule).toHaveBeenCalledOnce();
});
