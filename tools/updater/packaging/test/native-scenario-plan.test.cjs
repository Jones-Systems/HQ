'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { scenarioPlan } = require('../native-scenario-plan.cjs');
const { buildReceipt } = require('../identity.cjs');
const { fixture, writeBundle } = require('../../test/fixtures.cjs');
const { createTransaction, MAX_RETAINED_OPERATIONS } = require('../../transaction.cjs');
const { readBuildReceipt, readJson, recordPath } = require('../../contract.cjs');

test('the native scenario plan admits every candidate and completes all journeys within production retention', async t => {
  const f = await fixture(t, { kind: 'fresh' });
  const production = buildReceipt({ sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40), version: '0.1.0', buildSequence: 17, channel: 'preview', compatibilityEpoch: `hq1-${'c'.repeat(64)}`, architecture: 'arm64' });
  const plan = scenarioPlan(path.join(f.root, 'native-scenarios'), production, { size: 100, sha256: 'd'.repeat(64), expandedSize: 1000, fileCount: 10 });
  const completed = new Set();
  for (const scenario of plan) {
    let record = scenario.record;
    await fs.mkdir(path.dirname(record.targetPath), { recursive: true });
    await fs.mkdir(path.dirname(record.stateRoot), { recursive: true });
    let engine = createTransaction(f.adapters);
    await engine.state.initialize(record);
    for (const step of scenario.steps) await writeBundle(step.candidate.bundlePath, step.receipt);
    await fs.mkdir(record.userData, { recursive: true });
    await fs.mkdir(record.sessionData, { recursive: true });
    const locked = action => engine.state.withGate(record, f.self, action);
    for (const step of scenario.steps) {
      const prior = record.installed;
      await locked(() => engine.prepare(record, step.candidate, { kind: step.journey === 'fresh' ? 'fresh' : 'update' }));
      let journal;
      if (step.journey === 'interrupted-recovery') {
        let interrupted = false;
        engine = createTransaction({ ...f.adapters, checkpoint: async name => { if (name === 'staged' && !interrupted) { interrupted = true; throw new Error('planned staged interruption'); } } });
        await assert.rejects(locked(() => engine.activate(record, f.self)), /planned staged interruption/);
        assert.equal((await engine.read(record)).state, 'staged');
        engine = createTransaction(f.adapters);
        const before = await engine.read(record);
        journal = await locked(() => engine.recover(record, f.self, { operationId: before.operationId, expectedSequence: before.sequence }));
      } else journal = await locked(() => engine.activate(record, f.self));
      assert.equal(journal.state, 'awaiting-health');
      journal = await locked(() => engine.requestLaunch(record, journal, f.self));
      const row = f.processes.get(303);
      const launched = { pid: row.pid, start: row.start, boot: row.boot, executable: row.executable };
      journal = await locked(() => engine.registerLaunch(record, launched, journal.operationId, journal.sequence));
      if (step.journey === 'failed-health') {
        await fs.writeFile(path.join(record.userData, 'post-open.data'), 'preserve failed health writes');
        f.processes.delete(launched.pid);
        const restored = await locked(() => engine.recover(record, f.self, { operationId: journal.operationId, expectedSequence: journal.sequence }));
        assert.equal(restored.state, 'restored');
        assert.deepEqual(await readBuildReceipt(record.targetPath, { synthetic: true }), prior);
        assert.deepEqual(await readBuildReceipt(restored.failedPath, { synthetic: true }), step.receipt);
        assert.equal(await fs.readFile(path.join(record.userData, 'post-open.data'), 'utf8'), 'preserve failed health writes');
        assert.equal(await fs.readFile(path.join(record.userData, 'committed.data'), 'utf8'), 'preserve committed writes');
        record = await readJson(recordPath(record.targetPath));
      } else {
        const healthy = await locked(() => engine.acknowledge(record, launched, journal.operationId, step.candidate.candidateId));
        assert.equal(healthy.journal.state, 'committed');
        record = healthy.record;
        f.processes.delete(launched.pid);
        await fs.writeFile(path.join(record.userData, 'committed.data'), 'preserve committed writes');
        assert.deepEqual(await readBuildReceipt(record.targetPath, { synthetic: true }), step.receipt);
      }
      completed.add(step.journey);
    }
    const history = await fs.readdir(path.join(record.stateRoot, 'history'));
    assert.ok(history.length <= MAX_RETAINED_OPERATIONS);
  }
  assert.deepEqual([...completed].sort(), ['failed-health', 'fresh', 'interrupted-recovery', 'next-launch']);
});
