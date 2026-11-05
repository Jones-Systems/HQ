import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createTestContext } from '../../../tools/storage/admission.mjs';
import { inspectReceiver, openHostEvidence, validateHostBundle } from './host-gallery-evidence.mjs';

async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const stat = await fs.statfs(parent, { bigint: true });
  assert.ok(stat.bavail * stat.bsize > 1024n * 1024n, 'Known capacity before tiny fixture allocation');
  const root = await fs.mkdtemp(path.join(parent, 'hq-host-evidence-'));
  const writers = [];
  t.after(async () => {
    try { for (const writer of writers) await writer.close({ error: 'test teardown' }).catch(() => {}); }
    finally { await fs.rm(root, { recursive: true, force: true }); await assert.rejects(fs.lstat(root), { code: 'ENOENT' }); }
  });
  await fs.chmod(root, 0o700);
  const worktree = path.join(root, 'worktree'), parentEvidence = path.join(root, 'evidence'), scratchParent = path.join(root, 'scratch');
  await fs.mkdir(worktree, { mode: 0o700 }); await fs.mkdir(parentEvidence, { mode: 0o700 });
  const state = { capacity: 1024 * 1024 };
  const testContext = createTestContext({ policy: { reserveBytes: 1, peakBytes: 1,
    evidenceRunBytes: 8192, evidenceOrdinaryBytes: 6144, evidenceClosureBytes: 2048,
    artifactBytes: 4096, evidenceParentBytes: 1024 * 1024 },
    measureFilesystem: async root => ({ id: root.dev, type: 'synthetic', blockBytes: 4096, availableBytes: state.capacity }),
  });
  const plan = { worktree, parent: parentEvidence, scratchParent, source: 'pinned-source', runId: 'host-1' };
  const open = async () => { const writer = await openHostEvidence(plan, { testContext }); writers.push(writer); return writer; };
  return { plan, state, testContext, open, expected: { parent: parentEvidence, runId: 'host-1', source: 'pinned-source', closureBytes: 2048 } };
}

test('fixture adapter admits before scratch creation and publishes only actual closed immutable paths', async t => {
  const f = await fixture(t); const writer = await f.open();
  await assert.rejects(fs.lstat(f.plan.scratchParent), { code: 'ENOENT' });
  const closing = writer.close({ cleanup: { rootAbsent: true }, ledger: [], finalDigests: {} });
  assert.equal(writer.close({ error: 'late replacement' }), closing);
  const bundle = await closing;
  const validated = await validateHostBundle(bundle, f.expected);
  assert.equal(validated.value.source, 'pinned-source');
  assert.equal(bundle.result.code, 0);
  assert.equal(bundle.report.path, path.join(writer.directory, 'report.json'));
  await assert.rejects(fs.lstat(path.join(f.plan.parent, '.hq-storage.lock')), { code: 'ENOENT' });
});

for (const capacity of [0, NaN]) test(`unknown/low capacity ${capacity} allocates neither evidence nor scratch`, async t => {
  const f = await fixture(t); f.state.capacity = capacity;
  await assert.rejects(f.open(), /Storage refused|Unknown/);
  assert.deepEqual(await fs.readdir(f.plan.parent), []);
  await assert.rejects(fs.lstat(f.plan.scratchParent), { code: 'ENOENT' });
});

test('existing evidence parent and disjoint roots are mandatory before any writer allocation', async t => {
  const f = await fixture(t);
  await assert.rejects(inspectReceiver({ ...f.plan, parent: path.join(f.plan.parent, 'absent') }, { testContext: f.testContext }), /absent/);
  await assert.rejects(inspectReceiver({ ...f.plan, scratchParent: path.join(f.plan.parent, 'nested') }, { testContext: f.testContext }), /disjoint/);
  assert.deepEqual(await fs.readdir(f.plan.parent), []);
});

for (const key of ['source', 'runId', 'parent']) test(`closed ${key} substitution is refused`, async t => {
  const f = await fixture(t); const writer = await f.open(); const bundle = await writer.close({});
  await assert.rejects(validateHostBundle({ ...bundle, [key]: 'substituted' }, f.expected), /Closed/);
});

test('closed report path/hash substitution and changed bytes never fall back to a caller report', async t => {
  const f = await fixture(t); const writer = await f.open(); const bundle = await writer.close({});
  await assert.rejects(validateHostBundle({ ...bundle, report: { ...bundle.report, path: '/unowned/report.json' } }, f.expected));
  await assert.rejects(validateHostBundle({ ...bundle, report: { ...bundle.report, sha256: '0'.repeat(64) } }, f.expected));
  await fs.appendFile(bundle.report.path, ' ');
  await assert.rejects(validateHostBundle(bundle, f.expected));
});

test('failed cleanup remains primary in the closed writer outcome', async t => {
  const f = await fixture(t); const writer = await f.open();
  const bundle = await writer.close({ error: 'original failure', cleanupError: 'cleanup failed' });
  assert.equal(bundle.result.code, 1);
  assert.equal(bundle.result.incomplete, false);
});

test('writer refusal closes the reserved receipt and releases only its own lock', async t => {
  const f = await fixture(t); const writer = await f.open();
  await assert.rejects(writer.close({ oversized: 'x'.repeat(5000) }), /artifact byte limit/);
  const closure = JSON.parse(await fs.readFile(path.join(writer.directory, '.closure.json'), 'utf8'));
  assert.equal(closure.status, 'incomplete'); assert.equal(closure.code, 1);
  await assert.rejects(fs.lstat(path.join(f.plan.parent, '.hq-storage.lock')), { code: 'ENOENT' });
});
