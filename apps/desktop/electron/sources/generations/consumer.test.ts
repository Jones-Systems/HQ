import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FetchPort } from '../../jones-code/wire.js';
import { canonicalJson, sha256 } from './canonical-json.js';
import { createGenerationConsumer } from './consumer.js';
import { createGenerationConsumerWithStore } from './consumer.js';
import { GenerationStore } from './store.js';
import { fileRoute, manifestRoute, rootRoute } from './paths.js';
import type { GenerationBinding, GenerationHealth, GenerationManifest, GenerationRef } from './types.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const binding: GenerationBinding = { origin: 'http://127.0.0.1:43210', publisherId: 'consumer-publisher', hostId: 'consumer-host',
  rootId: 'consumer-root', bindingRevision: 'revision-one', scopeDigest: 'a'.repeat(64), consistencyMode: 'observed-files-v1' };
function vector(sequence = '1', text = 'retained offline bytes', epoch = '1', mutate?: (manifest: GenerationManifest) => void) {
  const content = new TextEncoder().encode(text), unused = new TextEncoder().encode('optional bytes');
  const files = [{ path: 'page.txt', size: content.length, sha256: sha256(content), media_type: 'text/plain' },
    { path: 'unselected.txt', size: unused.length, sha256: sha256(unused), media_type: 'text/plain' }];
  const value: GenerationManifest = { schema: 'hq-sync.manifest/v1', publisher_id: binding.publisherId, host_id: binding.hostId,
    root_id: binding.rootId, binding_revision: binding.bindingRevision, scope_digest: binding.scopeDigest, epoch, sequence,
    predecessor: null, published_at: '2026-03-04T05:06:07Z',
    capture: { method: 'observed-files-v1', observation_id: 'consumer-observation', started_at: '2026-03-04T05:06:00Z', finished_at: '2026-03-04T05:06:07Z',
      source_generation: null, source_inventory_sha256: null, point_in_time: false, application_completion: 'not-asserted' },
    inventory: { enumeration: 'complete-within-declared-scope', file_count: 2, total_bytes: content.length + unused.length, inventory_sha256: sha256(canonicalJson(files)) },
    files, presentations: [{ id: 'page', kind: 'file', entry_path: 'page.txt', preview_path: null,
      dependency_mode: 'independent-file', required_paths: ['page.txt'] }], retention_policy: 'no-automatic-deletion-v1' };
  mutate?.(value);
  const bytes = canonicalJson(value);
  const identity = { rootId: binding.rootId, epoch, sequence, manifestSha256: sha256(bytes) };
  const ref: GenerationRef = { schema: 'hq-sync.ref/v1', publisher_id: binding.publisherId, host_id: binding.hostId,
    root_id: binding.rootId, binding_revision: binding.bindingRevision, scope_digest: binding.scopeDigest,
    epoch, sequence, manifest_sha256: identity.manifestSha256, manifest_path: manifestRoute(identity) };
  const health: GenerationHealth = { schema: 'hq-sync.health/v1', publisher_id: binding.publisherId, publisher_instance_id: 'consumer-process',
    root_id: binding.rootId, binding_revision: binding.bindingRevision, scope_digest: binding.scopeDigest, observation_sequence: sequence,
    last_attempt_at: null, last_success_at: null, last_success_age_ms: null, source_status: 'changing', reason: 'source_changing',
    observed_inventory_sha256: null, published: { epoch, sequence, manifest_sha256: identity.manifestSha256 }, pending_change: true, storage_status: 'ok' };
  return { value, bytes, identity, ref, health, content, unused };
}
function publisher(initial = vector()) {
  const remote: { active: ReturnType<typeof vector>; offline: boolean; calls: string[];
    intercept?: (path: string) => Response | Promise<Response> | undefined } = { active: initial, offline: false, calls: [] };
  const fetcher: FetchPort = async input => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    remote.calls.push(path);
    if (remote.offline) throw Error('synthetic offline');
    const intercepted = remote.intercept?.(path);
    if (intercepted) return intercepted;
    const v = remote.active;
    if (path === rootRoute(binding.rootId) + '/ref.json') return new Response(canonicalJson(v.ref));
    if (path === rootRoute(binding.rootId) + '/health.json') return new Response(canonicalJson(v.health));
    if (path === manifestRoute(v.identity)) return new Response(v.bytes);
    if (path === fileRoute(v.identity, 'page.txt')) return new Response(v.content);
    if (path === fileRoute(v.identity, 'unselected.txt')) return new Response(v.unused);
    return new Response(null, { status: 404 });
  };
  return { remote, fetcher };
}
async function fixture(initial = vector()) {
  const root = await mkdtemp(join(tmpdir(), 'hq-generation-consumer-')); roots.push(root);
  const { remote, fetcher } = publisher(initial);
  const consumer = createGenerationConsumer({ storeRoot: root, binding, fetch: fetcher });
  return { root, remote, fetcher, consumer, pointer: join(root, 'roots', binding.rootId + '.json') };
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

it('activates complete required files, reports observation health and refetches zero files when current', async () => {
  const v = vector('9007199254740993', 'retained offline bytes', '9007199254740995'), f = await fixture(v);
  expect(await f.consumer.refresh()).toEqual({ status: 'activated', generation: v.identity, previous: null,
    health: { ...v.health, matchesRef: true } });
  expect(f.remote.calls).toEqual([rootRoute(binding.rootId) + '/ref.json', rootRoute(binding.rootId) + '/health.json',
    manifestRoute(v.identity), fileRoute(v.identity, 'page.txt')]);
  f.remote.calls.length = 0;
  const pointer = await readFile(f.pointer);
  expect(await f.consumer.refresh()).toMatchObject({ status: 'current', generation: v.identity, health: { source_status: 'changing' } });
  expect(await readFile(f.pointer)).toEqual(pointer);
  expect(f.remote.calls.filter(path => path.includes('/files/'))).toEqual([]);
  expect(await f.consumer.manifest()).toEqual(v.value);
  expect(await f.consumer.readFile('page.txt')).toEqual({ ok: true, bytes: v.content, mediaType: 'text/plain' });
  expect(await f.consumer.readFile('unselected.txt')).toEqual({ ok: false, reason: 'unavailable' });
  expect(await f.consumer.readFile('absent.txt')).toEqual({ ok: false, reason: 'not_in_generation' });
  expect(await f.consumer.readFile('../page.txt')).toEqual({ ok: false, reason: 'invalid_path' });
});
it('acquires the union of presentation dependencies once before making static content current', async () => {
  const v = vector('1', 'static entry', '1', value => {
    value.presentations = [{ id: 'static-page', kind: 'static', entry_path: 'page.txt', preview_path: 'unselected.txt',
      dependency_mode: 'entire-eligible-tree', required_paths: ['page.txt', 'unselected.txt'] },
    { id: 'independent-preview', kind: 'file', entry_path: 'unselected.txt', preview_path: null,
      dependency_mode: 'independent-file', required_paths: ['unselected.txt'] }];
  });
  const f = await fixture(v);
  expect(await f.consumer.refresh()).toMatchObject({ status: 'activated' });
  expect(f.remote.calls.filter(path => path.includes('/files/'))).toEqual([
    fileRoute(v.identity, 'page.txt'), fileRoute(v.identity, 'unselected.txt')]);
  expect(await f.consumer.readFile('unselected.txt')).toEqual({ ok: true, bytes: v.unused, mediaType: 'text/plain' });
});
it('retains last-good pointer bytes for remote binding, ordering, inventory and dependency holds', async () => {
  const f = await fixture(vector('4')); await f.consumer.refresh();
  const before = await readFile(f.pointer), lastGood = await f.consumer.current();
  const cases: [ReturnType<typeof vector>, string][] = [
    [vector('3'), 'sequence_regression'], [vector('4', 'different digest'), 'equal_sequence_digest_mismatch'],
    [vector('5', 'new epoch', '2'), 'epoch_reconciliation_required'],
    [vector('5', 'next', '1', v => { v.inventory.total_bytes++; }), 'inventory_mismatch'],
    [vector('5', 'next', '1', v => { v.presentations[0].required_paths = ['missing']; }), 'missing_dependencies']
  ];
  const badBinding = vector('5'); badBinding.ref.host_id = 'other-host'; cases.push([badBinding, 'binding_mismatch']);
  const badPath = vector('5'); badPath.ref.manifest_path = '/untrusted'; cases.push([badPath, 'invalid_manifest_path']);
  const badHealth = vector('5'); badHealth.health.scope_digest = 'f'.repeat(64); cases.push([badHealth, 'binding_mismatch']);
  const badDigest = vector('5'); badDigest.bytes = new TextEncoder().encode('{}'); cases.push([badDigest, 'manifest_digest_mismatch']);
  for (const [candidate, reason] of cases) {
    f.remote.active = candidate;
    expect(await f.consumer.refresh(), reason).toEqual({ status: 'held', reason, lastGood });
    expect(await readFile(f.pointer), reason).toEqual(before);
    expect(await f.consumer.readFile('page.txt')).toMatchObject({ ok: true });
  }
});
it('holds on missing, mismatched or oversized pinned bytes with the pointer unchanged', async () => {
  const f = await fixture(); await f.consumer.refresh();
  const before = await readFile(f.pointer), lastGood = await f.consumer.current();
  f.remote.active = vector('2', 'next-content');
  for (const [response, reason] of [[new Response(null, { status: 404 }), 'generation_missing'],
    [new Response('wrong'), 'blob_mismatch'], [new Response('x'.repeat(100)), 'response_too_large']] as const) {
    f.remote.intercept = path => path.includes('/files/') ? response : undefined;
    expect(await f.consumer.refresh()).toEqual({ status: 'held', reason, lastGood });
    expect(await readFile(f.pointer)).toEqual(before);
  }
  f.remote.intercept = path => path.endsWith('/manifest.json') ? new Response(null, { status: 404 }) : undefined;
  expect(await f.consumer.refresh()).toMatchObject({ status: 'held', reason: 'generation_missing' });
  expect(await readFile(f.pointer)).toEqual(before);
});
it('preserves pointer bytes for noncanonical documents, HTTP errors and transport failure', async () => {
  const f = await fixture(); await f.consumer.refresh();
  const before = await readFile(f.pointer), lastGood = await f.consumer.current();
  for (const [response, reason] of [[new Response(new TextDecoder().decode(canonicalJson(f.remote.active.ref)) + '\n'), 'invalid_json'],
    [new Response(null, { status: 503 }), 'http_status'], [new Response('x', { headers: { 'content-length': '65537' } }), 'response_too_large']] as const) {
    f.remote.intercept = path => path.endsWith('/ref.json') ? response : undefined;
    expect(await f.consumer.refresh()).toEqual({ status: 'held', reason, lastGood });
    expect(await readFile(f.pointer)).toEqual(before);
  }
  f.remote.offline = true;
  expect(await f.consumer.refresh()).toEqual({ status: 'held', reason: 'transport_unavailable', lastGood });
  expect(await readFile(f.pointer)).toEqual(before);
});
it('serves retained bytes after restart while offline and verifies them on each read', async () => {
  const v = vector(), f = await fixture(v); await f.consumer.refresh(); f.remote.offline = true;
  const restarted = createGenerationConsumer({ storeRoot: f.root, binding, fetch: f.fetcher });
  expect(await restarted.current()).toEqual(v.identity);
  expect(await restarted.refresh()).toMatchObject({ status: 'held', reason: 'transport_unavailable', lastGood: v.identity });
  expect(await restarted.readFile('page.txt')).toEqual({ ok: true, bytes: v.content, mediaType: 'text/plain' });
  const blob = join(f.root, 'blobs', sha256(v.content));
  await writeFile(blob, 'tampered');
  expect(await restarted.readFile('page.txt')).toEqual({ ok: false, reason: 'blob_mismatch' });
  await unlink(blob);
  expect(await restarted.readFile('page.txt')).toEqual({ ok: false, reason: 'unavailable' });
});
it('holds on stored binding differences without rebinding or serving mismatched data', async () => {
  const f = await fixture(); await f.consumer.refresh(); const before = await readFile(f.pointer);
  const rebound = createGenerationConsumer({ storeRoot: f.root, binding: { ...binding, bindingRevision: 'revision-two' }, fetch: f.fetcher });
  const count = f.remote.calls.length;
  expect(await rebound.refresh()).toMatchObject({ status: 'held', reason: 'binding_mismatch' });
  expect(f.remote.calls).toHaveLength(count);
  expect(await readFile(f.pointer)).toEqual(before);
  expect(await rebound.current()).toBeNull();
  expect(await rebound.readFile('page.txt')).toEqual({ ok: false, reason: 'unavailable' });
});
it('coalesces a burst to one in-flight pass and one follow-up with shared queued results', async () => {
  const f = await fixture(), entered = deferred<void>(), release = deferred<Response>();
  let refs = 0;
  f.remote.intercept = path => {
    if (path.endsWith('/ref.json') && ++refs === 1) { entered.resolve(); return release.promise; }
    return undefined;
  };
  const first = f.consumer.refresh();
  const pending: Promise<unknown>[] = [first];
  try {
    await entered.promise;
    const queued = f.consumer.refresh(); pending.push(queued);
    for (let call = 0; call < 10; call++) expect(f.consumer.refresh()).toBe(queued);
    release.resolve(new Response(canonicalJson(f.remote.active.ref)));
    expect(await first).toMatchObject({ status: 'activated' });
    expect(await queued).toMatchObject({ status: 'current' });
    expect(f.remote.calls.filter(path => path.endsWith('/ref.json'))).toHaveLength(2);
    expect(f.remote.calls.filter(path => path.includes('/files/'))).toHaveLength(1);
  } finally { release.resolve(new Response(null, { status: 503 })); await Promise.allSettled(pending); }
});
it('rejects a late acquisition superseded by a second instance and preserves the newer bytes', async () => {
  const f = await fixture(), stale = vector('2', 'stale bytes'), newest = vector('3', 'newest bytes');
  await f.consumer.refresh();
  const slowRemote = publisher(stale), entered = deferred<void>(), release = deferred<Response>();
  slowRemote.remote.intercept = path => { if (path.includes('/files/')) { entered.resolve(); return release.promise; } return undefined; };
  const slow = createGenerationConsumer({ storeRoot: f.root, binding, fetch: slowRemote.fetcher });
  const pending = slow.refresh();
  try {
    await entered.promise;
    expect(await slow.readFile('page.txt')).toEqual({ ok: true, bytes: vector().content, mediaType: 'text/plain' });
    f.remote.active = newest;
    expect(await f.consumer.refresh()).toMatchObject({ status: 'activated', generation: newest.identity });
    const before = await readFile(f.pointer);
    release.resolve(new Response(stale.content));
    expect(await pending).toEqual({ status: 'held', reason: 'superseded', lastGood: newest.identity });
    expect(await readFile(f.pointer)).toEqual(before);
    expect(await slow.readFile('page.txt')).toEqual({ ok: true, bytes: newest.content, mediaType: 'text/plain' });
  } finally { release.resolve(new Response(null, { status: 503 })); await pending; }
});

function rebindVector(target: GenerationBinding, sequence: string) {
  const v = vector(sequence, 'retained offline bytes', '1', manifest => { manifest.binding_revision = target.bindingRevision; });
  v.ref.binding_revision = target.bindingRevision;
  v.health.binding_revision = target.bindingRevision;
  return v;
}
it('BQ-6/7 keeps default equality and opts into serving last-good while the publisher revision is pending', async () => {
  const old = vector('9007199254740993'), f = await fixture(old); await f.consumer.refresh();
  const nextBinding = { ...binding, bindingRevision: 'revision-two' };
  const ordinary = createGenerationConsumer({ storeRoot: f.root, binding: nextBinding, fetch: f.fetcher });
  expect(await ordinary.serving()).toEqual({ status: 'held', reason: 'binding_mismatch', lastGood: old.identity });
  expect(await ordinary.current()).toBeNull();
  const consumer = createGenerationConsumer({ storeRoot: f.root, binding: nextBinding, fetch: f.fetcher, rebind: 'same-scope-v1' });
  expect(await consumer.serving()).toEqual({ status: 'rebind_pending', generation: old.identity,
    served: { bindingRevision: binding.bindingRevision, origin: binding.origin } });
  expect(await consumer.current()).toEqual(old.identity);
  expect(await consumer.manifest()).toEqual(old.value);
  expect(await consumer.readFile('page.txt')).toEqual({ ok: true, bytes: old.content, mediaType: 'text/plain' });
  const before = await readFile(f.pointer);
  expect(await consumer.refresh()).toEqual({ status: 'held', reason: 'binding_mismatch', lastGood: old.identity });
  expect(await readFile(f.pointer)).toEqual(before);
  const next = rebindVector(nextBinding, '9007199254740994'); f.remote.active = next;
  expect(await consumer.refresh()).toMatchObject({ status: 'activated', previous: old.identity, generation: next.identity });
  expect(await consumer.serving()).toEqual({ status: 'active', generation: next.identity,
    served: { bindingRevision: nextBinding.bindingRevision, origin: nextBinding.origin } });
  expect(await createGenerationConsumer({ storeRoot: f.root, binding: nextBinding, fetch: f.fetcher }).current()).toEqual(next.identity);
  expect(JSON.parse(await readFile(f.pointer, 'utf8'))).toEqual({ schema: 'hq-generation-pointer/v1', binding: nextBinding, generation: next.identity });
});
it('BQ-7 collapses several accepted binding revisions into one activation', async () => {
  const f = await fixture(); await f.consumer.refresh();
  const nextBinding = { ...binding, bindingRevision: 'revision-three' };
  const next = rebindVector(nextBinding, '3'); f.remote.active = next;
  const consumer = createGenerationConsumer({ storeRoot: f.root, binding: nextBinding, fetch: f.fetcher, rebind: 'same-scope-v1' });
  expect(await consumer.refresh()).toMatchObject({ status: 'activated', previous: vector().identity, generation: next.identity });
  expect(await consumer.refresh()).toMatchObject({ status: 'current', generation: next.identity });
  expect(await consumer.serving()).toMatchObject({ status: 'active', served: { bindingRevision: 'revision-three' } });
});
it('BQ-7 retains a pending rebind before pointer rename and recovers the committed binding after uncertainty', async () => {
  for (const boundary of ['before', 'after'] as const) {
    const old = vector(), f = await fixture(old); await f.consumer.refresh();
    const target = { ...binding, bindingRevision: 'revision-two' }, next = rebindVector(target, '2'); f.remote.active = next;
    const fail = async (kind: string) => { if (kind === 'pointer') throw Error('synthetic pointer durability failure'); };
    const store = new GenerationStore(f.root, boundary === 'before' ? { beforeRename: fail } : { afterRename: fail });
    const options = { storeRoot: f.root, binding: target, fetch: f.fetcher, rebind: 'same-scope-v1' as const };
    const consumer = createGenerationConsumerWithStore(options, store), before = await readFile(f.pointer);
    expect(await consumer.refresh()).toMatchObject({ status: 'held', reason: boundary === 'before' ? 'store_unavailable' : 'store_uncertain', lastGood: old.identity });
    const restarted = createGenerationConsumer(options);
    expect(await restarted.serving()).toMatchObject({ status: boundary === 'before' ? 'rebind_pending' : 'active',
      generation: boundary === 'before' ? old.identity : next.identity });
    if (boundary === 'before') expect(await readFile(f.pointer)).toEqual(before);
    else {
      expect(await consumer.serving()).toMatchObject({ status: 'held', reason: 'store_uncertain' });
      expect(await consumer.readFile('page.txt')).toEqual({ ok: false, reason: 'store_uncertain' });
    }
    expect(await restarted.readFile('page.txt')).toEqual({ ok: true, bytes: old.content, mediaType: 'text/plain' });
  }
});
it('BQ-8 revalidates and CAS-rewrites only the origin while returning current', async () => {
  const old = vector(), f = await fixture(old); await f.consumer.refresh();
  const target = { ...binding, origin: 'http://127.0.0.1:43211' };
  const origins: string[] = [];
  const fetcher: FetchPort = async (url, options) => { origins.push(String(url)); return f.fetcher(url, options); };
  const options = { storeRoot: f.root, binding: target, fetch: fetcher, rebind: 'same-scope-v1' as const };
  const consumer = createGenerationConsumer(options), before = await readFile(f.pointer);
  expect(await consumer.serving()).toMatchObject({ status: 'rebind_pending', served: { origin: binding.origin } });
  expect(origins).toEqual([]);
  expect(await consumer.refresh()).toMatchObject({ status: 'current', generation: old.identity });
  expect(origins.length).toBeGreaterThan(0); expect(origins.every(url => url.startsWith(target.origin + '/'))).toBe(true);
  expect(await readFile(f.pointer)).not.toEqual(before);
  expect(JSON.parse(await readFile(f.pointer, 'utf8'))).toEqual({ schema: 'hq-generation-pointer/v1', binding: target, generation: old.identity });
  expect(await createGenerationConsumer(options).serving()).toEqual({ status: 'active', generation: old.identity,
    served: { bindingRevision: binding.bindingRevision, origin: target.origin } });
});
it('BQ-8 rejects non-rebindable changes and invalid opt-in values without touching the pointer', async () => {
  const f = await fixture(); await f.consumer.refresh(); const before = await readFile(f.pointer), calls = f.remote.calls.length;
  for (const change of [{ scopeDigest: 'f'.repeat(64) }, { consistencyMode: 'producer-complete-v1' as const },
    { hostId: 'different-host' }, { publisherId: 'different-publisher' }]) {
    const consumer = createGenerationConsumer({ storeRoot: f.root, binding: { ...binding, ...change }, fetch: f.fetcher, rebind: 'same-scope-v1' });
    expect(await consumer.serving()).toMatchObject({ status: 'held', reason: 'binding_mismatch' });
    expect(await consumer.refresh()).toMatchObject({ status: 'held', reason: 'binding_mismatch' });
    expect(await consumer.current()).toBeNull(); expect(await readFile(f.pointer)).toEqual(before);
  }
  expect(f.remote.calls).toHaveLength(calls);
  for (const rebind of [null, true, '', 'all']) {
    expect(() => createGenerationConsumer({ storeRoot: f.root, binding, rebind: rebind as 'same-scope-v1' })).toThrow(TypeError);
  }
});
it('BQ-9 separates transport availability from pending rebind state and retained offline bytes', async () => {
  const old = vector(), f = await fixture(old); await f.consumer.refresh();
  const before = await readFile(f.pointer), target = { ...binding, origin: 'http://127.0.0.1:43211' };
  for (const fault of ['404', 'timeout', 'refused']) {
    const fetcher: FetchPort = async () => {
      if (fault === '404') return new Response(null, { status: 404 });
      throw fault === 'timeout' ? new DOMException('synthetic timeout', 'TimeoutError') : Error('synthetic refusal');
    };
    const consumer = createGenerationConsumer({ storeRoot: f.root, binding: target, fetch: fetcher, rebind: 'same-scope-v1' });
    expect(await consumer.refresh()).toMatchObject({ status: 'held', reason: fault === '404' ? 'http_status' : 'transport_unavailable', lastGood: old.identity });
    expect(await consumer.serving()).toMatchObject({ status: 'rebind_pending', generation: old.identity });
    expect(await readFile(f.pointer)).toEqual(before);
    expect(await consumer.readFile('page.txt')).toEqual({ ok: true, bytes: old.content, mediaType: 'text/plain' });
  }
});
it('BQ-10 reports empty locally with no fetch and keeps the legacy consumer interface usable', async () => {
  const f = await fixture();
  expect(await f.consumer.serving()).toEqual({ status: 'empty' }); expect(f.remote.calls).toEqual([]);
  const fake: import('./types.js').GenerationConsumer = {
    async refresh() { return { status: 'held', reason: 'transport_unavailable', lastGood: null }; },
    async current() { return null; }, async manifest() { return null; },
    async readFile() { return { ok: false, reason: 'unavailable' }; }
  };
  expect(await fake.current()).toBeNull(); expect('serving' in fake).toBe(false);
});
