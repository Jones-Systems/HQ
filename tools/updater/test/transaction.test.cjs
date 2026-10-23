'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { fixture, identity, writeBundle, fakeApp } = require('./fixtures.cjs');
const { run, getContext } = require('../bootstrap.cjs');
const { createTransaction, isCandidateRetained } = require('../transaction.cjs');
const { atomicWrite, readJson, recordPath, receiptOf } = require('../contract.cjs');

for (const boundary of ['prepared', 'before-stage-copy', 'after-stage-copy', 'staged', 'before-retain-prior', 'after-retain-prior', 'prior-retained', 'before-install-replacement', 'after-install-replacement', 'replacement-installed', 'awaiting-health']) {
  test(`interrupted ${boundary} reconciles exact bundle identities`, async t => {
    let enabled = true;
    const f = await fixture(t, { checkpoint: async name => { if (enabled && name === boundary) { enabled = false; throw new Error('injected interruption'); } } });
    if (boundary === 'prepared') await assert.rejects(f.prepare(), /injected interruption/);
    else { await f.prepare(); await assert.rejects(f.activate(), /injected interruption/); }
    const journal = await f.activate();
    assert.equal(journal.state, 'awaiting-health');
    assert.deepEqual(await f.native.verifyBundle(f.record.targetPath, receiptOf(f.candidate.manifest)), receiptOf(f.candidate.manifest));
    assert.deepEqual(await f.native.verifyBundle(journal.priorPath, f.prior), f.prior);
    assert.equal(await fs.readFile(path.join(f.record.userData, 'untouched.data'), 'utf8'), 'synthetic profile bytes');
  });
}

test('journal fsync and rename failures preserve a reconcilable complete record', async t => {
  for (const boundary of ['atomic-file-synced', 'atomic-renamed', 'atomic-directory-synced']) {
    let armed = false;
    const f = await fixture(t, { checkpoint: async (name, filename) => {
      if (armed && name === boundary && typeof filename === 'string' && filename.endsWith('/transaction.json')) { armed = false; throw new Error('journal durability fault'); }
    } });
    await f.prepare();
    armed = true;
    await assert.rejects(f.activate(), /journal durability fault/);
    assert.equal((await f.activate()).state, 'awaiting-health');
  }
});

test('concurrent gate owners cannot mutate and a live lease is not stolen', async t => {
  const f = await fixture(t);
  const gate = await f.engine.state.acquireGate(f.record, f.self);
  const other = identity(path.join(f.root, 'other-runtime'), 909);
  f.processes.set(other.pid, { ...other, ppid: 0 });
  await assert.rejects(f.engine.state.acquireGate(f.record, other), { code: 'busy' });
  await gate.release();
  const owned = await f.engine.state.acquireGate(f.record, other);
  await owned.release();
});

test('PID reuse and reboot prove stale leases; unavailable process evidence holds', async t => {
  const f = await fixture(t);
  const old = identity(path.join(f.record.targetPath, 'Contents/MacOS', f.record.appName), 800);
  f.processes.set(old.pid, { ...old, ppid: 0 });
  await f.locked(() => f.engine.state.claimSession(f.record, old));
  await assert.rejects(f.locked(() => f.engine.state.claimSession(f.record, f.self)), { code: 'busy' });
  f.setComplete(false);
  await assert.rejects(f.locked(() => f.engine.state.claimSession(f.record, f.self)), { code: 'recovery-required' });
  f.setComplete(true);
  f.processes.set(old.pid, { ...old, start: 'reused-pid-start', ppid: 0 });
  const lease = await f.locked(() => f.engine.state.claimSession(f.record, f.self));
  assert.equal(lease.process.pid, f.self.pid);
  assert.equal(await f.native.observe({ ...old, boot: 'prior-boot' }), 'stale');
});

test('dead gate owner is reconciled without treating an incomplete owner as stale', async t => {
  const f = await fixture(t);
  const dead = identity(path.join(f.root, 'dead-runtime'), 999);
  await f.engine.state.acquireGate(f.record, dead);
  const gate = await f.engine.state.acquireGate(f.record, f.self);
  await gate.release();
  assert.equal((await fs.readdir(f.record.stateRoot)).filter(name => name.startsWith('abandoned-gate-')).length, 1);
  await fs.mkdir(path.join(f.record.stateRoot, 'gate'));
  await assert.rejects(f.engine.state.acquireGate(f.record, f.self));
});

test('exact cache helper exception does not exempt its children or another cache process', async t => {
  const f = await fixture(t);
  await f.prepare();
  const child = identity(path.join(f.root, 'external-child'), 402);
  f.processes.set(child.pid, { ...child, ppid: f.self.pid });
  await assert.rejects(f.activate(), { code: 'busy' });
  f.processes.delete(child.pid);
  const other = identity(path.join(f.candidate.bundlePath, 'Contents/MacOS', f.record.appName), 403);
  f.processes.set(other.pid, { ...other, ppid: 0 });
  await assert.rejects(f.activate(), { code: 'busy' });
});

test('initiating bootstrap must be proved exited before the first mutation', async t => {
  const f = await fixture(t);
  const initiating = identity(path.join(f.record.targetPath, 'Contents/MacOS', f.record.appName), 400);
  f.processes.set(initiating.pid, { ...initiating, ppid: 0 });
  await f.locked(() => f.engine.prepare(f.record, f.candidate, { initiating }));
  assert.equal((await f.activate()).state, 'held');
  assert.equal(f.calls.some(call => call[0] === 'copyBundle'), false);
  f.processes.delete(initiating.pid);
  assert.equal((await f.activate()).state, 'awaiting-health');
});

test('target substitution, stage symlinks and disk shortage fail before a rename', async t => {
  const f = await fixture(t);
  const journal = await f.prepare();
  await fs.symlink(f.candidate.bundlePath, journal.stagePath);
  await assert.rejects(f.activate(), { code: 'recovery-required' });
  await fs.unlink(journal.stagePath);
  await writeBundle(f.record.targetPath, { ...f.prior, sourceSha: 'e'.repeat(40) });
  await assert.rejects(f.activate(), { code: 'integrity' });
  await writeBundle(f.record.targetPath, f.prior);
  f.native.checkTarget = async () => { const error = new Error('space'); error.code = 'space'; throw error; };
  await assert.rejects(f.activate(), { code: 'space' });
  assert.equal(await fs.readFile(path.join(f.record.userData, 'untouched.data'), 'utf8'), 'synthetic profile bytes');
});

test('HQ-REV-004 partial staging recovery preserves the partial tree and lets the unchanged app boot', async t => {
  const f = await fixture(t);
  await f.writeRecord();
  f.native.copyBundle = async (_source, destination) => {
    assert.equal((await fs.lstat(destination)).isDirectory(), true);
    await fs.writeFile(path.join(destination, 'partial.data'), 'owned incomplete copy');
    throw new Error('interrupted stage copy');
  };
  await f.prepare();
  await assert.rejects(f.activate(), /interrupted stage copy/);
  const partial = await f.engine.read(f.record);
  assert.equal(partial.state, 'prepared');
  const recovered = await f.locked(() => f.engine.recover(f.record, f.self, { operationId: partial.operationId, expectedSequence: partial.sequence }));
  assert.equal(recovered.state, 'restored');
  assert.deepEqual(await f.native.verifyBundle(f.record.targetPath, f.prior), f.prior);
  assert.equal(await fs.readFile(path.join(recovered.failedPath, 'partial.data'), 'utf8'), 'owned incomplete copy');
  await assert.rejects(fs.stat(recovered.stagePath), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(f.record.userData, 'untouched.data'), 'utf8'), 'synthetic profile bytes');
  f.processes.clear();
  f.setSelf(identity(path.join(f.record.targetPath, 'Contents/MacOS', f.record.appName), 404));
  let imported = false;
  assert.equal((await run({ app: fakeApp(f.record.appName), bundlePath: f.record.targetPath, adapters: { ...f.adapters, argv: [], environment: {} }, importMain: async () => { imported = true; } })).state, 'running');
  assert.equal(imported, true);
  await getContext().dispose();
});

for (const evidence of ['live-stage', 'unknown-process']) test(`HQ-REV-004 ${evidence} holds partial staging without moving either tree`, async t => {
  const f = await fixture(t);
  f.native.copyBundle = async (_source, destination) => {
    assert.equal((await fs.lstat(destination)).isDirectory(), true);
    await fs.writeFile(path.join(destination, 'partial.data'), 'owned incomplete copy');
    throw new Error('interrupted stage copy');
  };
  await f.prepare();
  await assert.rejects(f.activate(), /interrupted stage copy/);
  const partial = await f.engine.read(f.record);
  if (evidence === 'live-stage') {
    const writer = identity(path.join(partial.stagePath, 'Contents/MacOS', f.record.appName), 707);
    f.processes.set(writer.pid, { ...writer, ppid: 0 });
  } else f.setComplete(false);
  const held = await f.locked(() => f.engine.recover(f.record, f.self, { operationId: partial.operationId, expectedSequence: partial.sequence }));
  assert.equal(held.state, 'held');
  assert.equal(await fs.readFile(path.join(partial.stagePath, 'partial.data'), 'utf8'), 'owned incomplete copy');
  await assert.rejects(fs.stat(partial.failedPath), { code: 'ENOENT' });
  assert.deepEqual(await f.native.verifyBundle(f.record.targetPath, f.prior), f.prior);
});

test('journal nonce, sequence and expected current identity are compare-and-set guards', async t => {
  const f = await fixture(t);
  const prepared = await f.prepare();
  const active = await f.activate();
  await assert.rejects(f.locked(() => f.engine.save(f.record, prepared, { state: 'staged' })), { code: 'stale-candidate' });
  await assert.rejects(f.locked(() => f.engine.recover(f.record, f.self, { operationId: '0'.repeat(32), expectedSequence: active.sequence })), { code: 'stale-candidate' });
  await assert.rejects(f.locked(() => f.engine.recover(f.record, f.self, { operationId: active.operationId, expectedSequence: active.sequence - 1 })), { code: 'stale-candidate' });
});

test('live timeout holds, then late exact health commits without a rename', async t => {
  const f = await fixture(t);
  const { journal, launched } = await f.start();
  const held = await f.locked(() => f.engine.recover(f.record, f.self, { operationId: journal.operationId, expectedSequence: journal.sequence, timeout: true }));
  assert.equal(held.state, 'held');
  assert.equal(held.reason, 'health-timeout');
  assert.equal(held.profileOpened, true);
  await assert.rejects(f.locked(() => f.engine.acknowledge(f.record, { ...launched, start: 'different-start' }, journal.operationId, journal.candidate.candidateId)), { code: 'stale-candidate' });
  await assert.rejects(f.locked(() => f.engine.acknowledge(f.record, launched, journal.operationId, 'f'.repeat(64))), { code: 'stale-candidate' });
  const result = await f.locked(() => f.engine.acknowledge(f.record, launched, journal.operationId, journal.candidate.candidateId));
  assert.equal(result.journal.state, 'committed');
  assert.equal((await readJson(recordPath(f.record.targetPath))).installed.buildSequence, 2);
  await assert.rejects(fs.stat(journal.failedPath), { code: 'ENOENT' });
});

test('durable health receipt can be committed after interruption; post-commit writes survive', async t => {
  let armed = false;
  const f = await fixture(t, { checkpoint: async name => { if (armed && name === 'health-receipt') { armed = false; throw new Error('health interruption'); } } });
  const { journal, launched } = await f.start();
  armed = true;
  await assert.rejects(f.locked(() => f.engine.acknowledge(f.record, launched, journal.operationId, journal.candidate.candidateId)), /health interruption/);
  const committed = await f.locked(() => f.engine.recover(f.record, f.self, { operationId: journal.operationId, expectedSequence: journal.sequence }));
  assert.equal(committed.state, 'committed');
  await fs.writeFile(path.join(f.record.userData, 'after-commit.data'), 'new synthetic writes');
  f.processes.delete(launched.pid);
  assert.equal((await f.locked(() => f.engine.recover(f.record, f.self, { operationId: committed.operationId, expectedSequence: committed.sequence }))).state, 'committed');
  assert.equal(await fs.readFile(path.join(f.record.userData, 'after-commit.data'), 'utf8'), 'new synthetic writes');
});

test('exact durable health commits after candidate exit without restoring its prior bundle', async t => {
  let armed = false;
  const f = await fixture(t, { kind: 'adopt', checkpoint: async name => { if (armed && name === 'health-receipt') { armed = false; throw new Error('receipt interruption'); } } });
  const { journal, launched } = await f.start();
  armed = true;
  await assert.rejects(f.locked(() => f.engine.acknowledge(f.record, launched, journal.operationId, journal.candidate.candidateId)), /receipt interruption/);
  f.processes.delete(launched.pid);
  const committed = await f.locked(() => f.engine.recover(f.record, f.self, { operationId: journal.operationId, expectedSequence: journal.sequence }));
  assert.equal(committed.state, 'committed');
  assert.equal((await readJson(recordPath(f.record.targetPath))).compatibilityEpoch, f.candidate.manifest.compatibilityEpoch);
  assert.equal((await f.native.verifyBundle(f.record.targetPath, receiptOf(f.candidate.manifest))).buildSequence, 2);
  assert.equal(await fs.readFile(path.join(f.record.userData, 'untouched.data'), 'utf8'), 'synthetic profile bytes');
  await assert.rejects(fs.stat(journal.failedPath), { code: 'ENOENT' });
});

test('unknown process evidence cannot produce a durable health receipt', async t => {
  const f = await fixture(t);
  const { journal, launched } = await f.start();
  f.setComplete(false);
  await assert.rejects(f.locked(() => f.engine.acknowledge(f.record, launched, journal.operationId, journal.candidate.candidateId)), { code: 'recovery-required' });
  await assert.rejects(fs.stat(f.engine.healthFile(f.record)), { code: 'ENOENT' });
  assert.equal((await f.engine.read(f.record)).state, 'awaiting-health');
  assert.equal(await fs.readFile(path.join(f.record.userData, 'untouched.data'), 'utf8'), 'synthetic profile bytes');
});

test('dead compatible candidate restores only the binary and preserves profile files', async t => {
  const f = await fixture(t);
  const { journal, launched } = await f.start();
  f.processes.delete(launched.pid);
  const restored = await f.locked(() => f.engine.recover(f.record, f.self, { operationId: journal.operationId, expectedSequence: journal.sequence }));
  assert.equal(restored.state, 'restored');
  assert.equal((await f.native.verifyBundle(f.record.targetPath, f.prior)).buildSequence, 1);
  assert.equal(await fs.readFile(path.join(f.record.userData, 'untouched.data'), 'utf8'), 'synthetic profile bytes');
});

for (const boundary of ['after-retain-failed', 'after-restore-prior']) test(`recovery reconciles ${boundary} without duplicate moves`, async t => {
  let armed = false;
  const f = await fixture(t, { checkpoint: async name => { if (armed && name === boundary) { armed = false; throw new Error('rollback interruption'); } } });
  const { journal, launched } = await f.start();
  f.processes.delete(launched.pid);
  armed = true;
  const recover = () => f.locked(() => f.engine.recover(f.record, f.self, { operationId: journal.operationId, expectedSequence: journal.sequence }));
  await assert.rejects(recover(), /rollback interruption/);
  assert.equal((await recover()).state, 'restored');
});

test('unknown legacy epoch restores before profile-opened and holds afterward', async t => {
  const before = await fixture(t, { kind: 'adopt' });
  await before.prepare();
  const unlaunched = await before.activate();
  assert.equal((await before.locked(() => before.engine.recover(before.record, before.self, { operationId: unlaunched.operationId, expectedSequence: unlaunched.sequence }))).state, 'restored');
  const after = await fixture(t, { kind: 'adopt' });
  const { journal, launched } = await after.start();
  after.processes.delete(launched.pid);
  const held = await after.locked(() => after.engine.recover(after.record, after.self, { operationId: journal.operationId, expectedSequence: journal.sequence }));
  assert.equal(held.reason, 'incompatible-recovery');
  assert.equal(await fs.readFile(path.join(after.record.userData, 'untouched.data'), 'utf8'), 'synthetic profile bytes');
});

test('unknown launch effect is not retried and complete process evidence is required', async t => {
  const f = await fixture(t);
  await f.prepare();
  let journal = await f.activate();
  f.native.launch = async () => { const error = new Error('unknown launch'); error.unknownEffect = true; throw error; };
  await assert.rejects(f.locked(() => f.engine.requestLaunch(f.record, journal, f.self)), /unknown launch/);
  journal = await f.engine.read(f.record);
  assert.equal(journal.launchAttempted, true);
  await assert.rejects(f.locked(() => f.engine.requestLaunch(f.record, journal, f.self)), { code: 'recovery-required' });
  f.setComplete(false);
  assert.equal((await f.locked(() => f.engine.recover(f.record, f.self, { operationId: journal.operationId, expectedSequence: journal.sequence }))).state, 'held');
});

test('retention guard protects active and historical candidates and rejects malformed metadata', async t => {
  const f = await fixture(t);
  const journal = await f.prepare();
  assert.equal(await isCandidateRetained(f.record.stateRoot, f.candidate.candidateId), true);
  assert.equal(await isCandidateRetained(f.record.stateRoot, 'f'.repeat(64)), false);
  await fs.mkdir(path.join(f.record.stateRoot, 'history'));
  await atomicWrite(path.join(f.record.stateRoot, 'history', `${journal.operationId}.json`), journal);
  assert.equal(await isCandidateRetained(f.record.stateRoot, f.candidate.candidateId), true);
  await fs.writeFile(path.join(f.record.stateRoot, 'history', 'unexpected.json'), '{}');
  await assert.rejects(isCandidateRetained(f.record.stateRoot, 'f'.repeat(64)), { code: 'recovery-required' });
});

test('a live historical retained executable and its child prevent replacement', async t => {
  const f = await fixture(t);
  const historical = await f.prepare();
  await fs.mkdir(path.join(f.record.stateRoot, 'history'));
  await atomicWrite(path.join(f.record.stateRoot, 'history', `${historical.operationId}.json`), historical);
  const prior = identity(path.join(historical.priorPath, 'Contents/MacOS', f.record.appName), 606);
  f.processes.set(prior.pid, { ...prior, ppid: 0 });
  await assert.rejects(f.engine.state.excludeWriters(f.record, null, [f.self]), { code: 'busy' });
  const child = identity(path.join(f.root, 'detached-service'), 607);
  f.processes.set(child.pid, { ...child, ppid: prior.pid });
  await assert.rejects(f.engine.state.excludeWriters(f.record, null, [f.self, prior]), { code: 'busy' });
  const corrupt = { ...historical, priorPath: path.join(f.root, 'unexpected.app') };
  await atomicWrite(path.join(f.record.stateRoot, 'history', `${historical.operationId}.json`), corrupt);
  await assert.rejects(f.engine.state.excludeWriters(f.record, null, [f.self]), { code: 'recovery-required' });
});

test('production admission cannot downgrade to ad-hoc while the exact pre-migration rollback remains retained', async t => {
  const { DEVELOPER_ID } = require('../signing.cjs');
  const { createTransaction } = require('../transaction.cjs');
  const f = await fixture(t);
  const prior = { ...f.prior, appName: 'HQ', bundleId: 'org.jones-systems.hq.local', signingPolicy: { ...DEVELOPER_ID } };
  const record = { ...f.record, synthetic: false, appName: 'HQ', bundleId: prior.bundleId, installed: prior };
  const candidateManifest = { ...f.candidate.manifest, appName: 'HQ', bundleId: prior.bundleId };
  const { candidateId } = require('../contract.cjs');
  const candidate = { ...f.candidate, manifest: candidateManifest, candidateId: candidateId(candidateManifest) };
  const engine = createTransaction({ native: f.native });
  assert.throws(() => engine.admit(record, candidate), /ad-hoc downgrade/);
  const signed = { ...candidateManifest, signing: 'developer-id', signingPolicy: { ...DEVELOPER_ID } };
  assert.doesNotThrow(() => engine.admit(record, { ...candidate, manifest: signed, candidateId: candidateId(signed) }));
  const developmentPrior = { ...prior }; delete developmentPrior.signingPolicy;
  assert.doesNotThrow(() => engine.admit({ ...record, installed: developmentPrior }, { ...candidate, manifest: signed, candidateId: candidateId(signed) }));
});
