import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openEnabledCandidateStorage } from '../../../modules/design/app/storage/enabled-candidate.ts';
import { allCallFs } from '../../../modules/design/app/storage/test/engine-fixture.ts';
import { nodeFs, type StoreFs } from '../../../packages/design-store/src/fs.ts';
import { encodeName } from '../../../packages/design-store/src/layout.ts';
import { sha256Digest, type WriteOp } from '../../../modules/design/imports/src/contract.ts';
import { createDesignHost } from './design-host';

type Host = ReturnType<typeof createDesignHost>;
interface Fixture {
  dir: string;
  root: string;
  track(host: Host): Host;
  reset(action: () => void): void;
}
const key = 'design/projects/candidate';
const stream = 'design/imports';
const bytes = new TextEncoder().encode('synthetic candidate blob');
const digest = sha256Digest('sha256:' + createHash('sha256').update(bytes).digest('hex'));
const document = { candidate: true, digest };
const payload = { type: 'import.applied', importId: 'candidate' };
const exportedAt = '2026-01-01T00:00:00Z';
const disabled = { ok: false, kind: 'unavailable', reason: 'disabled' };
const unavailable = { ok: false, kind: 'unavailable' };
const operations = (): readonly WriteOp[] => [
  { op: 'put-document', namespace: 'workspace', key, value: document, expectedRevision: null },
  { op: 'put-blob', namespace: 'workspace', digest, mediaType: 'text/plain', bytes },
  { op: 'append-event', namespace: 'workspace', stream, payload, expectedSeq: 0 },
];
const journal = (root: string) => join(root, 'generations/g000001/ns/workspace/events', encodeName(stream) + '.jsonl');
function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
function files(root: string): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) for (const [name, contents] of Object.entries(files(path))) out[`${entry.name}/${name}`] = contents;
    else out[entry.name] = readFileSync(path);
  }
  return out;
}
const quarantines = (root: string) => Object.entries(files(root)).filter(([name]) => name.startsWith('quarantine/'));

async function synthetic(run: (fixture: Fixture) => Promise<void>) {
  const parent = join(process.cwd(), '.t3/shared-host');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'imports-candidate-'));
  const hosts: Host[] = [], resets: (() => void)[] = [];
  const failures: unknown[] = [];
  const root = join(dir, 'store');
  try {
    await run({ dir, root, track: host => { hosts.push(host); return host; }, reset: action => { resets.push(action); } });
  } catch (error) {
    failures.push(error);
    console.error('Synthetic candidate failure files', Object.entries(files(dir)).map(([name, data]) => ({
      name, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'),
    })));
  } finally {
    for (const reset of resets) reset();
    for (const host of hosts.reverse()) {
      try { await host.close(); } catch (error) { failures.push(error); }
    }
    try { await rm(dir, { recursive: true, force: true }); } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, 'Synthetic candidate or cleanup failed');
  expect(existsSync(dir)).toBe(false);
}

async function committed(host: Host) {
  expect(await host.call('doc.get', { key })).toMatchObject({ ok: true, value: { key, revision: 1, value: document } });
  expect(await host.call('doc.list', { prefix: 'design/projects/' })).toEqual({ ok: true, value: [key] });
  expect(await host.call('blob.get', { digest })).toEqual({ ok: true, value: bytes });
  expect(await host.call('blob.has', { digest })).toEqual({ ok: true, value: true });
  expect(await host.call('event.read', { stream })).toEqual({ ok: true, value: { events: [{ seq: 1, payload }], status: { state: 'ok' } } });
}
async function pendingId(host: Host): Promise<string> {
  const result = await host.call('storage.diagnostics', {});
  expect(result).toMatchObject({ ok: true, value: { pending: [expect.stringMatching(/^[a-f0-9]{64}$/)] } });
  if (!result.ok || !result.value || typeof result.value !== 'object' || !('pending' in result.value)
    || !Array.isArray(result.value.pending) || result.value.pending.length !== 1 || typeof result.value.pending[0] !== 'string') throw new Error('Expected one pending intent');
  return result.value.pending[0];
}
async function blocked(host: Host, txnId: string) {
  expect(await host.call('storage.diagnostics', {})).toMatchObject({ ok: true, value: { pending: [txnId], blocked: [{ txnId, keys: [key], streams: [stream] }] } });
  for (const [route, params] of [
    ['doc.get', { key }], ['blob.get', { digest }], ['blob.has', { digest }], ['event.read', { stream }],
  ] as const) expect(await host.call(route, params)).toEqual(unavailable);
  expect(await host.call('doc.list', { prefix: 'design/projects/' })).toEqual({ ok: true, value: [] });
  for (const [route, params] of [
    ['doc.put', { key, value: { bypass: true } }],
    ['blob.put', { bytes, expectedDigest: digest }],
    ['event.append', { stream, payload: { bypass: true } }],
  ] as const) expect(await host.call(route, params)).toEqual({ ok: false, kind: 'unknown' });
  expect(await host.call('doc.put', { key: 'design/flows/unaffected', value: { available: true } })).toMatchObject({ ok: true });
  expect(await host.call('doc.get', { key: 'design/flows/unaffected' })).toMatchObject({ ok: true, value: { value: { available: true } } });
}
async function crashBeforeFirstAppend(fixture: Fixture, torn: boolean) {
  const fault = allCallFs(), append = fault.fs.append;
  fixture.reset(() => { fault.disarm(); fault.fs.append = append; });
  fault.fs.append = (path, data) => { fault.arm(0, torn); return append(path, data); };
  const host = fixture.track(createDesignHost(() => openEnabledCandidateStorage({ root: fixture.root, fs: fault.fs })));
  expect(await host.call('import.commit', { ops: operations() })).toEqual({ ok: false, kind: 'unknown' });
  expect(fault.crashed).toBe(true);
  expect(fault.trace).toEqual(['append']);
  fault.disarm(); fault.fs.append = append;
  const txnId = await pendingId(host);
  await host.close();
  return txnId;
}

it('commits through the candidate host, persists across new hosts, enables diagnostics and keeps export OFF', async () => {
  await synthetic(async f => {
    let opens = 0;
    const save = vi.fn();
    const host = f.track(createDesignHost(() => { opens++; return openEnabledCandidateStorage({ root: f.root }); }, save));
    expect(await host.call('import.status', {})).toEqual({ ok: true, value: { accepted: true, state: 'candidate' } });
    expect(await host.call('import.commit', { ops: operations() })).toEqual({ ok: true, value: { txnId: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    await committed(host);
    expect(opens).toBe(1);
    expect(await host.call('storage.diagnostics', {})).toMatchObject({ ok: true, value: { pending: [], blocked: [] } });
    for (const route of ['export.preview', 'export.save']) expect(await host.call(route, { exportedAt })).toEqual(disabled);
    expect(save).not.toHaveBeenCalled();
    await host.close();
    const reopened = f.track(createDesignHost(() => openEnabledCandidateStorage({ root: f.root })));
    await committed(reopened);
  });
});

it('gates every participating reader and writer behind a commit paused after manifest publication', async () => {
  await synthetic(async f => {
    const reached = barrier(), release = barrier();
    f.reset(release.resolve);
    let paused = false;
    const fs: StoreFs = { ...nodeFs, async append(path, data) {
      if (!paused && path === journal(f.root)) { paused = true; reached.resolve(); await release.promise; }
      await nodeFs.append(path, data);
    } };
    const host = f.track(createDesignHost(() => openEnabledCandidateStorage({ root: f.root, fs })));
    expect(await host.ready()).toBe(true);
    const commit = host.call('import.commit', { ops: operations() });
    await Promise.race([reached.promise, commit.then(result => { throw new Error(`Commit ended before the append barrier: ${JSON.stringify(result)}`); })]);
    const another = new TextEncoder().encode('another synthetic blob');
    const anotherDigest = 'sha256:' + createHash('sha256').update(another).digest('hex');
    const routes = [
      ['doc.get', { key }], ['doc.list', { prefix: 'design/projects/' }],
      ['doc.put', { key: 'design/flows/after', value: { after: true }, expectedRevision: null }],
      ['blob.get', { digest }], ['blob.has', { digest }], ['blob.put', { bytes: another, expectedDigest: anotherDigest }],
      ['event.read', { stream }], ['event.append', { stream: 'design/requests/after/reviews', payload: { after: true } }],
    ] as const;
    const finished: string[] = [];
    const waiting = routes.map(([route, params]) => host.call(route, params).then(result => { finished.push(route); return result; }));
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(finished).toEqual([]);
    release.resolve();
    expect(await commit).toMatchObject({ ok: true });
    const results = await Promise.all(waiting);
    expect(results.map(result => result.ok)).toEqual(routes.map(() => true));
    expect(results[0]).toMatchObject({ ok: true, value: { value: document } });
    expect(results[1]).toEqual({ ok: true, value: [key] });
    expect(results[3]).toEqual({ ok: true, value: bytes });
    expect(results[4]).toEqual({ ok: true, value: true });
    expect(results[6]).toEqual({ ok: true, value: { events: [{ seq: 1, payload }], status: { state: 'ok' } } });
    await committed(host);
  });
});

it('replays a committed crash intent inside lazy host opening before exposing records', async () => {
  await synthetic(async f => {
    await crashBeforeFirstAppend(f, false);
    expect(existsSync(journal(f.root))).toBe(false);
    const reached = barrier(), release = barrier();
    f.reset(release.resolve);
    let replayed = false;
    const fs: StoreFs = { ...nodeFs, async append(path, data) {
      if (!replayed && path === journal(f.root)) { replayed = true; reached.resolve(); await release.promise; }
      await nodeFs.append(path, data);
    } };
    let opens = 0, complete = false;
    const host = f.track(createDesignHost(() => { opens++; return openEnabledCandidateStorage({ root: f.root, fs }); }));
    const read = host.call('doc.get', { key }).then(result => { complete = true; return result; });
    await Promise.race([reached.promise, read.then(result => { throw new Error(`Read ended before the replay barrier: ${JSON.stringify(result)}`); })]);
    expect(complete).toBe(false);
    release.resolve();
    expect(await read).toMatchObject({ ok: true, value: { value: document } });
    await committed(host);
    expect(opens).toBe(1);
    expect(await host.call('storage.diagnostics', {})).toMatchObject({ ok: true, value: { pending: [], blocked: [] } });
  });
});

it('keeps torn scopes blocked until explicit host repair quarantines the exact original journal', async () => {
  await synthetic(async f => {
    const txnId = await crashBeforeFirstAppend(f, true);
    const original = readFileSync(journal(f.root));
    expect(original.length).toBeGreaterThan(0);
    expect(quarantines(f.root)).toEqual([]);
    const host = f.track(createDesignHost(() => openEnabledCandidateStorage({ root: f.root })));
    expect(await host.ready()).toBe(true);
    await blocked(host, txnId);
    expect(readFileSync(journal(f.root))).toEqual(original);
    expect(quarantines(f.root)).toEqual([]);
    await host.close();
    const reopened = f.track(createDesignHost(() => openEnabledCandidateStorage({ root: f.root })));
    expect(await reopened.call('doc.get', { key })).toEqual(unavailable);
    expect(quarantines(f.root)).toEqual([]);
    expect(await reopened.call('import.repair', { txnId })).toEqual({ ok: true, value: { txnId, repaired: true } });
    const saved = quarantines(f.root);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.[1]).toEqual(original);
    await committed(reopened);
    expect(await reopened.call('storage.diagnostics', {})).toMatchObject({ ok: true, value: { pending: [], blocked: [] } });
  });
});

it('refuses corrupt-stream repair through the host without changing bytes or unblocking scopes', async () => {
  await synthetic(async f => {
    const txnId = await crashBeforeFirstAppend(f, true);
    writeFileSync(journal(f.root), '{}\n');
    const host = f.track(createDesignHost(() => openEnabledCandidateStorage({ root: f.root })));
    expect(await host.ready()).toBe(true);
    await blocked(host, txnId);
    const before = files(f.root);
    expect(await host.call('import.repair', { txnId })).toEqual({ ok: false, kind: 'unknown' });
    expect(files(f.root)).toEqual(before);
    expect(quarantines(f.root)).toEqual([]);
    expect(await host.call('doc.get', { key })).toEqual(unavailable);
    expect(await host.call('event.read', { stream })).toEqual(unavailable);
    await host.close();
    const reopened = f.track(createDesignHost(() => openEnabledCandidateStorage({ root: f.root })));
    expect(await reopened.call('doc.get', { key })).toEqual(unavailable);
    expect(await reopened.call('import.repair', { txnId })).toEqual({ ok: false, kind: 'unknown' });
    expect(readFileSync(journal(f.root))).toEqual(Buffer.from('{}\n'));
  });
});

it('leaves every import route and export route disabled in the emitted production host', async () => {
  await synthetic(async f => {
    const emitted: typeof import('../../../modules/design/app/storage/node.ts') = await import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'apps/desktop/dist-electron/design-host/modules/design/app/storage/node.js')).href);
    const save = vi.fn(), host = f.track(createDesignHost(() => emitted.openDesignStorage({ root: f.root }), save));
    expect(await host.ready()).toBe(true);
    for (const [route, params] of [
      ['import.commit', { ops: operations() }], ['import.status', {}],
      ['import.repair', { txnId: 'a'.repeat(64) }], ['storage.diagnostics', {}],
      ['export.preview', { exportedAt }], ['export.save', { exportedAt }],
    ] as const) expect(await host.call(route, params)).toEqual(disabled);
    expect(save).not.toHaveBeenCalled();
    expect(await host.call('doc.get', { key })).toEqual({ ok: true, value: null });
    expect(await host.call('event.read', { stream })).toEqual({ ok: true, value: { events: [], status: { state: 'ok' } } });
    expect(await host.call('blob.has', { digest })).toEqual({ ok: true, value: false });
    expect(quarantines(f.root)).toEqual([]);
  });
});
