import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { JsonStore } from '../jones-code/storage.js';
import * as generations from './generations/index.js';
import type { AcceptedBindingSet, BindingSetRead, GenerationBinding, GenerationConsumerOptions,
  GenerationHealth, GenerationManifest, GenerationRef, ServingGenerationConsumer } from './generations/index.js';
import { createGenerationSources } from './generation-sources.js';
import type { GenerationSourceRecord, GenerationSourcesApi } from './generation-sources.js';

const closers: (() => Promise<void>)[] = [], directories: string[] = [];
afterEach(async () => {
  try { await Promise.all(closers.splice(0).map(close => close())); }
  finally { await Promise.all(directories.splice(0).map(root => rm(root, { recursive: true, force: true }))); }
});
const binding: GenerationBinding = { publisherId: 'publisher-one', hostId: 'host-one', rootId: 'root-one',
  bindingRevision: 'revision-one', origin: 'http://127.0.0.1:48123', scopeDigest: 'a'.repeat(64), consistencyMode: 'observed-files-v1' };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, part]) => JSON.stringify(key) + ':' + canonical(part)).join(',') + '}';
  return JSON.stringify(value);
}
const bytes = (value: unknown) => new TextEncoder().encode(canonical(value));
const sha = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
function document(revision = '1', bindings: GenerationBinding[] = [binding]) {
  return bytes({ schema: 'hq-sync.consumer-bindings/v1', completeness: 'complete-for-publisher-binding',
    publisher_id: binding.publisherId, host_id: binding.hostId, origin: bindings[0]?.origin ?? binding.origin,
    set_revision: revision, roots: bindings.map(b => ({ root_id: b.rootId, binding_revision: b.bindingRevision,
      scope_digest: b.scopeDigest, consistency_mode: b.consistencyMode })),
    provenance: { forward_binding_id: 'b'.repeat(64), request_digest: 'c'.repeat(64), observed_at: '2026-10-26T12:00:00Z' } });
}
function memory(initial: GenerationSourceRecord | null = null) {
  let saved = structuredClone(initial), count = 0;
  const store: JsonStore<GenerationSourceRecord> = {
    read: vi.fn(async () => structuredClone(saved)),
    write: vi.fn(async value => { count++; await hooks.beforeWrite?.(value, count); saved = structuredClone(value); await hooks.afterWrite?.(value, count); }),
  };
  const hooks: { beforeWrite?: (value: GenerationSourceRecord, count: number) => Promise<void>;
    afterWrite?: (value: GenerationSourceRecord, count: number) => Promise<void> } = {};
  return { store, hooks, saved: () => structuredClone(saved), external(value: GenerationSourceRecord) { saved = structuredClone(value); } };
}
function fakeConsumer(): ServingGenerationConsumer {
  return { serving: vi.fn(async () => ({ status: 'empty' as const })),
    refresh: vi.fn(async () => ({ status: 'held' as const, reason: 'transport_unavailable' as const, lastGood: null })),
    current: vi.fn(async () => null), manifest: vi.fn(async () => null),
    readFile: vi.fn(async () => ({ ok: false as const, reason: 'unavailable' as const })) };
}
function fixture(initial: GenerationSourceRecord | null = null, overrides: Partial<GenerationSourcesApi> = {}) {
  const storage = memory(initial), fake = fakeConsumer();
  const remote: { bytes: Uint8Array; held?: Extract<BindingSetRead, { kind: 'held' }> } = { bytes: document() };
  const reader = vi.fn(async (id: string, accepted: AcceptedBindingSet | null): Promise<BindingSetRead> => remote.held
    ?? generations.parseConsumerBindingSet(remote.bytes, id, accepted));
  const factory = vi.fn((_options: GenerationConsumerOptions) => fake);
  const api: GenerationSourcesApi = { ...generations, readConsumerBindingSet: reader, createGenerationConsumer: factory, ...overrides };
  let minted = 0;
  const mint = vi.fn(() => `source-${++minted}`);
  const rootFor = vi.fn((id: string) => join(tmpdir(), 'synthetic-not-opened', id));
  const make = () => {
    const registry = createGenerationSources({ store: storage.store, generations: api, storeRootFor: rootFor, mintSourceId: mint });
    closers.push(registry.close); return registry;
  };
  const registry = make();
  const revision = async () => (await registry.snapshot()).recordRevision;
  const register = () => registry.registerPublisher(binding.publisherId, '0');
  const importSet = async () => registry.importPublisher(binding.publisherId, await revision());
  return { ...storage, remote, registry, make, reader, factory, fake, mint, rootFor, revision, register, importSet };
}

it('constructs without I/O and rejects unregistered imports before the binding reader or consumer', async () => {
  const f = fixture();
  expect(f.store.read).not.toHaveBeenCalled(); expect(f.store.write).not.toHaveBeenCalled();
  expect(f.reader).not.toHaveBeenCalled(); expect(f.rootFor).not.toHaveBeenCalled(); expect(f.factory).not.toHaveBeenCalled();
  expect(await f.registry.importPublisher(binding.publisherId, '0')).toEqual({ kind: 'held', reason: 'publisher_unregistered' });
  expect(await f.registry.serving('unknown')).toEqual({ status: 'unavailable', reason: 'source_unknown' });
  expect(f.reader).not.toHaveBeenCalled(); expect(f.factory).not.toHaveBeenCalled(); expect(f.store.write).not.toHaveBeenCalled();
  await f.register();
  const before = await f.registry.snapshot(); f.remote.held = { kind: 'held', reason: 'bindings_unavailable' };
  expect(await f.importSet()).toEqual(f.remote.held);
  expect(await f.registry.snapshot()).toEqual(before); expect(before.publishers[0].accepted).toBeNull();
  expect(before.sources).toEqual([]); expect(f.factory).not.toHaveBeenCalled();
});

it('enforces the full opaque publisher grammar and ASCII casefold uniqueness', async () => {
  const f = fixture();
  for (const id of ['', '.', '..', '.a', '-a', 'a/b', 'a\\b', 'a.json', 'a\0', 'é', 'a'.repeat(129), 'a\n'])
    await expect(f.registry.registerPublisher(id, '0')).rejects.toMatchObject({ reason: 'invalid_publisher' });
  expect(f.store.read).not.toHaveBeenCalled();
  await f.registry.registerPublisher('A-0_x', '0');
  await expect(f.registry.registerPublisher('a-0_X', '1')).rejects.toMatchObject({ reason: 'publisher_exists' });
  await f.registry.registerPublisher('z'.repeat(128), '1');
  expect((await f.registry.snapshot()).publishers.map(p => p.publisherId)).toEqual(['A-0_x', 'z'.repeat(128)]);
});

it('imports first/unchanged/advanced sets and keeps IDs across revision and origin changes', async () => {
  const diff = vi.fn(generations.diffBindingSets), f = fixture(null, { diffBindingSets: diff });
  await f.register(); expect(await f.importSet()).toEqual({ kind: 'advanced', recordRevision: '3' });
  const first = (await f.registry.snapshot()).sources[0];
  expect(f.reader).toHaveBeenNthCalledWith(1, binding.publisherId, null);
  const writes = vi.mocked(f.store.write).mock.calls.length;
  expect(await f.importSet()).toEqual({ kind: 'unchanged', recordRevision: '3' });
  expect(f.store.write).toHaveBeenCalledTimes(writes);
  const changed = { ...binding, bindingRevision: 'revision-two', origin: 'http://127.0.0.1:48124' };
  f.remote.bytes = document('2', [changed]); await f.importSet();
  expect((await f.registry.snapshot()).sources[0]).toEqual({ ...first, binding: changed, acceptedSetRevision: '2' });
  expect(f.mint).toHaveBeenCalledTimes(1);
  expect(diff).toHaveBeenLastCalledWith([binding], [changed]);
  expect(f.factory).not.toHaveBeenCalled();
  const state = await f.registry.snapshot();
  expect(state.publishers[0].accepted).toEqual({ hostId: binding.hostId, setRevision: '2', sha256: sha(f.remote.bytes) });
  expect(Object.keys(state.sources[0]).sort()).toEqual(['acceptedSetRevision', 'binding', 'issuance', 'ownerState', 'reason', 'sourceId']);
});

it('replays an accepted but partly applied set after restart without reminting durable keys', async () => {
  const f = fixture(); await f.register();
  f.remote.bytes = document('1', [binding, { ...binding, rootId: 'root-two' }]);
  f.hooks.beforeWrite = async value => { if (value.sources.length === 2) throw Error('synthetic crash before second key write'); };
  await expect(f.importSet()).rejects.toMatchObject({ reason: 'record_uncertain' });
  const partial = f.saved()!;
  expect(partial.publishers[0].accepted?.setRevision).toBe('1'); expect(partial.sources).toHaveLength(1);
  await expect(f.registry.snapshot()).rejects.toMatchObject({ reason: 'record_uncertain' });
  await f.registry.close(); delete f.hooks.beforeWrite;
  const restarted = f.make();
  expect(await restarted.importPublisher(binding.publisherId, partial.recordRevision)).toMatchObject({ kind: 'unchanged' });
  const recovered = await restarted.snapshot();
  expect(recovered.sources).toHaveLength(2); expect(recovered.sources[0].sourceId).toBe(partial.sources[0].sourceId);
  expect(recovered.sources.every(s => s.acceptedSetRevision === '1')).toBe(true);
  const count = vi.mocked(f.store.write).mock.calls.length;
  await restarted.importPublisher(binding.publisherId, recovered.recordRevision);
  expect(f.store.write).toHaveBeenCalledTimes(count);
});

it('recovers a crash immediately after acceptance and supersedes a partly applied older set', async () => {
  const f = fixture(); await f.register(); await f.importSet();
  f.remote.bytes = document('2', [{ ...binding, bindingRevision: 'revision-two' }, { ...binding, rootId: 'root-two' }]);
  f.hooks.afterWrite = async value => {
    if (value.publishers[0].accepted?.setRevision === '2') throw Error('synthetic crash after acceptance');
  };
  await expect(f.importSet()).rejects.toMatchObject({ reason: 'record_uncertain' });
  const partial = f.saved()!; expect(partial.sources[0].acceptedSetRevision).toBe('1');
  await f.registry.close(); delete f.hooks.afterWrite;
  const restarted = f.make();
  expect(await restarted.refresh(partial.sources[0].sourceId)).toEqual({ status: 'unavailable', reason: 'application_pending' });
  expect(f.factory).not.toHaveBeenCalled();
  f.remote.bytes = document('3', [{ ...binding, bindingRevision: 'revision-three' }]);
  expect(await restarted.importPublisher(binding.publisherId, partial.recordRevision)).toMatchObject({ kind: 'advanced' });
  expect((await restarted.snapshot()).sources).toEqual([{ ...partial.sources[0], binding: { ...binding, bindingRevision: 'revision-three' }, acceptedSetRevision: '3' }]);
});

it('detects stale caller and pre-write CAS conflicts without a blind retry', async () => {
  const f = fixture(); await f.register();
  await expect(f.registry.importPublisher(binding.publisherId, '0')).rejects.toMatchObject({ reason: 'record_conflict' });
  expect(f.reader).not.toHaveBeenCalled();
  f.reader.mockImplementationOnce(async (id, accepted) => {
    f.external({ ...f.saved()!, recordRevision: '2' });
    return generations.parseConsumerBindingSet(f.remote.bytes, id, accepted);
  });
  await expect(f.registry.importPublisher(binding.publisherId, '1')).rejects.toMatchObject({ reason: 'record_conflict' });
  expect(f.reader).toHaveBeenCalledTimes(1); expect(f.store.write).toHaveBeenCalledTimes(1);
  expect(f.saved()?.recordRevision).toBe('2'); expect(f.saved()?.publishers[0].accepted).toBeNull();
});

it('serializes competing writes and enforces one writer for the injected store', async () => {
  const f = fixture();
  expect(() => f.make()).toThrow('writer_exists');
  const results = await Promise.allSettled([f.registry.registerPublisher('one', '0'), f.registry.registerPublisher('two', '0')]);
  expect(results[0].status).toBe('fulfilled'); expect(results[1]).toMatchObject({ status: 'rejected', reason: { reason: 'record_conflict' } });
  expect(f.store.write).toHaveBeenCalledTimes(1);
  await f.registry.close();
  const restarted = f.make(); await f.registry.close();
  expect(() => f.make()).toThrow('writer_exists');
  expect((await restarted.snapshot()).publishers).toEqual([{ publisherId: 'one', accepted: null }]);
});

it('retains tombstones through imports and re-adds the original ID and storeRoot without deleting bytes', async () => {
  const f = fixture(); await f.register(); await f.importSet();
  const first = (await f.registry.snapshot()).sources[0];
  await f.registry.serving(first.sourceId); const root = f.factory.mock.calls[0][0].storeRoot;
  await f.registry.setOwnerState(first.sourceId, 'removed', await f.revision());
  f.remote.bytes = document('2', [{ ...binding, bindingRevision: 'revision-two' }]); await f.importSet();
  expect((await f.registry.snapshot()).sources[0].ownerState).toBe('removed');
  expect(await f.registry.refresh(first.sourceId)).toEqual({ status: 'unavailable', reason: 'source_removed' });
  expect(f.factory).toHaveBeenCalledTimes(1);
  await f.registry.setOwnerState(first.sourceId, 'active', await f.revision()); await f.registry.serving(first.sourceId);
  expect(f.factory).toHaveBeenCalledTimes(2); expect(f.factory.mock.calls[1][0].storeRoot).toBe(root);
  expect((await f.registry.snapshot()).sources[0].sourceId).toBe(first.sourceId); expect(f.mint).toHaveBeenCalledTimes(1);
});

it('distinguishes not_issued from missing files and preserves bindings on every reader hold', async () => {
  const f = fixture(); await f.register(); await f.importSet();
  const initial = await f.registry.snapshot(), source = initial.sources[0];
  for (const reason of ['bindings_unavailable', 'bindings_untrusted', 'bindings_invalid', 'bindings_rollback', 'bindings_fork', 'bindings_identity_changed'] as const) {
    f.remote.held = { kind: 'held', reason };
    expect(await f.importSet()).toEqual({ kind: 'held', reason });
    expect(await f.registry.snapshot()).toEqual(initial);
  }
  delete f.remote.held; f.remote.bytes = document('2', []); await f.importSet();
  const missing = await f.registry.snapshot();
  expect(missing.sources[0]).toEqual({ ...source, acceptedSetRevision: '2', issuance: 'not_issued', reason: 'not_issued' });
  expect(await f.registry.refresh(source.sourceId)).toEqual({ status: 'unavailable', reason: 'not_issued' });
  expect(f.factory).not.toHaveBeenCalled();
  f.remote.bytes = document('3'); await f.importSet();
  expect((await f.registry.snapshot()).sources[0]).toEqual({ ...source, acceptedSetRevision: '3' });
});

it.each(['scopeDigest', 'consistencyMode'] as const)('holds only the key with a changed %s, including unchanged replay', async field => {
  const f = fixture(); await f.register();
  const other = { ...binding, rootId: 'root-two' }; f.remote.bytes = document('1', [binding, other]); await f.importSet();
  const first = (await f.registry.snapshot()).sources.find(s => s.binding.rootId === binding.rootId)!;
  const changed: GenerationBinding = { ...binding, [field]: field === 'scopeDigest' ? 'd'.repeat(64) : 'producer-complete-v1' };
  f.remote.bytes = document('2', [changed, other]); await f.importSet();
  expect((await f.registry.snapshot()).sources.find(s => s.sourceId === first.sourceId)).toEqual({ ...first,
    issuance: 'held', reason: 'binding_scope_changed', acceptedSetRevision: '2' });
  expect(await f.registry.serving(first.sourceId)).toEqual({ status: 'unavailable', reason: 'binding_scope_changed' });
  await f.importSet();
  const good = (await f.registry.snapshot()).sources.find(s => s.binding.rootId === other.rootId)!;
  await f.registry.serving(good.sourceId);
  expect(f.factory).toHaveBeenCalledTimes(1); expect(f.factory.mock.calls[0][0].binding).toEqual(other);
});

it('keeps decimal counters exact beyond Number.MAX_SAFE_INTEGER and rejects numeric durable counters', async () => {
  const f = fixture(); await f.register(); await f.importSet();
  const initial = f.saved()!; await f.registry.close();
  const huge = '9007199254740993';
  f.external({ ...initial, recordRevision: huge });
  const restarted = f.make();
  f.remote.bytes = document(huge);
  await restarted.importPublisher(binding.publisherId, huge);
  const saved = await restarted.snapshot();
  expect(saved.recordRevision).toBe('9007199254740995');
  expect(saved.publishers[0].accepted?.setRevision).toBe(huge); expect(saved.sources[0].acceptedSetRevision).toBe(huge);
  f.external({ ...saved, recordRevision: 9007199254740992 as unknown as string });
  await expect(restarted.snapshot()).rejects.toMatchObject({ reason: 'record_invalid' });
});

it('reuses one consumer per source and rejects overlapping injected storeRoots', async () => {
  const f = fixture(); await f.register();
  f.remote.bytes = document('1', [binding, { ...binding, rootId: 'root-two' }]); await f.importSet();
  const sources = (await f.registry.snapshot()).sources;
  await Promise.all([f.registry.serving(sources[0].sourceId), f.registry.refresh(sources[0].sourceId), f.registry.serving(sources[0].sourceId)]);
  expect(f.factory).toHaveBeenCalledTimes(1);
  expect(f.factory.mock.calls[0][0].rebind).toBe('same-scope-v1');
  f.rootFor.mockReturnValueOnce(f.factory.mock.calls[0][0].storeRoot);
  await expect(f.registry.serving(sources[1].sourceId)).rejects.toMatchObject({ reason: 'store_root_collision' });
  f.rootFor.mockReturnValueOnce(join(tmpdir(), 'changed-root'));
  await expect(f.registry.serving(sources[0].sourceId)).rejects.toMatchObject({ reason: 'store_root_changed' });
  expect(f.factory).toHaveBeenCalledTimes(1);
});

function publication(b: GenerationBinding, sequence: string) {
  const manifest: GenerationManifest = { schema: 'hq-sync.manifest/v1', publisher_id: b.publisherId, host_id: b.hostId, root_id: b.rootId,
    binding_revision: b.bindingRevision, scope_digest: b.scopeDigest, epoch: '9007199254740993', sequence, predecessor: null,
    published_at: '2026-10-26T12:00:00Z', capture: { method: 'observed-files-v1', observation_id: 'synthetic-observation',
      started_at: '2026-10-26T12:00:00Z', finished_at: '2026-10-26T12:00:00Z', source_generation: null,
      source_inventory_sha256: null, point_in_time: false, application_completion: 'not-asserted' },
    files: [], presentations: [], inventory: { enumeration: 'complete-within-declared-scope', file_count: 0, total_bytes: 0, inventory_sha256: sha(bytes([])) },
    retention_policy: 'no-automatic-deletion-v1' };
  const manifestBytes = bytes(manifest), digest = sha(manifestBytes);
  const route = `/hq-sync/v1/roots/${b.rootId}/generations/${manifest.epoch}/${sequence}/${digest}/manifest.json`;
  const ref: GenerationRef = { schema: 'hq-sync.ref/v1', publisher_id: b.publisherId, host_id: b.hostId, root_id: b.rootId,
    binding_revision: b.bindingRevision, scope_digest: b.scopeDigest, epoch: manifest.epoch, sequence, manifest_sha256: digest, manifest_path: route };
  const health: GenerationHealth = { schema: 'hq-sync.health/v1', publisher_id: b.publisherId, publisher_instance_id: 'synthetic-process',
    root_id: b.rootId, binding_revision: b.bindingRevision, scope_digest: b.scopeDigest, observation_sequence: sequence,
    last_attempt_at: null, last_success_at: null, last_success_age_ms: null, source_status: 'ok', reason: 'synthetic_ok', observed_inventory_sha256: null,
    published: { epoch: manifest.epoch, sequence, manifest_sha256: digest }, pending_change: false, storage_status: 'ok' };
  return { manifestBytes, ref, health, route };
}

it('reports pointer-served pending/current through a real consumer; offline/404 preserve record and pointer', async () => {
  const allocated = await mkdtemp(join(tmpdir(), 'hq-generation-sources-')); directories.push(allocated);
  const root = await realpath(allocated);
  let active = publication(binding, '9007199254740993'), failure: 'offline' | '404' | null = null;
  const fetcher = vi.fn(async (input: Parameters<NonNullable<GenerationConsumerOptions['fetch']>>[0]) => {
    if (failure === 'offline') throw Error('synthetic offline');
    if (failure === '404') return new Response(null, { status: 404 });
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    if (path.endsWith('/ref.json')) return new Response(bytes(active.ref));
    if (path.endsWith('/health.json')) return new Response(bytes(active.health));
    if (path === active.route) return new Response(active.manifestBytes);
    throw Error('unexpected synthetic route');
  });
  const factory = vi.fn((options: GenerationConsumerOptions) => generations.createGenerationConsumer({ ...options, fetch: fetcher }));
  const f = fixture(null, { createGenerationConsumer: factory }); f.rootFor.mockImplementation(id => join(root, id));
  await f.register(); await f.importSet();
  const source = (await f.registry.snapshot()).sources[0];
  expect(await f.registry.refresh(source.sourceId)).toMatchObject({ status: 'activated' });
  const pointer = join(root, source.sourceId, 'roots', binding.rootId + '.json'), originalPointer = await readFile(pointer);
  const before = await f.registry.snapshot();
  for (const value of ['offline', '404'] as const) {
    failure = value;
    expect(await f.registry.refresh(source.sourceId)).toMatchObject({ status: 'held', reason: value === 'offline' ? 'transport_unavailable' : 'http_status' });
    expect(await f.registry.snapshot()).toEqual(before); expect(await readFile(pointer)).toEqual(originalPointer);
  }
  failure = null;
  const rebound = { ...binding, bindingRevision: 'revision-two', origin: 'http://127.0.0.1:48124' };
  f.remote.bytes = document('2', [rebound]); await f.importSet();
  const calls = fetcher.mock.calls.length;
  expect(await f.registry.serving(source.sourceId)).toMatchObject({ status: 'pending', served: { bindingRevision: binding.bindingRevision, origin: binding.origin },
    accepted: { bindingRevision: rebound.bindingRevision, origin: rebound.origin } });
  expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(await f.registry.refresh(source.sourceId)).toMatchObject({ status: 'held', reason: 'binding_mismatch' });
  expect(await readFile(pointer)).toEqual(originalPointer);
  const pendingRecord = await f.registry.snapshot(); await f.registry.close();
  const restarted = f.make();
  expect(await restarted.serving(source.sourceId)).toMatchObject({ status: 'pending' });
  active = publication(rebound, '9007199254740994');
  expect(await restarted.refresh(source.sourceId)).toMatchObject({ status: 'activated', generation: { epoch: '9007199254740993', sequence: '9007199254740994' } });
  expect(await restarted.serving(source.sourceId)).toMatchObject({ status: 'current', served: { bindingRevision: rebound.bindingRevision, origin: rebound.origin } });
  expect(await restarted.snapshot()).toEqual(pendingRecord);
  const originOnly = { ...rebound, origin: 'http://127.0.0.1:48125' };
  f.remote.bytes = document('3', [originOnly]);
  await restarted.importPublisher(binding.publisherId, pendingRecord.recordRevision);
  expect(await restarted.serving(source.sourceId)).toMatchObject({ status: 'pending', served: { origin: rebound.origin } });
  expect(await restarted.refresh(source.sourceId)).toMatchObject({ status: 'current' });
  expect(await restarted.serving(source.sourceId)).toMatchObject({ status: 'current', served: { origin: originOnly.origin } });
  await restarted.setOwnerState(source.sourceId, 'removed', (await restarted.snapshot()).recordRevision);
  const removedPointer = await readFile(pointer);
  expect(await restarted.refresh(source.sourceId)).toEqual({ status: 'unavailable', reason: 'source_removed' });
  expect(await readFile(pointer)).toEqual(removedPointer);
});
