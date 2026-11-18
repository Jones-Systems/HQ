'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture } = require('./fixtures.cjs');
const { prepareInstallation, activatePrepared, inspectInstallation, recoverInstallation, parseArguments } = require('../installer.cjs');
const { readJson, recordPath } = require('../contract.cjs');

test('fresh installer prepares an absent target with an explicit new profile and retained helper', async t => {
  const f = await fixture(t, { kind: 'fresh' });
  const result = await prepareInstallation({ record: f.record, candidate: f.candidate, mode: 'fresh' }, f.adapters);
  assert.equal(result.journal.state, 'prepared');
  assert.equal(result.journal.prior, null);
  assert.equal((await readJson(recordPath(f.record.targetPath))).userData, f.record.userData);
  await assert.rejects(fs.stat(f.record.targetPath), { code: 'ENOENT' });
  await assert.rejects(fs.stat(f.record.userData), { code: 'ENOENT' });
  assert.equal((await activatePrepared(f.record, f.adapters)).state, 'handoff');
  assert.equal(f.calls.filter(call => call[0] === 'spawnHelper').length, 1);
  await assert.rejects(prepareInstallation({ record: f.record, candidate: f.candidate, mode: 'fresh' }, f.adapters), { code: 'recovery-required' });
});

test('fresh installer refuses an existing target or existing profile instead of adopting it', async t => {
  const f = await fixture(t, { kind: 'fresh' });
  await fs.mkdir(f.record.targetPath);
  await assert.rejects(prepareInstallation({ record: f.record, candidate: f.candidate, mode: 'fresh' }, f.adapters), { code: 'recovery-required' });
  await fs.rmdir(f.record.targetPath);
  await fs.mkdir(f.record.userData, { recursive: true });
  await assert.rejects(prepareInstallation({ record: f.record, candidate: f.candidate, mode: 'fresh' }, f.adapters), { code: 'recovery-required' });
  await assert.rejects(readJson(recordPath(f.record.targetPath)), { code: 'ENOENT' });
});

test('legacy adoption requires exact source hashes and supplied pins without profile reads', async t => {
  const f = await fixture(t, { kind: 'adopt' });
  const before = await fs.readFile(path.join(f.record.userData, 'untouched.data'));
  await assert.rejects(prepareInstallation({ record: f.record, candidate: f.candidate, mode: 'adopt', expectedLegacy: { ...f.record.installed, mainSha256: '0'.repeat(64) } }, f.adapters), { code: 'stale-candidate' });
  const result = await prepareInstallation({ record: f.record, candidate: f.candidate, mode: 'adopt', expectedLegacy: f.record.installed }, f.adapters);
  assert.equal(result.journal.priorEpoch, 'unknown');
  assert.equal(result.record.userData, f.record.userData);
  assert.deepEqual(await fs.readFile(path.join(f.record.userData, 'untouched.data')), before);
});

test('production installer requires independent trust and rejects a different verified candidate', async t => {
  const f = await fixture(t, { kind: 'fresh', synthetic: false });
  await assert.rejects(prepareInstallation({ record: f.record, candidate: f.candidate, mode: 'fresh' }, f.adapters), { code: 'provenance' });
  await assert.rejects(prepareInstallation({ record: f.record, candidate: f.candidate, mode: 'fresh' }, { ...f.adapters, verifyCandidate: async () => ({ ...f.candidate, bundlePath: path.join(f.root, 'elsewhere.app') }) }), { code: 'stale-candidate' });
  await assert.rejects(readJson(recordPath(f.record.targetPath)), { code: 'ENOENT' });
});

test('inspection is read-only and recovery requires exact operation and sequence', async t => {
  const f = await fixture(t);
  const prepared = await f.prepare();
  const before = await fs.readFile(f.engine.journalFile(f.record));
  const inspection = await inspectInstallation(f.record, f.adapters);
  assert.equal(inspection.transaction.operationId, prepared.operationId);
  assert.deepEqual(await fs.readFile(f.engine.journalFile(f.record)), before);
  await assert.rejects(recoverInstallation(f.record, { operationId: prepared.operationId, expectedSequence: prepared.sequence + 1 }, f.adapters), { code: 'stale-candidate' });
});

test('installer has closed arguments and never accepts shell-shaped target commands', () => {
  assert.deepEqual(parseArguments(['fresh', '--channel', 'preview']), { command: 'fresh', args: { channel: 'preview' } });
  for (const argv of [['fresh', '--profile', '/other'], ['fresh', '--target'], ['adopt', '--input', 'one', '--input', 'two'], ['cleanup', '--all', 'true'], ['inspect', '--execute', 'command']]) assert.throws(() => parseArguments(argv), { code: 'invalid' });
});
