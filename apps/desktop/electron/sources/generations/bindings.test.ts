import { afterEach, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { bindingKey, createConsumerBindingReader, diffBindingSets, parseConsumerBindingSet, rebindable } from './bindings.js';
import type { ConsumerBindingReaderSeam } from './bindings.js';
import { canonicalJson, sha256 } from './canonical-json.js';
import type { GenerationBinding } from './types.js';

const publisherId = 'publisher-synthetic';
const projected: GenerationBinding = { publisherId, hostId: 'host-synthetic', rootId: 'root-synthetic',
  bindingRevision: 'binding-synthetic', scopeDigest: 'a'.repeat(64), consistencyMode: 'observed-files-v1', origin: 'http://127.0.0.1:48123' };
const vectorSha = '594b26fd33e6bfa56fe98e57e5d312fc9da94493de988c7a29de61cda0420269';
function document() {
  // Insertion order is independently prescribed here; the normative vector is
  // serialized without calling HQ's canonical encoder or copying a producer file.
  return { completeness: 'complete-for-publisher-binding', host_id: 'host-synthetic', origin: 'http://127.0.0.1:48123',
    provenance: { forward_binding_id: 'b'.repeat(64), observed_at: '2026-01-01T00:00:00Z', request_digest: 'c'.repeat(64) },
    publisher_id: publisherId, roots: [{ binding_revision: 'binding-synthetic', consistency_mode: 'observed-files-v1',
      root_id: 'root-synthetic', scope_digest: 'a'.repeat(64) }], schema: 'hq-sync.consumer-bindings/v1', set_revision: '1' };
}
const vector = () => new TextEncoder().encode(JSON.stringify(document()));
const accepted = { hostId: 'host-synthetic', setRevision: '1', sha256: vectorSha };
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => fs.rm(path, { recursive: true, force: true }))); });
async function homeFixture() {
  const home = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'hq-bindings-'))); roots.push(home);
  const directory = join(home, '.local/share/host-tooling/hq-sync/consumer-bindings'), file = join(directory, publisherId + '.json');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.writeFile(file, vector(), { mode: 0o600 });
  return { home, directory, file };
}
function reader(home: string, override: Partial<ConsumerBindingReaderSeam> = {}) {
  return createConsumerBindingReader({ home: () => home, platform: process.platform, uid: process.getuid, constants, fs, ...override });
}
function changedInfo<T extends object>(info: T, changes: Partial<T>): T {
  return Object.assign(Object.create(Object.getPrototypeOf(info)), info, changes);
}

it('BQ-1 projects the independent cross-language vector and replays the full unchanged set without provenance', () => {
  const bytes = vector();
  expect(bytes.length).toBe(629); expect(sha256(bytes)).toBe(vectorSha);
  const set = { publisherId, hostId: projected.hostId, origin: projected.origin, setRevision: '1', sha256: vectorSha, bindings: [projected] };
  expect(parseConsumerBindingSet(bytes, publisherId, null)).toEqual({ kind: 'advanced', set });
  expect(parseConsumerBindingSet(bytes, publisherId, accepted)).toEqual({ kind: 'unchanged', set });
});
it('BQ-2 rejects closed-schema, completeness, root-order, scalar, provenance and origin changes', () => {
  const good = document();
  const variants: unknown[] = [];
  for (const key of Object.keys(good)) { const v = { ...good } as Record<string, unknown>; delete v[key]; variants.push(v); }
  for (const key of Object.keys(good.roots[0])) {
    const root = { ...good.roots[0] } as Record<string, unknown>; delete root[key]; variants.push({ ...good, roots: [root] });
  }
  for (const key of Object.keys(good.provenance)) {
    const provenance = { ...good.provenance } as Record<string, unknown>;
    delete provenance[key]; variants.push({ ...good, provenance });
  }
  variants.push({ ...good, extra: true }, { ...good, roots: [{ ...good.roots[0], extra: true }] },
    { ...good, schema: 'hq-sync.consumer-bindings/v2' }, { ...good, completeness: 'partial' },
    { ...good, roots: [...good.roots, ...good.roots] },
    { ...good, roots: [{ ...good.roots[0], root_id: 'z' }, { ...good.roots[0], root_id: 'a' }] },
    { ...good, roots: Array.from({ length: 65 }, (_, i) => ({ ...good.roots[0], root_id: String(i).padStart(3, '0') })) },
    { ...good, roots: [{ ...good.roots[0], root_id: 'bad.id' }] },
    { ...good, roots: [{ ...good.roots[0], binding_revision: '' }] },
    { ...good, roots: [{ ...good.roots[0], scope_digest: 'A'.repeat(64) }] },
    { ...good, roots: [{ ...good.roots[0], consistency_mode: 'unknown' }] },
    { ...good, set_revision: '0' }, { ...good, set_revision: '01' },
    { ...good, provenance: { ...good.provenance, extra: true } },
    { ...good, provenance: { ...good.provenance, request_digest: 'bad' } },
    { ...good, provenance: { ...good.provenance, forward_binding_id: 'bad' } },
    { ...good, provenance: { ...good.provenance, observed_at: '2026-02-30T00:00:00Z' } });
  for (const origin of ['http://localhost:48123', 'http://127.0.0.1:0', 'http://127.0.0.1:65536', 'https://127.0.0.1:48123',
    'http://127.0.0.1:48123/', 'http://127.0.0.1:48123?q=1', 'http://u@127.0.0.1:48123', 'http://[::1]:48123']) {
    variants.push({ ...good, origin }, { ...good, origin, roots: [] });
  }
  for (const value of variants) expect(parseConsumerBindingSet(canonicalJson(value), publisherId, null)).toEqual({ kind: 'held', reason: 'bindings_invalid' });
  for (const bytes of [new TextEncoder().encode(JSON.stringify(good) + '\n'), new Uint8Array([0xff]), new Uint8Array(65537)])
    expect(parseConsumerBindingSet(bytes, publisherId, null)).toEqual({ kind: 'held', reason: 'bindings_invalid' });
  expect(parseConsumerBindingSet(canonicalJson({ ...good, roots: [] }), publisherId, null)).toMatchObject({ kind: 'advanced', set: { bindings: [] } });
  const maximal = { ...good, roots: Array.from({ length: 64 }, (_, i) => ({ ...good.roots[0],
    root_id: String(i).padStart(3, '0') + 'r'.repeat(125), binding_revision: 'b'.repeat(128) })) };
  expect(parseConsumerBindingSet(canonicalJson(maximal), publisherId, null)).toMatchObject({ kind: 'advanced' });
});
it('BQ-3 accepts monotonic string revisions, detects forks/rollback and keeps identity separate', () => {
  const higher = canonicalJson({ ...document(), set_revision: '9007199254740993' });
  expect(parseConsumerBindingSet(higher, publisherId, null)).toMatchObject({ kind: 'advanced', set: { setRevision: '9007199254740993' } });
  expect(parseConsumerBindingSet(higher, publisherId, accepted)).toMatchObject({ kind: 'advanced' });
  expect(parseConsumerBindingSet(vector(), publisherId, { ...accepted, setRevision: '9007199254740993' })).toMatchObject({ kind: 'unchanged' });
  expect(parseConsumerBindingSet(higher, publisherId, { ...accepted, setRevision: '9007199254740994' })).toEqual({ kind: 'held', reason: 'bindings_rollback' });
  expect(parseConsumerBindingSet(canonicalJson({ ...document(), origin: 'http://127.0.0.1:48124' }), publisherId, accepted))
    .toEqual({ kind: 'held', reason: 'bindings_fork' });
  for (const id of ['Publisher-synthetic', 'other-publisher'])
    expect(parseConsumerBindingSet(vector(), id, null)).toEqual({ kind: 'held', reason: 'bindings_identity_changed' });
  expect(parseConsumerBindingSet(vector(), publisherId, { ...accepted, hostId: 'different-host' }))
    .toEqual({ kind: 'held', reason: 'bindings_identity_changed' });
});
it('BQ-4(a,g) validates IDs and platform primitives before any filesystem or home call', async () => {
  const call = vi.fn(async () => { throw Error('must not touch filesystem'); });
  const home = vi.fn(() => '/synthetic-unused');
  const base = { home, fs: { open: call, lstat: call } };
  for (const id of ['', 'a/b', 'a\\b', '.', '..', '.a', 'a.json', 'a\0', 'é', 'a'.repeat(129), '-a']) {
    expect(await reader('/unused', base)(id, null)).toEqual({ kind: 'held', reason: 'bindings_invalid' });
  }
  for (const override of [{ platform: 'win32' }, { uid: undefined }, { constants: { ...constants, O_NOFOLLOW: undefined } },
    { constants: { ...constants, O_DIRECTORY: undefined } }, { constants: { ...constants, O_NONBLOCK: undefined } }])
    expect(await reader('/unused', { ...base, ...override })(publisherId, null)).toEqual({ kind: 'held', reason: 'bindings_untrusted' });
  expect(call).not.toHaveBeenCalled(); expect(home).not.toHaveBeenCalled();
});
it('BQ-4(h) reads descriptor-bound exact bytes without modifying file or directory identity/mtime', async () => {
  const f = await homeFixture(), beforeD = await fs.stat(f.directory, { bigint: true }), beforeF = await fs.stat(f.file, { bigint: true });
  const open = vi.fn((path: string, flags: number) => fs.open(path, flags));
  expect(await reader(f.home, { fs: { ...fs, open } })(publisherId, null)).toMatchObject({ kind: 'advanced', set: { sha256: vectorSha, bindings: [projected] } });
  expect(open.mock.calls.map(call => call[1])).toEqual([
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK]);
  for (const [path, before] of [[f.directory, beforeD], [f.file, beforeF]] as const) {
    const after = await fs.stat(path, { bigint: true });
    expect([after.ino, after.mtimeNs]).toEqual([before.ino, before.mtimeNs]);
  }
});
it('BQ-4(b) refuses a symlink at every home-to-file chain component', async () => {
  for (const component of ['', '.local', '.local/share', '.local/share/host-tooling', '.local/share/host-tooling/hq-sync',
    '.local/share/host-tooling/hq-sync/consumer-bindings', '.local/share/host-tooling/hq-sync/consumer-bindings/' + publisherId + '.json']) {
    const f = await homeFixture();
    const selected = component ? join(f.home, component) : f.home;
    // Place the replacement target under the owned test root, including the H case.
    const target = component ? join(f.home, 'preserved-target') : join(f.home, 'nested-home');
    if (!component) {
      await fs.mkdir(target, { mode: 0o700 });
      const link = join(f.home, 'linked-home'); await fs.symlink(target, link);
      expect(await reader(link)(publisherId, null)).toEqual({ kind: 'held', reason: 'bindings_untrusted' });
    } else {
      await fs.rename(selected, target); await fs.symlink(target, selected);
      expect(await reader(f.home)(publisherId, null)).toEqual({ kind: 'held', reason: 'bindings_untrusted' });
    }
  }
});
it('BQ-4(c) checks every private directory owner and group/world write bits', async () => {
  for (const component of ['', '.local', '.local/share', '.local/share/host-tooling', '.local/share/host-tooling/hq-sync', '.local/share/host-tooling/hq-sync/consumer-bindings']) {
    const f = await homeFixture(), path = component ? join(f.home, component) : f.home;
    for (const mode of [0o720, 0o702]) {
      await fs.chmod(path, mode);
      expect(await reader(f.home)(publisherId, null)).toEqual({ kind: 'held', reason: 'bindings_untrusted' });
      await fs.chmod(path, 0o700);
    }
    const lstat = async (name: string, options: { bigint: true }) => {
      const info = await fs.lstat(name, options);
      return name === path ? changedInfo(info, { uid: info.uid + 1n }) : info;
    };
    expect(await reader(f.home, { fs: { ...fs, lstat } })(publisherId, null)).toEqual({ kind: 'held', reason: 'bindings_untrusted' });
  }
});
it('BQ-4(d) refuses FIFO, directory, extra link, loose modes, foreign descriptor uid and oversize', async () => {
  for (const kind of ['fifo', 'directory', 'hardlink', '0640', '0644', 'owner', 'oversize']) {
    const f = await homeFixture();
    if (kind === 'fifo' || kind === 'directory') {
      await fs.unlink(f.file);
      if (kind === 'fifo') execFileSync('mkfifo', [f.file], { timeout: 1000, stdio: 'ignore' });
      else await fs.mkdir(f.file, { mode: 0o700 });
    } else if (kind === 'hardlink') await fs.link(f.file, join(f.home, 'second-link'));
    else if (kind === 'oversize') await fs.writeFile(f.file, new Uint8Array(65537));
    else if (kind === '0640' || kind === '0644') await fs.chmod(f.file, Number.parseInt(kind, 8));
    const open = async (path: string, flags: number) => {
      const handle = await fs.open(path, flags);
      return { close: () => handle.close(), read: handle.read.bind(handle), async stat(options: { bigint: true }) {
        const info = await handle.stat(options);
        return kind === 'owner' && path === f.file ? changedInfo(info, { uid: info.uid + 1n }) : info;
      } };
    };
    expect(await reader(f.home, { fs: { ...fs, open } })(publisherId, null), kind).toEqual({ kind: 'held', reason: 'bindings_untrusted' });
  }
}, 3000);
it('BQ-4(e) catches growth, file/directory replacement and a changed chain after descriptor reads', async () => {
  for (const kind of ['growth', 'file', 'directory', 'chain']) {
    const f = await homeFixture();
    const afterFileStat = async () => { if (kind === 'growth') await fs.appendFile(f.file, 'x'); };
    const afterRead = async () => {
      if (kind === 'file') { await fs.rename(f.file, join(f.home, 'prior-file')); await fs.writeFile(f.file, vector(), { mode: 0o600 }); }
      if (kind === 'directory') {
        const prior = join(dirname(f.directory), 'prior-directory');
        await fs.rename(f.directory, prior); await fs.mkdir(f.directory, { mode: 0o700 });
        await fs.rename(join(prior, publisherId + '.json'), f.file);
      }
      if (kind === 'chain') await fs.chmod(join(f.home, '.local'), 0o720);
    };
    expect(await reader(f.home, { afterFileStat, afterRead })(publisherId, null), kind).toEqual({ kind: 'held', reason: 'bindings_untrusted' });
  }
});
it('BQ-4(e) compares descriptor identities as BigInt even above the safe-integer boundary and closes both descriptors', async () => {
  const f = await homeFixture(), closes = vi.fn();
  const open = async (path: string, flags: number) => {
    const handle = await fs.open(path, flags);
    return { async close() { closes(path); await handle.close(); }, read: handle.read.bind(handle), async stat(options: { bigint: true }) {
      const info = await handle.stat(options);
      return path === f.file ? changedInfo(info, { ino: 9007199254740992n }) : info;
    } };
  };
  const lstat = async (path: string, options: { bigint: true }) => {
    const info = await fs.lstat(path, options);
    return path === f.file ? changedInfo(info, { ino: 9007199254740993n }) : info;
  };
  expect(await reader(f.home, { fs: { open, lstat } })(publisherId, null)).toEqual({ kind: 'held', reason: 'bindings_untrusted' });
  expect(closes.mock.calls.flat().sort()).toEqual([f.directory, f.file].sort());
});
it('BQ-4(f) leaves absent files and chain components absent without creating anything', async () => {
  for (const missing of ['file', 'directory', 'home']) {
    const f = await homeFixture();
    const path = missing === 'file' ? f.file : missing === 'directory' ? f.directory : join(f.home, 'absent-home');
    if (missing !== 'home') await fs.rm(path, { recursive: true, force: true });
    expect(await reader(missing === 'home' ? path : f.home)(publisherId, null)).toEqual({ kind: 'held', reason: 'bindings_unavailable' });
    await expect(fs.lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
  }
});
it('BQ-5 uses stable keys, deterministic root ordering and distinct rebind/scope/not-issued classes', () => {
  const item = (rootId: string) => ({ ...projected, rootId });
  const old = [item('z-removed'), item('c-scope'), item('b-rebound'), item('a-same')];
  const next = [{ ...item('c-scope'), scopeDigest: 'd'.repeat(64) }, item('e-added'), item('d-added'),
    { ...item('b-rebound'), bindingRevision: 'next-revision', origin: 'http://127.0.0.1:48124' }, item('a-same')];
  const diff = diffBindingSets(old, next);
  expect(diff.added.map(value => value.rootId)).toEqual(['d-added', 'e-added']);
  expect(diff.unchanged).toEqual([item('a-same')]); expect(diff.notIssued).toEqual([item('z-removed')]);
  expect(diff.rebound).toEqual([{ from: item('b-rebound'), to: next[3] }]);
  expect(diff.scopeChanged).toEqual([{ from: item('c-scope'), to: next[0] }]);
  expect(diffBindingSets(old, old).unchanged.map(value => value.rootId)).toEqual(['a-same', 'b-rebound', 'c-scope', 'z-removed']);
  expect(bindingKey(projected)).toBe('["publisher-synthetic","host-synthetic","root-synthetic"]');
  expect(bindingKey({ ...projected, origin: 'http://127.0.0.1:48124', bindingRevision: 'later' })).toBe(bindingKey(projected));
  expect(rebindable(projected, { ...projected, bindingRevision: 'later' })).toBe(true);
  for (const change of [{ publisherId: 'another-publisher' }, { hostId: 'another-host' }, { rootId: 'another-root' },
    { scopeDigest: 'f'.repeat(64) }, { consistencyMode: 'producer-complete-v1' as const }, {}])
    expect(rebindable(projected, { ...projected, ...change })).toBe(false);
});
