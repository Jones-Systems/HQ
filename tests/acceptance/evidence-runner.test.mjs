import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { createTestContext, LOCK_NAME } from '../../tools/storage/admission.mjs';
import { CLOSURE_NAME } from './evidence.mjs';
import { openRunnerEvidence } from './evidence-runner.mjs';

// Tiny synthetic disk artifacts and fake cleanup/oracle ports only. This does
// not execute Electron, CDP, fixtures, native journeys or a trace producer.
async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const capacity = await fs.statfs(parent, { bigint: true });
  assert.ok(capacity.bsize > 0n && capacity.bavail * capacity.bsize >= 16n * 1024n * 1024n,
    'Refuse fixture allocation without known capacity');
  const root = await fs.mkdtemp(path.join(parent, 'hq-evidence-runner-'));
  const runs = [];
  t.after(async () => {
    try {
      for (const run of runs) await run.finalize({ report: { outcome: 'failed' }, log: () => '',
        cleanup: async () => {}, verify: async () => {}, primary: () => ({ code: 1, signal: null }) });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await assert.rejects(fs.lstat(root), { code: 'ENOENT' });
    }
  });
  await fs.chmod(root, 0o700);
  const worktree = path.join(root, 'worktree');
  await fs.mkdir(worktree, { mode: 0o700 });
  const parentPath = path.join(worktree, '.t3/evidence');
  const scratchParent = path.join(worktree, '.t3/scratch');
  const state = { available: 16 * 1024 * 1024 };
  const testContext = createTestContext({
    policy: { reserveBytes: 1024, peakBytes: 32768, evidenceRunBytes: 32768,
      evidenceOrdinaryBytes: 30720, evidenceClosureBytes: 2048, artifactBytes: 4096,
      evidenceParentBytes: 512 * 1024 },
    measureFilesystem: async root => ({ id: root.dev, type: 'fixture', blockBytes: 4096,
      availableBytes: state.available }),
  });
  const open = async (options = {}, signal) => {
    const run = await openRunnerEvidence({ worktree, parent: parentPath, scratchParent, signal }, { testContext, ...options });
    runs.push(run); return run;
  };
  return { root, worktree, parentPath, scratchParent, state, open,
    read: (run, file) => fs.readFile(path.join(run.directory, file), 'utf8'),
    receipt: run => fs.readFile(path.join(run.directory, CLOSURE_NAME), 'utf8').then(JSON.parse) };
}

function hooks(report, overrides = {}) {
  const events = [];
  return { events, options: { report, log: () => 'bounded log',
    cleanup: async () => { events.push('cleanup'); report.cleanup = 'passed'; },
    verify: async () => { events.push('service/build/source'); report.buildIdentity = { sha256: 'synthetic' }; },
    primary: () => ({ code: report.outcome === 'passed' ? 0 : 1, signal: null }), ...overrides } };
}

test('actual adapter admits, reserves closure, writes immutable reports/logs and visits cleanup/oracles', async t => {
  const f = await fixture(t); const run = await f.open();
  assert.equal((await f.receipt(run)).status, 'incomplete');
  await assert.rejects(fs.lstat(f.scratchParent), { code: 'ENOENT' });
  await run.write('build-inventory.json', '{"synthetic":true}');
  await run.write('before-restart.png', Buffer.from([1, 2, 3]));
  const report = { outcome: 'passed' }; const h = hooks(report);
  const closing = run.finalize(h.options);
  assert.equal(run.finalize(h.options), closing);
  assert.deepEqual(await closing, { code: 0, signal: null, incomplete: false, diagnostics: [] });
  assert.deepEqual(h.events, ['cleanup', 'service/build/source']);
  assert.equal(JSON.parse(await f.read(run, 'report-before-cleanup.json')).cleanup, undefined);
  assert.equal(JSON.parse(await f.read(run, 'report.json')).cleanup, 'passed');
  assert.equal(JSON.parse(await f.read(run, 'report.json')).buildIdentity.sha256, 'synthetic');
  assert.equal(await f.read(run, 'runtime-before-cleanup.log'), 'bounded log');
  assert.equal(await f.read(run, 'runtime.log'), 'bounded log');
  assert.equal((await f.receipt(run)).status, 'complete');
  await assert.rejects(fs.lstat(path.join(f.parentPath, LOCK_NAME)), { code: 'ENOENT' });
});

for (const available of [NaN, 1024]) test(`refuses ${Number.isNaN(available) ? 'unknown' : 'low'} receiving capacity before parent allocation`, async t => {
  const f = await fixture(t); f.state.available = available;
  await assert.rejects(f.open(), /capacity|Storage refused/);
  await assert.rejects(fs.lstat(path.join(f.worktree, '.t3')), { code: 'ENOENT' });
});

test('write refusal preserves original failure and still runs cleanup and all post-cleanup oracles', async t => {
  const f = await fixture(t); const run = await f.open();
  await run.write('retained', 'first evidence');
  await assert.rejects(run.write('too-large', Buffer.alloc(4097)), /artifact byte limit/);
  const report = { outcome: 'failed', error: 'original harness failure' };
  const h = hooks(report, { primary: () => ({ code: 7, signal: null }) });
  const result = await run.finalize(h.options);
  assert.equal(result.code, 7); assert.equal(result.incomplete, true);
  assert.deepEqual(h.events, ['cleanup', 'service/build/source']);
  assert.equal(report.error, 'original harness failure');
  assert.equal(report.evidenceIncomplete, true);
  assert.equal(await f.read(run, 'retained'), 'first evidence');
  assert.equal((await f.receipt(run)).code, 7);
  assert.equal((await f.receipt(run)).status, 'incomplete');
});

for (const signal of ['SIGINT', 'SIGTERM']) test(`${signal} cancellation preserves signal, drains and visits cleanup/oracles`, async t => {
  const f = await fixture(t); const controller = new AbortController();
  const run = await f.open({}, controller.signal);
  await run.write('first', 'retained'); controller.abort();
  const report = { outcome: 'cancelled' };
  const h = hooks(report, { primary: () => ({ code: null, signal }) });
  const result = await run.finalize(h.options);
  assert.equal(result.signal, signal); assert.equal(result.code, null); assert.equal(result.incomplete, true);
  assert.deepEqual(h.events, ['cleanup', 'service/build/source']);
  assert.equal((await f.receipt(run)).signal, signal);
  assert.equal(report.outcome, 'cancelled');
  await assert.rejects(fs.lstat(path.join(f.parentPath, LOCK_NAME)), { code: 'ENOENT' });
});

test('cleanup failure cannot bypass post-cleanup oracles or replace original producer status', async t => {
  const f = await fixture(t); const run = await f.open(); const report = { outcome: 'failed', error: 'producer' };
  const h = hooks(report, { cleanup: async () => { throw new Error('cleanup failure'); },
    primary: () => ({ code: 9, signal: null }) });
  assert.equal((await run.finalize(h.options)).code, 9);
  assert.deepEqual(h.events, ['service/build/source']);
  assert.equal(report.cleanupError, 'cleanup failure'); assert.equal(report.error, 'producer');
  assert.equal(JSON.parse(await f.read(run, 'report.json')).cleanup, 'failed');
});

test('post-cleanup oracle failure fails an otherwise successful report', async t => {
  const f = await fixture(t); const run = await f.open(); const report = { outcome: 'passed' };
  const h = hooks(report, { verify: async () => { throw new Error('build changed'); } });
  assert.equal((await run.finalize(h.options)).code, 1);
  assert.deepEqual(h.events, ['cleanup']);
  assert.equal(JSON.parse(await f.read(run, 'report.json')).verificationError, 'build changed');
  assert.equal((await f.receipt(run)).status, 'failed');
});

test('serialization failure still cleans and verifies without an unbounded fallback file', async t => {
  const f = await fixture(t); const run = await f.open(); const report = { outcome: 'passed' }; report.circular = report;
  const h = hooks(report); const result = await run.finalize(h.options);
  assert.equal(result.code, 1); assert.equal(result.incomplete, true);
  assert.deepEqual(h.events, ['cleanup', 'service/build/source']);
  assert.equal(report.evidenceIncomplete, true);
  await assert.rejects(fs.lstat(path.join(run.directory, 'report.json')), { code: 'ENOENT' });
  assert.notEqual((await f.receipt(run)).status, 'complete');
});

test('final artifact refusal makes success incomplete while preserving reserved closure and earlier evidence', async t => {
  const f = await fixture(t); const run = await f.open({ maxArtifacts: 3 });
  await run.write('capture.png', 'synthetic');
  const report = { outcome: 'passed' }; const h = hooks(report);
  const result = await run.finalize(h.options);
  assert.equal(result.code, 1); assert.equal(result.incomplete, true);
  assert.deepEqual(h.events, ['cleanup', 'service/build/source']);
  assert.equal((await f.receipt(run)).status, 'incomplete');
  assert.equal(await f.read(run, 'capture.png'), 'synthetic');
});

test('accepted pending payload drains before final closure and historical evidence is never overwritten', async t => {
  const f = await fixture(t); const run = await f.open();
  const writing = run.write('pending', Buffer.alloc(1000, 3));
  const h = hooks({ outcome: 'passed' }); const closing = run.finalize(h.options);
  await writing; assert.equal((await closing).code, 0);
  assert.equal((await fs.readFile(path.join(run.directory, 'pending'))).length, 1000);
  const next = await f.open(); assert.notEqual(next.directory, run.directory);
  await assert.rejects(next.write('../old-report.json', 'overwrite'), /Invalid evidence name/);
  await next.finalize(hooks({ outcome: 'failed' }).options);
  assert.equal((await f.receipt(run)).status, 'complete');
  assert.equal((await fs.readFile(path.join(run.directory, 'pending'))).length, 1000);
});
