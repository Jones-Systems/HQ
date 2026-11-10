import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { createTestContext, LOCK_NAME } from '../../tools/storage/admission.mjs';
import { openEvidenceRun, CLOSURE_NAME } from './evidence.mjs';

// Standalone synthetic writer coverage only. Existing producer/screenshot/trace
// writes remain uncovered until their separately allocated wiring is delivered.
async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const capacity = await fs.statfs(parent, { bigint: true });
  assert.ok(capacity.bsize > 0n && capacity.bavail * capacity.bsize >= 16n * 1024n * 1024n,
    'Refuse fixture allocation without known capacity');
  const root = await fs.mkdtemp(path.join(parent, 'hq-evidence-test-'));
  const writers = [];
  // The exact fixture root is owned by this test, including all deliberately
  // corrupted/retained synthetic bytes. No producer or shared tree is removed.
  t.after(async () => {
    try { for (const writer of writers) await writer.close({ code: 1, signal: null }); }
    finally {
      await fs.rm(root, { recursive: true, force: true });
      await assert.rejects(fs.lstat(root), { code: 'ENOENT' });
    }
  });
  await fs.chmod(root, 0o700);
  const worktree = path.join(root, 'worktree');
  const evidence = path.join(root, 'evidence');
  await fs.mkdir(worktree, { mode: 0o700 });
  await fs.mkdir(evidence, { mode: 0o700 });
  const state = { available: 16 * 1024 * 1024, unknown: false };
  const testContext = createTestContext({
    policy: { reserveBytes: 1024, peakBytes: 32768, evidenceRunBytes: 8192,
      evidenceOrdinaryBytes: 6144, evidenceClosureBytes: 2048, artifactBytes: 4096,
      evidenceParentBytes: 512 * 1024 },
    measureFilesystem: async root => ({ id: root.dev, type: 'fixture', blockBytes: 4096,
      availableBytes: state.unknown ? NaN : state.available }),
  });
  const open = async (id = 'run-1', options = {}, extra = {}) => {
    const writer = await openEvidenceRun({ worktree, parent: evidence, runId: id, ...extra }, { testContext, ...options });
    writers.push(writer);
    return writer;
  };
  return { root, worktree, evidence, state, testContext, open,
    receipt: writer => fs.readFile(path.join(writer.directory, CLOSURE_NAME), 'utf8').then(JSON.parse) };
}

test('preallocates closure, appends bounded UTF-8 bytes and closes idempotently', async t => {
  const f = await fixture(t); const w = await f.open();
  assert.equal((await fs.stat(path.join(w.directory, CLOSURE_NAME))).size, 2048);
  assert.equal((await f.receipt(w)).status, 'incomplete');
  const data = Buffer.from('original');
  const first = w.write('output.txt', data); data.fill(0);
  await first; await w.append('output.txt', 'é');
  assert.equal(await fs.readFile(path.join(w.directory, 'output.txt'), 'utf8'), 'originalé');
  const closing = w.close(); assert.equal(w.close({ code: 9, signal: null }), closing);
  assert.deepEqual(await closing, { code: 0, signal: null, incomplete: false, diagnostics: [] });
  assert.equal((await f.receipt(w)).reservedOrdinaryBytes, 10);
  assert.equal((await f.receipt(w)).status, 'complete');
  await assert.rejects(fs.lstat(path.join(f.evidence, LOCK_NAME)), { code: 'ENOENT' });
  await assert.rejects(w.write('late', 'x'), /closing/);
});

test('close drains accepted writes before releasing its lock', async t => {
  const f = await fixture(t); const w = await f.open();
  const writing = w.write('pending', Buffer.alloc(1000, 7));
  const closing = w.close(); await writing;
  assert.equal((await closing).code, 0);
  assert.equal((await fs.readFile(path.join(w.directory, 'pending'))).length, 1000);
});

test('ordinary quota refusal preserves closure space and previously written bytes', async t => {
  const f = await fixture(t); const w = await f.open();
  await w.write('one', Buffer.alloc(3072)); await w.write('two', Buffer.alloc(3072));
  await assert.rejects(w.write('three', 'x'), /run byte limit/);
  f.state.available = 0; // Closing uses preallocated bytes even after capacity falls.
  assert.equal((await w.close()).code, 1);
  assert.equal((await f.receipt(w)).status, 'incomplete');
  assert.equal((await fs.stat(path.join(w.directory, 'one'))).size, 3072);
  await assert.rejects(fs.lstat(path.join(w.directory, 'three')), { code: 'ENOENT' });
});

test('per-artifact limit includes appends and refuses before extending the file', async t => {
  const f = await fixture(t); const w = await f.open();
  await w.write('one', Buffer.alloc(4096));
  await assert.rejects(w.append('one', 'x'), /artifact byte limit/);
  assert.equal((await fs.stat(path.join(w.directory, 'one'))).size, 4096);
  assert.equal((await w.close({ code: 7, signal: null })).code, 7);
});

test('artifact and pending-write counts cannot be bypassed by empty writes', async t => {
  const f = await fixture(t); let w = await f.open('count', { maxArtifacts: 1 });
  await w.write('one', ''); await assert.rejects(w.write('two', ''), /artifact count/); await w.close();
  w = await f.open('pending', { maxPendingWrites: 1 });
  const first = w.write('one', 'a');
  await assert.rejects(w.append('one', 'b'), /pending-write count/);
  await Promise.allSettled([first]);
  assert.equal((await w.close()).incomplete, true);
});

test('unknown or insufficient capacity refuses both allocation and later writes', async t => {
  const f = await fixture(t);
  f.state.unknown = true; await assert.rejects(f.open(), /Unknown or invalid/);
  assert.deepEqual(await fs.readdir(f.evidence), []);
  f.state.unknown = false; f.state.available = 1;
  await assert.rejects(f.open(), /Storage refused/);
  f.state.available = 16 * 1024 * 1024;
  const w = await f.open(); f.state.unknown = true;
  await assert.rejects(w.write('one', 'x'), /Unknown or invalid/);
  assert.equal((await w.close()).incomplete, true);
});

test('low live capacity refuses before creating an ordinary artifact', async t => {
  const f = await fixture(t); const w = await f.open(); f.state.available = 1024;
  await assert.rejects(w.write('one', 'x'), /capacity refused/);
  await assert.rejects(fs.lstat(path.join(w.directory, 'one')), { code: 'ENOENT' });
  await w.close();
});

test('existing runs and stale locks are preserved without overwrite or eviction', async t => {
  const f = await fixture(t);
  const w = await f.open(); await w.write('old', 'retained'); await w.close();
  await assert.rejects(f.open(), { code: 'EEXIST' });
  assert.equal(await fs.readFile(path.join(w.directory, 'old'), 'utf8'), 'retained');
  await fs.writeFile(path.join(f.evidence, LOCK_NAME), 'stale', { mode: 0o600 });
  await assert.rejects(f.open('new'), { code: 'EEXIST' });
  assert.equal(await fs.readFile(path.join(f.evidence, LOCK_NAME), 'utf8'), 'stale');
});

test('parent byte/run ceilings refuse prospectively without deleting history', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 16; i++) await fs.mkdir(path.join(f.evidence, `old-${i}`), { mode: 0o700 });
  await assert.rejects(f.open(), /evidence run limit/);
  assert.equal((await fs.readdir(f.evidence)).length, 16);
  const bytes = Buffer.alloc(512 * 1024);
  await fs.writeFile(path.join(f.evidence, 'old-0', 'retained'), bytes, { mode: 0o600 });
  await assert.rejects(f.open(), /evidence (byte|run) limit/);
  assert.equal((await fs.stat(path.join(f.evidence, 'old-0', 'retained'))).size, bytes.length);
});

test('run identifiers and artifact names reject traversal and reserved closure', async t => {
  const f = await fixture(t);
  for (const id of ['../escape', '.', '', 'a/b', 'x\\y']) await assert.rejects(f.open(id), /Invalid evidence name/);
  for (const filename of ['../escape', '.', CLOSURE_NAME]) {
    const w = await f.open(`bad-${filename.length}`);
    await assert.rejects(w.write(filename, 'x'), /Invalid evidence name/); await w.close();
  }
});

test('symlinked parents and preexisting artifact links never redirect writes', async t => {
  const f = await fixture(t); const alias = path.join(f.root, 'alias');
  await fs.symlink(f.evidence, alias);
  await assert.rejects(openEvidenceRun({ worktree: f.worktree, parent: alias, runId: 'bad' }, { testContext: f.testContext }), /Unsafe destination/);
  const w = await f.open(); const target = path.join(f.root, 'outside');
  await fs.writeFile(target, 'untouched'); await fs.symlink(target, path.join(w.directory, 'one'));
  await assert.rejects(w.write('one', 'overwrite'), { code: 'EEXIST' });
  assert.equal(await fs.readFile(target, 'utf8'), 'untouched'); await w.close();
});

test('replacing a run or hard-linking an artifact prevents further writes', async t => {
  const f = await fixture(t); let w = await f.open('linked');
  await w.write('one', 'original'); await fs.link(path.join(w.directory, 'one'), path.join(f.root, 'link'));
  await assert.rejects(w.append('one', 'x'), /Unsafe evidence file/); await w.close();
  w = await f.open('replaced'); await fs.rename(w.directory, w.directory + '-retained');
  await fs.mkdir(w.directory, { mode: 0o700 });
  await assert.rejects(w.write('one', 'x'), /Evidence run changed/);
  assert.equal((await w.close()).incomplete, true);
  assert.deepEqual(await fs.readdir(w.directory), []);
});

test('overwriting an artifact is forbidden and the original producer outcome stays primary', async t => {
  const f = await fixture(t); const w = await f.open(); await w.write('one', 'original');
  await assert.rejects(w.write('one', 'replacement'), /overwrite refused/);
  assert.deepEqual(await fs.readFile(path.join(w.directory, 'one'), 'utf8'), 'original');
  const result = await w.close({ code: null, signal: 'SIGTERM' });
  assert.equal(result.code, null); assert.equal(result.signal, 'SIGTERM'); assert.equal(result.incomplete, true);
});

test('cancellation rejects new writes while retaining bounded diagnostics', async t => {
  const f = await fixture(t); const controller = new AbortController();
  const w = await f.open('cancelled', {}, { signal: controller.signal });
  controller.abort(); await assert.rejects(w.write('one', 'x'), /cancelled/);
  assert.equal((await w.close({ code: 9, signal: null })).code, 9);
  assert.equal((await f.receipt(w)).status, 'incomplete');
  await assert.rejects(f.open('not-started', {}, { signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(fs.lstat(path.join(f.evidence, 'not-started')), { code: 'ENOENT' });
});

test('a changed lock is retained and cleanup failure never replaces an earlier failure', async t => {
  const f = await fixture(t); const w = await f.open();
  await fs.writeFile(path.join(f.evidence, LOCK_NAME), 'different owner', { mode: 0o600 });
  const result = await w.close({ code: 13, signal: null });
  assert.equal(result.code, 13); assert.equal(result.incomplete, true);
  assert.equal((await f.receipt(w)).status, 'incomplete');
  assert.equal(await fs.readFile(path.join(f.evidence, LOCK_NAME), 'utf8'), 'different owner');
});

test('a truncated closure reserve is incomplete and cannot masquerade as reserved capacity', async t => {
  const f = await fixture(t); const w = await f.open();
  await fs.truncate(path.join(w.directory, CLOSURE_NAME), 0);
  assert.equal((await w.close()).incomplete, true);
  assert.equal((await fs.stat(path.join(w.directory, CLOSURE_NAME))).size, 0);
});
