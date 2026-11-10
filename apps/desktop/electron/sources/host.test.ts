import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSourceHost } from './host';
import type { CatalogSnapshot } from '@hq/contracts/catalog';
import { createGenerationConsumer, type GenerationBinding, type GenerationIdentity, type GenerationManifest } from './generations/index.js';
import { canonicalJson, sha256 } from './generations/canonical-json.js';
import { fileRoute, manifestRoute, rootRoute } from './generations/paths.js';
import type { FetchPort } from '../jones-code/wire.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const userData = await mkdtemp(join(tmpdir(), 'hq-sources-')); roots.push(userData);
  const jones = { environment: vi.fn(async () => ({ hostId: 'jones-one', fingerprint: 'fp' })), projects: vi.fn(async () => ({ projects: [], nextCursor: null })) };
  const mapper = vi.fn(async (_input: unknown, context: unknown) => ({ ...(context as object), complete: true, entries: [] }) as CatalogSnapshot);
  const catalog = { call: vi.fn(async () => ({ ok: true as const, value: [] })) };
  const host = createSourceHost({ userData, catalog, jones, mappers: async () => ({ jones: mapper, gallery: mapper }) });
  return { userData, host, jones, mapper, catalog };
}
it('keeps credentials and URLs out of source status and retains last-good after offline refresh', async () => {
  const f = await fixture();
  const enrolled = await f.host.call('enrollJones', { label: 'First environment' }); expect(enrolled.ok).toBe(true);
  const first = (enrolled as { ok: true; value: { sourceId: string; generation: number }[] }).value[0]!;
  expect(first.generation).toBe(1);
  f.jones.projects.mockRejectedValueOnce(Error('offline'));
  const refreshed = await f.host.call('refresh', { sourceId: first.sourceId });
  expect(refreshed).toMatchObject({ ok: true, value: [{ state: 'stale', generation: 2, lastSuccessAt: expect.any(String) }] });
  expect(JSON.stringify(refreshed)).not.toMatch(/accessToken|workspaceRoot|baseUrl/);
  expect(f.jones.projects).toHaveBeenLastCalledWith('jones-one');
});
it('persists generation across restart and keeps failed refresh generations consumed', async () => {
  const f = await fixture(); const enrolled = await f.host.call('enrollJones', { label: 'Environment' }) as { ok: true; value: { sourceId: string }[] };
  const host = createSourceHost({ userData: f.userData, catalog: f.catalog, jones: f.jones, mappers: async () => ({ jones: f.mapper, gallery: f.mapper }) });
  expect(await host.call('refresh', { sourceId: enrolled.value[0]!.sourceId })).toMatchObject({ ok: true, value: [{ generation: 2 }] });
});
it('preserves the v1 catalog preimage before registry initialization', async () => {
  const f = await fixture(), preimage = JSON.stringify({ generation: 91, root: null });
  await writeFile(join(f.userData, 'design-catalog.json'), preimage);
  await f.host.call('status', {});
  expect(await readFile(join(f.userData, 'sources/catalog-v1-preimage.json'), 'utf8')).toBe(preimage);
  expect(await readFile(join(f.userData, 'design-catalog.json'), 'utf8')).toBe(preimage);
});
it('refuses untrusted URLs, route extras, and unknown source handles', async () => {
  const f = await fixture();
  for (const baseUrl of ['http://private.example/', 'https://user:secret@example.com/', 'file:///tmp/']) expect(await f.host.call('enrollGallery', { baseUrl, label: 'Gallery' })).toEqual({ ok: false, kind: 'invalid' });
  expect(await f.host.call('status', { token: 'leak' })).toEqual({ ok: false, kind: 'invalid' });
  expect(await f.host.call('refresh', { sourceId: 'missing' })).toEqual({ ok: false, kind: 'stale' });
});

const binding: GenerationBinding = { origin: 'http://127.0.0.1:43210', publisherId: 'host-publisher', hostId: 'host-one',
  rootId: 'root-one', bindingRevision: 'revision-one', scopeDigest: 'a'.repeat(64), consistencyMode: 'observed-files-v1' };
function publication(sequence = '9007199254740993', text = 'last-good bytes', epoch = '9007199254740995') {
  const bytes = new TextEncoder().encode(text);
  const files = [{ path: 'page.txt', size: bytes.length, sha256: sha256(bytes), media_type: 'text/plain' }];
  const manifest: GenerationManifest = { schema: 'hq-sync.manifest/v1', publisher_id: binding.publisherId, host_id: binding.hostId,
    root_id: binding.rootId, binding_revision: binding.bindingRevision, scope_digest: binding.scopeDigest, epoch, sequence,
    predecessor: null, published_at: '2026-03-04T05:06:07Z',
    capture: { method: binding.consistencyMode, observation_id: 'host-observation', started_at: '2026-03-04T05:06:00Z',
      finished_at: '2026-03-04T05:06:07Z', source_generation: null, source_inventory_sha256: null, point_in_time: false,
      application_completion: 'not-asserted' },
    inventory: { enumeration: 'complete-within-declared-scope', file_count: 1, total_bytes: bytes.length, inventory_sha256: sha256(canonicalJson(files)) },
    files, presentations: [{ id: 'page', kind: 'file', entry_path: 'page.txt', preview_path: null,
      dependency_mode: 'independent-file', required_paths: ['page.txt'] }], retention_policy: 'no-automatic-deletion-v1' };
  const manifestBytes = canonicalJson(manifest);
  const identity: GenerationIdentity = { rootId: binding.rootId, epoch, sequence, manifestSha256: sha256(manifestBytes) };
  const published = { epoch, sequence, manifest_sha256: identity.manifestSha256 };
  const ref = { schema: 'hq-sync.ref/v1', publisher_id: binding.publisherId, host_id: binding.hostId, root_id: binding.rootId,
    binding_revision: binding.bindingRevision, scope_digest: binding.scopeDigest, ...published, manifest_path: manifestRoute(identity) };
  const health = { schema: 'hq-sync.health/v1', publisher_id: binding.publisherId, publisher_instance_id: 'host-process',
    root_id: binding.rootId, binding_revision: binding.bindingRevision, scope_digest: binding.scopeDigest, observation_sequence: sequence,
    last_attempt_at: null, last_success_at: null, last_success_age_ms: null, source_status: 'ok', reason: 'source_ok',
    observed_inventory_sha256: null, published, pending_change: false, storage_status: 'ok' };
  return { bytes, manifest, manifestBytes, identity, ref, health };
}
async function generationFixture() {
  const f = await fixture();
  const remote = { value: publication(), offline: false };
  const fetcher = vi.fn<FetchPort>(async input => {
    if (remote.offline) throw Error('synthetic offline');
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).pathname;
    const v = remote.value;
    if (path === rootRoute(binding.rootId) + '/ref.json') return new Response(canonicalJson(v.ref));
    if (path === rootRoute(binding.rootId) + '/health.json') return new Response(canonicalJson(v.health));
    if (path === manifestRoute(v.identity)) return new Response(v.manifestBytes);
    if (path === fileRoute(v.identity, 'page.txt')) return new Response(v.bytes);
    return new Response(null, { status: 404 });
  });
  const storeRoot = join(f.userData, 'generation-store');
  const hostFor = (enrolledBinding = binding) => createSourceHost({ userData: f.userData, catalog: f.catalog, jones: f.jones,
    mappers: async () => ({ jones: f.mapper, gallery: f.mapper }),
    generations: createGenerationConsumer({ storeRoot, binding: enrolledBinding, fetch: fetcher }) });
  return { ...f, host: hostFor(), hostFor, remote, fetcher };
}
it('leaves the generation capability absent and existing enrollment explicit without injection', async () => {
  const f = await fixture();
  expect(f.host).not.toHaveProperty('generations');
  expect(await f.host.call('status', {})).toEqual({ ok: true, value: [] });
  expect(f.jones.environment).not.toHaveBeenCalled();
  expect(f.jones.projects).not.toHaveBeenCalled();
  expect(f.catalog.call).not.toHaveBeenCalled();
});
it('adapts typed activation and current results while preserving retained offline reads across restart', async () => {
  const f = await generationFixture(), v = f.remote.value, generations = f.host.generations!;
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(await generations.current()).toBeNull();
  expect(await generations.manifest()).toBeNull();
  expect(await generations.readBlob('page.txt')).toEqual({ ok: false, reason: 'not_in_generation' });
  const result = await generations.refresh();
  expect(result).toMatchObject({ status: 'activated', generation: v.identity, previous: null, health: { matchesRef: true } });
  if (result.status !== 'activated') throw Error('Expected activation');
  const identity: GenerationIdentity = result.generation;
  expect(identity.epoch).toBe('9007199254740995');
  expect(identity.sequence).toBe('9007199254740993');
  expect(await generations.refresh()).toMatchObject({ status: 'current', generation: identity });
  expect(await generations.manifest()).toEqual(v.manifest);
  expect(await generations.readBlob('page.txt')).toEqual({ ok: true, bytes: v.bytes, mediaType: 'text/plain' });
  f.remote.offline = true;
  expect(await generations.refresh()).toEqual({ status: 'held', reason: 'transport_unavailable', lastGood: identity });
  const restarted = f.hostFor().generations!, calls = f.fetcher.mock.calls.length;
  expect(await restarted.current()).toEqual(identity);
  expect(await restarted.manifest()).toEqual(v.manifest);
  expect(await restarted.readBlob('page.txt')).toEqual({ ok: true, bytes: v.bytes, mediaType: 'text/plain' });
  expect(await restarted.readBlob('../page.txt')).toEqual({ ok: false, reason: 'invalid_path' });
  expect(f.fetcher).toHaveBeenCalledTimes(calls);
  expect(f.catalog.call).not.toHaveBeenCalled();
  expect(f.jones.environment).not.toHaveBeenCalled();
  expect(f.jones.projects).not.toHaveBeenCalled();
});
it('preserves consumer scope and generation fences without enrolling or rebinding legacy sources', async () => {
  const f = await generationFixture(), v = f.remote.value, generations = f.host.generations!;
  await generations.refresh();
  for (const [candidate, reason] of [
    [publication('9007199254740992'), 'sequence_regression'],
    [publication(v.identity.sequence, 'conflicting bytes'), 'equal_sequence_digest_mismatch'],
    [publication('1', 'unreconciled epoch', '9007199254740996'), 'epoch_reconciliation_required'],
  ] as const) {
    f.remote.value = candidate;
    expect(await generations.refresh()).toEqual({ status: 'held', reason, lastGood: v.identity });
    expect(await generations.current()).toEqual(v.identity);
    expect(await generations.readBlob('page.txt')).toEqual({ ok: true, bytes: v.bytes, mediaType: 'text/plain' });
  }
  for (const changed of [{ bindingRevision: 'revision-two' }, { scopeDigest: 'b'.repeat(64) }, { hostId: 'host-two' }]) {
    const rebound = f.hostFor({ ...binding, ...changed }).generations!, calls = f.fetcher.mock.calls.length;
    expect(await rebound.refresh()).toMatchObject({ status: 'held', reason: 'binding_mismatch' });
    expect(await rebound.current()).toBeNull();
    expect(await rebound.manifest()).toBeNull();
    expect(await rebound.readBlob('page.txt')).toEqual({ ok: false, reason: 'unavailable' });
    expect(f.fetcher).toHaveBeenCalledTimes(calls);
  }
  expect(await f.host.call('status', {})).toEqual({ ok: true, value: [] });
  const enrolled = await f.host.call('enrollJones', { label: 'Explicit legacy enrollment' });
  expect(enrolled).toMatchObject({ ok: true, value: [{ generation: 1, hostId: 'jones-one', state: 'ready' }] });
  expect(await generations.current()).toEqual(v.identity);
  for (const route of ['current', 'manifest', 'readBlob']) expect(await f.host.call(route, {})).toEqual({ ok: false, kind: 'invalid' });
});
