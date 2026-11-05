import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'node:test';
import { digestOfBytes } from '../../../../../packages/design-store/src/jcs.ts';
import { encodeName } from '../../../../../packages/design-store/src/layout.ts';
import type { WriteOp, Sha256Digest } from '../../../imports/src/contract.ts';
import { IMPORT_LIMITS, createImportsStorage, type EngineResult } from '../transactions.ts';
import { makeDir, removeDir, proveCleanup } from './helpers.ts';
import { allCallFs, engineAt, TestCrash } from './engine-fixture.ts';
proveCleanup();
const value = <T>(r: EngineResult<T>): T => { assert.ok(r.ok); return r.value; };
const doc = (key = 'design/projects/a', expectedRevision: string | null = null): WriteOp => ({ op: 'put-document', namespace: 'workspace', key, value: { schema: 'hq.design.project-content/v1', projectId: 'p', views: [], versions: [], links: [], updatedAt: 't' }, expectedRevision });
const event = (stream = 'design/imports', expectedSeq = 0): WriteOp => ({ op: 'append-event', namespace: 'workspace', stream, payload: { type: 'import.applied', importId: 'i', at: 't', sourceDigest: 'x', counts: {} }, expectedSeq });
const blob = (text = 'fixture blob'): WriteOp => {
  const bytes = new TextEncoder().encode(text);
  return { op: 'put-blob', namespace: 'workspace', bytes, digest: digestOfBytes(bytes) as string as Sha256Digest, mediaType: 'text/plain' };
};
const operations = () => [doc(), blob(), event(), event('design/imports', 1), event('design/requests/r/review')];
function files(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) for (const [k, v] of Object.entries(files(p))) out[`${entry.name}/${k}`] = v;
    else out[entry.name] = readFileSync(p).toString('base64');
  }
  return out;
}
const journal = (root: string, stream: string) => join(root, 'generations/g000001/ns/workspace/events', encodeName(stream) + '.jsonl');

it('production construction is disabled and has no enable option or engine deletion surface', async () => {
  const dir = makeDir();
  try {
    const e = await engineAt(join(dir, 'store'));
    assert.deepEqual(await e.production.transactions.commit(operations()), { ok: false, kind: 'unavailable', reason: 'disabled' });
    assert.deepEqual(await e.production.transactions.recover(), { ok: false, kind: 'unavailable', reason: 'disabled' });
    assert.deepEqual(await e.production.transactions.repair('x'), { ok: false, kind: 'unavailable', reason: 'disabled' });
    assert.deepEqual(await e.production.exportBundle.build('2026-01-01T00:00:00Z'), { ok: false, kind: 'unavailable', reason: 'disabled' });
    assert.deepEqual(await e.production.exportBundle.preview('2026-01-01T00:00:00Z'), { ok: false, kind: 'unavailable', reason: 'disabled' });
    assert.equal(e.production.transactions.status.accepted, false);
    assert.equal(e.production.exportBundle.status.state, 'disabled');
    for (const surface of [e.transactions, e.transactions.workspace, e.exportBundle, createImportsStorage(e.transactions)]) {
      assert.ok(Object.keys(surface).every(k => !/delete|remove/i.test(k)));
    }
    const nodeSource = readFileSync(new URL('../node.ts', import.meta.url), 'utf8');
    assert.match(nodeSource, /createTransactionRuntime\(store\)/);
    assert.doesNotMatch(nodeSource, /enabled: true|createTransactionRuntime\(store,|test\//);
    await e.close();
  } finally { removeDir(dir); }
});
it('commit is idempotent, uses root-specific event types, and preserves every revision on retry', async () => {
  const dir = makeDir();
  try {
    const root = join(dir, 'store'); let e = await engineAt(root);
    const ops = operations(); const first = value(await e.transactions.commit(ops));
    assert.match(first.txnId, /^[0-9a-f]{64}$/);
    const before = files(root);
    assert.deepEqual(await e.transactions.commit(ops), { ok: true, value: first });
    assert.deepEqual(files(root), before);
    assert.equal((await e.transactions.workspace.readEvents('design/imports')).events.length, 2);
    assert.equal((await e.transactions.workspace.readEvents('design/requests/r/review')).events[0]?.type, 'requests.event-bytes');
    await e.close(); e = await engineAt(root);
    const reopened = files(root); await e.transactions.commit(ops); assert.deepEqual(files(root), reopened);
    await e.close();
  } finally { removeDir(dir); }
});
it('all preflight refusals leave byte-identical stores, including caps and existing damaged streams', async () => {
  const dir = makeDir();
  try {
    const root = join(dir, 'store'), e = await engineAt(root);
    await e.transactions.commit([doc()]);
    const overBlob = new Uint8Array(IMPORT_LIMITS.blobBytes + 1);
    const oversized = { ...blob(), bytes: overBlob, digest: digestOfBytes(overBlob) };
    const big = { ...doc('design/projects/large'), value: 'x'.repeat(IMPORT_LIMITS.totalBytes + 1) };
    const bads: unknown[] = [
      [{ ...doc(), value: { changed: true } }], [doc('design/projects/a', '999')], [event('design/imports', 2)],
      [doc('design/storage/forged')], [doc('imports/a')], [event('imports')],
      [{ ...doc(), op: 'erase' }], [{ ...doc(), extra: true }], [{ ...doc(), value: { bad: undefined } }],
      [{ ...blob(), bytes: new Uint8Array([1]) }], [oversized], [big], Array.from({ length: 10001 }, () => doc()),
      [event('design/imports/' + 'A'.repeat(100))],
    ];
    for (const ops of bads) {
      const before = files(root); await assert.rejects(e.transactions.commit(ops as WriteOp[])); assert.deepEqual(files(root), before);
    }
    await e.runtime.raw.appendEvent('design/imports', { type: 'imports.event', payload: {} });
    const p = journal(root, 'design/imports'); const good = readFileSync(p);
    for (const damaged of [Buffer.concat([good, Buffer.from('{')]), Buffer.from('{}\n')]) {
      writeFileSync(p, damaged); const before = files(root);
      await assert.rejects(e.transactions.commit([blob('not staged'), event('design/imports', 1)]));
      assert.deepEqual(files(root), before);
    }
    await e.close();
  } finally { removeDir(dir); }
});
for (const tear of [false, true]) it(`every fs call: process crash, reopen, overlay and replay (${tear ? 'torn' : 'clean'})`, async () => {
  let total = 0, absent = 0, applied = 0, blocked = 0;
  const covered = new Set<string>();
  for (let at = 0; ; at++) {
    const dir = makeDir();
    try {
      const root = join(dir, 'store'), fs = allCallFs();
      let e = await engineAt(root, fs.fs);
      fs.arm(at, tear);
      try { await e.transactions.commit(operations()); }
      catch (error) { assert.ok(error instanceof TestCrash, String(error)); }
      const crashed = fs.crashed; total = fs.count; for (const op of fs.trace) covered.add(op);
      fs.disarm(); await e.close(); e = await engineAt(root);
      const diagnostics = value(await e.transactions.diagnostics());
      if (diagnostics.pending.length) {
        blocked++;
        const txnId = diagnostics.pending[0]!;
        await assert.rejects(e.transactions.workspace.getDocument('design/projects/a'));
        await assert.rejects(e.transactions.workspace.readEvents('design/imports'));
        await assert.rejects(e.transactions.workspace.putDocument('design/projects/a', {}));
        assert.deepEqual(await e.transactions.workspace.listDocuments(), []);
        assert.deepEqual(await e.transactions.workspace.listStreams(), []);
        await e.transactions.workspace.putDocument('design/flows/unrelated', {});
        assert.ok(await e.transactions.workspace.getDocument('design/flows/unrelated'));
        const original = readFileSync(journal(root, 'design/imports'));
        const repair = value(await e.transactions.repair(txnId));
        assert.ok(repair.quarantine.length > 0);
        // One of the two target streams may be torn; every quarantine preserves its original bytes.
        assert.ok(repair.quarantine.every(q => readFileSync(join(root, q.quarantinedAs)).length >= q.removedTailBytes));
        if (repair.quarantine.some(q => readFileSync(join(root, q.quarantinedAs)).equals(original))) assert.ok(original.length);
      }
      const d = await e.transactions.workspace.getDocument('design/projects/a');
      const events = (await e.transactions.workspace.readEvents('design/imports')).events;
      const refs = await e.transactions.workspace.listBlobs();
      if (!d) { absent++; assert.equal(events.length, 0); assert.equal(refs.length, 0); }
      else {
        applied++; assert.equal(events.length, 2); assert.equal(new Set(events.map(x => x.clientEventId)).size, 2); assert.equal(refs.length, 1);
        const before = files(root); await e.transactions.commit(operations()); assert.deepEqual(files(root), before);
      }
      await e.close();
      if (!crashed) break;
    } finally { removeDir(dir); }
  }
  assert.ok(absent && applied); assert.equal(blocked > 0, tear);
  for (const name of ['readFile', 'stat', 'mkdir', 'writeNew', 'append', 'fsyncFile', 'fsyncDir', 'rename', 'unlink']) assert.ok(covered.has(name), name);
  console.log(JSON.stringify({ faultSweep: tear ? 'torn' : 'clean', calls: total, absent, applied, blocked, covered: [...covered] }));
});
it('live manifest failure keeps overlay, refuses retry, and requires reopen', async () => {
  const dir = makeDir();
  try {
    const root = join(dir, 'store'); const fs = allCallFs(); const e = await engineAt(root, fs.fs);
    // Fail immediately after the first document is moved into its final location.
    const originalRename = fs.fs.rename; let published = false;
    fs.fs.rename = async (from, to) => { await originalRename(from, to); if (from.includes('.stage-')) { published = true; throw new Error('live I/O failure'); } };
    await assert.rejects(e.transactions.commit(operations()), /live I\/O failure/);
    assert.ok(published);
    await assert.rejects(e.transactions.workspace.getDocument('design/projects/a'));
    await assert.rejects(e.transactions.commit(operations()), /Reopen required/);
    assert.equal(value(await e.transactions.recover()).blocked[0]?.reason, 'reopen-required');
    await e.close(); const reopened = await engineAt(root);
    assert.ok(await reopened.transactions.workspace.getDocument('design/projects/a'));
    assert.equal((await reopened.transactions.workspace.readEvents('design/imports')).events.length, 2);
    await reopened.close();
  } finally { removeDir(dir); }
});
it('corrupt replay stream refuses repair and preserves bytes; torn repair quarantines exact bytes', async () => {
  const dir = makeDir();
  try {
    const root = join(dir, 'store'); let e = await engineAt(root);
    await e.close();
    const fs = allCallFs(); e = await engineAt(root, fs.fs);
    const realAppend = fs.fs.append;
    fs.fs.append = async (p, bytes) => { await realAppend(p, bytes.subarray(0, 7)); throw new Error('interrupted append'); };
    await assert.rejects(e.transactions.commit(operations()), /interrupted append/);
    await e.close(); e = await engineAt(root);
    const txnId = value(await e.transactions.diagnostics()).pending[0]!;
    const p = journal(root, 'design/imports'); const original = readFileSync(p);
    writeFileSync(p, '{}\n'); const corrupt = files(root);
    await assert.rejects(e.transactions.repair(txnId), /Corrupt/); assert.deepEqual(files(root), corrupt);
    writeFileSync(p, original);
    const repaired = value(await e.transactions.repair(txnId));
    assert.equal(repaired.quarantine.length, 1);
    assert.deepEqual(readFileSync(join(root, repaired.quarantine[0]!.quarantinedAs)), original);
    assert.equal((await e.transactions.workspace.readEvents('design/imports')).events.length, 2);
    await e.close();
  } finally { removeDir(dir); }
});
it('concurrent doc put waits behind exclusive import', async () => {
  const dir = makeDir();
  try {
    const fs = allCallFs(), e = await engineAt(join(dir, 'store'), fs.fs);
    let release!: () => void, arrived!: () => void;
    const pause = new Promise<void>(r => { release = r; }), reached = new Promise<void>(r => { arrived = r; });
    const real = fs.fs.append;
    fs.fs.append = async (p, b) => { arrived(); await pause; return real(p, b); };
    const commit = e.transactions.commit(operations()); await reached;
    let done = false;
    const put = e.transactions.workspace.putDocument('design/flows/after', {}).then(() => { done = true; });
    await new Promise(r => setImmediate(r)); assert.equal(done, false);
    release(); await commit; await put; assert.equal(done, true); await e.close();
  } finally { removeDir(dir); }
});
it('imports lane prefix mapping covers documents, streams, blobs and listings', async () => {
  const dir = makeDir();
  try {
    const e = await engineAt(join(dir, 'store')), p = createImportsStorage(e.transactions);
    await p.commit([doc('imports/records/a'), event('imports'), blob()]);
    assert.ok(await p.getDocument('workspace', 'imports/records/a'));
    assert.equal((await p.listDocuments('workspace', 'imports/'))[0]?.key, 'imports/records/a');
    assert.deepEqual(await p.listStreams('workspace'), ['imports']);
    assert.equal((await p.readEvents('workspace', 'imports')).length, 1);
    assert.equal((await p.listBlobs('workspace'))[0]?.mediaType, 'text/plain');
    assert.ok(await e.runtime.raw.getDocument('design/imports/records/a'));
    await assert.rejects(e.transactions.commit([event('imports')])); await e.close();
  } finally { removeDir(dir); }
});
it('legacy hashed streams make diagnostics and export unavailable, never partial', async () => {
  const dir = makeDir();
  try {
    const e = await engineAt(join(dir, 'store'));
    await e.runtime.raw.appendEvent('design/imports/' + 'A'.repeat(100), { type: 'imports.event', payload: {} });
    const expected = { ok: false, kind: 'unavailable', reason: 'stream-enumeration' };
    assert.deepEqual(await e.transactions.diagnostics(), expected);
    assert.deepEqual(await e.exportBundle.preview('2026-01-01T00:00:00Z'), expected);
    await e.close();
  } finally { removeDir(dir); }
});
it('a staged orphan stays invisible even when an existing document references its digest', async () => {
  const dir = makeDir();
  try {
    const root = join(dir, 'store'), fs = allCallFs(); let e = await engineAt(root, fs.fs);
    const b = blob('referenced but absent'); assert.equal(b.op, 'put-blob'); if (b.op !== 'put-blob') throw new Error('fixture');
    await e.runtime.raw.putDocument('design/references/library', { schema: 'hq.design.references/v1', references: { r: { asset: { digest: b.digest, mediaType: b.mediaType, bytes: b.bytes.length } } }, collections: {}, uses: {} });
    const write = fs.fs.writeNew;
    fs.fs.writeNew = (p, bytes) => p.includes('.stage-') ? Promise.reject(new Error('manifest staging stopped')) : write(p, bytes);
    await assert.rejects(e.transactions.commit([doc(), b]), /manifest staging stopped/);
    await e.close(); e = await engineAt(root);
    assert.equal(await e.transactions.workspace.getBlob(b.digest), null);
    assert.equal(await e.transactions.workspace.hasBlob(b.digest), false);
    assert.deepEqual(await e.transactions.workspace.listBlobs(), []);
    assert.deepEqual(value(await e.transactions.diagnostics()).orphanBlobs, { count: 1, bytes: b.bytes.length });
    const output = value(await e.exportBundle.build('2026-01-01T00:00:00Z'));
    assert.equal(output.report.blobs, 0);
    await e.close();
  } finally { removeDir(dir); }
});
