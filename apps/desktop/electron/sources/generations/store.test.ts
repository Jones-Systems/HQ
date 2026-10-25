import { afterEach, expect, it } from 'vitest';
import { chmod, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, sha256 } from './canonical-json.js';
import { GenerationStore } from './store.js';
import type { StoreHooks } from './store.js';
import type { GenerationBinding, GenerationManifest } from './types.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const binding: GenerationBinding = { origin: 'http://127.0.0.1:43210', publisherId: 'store-publisher', hostId: 'store-host',
  rootId: 'store-root', bindingRevision: 'binding-one', scopeDigest: 'a'.repeat(64), consistencyMode: 'observed-files-v1' };
async function fixture(hooks: StoreHooks = {}) {
  const root = await mkdtemp(join(tmpdir(), 'hq-generation-store-')); roots.push(root);
  return { root, store: new GenerationStore(root, hooks) };
}
function vector(sequence = '1') {
  const value: GenerationManifest = { schema: 'hq-sync.manifest/v1', publisher_id: binding.publisherId, host_id: binding.hostId,
    root_id: binding.rootId, binding_revision: binding.bindingRevision, scope_digest: binding.scopeDigest,
    epoch: '1', sequence, predecessor: null, published_at: '2026-02-03T04:05:06Z',
    capture: { method: 'observed-files-v1', observation_id: 'sample-observation', started_at: '2026-02-03T04:05:00Z', finished_at: '2026-02-03T04:05:06Z',
      source_generation: null, source_inventory_sha256: null, point_in_time: false, application_completion: 'not-asserted' },
    inventory: { enumeration: 'complete-within-declared-scope', file_count: 0, total_bytes: 0, inventory_sha256: sha256(canonicalJson([])) },
    files: [], presentations: [], retention_policy: 'no-automatic-deletion-v1' };
  const bytes = canonicalJson(value);
  return { value, bytes, identity: { rootId: binding.rootId, epoch: '1', sequence, manifestSha256: sha256(bytes) } };
}
async function activate(store: GenerationStore, sequence = '1') {
  const expected = await store.snapshot(binding.rootId), v = vector(sequence);
  await store.putManifest(v.identity, v.bytes, binding);
  await store.activate(expected, binding, v.identity);
  return v;
}
function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
it('persists private verified blobs and manifests before a restart-readable pointer', async () => {
  const { root, store } = await fixture();
  const bytes = new TextEncoder().encode('abc'), item = { path: 'sample.txt', size: 3, sha256: sha256(bytes), media_type: 'text/plain' };
  await store.putBlob(item, bytes);
  const v = await activate(store);
  expect((await stat(root)).mode & 0o777).toBe(0o700);
  for (const name of ['blobs', 'manifests', 'roots', 'staging']) expect((await stat(join(root, name))).mode & 0o777).toBe(0o700);
  expect((await stat(join(root, 'blobs', item.sha256))).mode & 0o777).toBe(0o600);
  expect((await stat(join(root, 'roots', binding.rootId + '.json'))).mode & 0o777).toBe(0o600);
  expect(await readdir(join(root, 'staging'))).toEqual([]);
  const restarted = new GenerationStore(root);
  expect((await restarted.snapshot(binding.rootId)).pointer?.generation).toEqual(v.identity);
  expect(await restarted.manifest(v.identity, binding)).toEqual(v.value);
  expect(await restarted.readBlob(item)).toEqual(bytes);
  await writeFile(join(root, 'blobs', item.sha256), 'changed');
  await expect(restarted.readBlob(item)).rejects.toMatchObject({ reason: 'blob_mismatch' });
});
it('leaves the pointer unchanged and cleans only its own staging file on a pre-rename failure', async () => {
  const { root, store } = await fixture(); await activate(store);
  const path = join(root, 'roots', binding.rootId + '.json'), before = await readFile(path);
  const failing = new GenerationStore(root, { async beforeRename(kind) { if (kind === 'pointer') throw Error('synthetic pre-rename failure'); } });
  const expected = await failing.snapshot(binding.rootId), v = vector('2');
  await failing.putManifest(v.identity, v.bytes, binding);
  await writeFile(join(root, 'staging', 'unrelated-owned-elsewhere'), 'preserve');
  await expect(failing.activate(expected, binding, v.identity)).rejects.toMatchObject({ reason: 'store_unavailable' });
  expect(failing.uncertain).toBe(false);
  expect(await readFile(path)).toEqual(before);
  expect(await readdir(join(root, 'staging'))).toEqual(['unrelated-owned-elsewhere']);
  expect((await failing.snapshot(binding.rootId)).pointer?.generation.sequence).toBe('1');
});
it('poisons after a pointer rename without rolling back the possibly committed pointer', async () => {
  const { root, store } = await fixture(); await activate(store);
  const failing = new GenerationStore(root, { async afterRename(kind) { if (kind === 'pointer') throw Error('synthetic post-rename failure'); } });
  const expected = await failing.snapshot(binding.rootId), v = vector('2');
  await failing.putManifest(v.identity, v.bytes, binding);
  await expect(failing.activate(expected, binding, v.identity)).rejects.toMatchObject({ reason: 'store_uncertain' });
  await expect(failing.snapshot(binding.rootId)).rejects.toMatchObject({ reason: 'store_uncertain' });
  expect(await readdir(join(root, 'staging'))).toEqual([]);
  expect((await new GenerationStore(root).snapshot(binding.rootId)).pointer?.generation).toEqual(v.identity);
});
it('also poisons uncertain blob and manifest writes before pointer publication', async () => {
  for (const kind of ['blob', 'manifest'] as const) {
    const { root, store } = await fixture({ async afterRename(actual) { if (actual === kind) throw Error('synthetic durability failure'); } });
    const v = vector(), bytes = new TextEncoder().encode('x');
    const operation = kind === 'blob'
      ? store.putBlob({ path: 'x', size: 1, sha256: sha256(bytes), media_type: 'text/plain' }, bytes)
      : store.putManifest(v.identity, v.bytes, binding);
    await expect(operation).rejects.toMatchObject({ reason: 'store_uncertain' });
    expect((await new GenerationStore(root).snapshot(binding.rootId)).pointer).toBeNull();
  }
});
it('serializes slow promotions across instances and rejects the stale expected pointer', async () => {
  const { root, store } = await fixture(); await activate(store);
  const entered = deferred(), release = deferred();
  const first = new GenerationStore(root, { async beforeRename(kind) { if (kind === 'pointer') { entered.resolve(); await release.promise; } } });
  const second = new GenerationStore(root);
  const a = vector('2'), b = vector('3');
  const expectedA = await first.snapshot(binding.rootId), expectedB = await second.snapshot(binding.rootId);
  await first.putManifest(a.identity, a.bytes, binding); await second.putManifest(b.identity, b.bytes, binding);
  const pendingA = first.activate(expectedA, binding, a.identity);
  try {
    await entered.promise;
    const pendingB = second.activate(expectedB, binding, b.identity);
    const rejectedB = expect(pendingB).rejects.toMatchObject({ reason: 'superseded' });
    release.resolve();
    await pendingA; await rejectedB;
    expect((await second.snapshot(binding.rootId)).pointer?.generation).toEqual(a.identity);
  } finally { release.resolve(); await pendingA; }
});
it('rejects unsafe directories and symlinked blobs without following them', async () => {
  const { root, store } = await fixture(); await store.snapshot(binding.rootId);
  await chmod(join(root, 'blobs'), 0o755);
  await expect(store.snapshot(binding.rootId)).rejects.toMatchObject({ reason: 'store_unavailable' });
  await chmod(join(root, 'blobs'), 0o700);
  const bytes = new TextEncoder().encode('safe'), checksum = sha256(bytes), target = join(root, 'synthetic-target');
  await writeFile(target, bytes, { mode: 0o600 });
  await symlink(target, join(root, 'blobs', checksum));
  await expect(store.readBlob({ path: 'item', size: 4, sha256: checksum, media_type: 'text/plain' })).rejects.toMatchObject({ reason: 'store_unavailable' });
  expect(await readFile(target)).toEqual(Buffer.from(bytes));
});
