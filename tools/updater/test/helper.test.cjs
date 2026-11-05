'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { fixture, identity } = require('./fixtures.cjs');
const { runHelper } = require('../helper.cjs');

test('helper refuses to run from the bundle it would replace', async t => {
  const f = await fixture(t);
  const journal = await f.prepare();
  f.setSelf(identity(path.join(f.record.targetPath, 'Contents/MacOS', f.record.appName), 500));
  await assert.rejects(runHelper({ record: f.record, operationId: journal.operationId, adapters: f.adapters }), { code: 'recovery-required' });
  assert.equal(f.calls.some(call => call[0] === 'copyBundle'), false);
});

test('a still-live initiating bootstrap times out held without any signal or bundle mutation', async t => {
  const f = await fixture(t);
  const initiating = identity(path.join(f.record.targetPath, 'Contents/MacOS', f.record.appName), 500);
  f.processes.set(initiating.pid, { ...initiating, ppid: 0 });
  const journal = await f.locked(() => f.engine.prepare(f.record, f.candidate, { initiating }));
  const result = await runHelper({ record: f.record, operationId: journal.operationId, adapters: { ...f.adapters, sleep: async () => f.setNow(200000) } });
  assert.equal(result.state, 'held');
  assert.equal(result.reason, 'live-process');
  assert.equal(f.calls.some(call => call[0] === 'copyBundle' || call[0] === 'launch'), false);
});

test('retained helper installs, observes joint health and releases its gate', async t => {
  const f = await fixture(t);
  const prepared = await f.prepare();
  let healthDelivered = false;
  const result = await runHelper({ record: f.record, operationId: prepared.operationId, adapters: { ...f.adapters, sleep: async () => {
    if (healthDelivered) return;
    healthDelivered = true;
    let journal = await f.engine.read(f.record);
    const row = f.processes.get(303);
    const launched = { pid: row.pid, start: row.start, boot: row.boot, executable: row.executable };
    journal = await f.locked(() => f.engine.registerLaunch(f.record, launched, journal.operationId, journal.sequence));
    await f.locked(() => f.engine.acknowledge(f.record, launched, journal.operationId, journal.candidate.candidateId));
  } } });
  assert.equal(result.state, 'committed');
  const gate = await f.engine.state.acquireGate(f.record, f.self);
  await gate.release();
});

test('a launch with no acknowledged identity holds at timeout while its process remains live', async t => {
  const f = await fixture(t);
  const prepared = await f.prepare();
  const result = await runHelper({ record: f.record, operationId: prepared.operationId, adapters: { ...f.adapters, sleep: async () => f.setNow(200000) } });
  assert.equal(result.state, 'held');
  assert.equal(result.reason, 'live-process');
  assert.equal(f.processes.has(303), true);
});
