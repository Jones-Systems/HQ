import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { createTestContext, LOCK_NAME } from '../../../tools/storage/admission.mjs';
import { CLOSURE_NAME } from '../evidence.mjs';
import { openPreviewEvidence, TraceStorageHeld } from './evidence.mjs';

// Dependency-free synthetic artifacts and fake producer/cleanup ports only.
// No Electron/CDP, native process, raw trace or historical tree is exercised.
async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const capacity = await fs.statfs(parent, { bigint: true });
  assert.ok(capacity.bsize > 0n && capacity.bavail * capacity.bsize >= 16n * 1024n * 1024n,
    'Refuse fixture allocation without known capacity');
  const root = await fs.mkdtemp(path.join(parent, 'hq-preview-evidence-'));
  const runs = [];
  t.after(async () => {
    try {
      for (const { run, report } of runs) await run.finalize(hooks(report));
    } finally {
      // Only this exact newly allocated synthetic root is cleanup scope.
      await fs.rm(root, { recursive: true, force: true });
      await assert.rejects(fs.lstat(root), { code: 'ENOENT' });
    }
  });
  await fs.chmod(root, 0o700);
  const worktree = path.join(root, 'worktree');
  await fs.mkdir(worktree, { mode: 0o700 });
  const parentPath = path.join(root, 'evidence');
  const scratchParent = path.join(worktree, '.t3/scratch');
  const state = { available: 16 * 1024 * 1024, stops: 0 };
  const testContext = createTestContext({
    policy: { reserveBytes: 1024, peakBytes: 32768, evidenceRunBytes: 32768,
      evidenceOrdinaryBytes: 30720, evidenceClosureBytes: 2048, artifactBytes: 4096,
      evidenceParentBytes: 512 * 1024 },
    measureFilesystem: async root => {
      await state.gate;
      return { id: root.dev, type: 'fixture', blockBytes: 4096, availableBytes: state.available };
    },
  });
  const open = async (options = {}, overrides = {}) => {
    const report = { outcome: 'passed' };
    const run = await openPreviewEvidence({ worktree, parent: parentPath, scratchParent, report,
      stopProducer: async () => { state.stops++; }, ...overrides }, { testContext, ...options });
    runs.push({ run, report }); return { run, report };
  };
  return { root, worktree, parentPath, scratchParent, state, open,
    read: (run, file) => fs.readFile(path.join(run.directory, file), 'utf8'),
    receipt: async run => JSON.parse(await fs.readFile(path.join(run.directory, CLOSURE_NAME), 'utf8')) };
}
function hooks(report, overrides = {}) {
  return { cleanup: async () => { report.cleanup = 'passed'; }, verify: async () => {},
    outcome: () => ({ code: report.outcome === 'passed' ? 0 : report.outcome === 'partial' ? 2 : 1, signal: null }),
    ...overrides };
}

test('preallocates closure, streams actual writes, retains history and unlocks after cleanup/readbacks', async t => {
  const f = await fixture(t);
  await fs.mkdir(f.parentPath, { mode: 0o700 });
  const historical = path.join(f.parentPath, 'retained-failure');
  await fs.mkdir(historical); await fs.writeFile(path.join(historical, 'keep'), 'original');
  const { run, report } = await f.open();
  assert.equal((await f.receipt(run)).status, 'incomplete');
  await assert.rejects(fs.lstat(f.scratchParent), { code: 'ENOENT' });
  assert.equal(await run.append('events.jsonl', 'first\n'), true);
  assert.equal(await run.append('events.jsonl', 'second\n'), true);
  await run.write('shot.png', Buffer.from([1, 2, 3]));
  const events = [];
  const options = hooks(report, {
    cleanup: async () => { events.push('cleanup'); report.cleanup = 'passed'; },
    verify: async () => { events.push('HEAD/hash/root/process-group'); report.identity = 'synthetic'; },
  });
  const closed = run.finalize(options);
  assert.equal(run.finalize(options), closed);
  assert.deepEqual(await closed, { code: 0, signal: null, diagnostics: [], incomplete: false });
  assert.deepEqual(events, ['cleanup', 'HEAD/hash/root/process-group']);
  assert.equal(await f.read(run, 'events.jsonl'), 'first\nsecond\n');
  assert.equal(JSON.parse(await f.read(run, 'report.json')).identity, 'synthetic');
  assert.equal((await f.receipt(run)).status, 'complete');
  assert.equal(await fs.readFile(path.join(historical, 'keep'), 'utf8'), 'original');
  await assert.rejects(fs.lstat(path.join(f.parentPath, LOCK_NAME)), { code: 'ENOENT' });
});

for (const available of [NaN, 1024]) test(`unknown/low capacity ${available} refuses before any receiving parent`, async t => {
  const f = await fixture(t); f.state.available = available;
  await assert.rejects(f.open(), /capacity|Storage refused/);
  await assert.rejects(fs.lstat(f.parentPath), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(path.join(f.worktree, '.t3')), { code: 'ENOENT' });
});

test('evidence/profile overlap and unsafe symlink refuse before allocating a run', async t => {
  const f = await fixture(t);
  for (const scratchParent of [f.parentPath, path.join(f.parentPath, 'profile'), f.root]) {
    await assert.rejects(f.open({}, { scratchParent }), /disjoint|contain/);
  }
  await fs.symlink(f.worktree, f.parentPath);
  await assert.rejects(f.open(), /Unsafe/);
  await assert.rejects(fs.lstat(path.join(f.worktree, '.t3')), { code: 'ENOENT' });
});

test('stream overflow latches, stops only supplied producer once, drains and still cleans/verifies', async t => {
  const f = await fixture(t); const { run, report } = await f.open();
  assert.equal(await run.append('native.log', 'a'.repeat(4000)), true);
  assert.equal(await run.append('native.log', 'b'.repeat(97)), false);
  for (let i = 0; i < 20; i++) assert.equal(await run.append('native.log', 'refused'), false);
  const events = [];
  const result = await run.finalize(hooks(report, {
    cleanup: async () => { events.push('cleanup'); report.cleanup = 'passed'; },
    verify: async () => { events.push('readbacks'); },
  }));
  assert.equal(result.code, 1); assert.equal(result.incomplete, true);
  assert.equal(f.state.stops, 1);
  assert.deepEqual(events, ['cleanup', 'readbacks']);
  assert.match(report.evidenceError, /artifact byte/);
  assert.equal(await f.read(run, 'native.log'), 'a'.repeat(4000));
  const receipt = await f.receipt(run);
  assert.equal(receipt.status, 'incomplete'); assert.match(receipt.writerFailure, /artifact byte/);
});

test('immediate submissions cannot hide unbounded writes behind an adapter promise queue', async t => {
  const f = await fixture(t); const { run, report } = await f.open({ maxPendingWrites: 2 });
  let release; f.state.gate = new Promise(resolve => { release = resolve; });
  try {
    const first = run.append('events.jsonl', 'one');
    const second = run.append('events.jsonl', 'two');
    const refused = run.append('events.jsonl', 'three');
    assert.equal(await refused, false, 'refusal is immediate despite blocked filesystem writes');
    assert.match(report.evidenceError, /pending-write/);
    release();
    await Promise.all([first, second]);
    const result = await run.finalize(hooks(report));
    assert.equal(result.code, 1); assert.equal(result.incomplete, true);
    assert.equal(f.state.stops, 1);
    assert.equal((await f.receipt(run)).reservedOrdinaryBytes, 6);
  } finally { release(); }
});

for (const primary of [{ code: 7, signal: null }, { code: null, signal: 'SIGTERM' }]) {
  test(`original ${primary.signal ?? primary.code} survives evidence and cleanup failures`, async t => {
    const f = await fixture(t); const { run, report } = await f.open();
    run.observeOutcome(primary);
    run.observeOutcome({ code: 1, signal: null });
    assert.equal(await run.append('native.log', 'x'.repeat(4097)), false);
    const events = [];
    const result = await run.finalize(hooks(report, {
      cleanup: async () => { events.push('cleanup'); throw Error('synthetic cleanup failure'); },
      verify: async () => { events.push('readback'); },
    }));
    assert.equal(result.code, primary.code); assert.equal(result.signal, primary.signal);
    assert.deepEqual(events, ['cleanup', 'readback']); assert.equal(result.incomplete, true);
    assert.equal((await f.receipt(run)).signal, primary.signal);
  });
}

test('serialization and oracle failures cannot bypass exact owned scratch cleanup or close', async t => {
  const f = await fixture(t); const { run, report } = await f.open();
  await fs.mkdir(f.scratchParent, { recursive: true });
  const owned = await fs.mkdtemp(path.join(f.scratchParent, 'owned-'));
  report.circular = report;
  let verified = false;
  const result = await run.finalize(hooks(report, {
    cleanup: async () => { await fs.rm(owned, { recursive: true }); report.cleanup = 'passed'; },
    verify: async () => { verified = true; throw Error('synthetic readback failure'); },
  }));
  assert.equal(verified, true); assert.equal(result.code, 1); assert.equal(result.incomplete, true);
  await assert.rejects(fs.lstat(owned), { code: 'ENOENT' });
  await assert.rejects(fs.lstat(path.join(f.parentPath, LOCK_NAME)), { code: 'ENOENT' });
  assert.equal((await f.receipt(run)).status, 'failed');
});

test('falling capacity refuses, retained bytes survive and cancellation cleanup still runs', async t => {
  const f = await fixture(t); const { run, report } = await f.open();
  await run.write('keep.json', 'retained');
  run.observeOutcome({code:null,signal:'SIGINT'});
  f.state.available = NaN;
  assert.equal(await run.append('native.log', 'refused'), false);
  let cleaned = false;
  const result = await run.finalize(hooks(report, { cleanup: async () => { cleaned = true; report.cleanup = 'passed'; } }));
  assert.equal(cleaned, true); assert.equal(result.signal, 'SIGINT'); assert.equal(result.incomplete, true);
  assert.equal(await f.read(run, 'keep.json'), 'retained');
});

test('raw trace refusal happens before producer start and retains a non-passing closure/report', async t => {
  const f = await fixture(t); const { run, report } = await f.open();
  let starts = 0;
  const traceStart = () => { run.refuseRawTrace(); starts++; };
  assert.throws(traceStart, TraceStorageHeld);
  report.rows = [{ id: 'Q-PV4', outcome: 'unmeasured', reason: report.traceStorageHold }];
  const result = await run.finalize(hooks(report));
  assert.equal(starts, 0); assert.equal(f.state.stops, 0);
  assert.equal(result.code, 2); assert.equal(result.incomplete, true);
  assert.equal((await f.receipt(run)).status, 'failed');
  const retained = JSON.parse(await f.read(run, 'report.json'));
  assert.equal(retained.outcome, 'partial'); assert.equal(retained.rows[0].outcome, 'unmeasured');
  assert.match(retained.traceStorageHold, /storage-held.*unmeasured/);
});

test('artifact count and total run bytes remain enforced through the streaming adapter', async t => {
  const f = await fixture(t);
  const first = await f.open({ maxArtifacts: 1 });
  await first.run.write('one.png', Buffer.from([1]));
  assert.equal(await first.run.append('two.log', 'x'), false);
  assert.match(first.report.evidenceError, /artifact count/);
  assert.equal((await first.run.finalize(hooks(first.report))).incomplete, true);
  const second = await f.open();
  for (let i = 0; i < 7; i++) await second.run.write(`shot-${i}.png`, Buffer.alloc(4096));
  await assert.rejects(second.run.write('last.png', Buffer.alloc(4096)), /run byte/);
  const result = await second.run.finalize(hooks(second.report));
  assert.equal(result.code, 1); assert.equal(result.incomplete, true);
  assert.equal((await f.receipt(second.run)).reservedOrdinaryBytes, 7 * 4096);
});

test('a retained parent lock refuses another run without eviction or historical modification', async t => {
  const f = await fixture(t); const { run, report } = await f.open();
  const lock = path.join(f.parentPath, LOCK_NAME);
  const original = await fs.readFile(lock);
  await assert.rejects(f.open(), { code: 'EEXIST' });
  assert.deepEqual(await fs.readFile(lock), original);
  assert.equal((await fs.readdir(f.parentPath)).length, 2);
  assert.equal((await run.finalize(hooks(report))).code, 0);
});

for (const expected of [true, false]) test(`${expected ? 'expected teardown' : 'unexpected child'} signal retains its classification`, async t => {
  const f = await fixture(t); const { run, report } = await f.open();
  run.observeChildExit({ pid: 12345, code: null, signal: 'SIGTERM' }, expected);
  const result = await run.finalize(hooks(report));
  assert.equal(result.code, expected ? 0 : null);
  assert.equal(result.signal, expected ? null : 'SIGTERM');
  assert.equal(report.outcome, expected ? 'passed' : 'failed');
  assert.equal((await f.receipt(run)).status, expected ? 'complete' : 'failed');
});
