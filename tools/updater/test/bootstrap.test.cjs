'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { run, getContext } = require('../bootstrap.cjs');
const { fixture, identity, fakeApp } = require('./fixtures.cjs');
const { readJson, recordPath } = require('../contract.cjs');

function useAppProcess(f, pid = 401) {
  f.processes.clear();
  f.setSelf(identity(path.join(f.record.targetPath, 'Contents/MacOS', f.record.appName), pid));
}
function options(f, app, importMain, extra = {}) {
  return { app, importMain, bundlePath: f.record.targetPath, adapters: { ...f.adapters, argv: [], environment: {}, ...extra } };
}

test('pins and singleton exclusion precede main; readiness does not wait for a renderer that is not created', async t => {
  const f = await fixture(t);
  await f.writeRecord();
  useAppProcess(f);
  const app = fakeApp(f.record.appName);
  let imported = false;
  await run(options(f, app, async () => {
    imported = true;
    assert.deepEqual(app.calls.slice(0, 3), [['setPath', 'userData', f.record.userData], ['setPath', 'sessionData', f.record.sessionData], ['singleton']]);
    assert.equal(await getContext().markMainReady(), false);
    assert.equal(await getContext().markRendererReady(), true);
  }));
  assert.equal(imported, true);
  assert.equal(app.listenerCount('will-quit'), 1);
  await getContext().dispose();
  assert.equal(app.listenerCount('will-quit'), 0);
  assert.equal(await f.engine.state.session(f.record), null);
});

test('schedule/cancel persist exact consent, leave the app running and preserve profile contents', async t => {
  const f = await fixture(t);
  await f.writeRecord();
  useAppProcess(f);
  const app = fakeApp(f.record.appName);
  await run(options(f, app, async () => {}));
  const context = getContext();
  await context.schedule(f.candidate);
  assert.equal((await readJson(path.join(f.record.stateRoot, 'scheduled.json'))).candidate.candidateId, f.candidate.candidateId);
  assert.equal(app.calls.some(call => call[0] === 'exit'), false);
  assert.equal(f.calls.some(call => call[0] === 'spawnHelper'), false);
  assert.equal(await fs.readFile(path.join(f.record.userData, 'untouched.data'), 'utf8'), 'synthetic profile bytes');
  await assert.rejects(context.schedule({ ...f.candidate, candidateId: 'f'.repeat(64) }), { code: 'stale-candidate' });
  await context.cancelScheduled();
  await assert.rejects(readJson(path.join(f.record.stateRoot, 'scheduled.json')), { code: 'ENOENT' });
  await context.dispose();
  await assert.rejects(context.schedule(f.candidate), { code: 'unavailable' });
});

test('only a later clean bootstrap hands off and exits before any replacement', async t => {
  const f = await fixture(t);
  await f.writeRecord();
  useAppProcess(f);
  await run(options(f, fakeApp(f.record.appName), async () => {}));
  await getContext().schedule(f.candidate);
  await getContext().dispose();
  useAppProcess(f, 402);
  const app = fakeApp(f.record.appName);
  let imported = false;
  const result = await run(options(f, app, async () => { imported = true; }));
  assert.equal(result.state, 'handoff');
  assert.equal(imported, false);
  assert.equal(f.calls.filter(call => call[0] === 'spawnHelper').length, 1);
  assert.equal(f.calls.some(call => call[0] === 'copyBundle'), false);
  assert.deepEqual(app.calls.slice(-2), [['releaseSingleton'], ['exit', 0]]);
  assert.equal((await f.engine.read(f.record)).initiating.pid, 402);
});

test('profile arguments, environment overrides and application identity mismatch stop before import', async t => {
  const f = await fixture(t);
  await f.writeRecord();
  useAppProcess(f);
  for (const extra of [{ argv: ['--user-data-dir=/unrelated'] }, { environment: { HQ_USER_DATA_DIR: '/unrelated' } }]) {
    let imported = false;
    await assert.rejects(run(options(f, fakeApp(f.record.appName), async () => { imported = true; }, extra)), { code: 'invalid' });
    assert.equal(imported, false);
  }
  await assert.rejects(run(options(f, fakeApp('different-name'), async () => assert.fail('main imported'))), { code: 'incompatible' });
});

test('another live lease or a failed singleton cannot import main', async t => {
  const f = await fixture(t);
  await f.writeRecord();
  useAppProcess(f);
  const existing = identity(path.join(f.record.targetPath, 'Contents/MacOS', f.record.appName), 500);
  f.processes.set(existing.pid, { ...existing, ppid: 0 });
  await f.locked(() => f.engine.state.claimSession(f.record, existing));
  await assert.rejects(run(options(f, fakeApp(f.record.appName), async () => assert.fail('main imported'))), { code: 'busy' });
  f.processes.delete(existing.pid);
  const app = fakeApp(f.record.appName);
  app.requestSingleInstanceLock = () => false;
  await assert.rejects(run(options(f, app, async () => assert.fail('main imported'))), { code: 'busy' });
});

test('profile-opened is durable before main and joint readiness commits the installed record', async t => {
  const f = await fixture(t, { kind: 'adopt' });
  await f.writeRecord();
  await f.prepare();
  let journal = await f.activate();
  journal = await f.locked(() => f.engine.requestLaunch(f.record, journal, f.self));
  const row = f.processes.get(303);
  f.setSelf({ pid: row.pid, start: row.start, boot: row.boot, executable: row.executable });
  const app = fakeApp(f.record.appName);
  const argv = [`--hq-update-operation=${journal.operationId}`, `--hq-update-sequence=${journal.sequence}`];
  await run(options(f, app, async () => {
    assert.equal((await f.engine.read(f.record)).profileOpened, true);
    assert.equal(getContext().record.compatibilityEpoch, 'unknown');
    assert.equal(await getContext().markMainReady(), false);
    assert.equal((await f.engine.read(f.record)).state, 'awaiting-health');
    assert.equal(await getContext().markRendererReady(), true);
    assert.equal(getContext().record.compatibilityEpoch, f.candidate.manifest.compatibilityEpoch);
    assert.equal((await readJson(recordPath(f.record.targetPath))).installed.buildSequence, 2);
    assert.equal(getContext().recovery, null);
  }, { argv }));
  await getContext().dispose();
});

test('a failed imported main retains the durable profile-opened barrier', async t => {
  const f = await fixture(t, { kind: 'adopt' });
  await f.writeRecord();
  await f.prepare();
  let journal = await f.activate();
  journal = await f.locked(() => f.engine.requestLaunch(f.record, journal, f.self));
  const row = f.processes.get(303);
  f.setSelf({ pid: row.pid, start: row.start, boot: row.boot, executable: row.executable });
  await assert.rejects(run(options(f, fakeApp(f.record.appName), async () => { throw new Error('main failed'); }, { argv: [`--hq-update-operation=${journal.operationId}`, `--hq-update-sequence=${journal.sequence}`] })), /main failed/);
  assert.equal((await f.engine.read(f.record)).profileOpened, true);
  await getContext().dispose();
});

test('later bootstrap replays durable exact health before an existing singleton denies import', async t => {
  let armed = false;
  const f = await fixture(t, { kind: 'adopt', checkpoint: async name => { if (armed && name === 'health-receipt') { armed = false; throw new Error('receipt interruption'); } } });
  await f.writeRecord();
  const { journal, launched } = await f.start();
  armed = true;
  await assert.rejects(f.locked(() => f.engine.acknowledge(f.record, launched, journal.operationId, journal.candidate.candidateId)), /receipt interruption/);
  f.setSelf(identity(path.join(f.record.targetPath, 'Contents/MacOS', f.record.appName), 404));
  const app = fakeApp(f.record.appName);
  app.requestSingleInstanceLock = () => false;
  await assert.rejects(run(options(f, app, async () => assert.fail('duplicate main imported'))), { code: 'busy' });
  assert.equal((await f.engine.read(f.record)).state, 'committed');
  assert.equal((await readJson(recordPath(f.record.targetPath))).compatibilityEpoch, f.candidate.manifest.compatibilityEpoch);
});
