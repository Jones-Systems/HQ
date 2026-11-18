import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jsonStore } from '../jones-code/storage.js';
import { createGenerationSources } from './generation-sources.js';
import type { GenerationSourceRecord, GenerationSourcesApi } from './generation-sources.js';
import type { GenerationBinding, ServingGenerationConsumer, ServingState } from './generations/index.js';
import { createGenerationSourcesHost } from './generation-host.js';

vi.mock('../jones-code/storage.js', async original => {
  const actual = await original<typeof import('../jones-code/storage.js')>();
  return { ...actual, jsonStore: vi.fn(actual.jsonStore) };
});
vi.mock('./generation-sources.js', async original => {
  const actual = await original<typeof import('./generation-sources.js')>();
  return { ...actual, createGenerationSources: vi.fn(actual.createGenerationSources) };
});
vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile), mkdir: vi.fn(actual.mkdir),
    open: vi.fn(actual.open), rename: vi.fn(actual.rename), unlink: vi.fn(actual.unlink) };
});

const hosts: ReturnType<typeof createGenerationSourcesHost>[] = [], directories: string[] = [];
afterEach(async () => {
  try { await Promise.all(hosts.splice(0).map(host => host.close())); }
  finally {
    await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true })));
    vi.clearAllMocks();
  }
});
function host(options: Parameters<typeof createGenerationSourcesHost>[0]) {
  const value = createGenerationSourcesHost(options); hosts.push(value); return value;
}
const binding: GenerationBinding = { publisherId: 'synthetic-publisher', hostId: 'synthetic-host', rootId: 'synthetic-root',
  bindingRevision: 'accepted-revision', origin: 'http://127.0.0.1:48123', scopeDigest: 'a'.repeat(64), consistencyMode: 'observed-files-v1' };
const generation = { rootId: binding.rootId, epoch: '900719925474099312345', sequence: '900719925474099398765', manifestSha256: 'b'.repeat(64) };
function fakeApi() {
  const state: { value: ServingState } = { value: { status: 'empty' } };
  const unexpected = vi.fn(async (): Promise<never> => { throw Error('Operational generation call is forbidden'); });
  const consumer: ServingGenerationConsumer = { serving: vi.fn(async () => structuredClone(state.value)),
    refresh: unexpected, current: unexpected, manifest: unexpected, readFile: unexpected };
  const api: GenerationSourcesApi = {
    readConsumerBindingSet: unexpected, diffBindingSets: vi.fn(() => { throw Error('No publisher import'); }),
    bindingKey: value => JSON.stringify([value.publisherId, value.hostId, value.rootId]),
    rebindable: (a, b) => a.origin !== b.origin || a.bindingRevision !== b.bindingRevision,
    createGenerationConsumer: vi.fn(() => consumer),
  };
  return { api, consumer, state, unexpected };
}
async function fixture(seed = false) {
  const userData = await mkdtemp(join(tmpdir(), 'hq-generation-host-')); directories.push(userData);
  if (seed) {
    const record: GenerationSourceRecord = { schema: 'hq.generation-sources/v1', recordRevision: '900719925474099312345',
      publishers: [{ publisherId: binding.publisherId, accepted: { hostId: binding.hostId, setRevision: '1', sha256: 'c'.repeat(64) } }],
      sources: [{ sourceId: 'synthetic-source', ownerState: 'active', issuance: 'issued', reason: 'issued', binding, acceptedSetRevision: '1' }] };
    await mkdir(join(userData, 'sources'));
    await writeFile(join(userData, 'sources', 'generation-sources.json'), JSON.stringify(record), { mode: 0o600 });
  }
  const fake = fakeApi();
  return { userData, ...fake, make: (path = userData) => host({ userData: path, mode: 'enabled', generations: fake.api }) };
}

it('keeps default and explicit disabled calls inert, including invalid routes and calls after close', async () => {
  const fs = await import('node:fs/promises');
  for (const mode of [undefined, 'disabled'] as const) {
    const disabled = host({ mode,
      get userData(): string { throw Error('Disabled host must not inspect storage'); },
      get generations(): GenerationSourcesApi { throw Error('Disabled host must not construct generations'); } });
    expect(Object.keys(disabled).sort()).toEqual(['call', 'close']);
    for (const route of ['snapshot', 'serving', 'registerPublisher', 'importPublisher', 'setOwnerState', 'refresh', null])
      for (const params of [{}, { sourceId: 'synthetic-source' }, null])
        expect(await disabled.call(route, params)).toEqual({ ok: false, kind: 'unavailable', reason: 'disabled' });
    const closing = disabled.close(); expect(disabled.close()).toBe(closing); await closing;
    expect(await disabled.call('snapshot', {})).toEqual({ ok: false, kind: 'unavailable', reason: 'disabled' });
  }
  expect(jsonStore).not.toHaveBeenCalled(); expect(createGenerationSources).not.toHaveBeenCalled();
  for (const operation of [fs.readFile, fs.mkdir, fs.open, fs.rename, fs.unlink]) expect(operation).not.toHaveBeenCalled();
});

it('lazily opens only the temporary record and returns empty snapshot and source_unknown without a consumer', async () => {
  const f = await fixture(), enabled = f.make();
  expect(jsonStore).not.toHaveBeenCalled(); expect(createGenerationSources).not.toHaveBeenCalled();
  expect(await enabled.call('snapshot', {})).toEqual({ ok: true, value: [] });
  expect(await enabled.call('serving', { sourceId: 'unknown' })).toEqual({ ok: true, value: { status: 'unavailable', reason: 'source_unknown' } });
  expect(jsonStore).toHaveBeenCalledExactlyOnceWith(join(f.userData, 'sources'), 'generation-sources.json');
  expect(vi.mocked(readFile).mock.calls.map(([path]) => path)).toEqual([
    join(f.userData, 'sources', 'generation-sources.json'), join(f.userData, 'sources', 'generation-sources.json')]);
  expect(f.api.createGenerationConsumer).not.toHaveBeenCalled(); expect(f.unexpected).not.toHaveBeenCalled();
  expect(await readdir(f.userData)).toEqual([]);
  const closing = enabled.close(); expect(enabled.close()).toBe(closing); await closing;
  expect(await enabled.call('snapshot', {})).toEqual({ ok: false, kind: 'unavailable', reason: 'writer_closed' });
});

it('rejects operational routes and malformed parameters before opening storage', async () => {
  const f = await fixture(), enabled = f.make();
  for (const [route, params] of [
    ['registerPublisher', {}], ['importPublisher', {}], ['setOwnerState', {}], ['refresh', {}], ['unknown', {}], [null, {}],
    ['snapshot', null], ['snapshot', []], ['snapshot', { extra: true }], ['serving', {}], ['serving', { sourceId: 7 }],
    ...['', '../source', 'source/name', 'source\n', 'a'.repeat(129)].map(sourceId => ['serving', { sourceId }]),
    ['serving', { sourceId: 'synthetic-source', extra: true }],
  ]) expect(await enabled.call(route, params)).toEqual({ ok: false, kind: 'invalid' });
  expect(jsonStore).not.toHaveBeenCalled(); expect(createGenerationSources).not.toHaveBeenCalled();
  expect(f.api.createGenerationConsumer).not.toHaveBeenCalled(); expect(f.unexpected).not.toHaveBeenCalled();
});

it('projects snapshot fields and preserves serving states and arbitrarily large decimal counters', async () => {
  const f = await fixture(true), enabled = f.make();
  const pending: ServingState = { status: 'rebind_pending', generation, served: { bindingRevision: 'served-revision', origin: 'http://127.0.0.1:48124' } };
  f.state.value = pending;
  expect(await enabled.call('snapshot', {})).toEqual({ ok: true, value: [{ sourceId: 'synthetic-source', ownerState: 'active',
    issuance: { state: 'issued', reason: 'issued' }, served: { bindingRevision: 'served-revision' }, accepted: { bindingRevision: binding.bindingRevision } }] });
  for (const status of ['rebind_pending', 'active'] as const) {
    f.state.value = { ...pending, status };
    expect(await enabled.call('serving', { sourceId: 'synthetic-source' })).toEqual({ ok: true, value: {
      status: status === 'active' ? 'current' : 'pending', generation,
      served: pending.served, accepted: { bindingRevision: binding.bindingRevision, origin: binding.origin } } });
  }
  for (const value of [{ status: 'empty' }, { status: 'held', reason: 'transport_unavailable', lastGood: generation }] as const) {
    f.state.value = value;
    expect(await enabled.call('serving', { sourceId: 'synthetic-source' })).toEqual({ ok: true, value });
    expect(await enabled.call('snapshot', {})).toEqual({ ok: true, value: [{ sourceId: 'synthetic-source', ownerState: 'active',
      issuance: { state: 'issued', reason: 'issued' }, served: null, accepted: { bindingRevision: binding.bindingRevision } }] });
  }
  expect(f.api.createGenerationConsumer).toHaveBeenCalledExactlyOnceWith({ storeRoot: join(f.userData, 'sources', 'generations', 'synthetic-source'), binding, rebind: 'same-scope-v1' });
  expect(f.unexpected).not.toHaveBeenCalled();
});

it('surfaces writer_exists for the same normalized store and releases only its own writer on idempotent close', async () => {
  const f = await fixture(), first = f.make(), second = f.make(join(f.userData, 'nested', '..'));
  const results = await Promise.all([first.call('snapshot', {}), second.call('snapshot', {})]);
  expect(results).toEqual([{ ok: true, value: [] }, { ok: false, kind: 'unavailable', reason: 'writer_exists' }]);
  expect(jsonStore).toHaveBeenCalledTimes(1);
  await second.close();
  const third = f.make();
  expect(await third.call('snapshot', {})).toEqual({ ok: false, kind: 'unavailable', reason: 'writer_exists' });
  expect(await first.call('snapshot', {})).toEqual({ ok: true, value: [] });
  const closing = first.close(); expect(first.close()).toBe(closing); await closing;
  const replacement = f.make();
  expect(await replacement.call('snapshot', {})).toEqual({ ok: true, value: [] });
  expect(f.api.createGenerationConsumer).not.toHaveBeenCalled(); expect(f.unexpected).not.toHaveBeenCalled();
});
