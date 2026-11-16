'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { runInNewContext } = require('node:vm');
const { fixture, fakeApp } = require('./fixtures.cjs');
const bootstrap = require('../bootstrap.cjs');
const { runHelper } = require('../helper.cjs');
const { createState } = require('../state.cjs');
const { atomicWrite, readJson } = require('../contract.cjs');
const { fixtureReporter, captureFailure } = require('../packaging/fixtures/native-diagnostics.cjs');

const boot = '1792612800:000002';
const syntheticPid = value => value === process.pid ? value + 1 : value;
const helperObserverPid = syntheticPid(2147000001);
const bootstrapObserverPid = syntheticPid(2147000010);
const sentinel = 'SYNTHETIC_PRIVATE_ARGV_ENV_PROFILE_EVENT';
const production = { sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40), architecture: 'arm64' };
const archive = { sha256: 'c'.repeat(64), size: 100, expandedSize: 200, fileCount: 1 };
const identity = (executable, pid, start = '1792663200:000001') => ({ pid, start, boot, executable });
const row = (value, ppid = 0) => ({ ...value, ppid });
const inventoryPath = bundle => path.join(bundle, 'Contents/Resources/app/tools/updater/process-inventory');
const equalIdentity = { pidEqual: true, identityEqual: true };
const differentIdentity = { pidEqual: false, identityEqual: false };
const unknownIdentity = { pidEqual: null, identityEqual: null };

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function packagedNative(bundle, execFile) {
  // Model the packaged loader location, using the unchanged production source and dependencies.
  // execFile is the existing native seam: no inventory executable or other OS command runs.
  const source = path.resolve(__dirname, '../native.cjs');
  const module = { exports: {} };
  runInNewContext(await fs.readFile(source, 'utf8'), {
    module, require: createRequire(source), __dirname: path.dirname(inventoryPath(bundle)), process, Buffer,
  }, { filename: source });
  return module.exports.createNativeAdapter({ platform: 'darwin', architecture: 'arm64', execFile,
    spawn: () => assert.fail('portable inventory characterization must not spawn'),
  });
}

function observation(bundle, pid, rows) {
  // Keep the parser's required completed-child provenance intact. This is the
  // test runtime's parent PID, not an invented logical helper/bootstrap parent.
  const observer = row(identity(inventoryPath(bundle), pid, '1792663201:000002'), process.pid);
  return { stdout: JSON.stringify({ schemaVersion: 1, complete: true, boot, processes: [...rows, observer] }) };
}

async function retainDiagnostic(f, error, name) {
  const directory = path.join(f.root, 'diagnostics', name, 'fixture');
  const output = path.join(f.root, 'diagnostics', name, 'output');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.mkdir(output, { mode: 0o700 });
  await atomicWrite(path.join(directory, 'diagnostic-binding.json'), {
    runRoot: f.root, stateRoot: f.record.stateRoot, buildSequence: 2,
  });
  // Deliberately contaminate the input envelope, never the closed inventory rows.
  const envelope = Object.assign(new Error(sentinel), { code: error.code, refusal: error.refusal,
    argv: [sentinel], environment: { private: sentinel }, profile: sentinel, events: [sentinel] });
  assert.equal(fixtureReporter(directory, 'bootstrap')('error', envelope), true);
  const snapshot = captureFailure({ output, root: f.root, production, archive,
    active: { scenario: 'lifecycle', journey: 'fresh', buildSequence: 2, stateRoot: f.record.stateRoot }, error: envelope,
  });
  const milestone = snapshot.milestones['bootstrap:error'];
  assert.equal(snapshot.failureCategory, 'busy');
  assert.equal(milestone.category, 'busy');
  assert.deepEqual(milestone.refusal.writerEvidence, error.refusal.writerEvidence);
  const filename = path.join(output, 'native-smoke-primary-failure.json');
  const raw = await fs.readFile(filename, 'utf8');
  for (const value of [sentinel, f.root, String(helperObserverPid), String(bootstrapObserverPid)]) assert.equal(raw.includes(value), false);
  for (const key of ['pid', 'ppid', 'start', 'boot', 'executable', 'argv', 'environment', 'profile', 'events']) {
    assert.equal(raw.includes(`"${key}":`), false);
  }
  assert.ok(Buffer.byteLength(raw) <= 32768);
  assert.equal((await fs.stat(filename)).mode & 0o777, 0o600);
  return milestone.refusal;
}

test('inventory contention: real helper observation overlaps bootstrap exclusion without weakening writer refusal', async t => {
  const f = await fixture(t, { kind: 'fresh' });
  const oldState = f.record.stateRoot;
  f.record.stateRoot = path.join(f.root, 'lifecycle/state');
  await fs.mkdir(path.dirname(f.record.stateRoot), { mode: 0o700 });
  await fs.rename(oldState, f.record.stateRoot);
  f.candidate.bundlePath = path.join(f.record.stateRoot, path.relative(oldState, f.candidate.bundlePath));
  const helper = identity(path.join(f.candidate.bundlePath, 'Contents/MacOS', f.record.appName), syntheticPid(101));
  const self = identity(path.join(f.record.targetPath, 'Contents/MacOS', f.record.appName), syntheticPid(303));
  f.processes.clear();
  f.setSelf(helper);
  const prepared = await f.prepare();
  await f.writeRecord();

  const helperWaiting = deferred(), letHelperContend = deferred(), observerStarted = deferred(), completeObserver = deferred();
  const stop = new Error('bounded synthetic helper schedule complete');
  const events = [], sleeps = [], scans = [];
  let contending = false, observerPending = false, helperObservationCount = 0;
  const helperNative = await packagedNative(f.candidate.bundlePath, (file, args) => {
    assert.equal(file, inventoryPath(f.candidate.bundlePath));
    assert.deepEqual(Array.from(args), []);
    let pending;
    if (contending) {
      assert.equal(++helperObservationCount, 1, 'one contended observation, no blind retry');
      observerPending = true;
      events.push('helper-observer-started');
      observerStarted.resolve();
      pending = completeObserver.promise.then(() => {
        observerPending = false;
        events.push('helper-observer-completed');
        return observation(f.candidate.bundlePath, helperObserverPid, [row(helper), row(self)]);
      });
    } else pending = Promise.resolve(observation(f.candidate.bundlePath, helperObserverPid, [row(helper)]));
    pending.child = { pid: helperObserverPid };
    return pending;
  });
  // Bundle verification, copying and launch stay synthetic; observe/processTable
  // below execute native.cjs itself, rather than the fixture's process Map logic.
  const helperRun = runHelper({ record: f.record, operationId: prepared.operationId, adapters: {
    ...f.adapters, native: { ...f.native, identity: async () => helper,
      observe: helperNative.observe, processTable: helperNative.processTable },
    sleep: async milliseconds => {
      sleeps.push(milliseconds);
      if (sleeps.length === 1) {
        assert.equal(milliseconds, 200);
        helperWaiting.resolve();
        await letHelperContend.promise;
      } else {
        assert.equal(milliseconds, 20, 'withGate reached its busy retry after native.observe returned live');
        throw stop;
      }
    },
  } }).then(result => ({ result }), error => ({ error }));
  const unexpectedHelperEnd = () => helperRun.then(outcome => { throw outcome.error ?? new Error('helper ended before the scheduled barrier'); });

  try {
    await Promise.race([helperWaiting.promise, unexpectedHelperEnd()]);
    const before = await f.engine.read(f.record);
    assert.equal(before.state, 'awaiting-health');
    assert.equal(before.launchAttempted, true);
    assert.deepEqual(before.helper, helper);
    assert.equal(before.launch, null);
    assert.equal(before.profileOpened, false);
    assert.equal(before.health, null);
    const journalFile = path.join(f.record.stateRoot, 'transaction.json');
    const journalBytes = await fs.readFile(journalFile, 'utf8');
    const gateFile = path.join(f.record.stateRoot, 'gate/owner.json');
    const foreignObserver = row(identity(inventoryPath(f.candidate.bundlePath), helperObserverPid, '1792663201:000002'), process.pid);
    const framework = row(identity(path.join(f.record.targetPath, 'Contents/Frameworks/Synthetic Helper.app/Contents/MacOS/child'), syntheticPid(505)), self.pid);
    let scanRows = [row(helper), row(self), foreignObserver, framework];
    const native = await packagedNative(f.record.targetPath, (file, args) => {
      assert.equal(file, inventoryPath(f.record.targetPath));
      assert.deepEqual(Array.from(args), []);
      events.push('bootstrap-inventory');
      const pending = Promise.resolve(observation(f.record.targetPath, bootstrapObserverPid, scanRows));
      pending.child = { pid: bootstrapObserverPid };
      return pending;
    });
    const bootstrapNative = { ...f.native, identity: async () => self, observe: native.observe,
      processTable: async () => { const table = await native.processTable(); scans.push(table); return table; },
    };
    const app = fakeApp(f.record.appName);
    let original;
    await assert.rejects(bootstrap.run({ app, bundlePath: f.record.targetPath,
      importMain: async () => assert.fail('writer refusal must precede main import'),
      adapters: { ...f.adapters, native: bootstrapNative, environment: {},
        argv: [`--hq-update-operation=${before.operationId}`, `--hq-update-sequence=${before.sequence}`],
        checkpoint: async (name, file) => {
          if ([journalFile, path.join(f.record.stateRoot, 'session.json'), path.join(f.record.stateRoot, 'health.json')].includes(file)) {
            assert.fail('writer refusal must precede session claim, launch registration and health writes');
          }
          if (name !== 'atomic-directory-synced' || file !== gateFile) return;
          assert.deepEqual((await readJson(gateFile)).process, self);
          events.push('bootstrap-gate-held');
          contending = true;
          letHelperContend.resolve();
          await Promise.race([observerStarted.promise, unexpectedHelperEnd()]);
          assert.equal(observerPending, true);
        },
      },
    }), error => {
      original = error;
      assert.equal(error.code, 'busy');
      assert.equal(error.message, 'A live HQ app or helper blocks replacement.');
      assert.equal(error.refusal.guard, 'writer-process');
      return true;
    });
    assert.deepEqual(events, ['bootstrap-gate-held', 'helper-observer-started', 'bootstrap-inventory']);
    assert.equal(observerPending, true, 'foreign helper observation remains pending when bootstrap refuses');
    assert.equal(scans.length, 1);
    assert.deepEqual(Array.from(scans[0].processes, value => value.pid), [helper.pid, self.pid, helperObserverPid, framework.pid]);
    const evidence = original.refusal.writerEvidence;
    assert.equal(evidence.status, 'available');
    assert.equal(evidence.executableClass, 'inventory');
    assert.equal(evidence.rootClass, 'transaction-bundle');
    assert.deepEqual(evidence.self, differentIdentity);
    assert.deepEqual(evidence.helper, differentIdentity);
    assert.deepEqual(evidence.initiating, unknownIdentity);
    // Both logical roles run in one JS test process. The real observer-parent
    // requirement is retained, but its row is absent: no helper parent is inferred.
    assert.equal(scans[0].processes.some(value => value.pid === foreignObserver.ppid), false);
    assert.equal(evidence.parent.match, 'unknown');
    assert.equal(evidence.parent.executableClass, 'unknown');
    assert.equal(evidence.parent.rootClass, 'unknown');
    for (const key of ['self', 'helper', 'initiating']) assert.deepEqual(evidence.parent[key], unknownIdentity);
    assert.equal(await f.engine.state.session(f.record), null);
    assert.equal(await fs.readFile(journalFile, 'utf8'), journalBytes);
    assert.equal(bootstrap.getContext(), null);
    assert.equal(app.listenerCount('will-quit'), 0);
    assert.deepEqual(app.calls.map(call => call[0]), ['setPath', 'setPath', 'singleton', 'releaseSingleton']);
    await assert.rejects(fs.stat(path.join(f.record.stateRoot, 'health.json')), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.dirname(gateFile)), { code: 'ENOENT' });
    const refusal = await retainDiagnostic(f, original, 'interleaving');
    assert.equal(refusal.launchBinding, 'present');
    assert.equal(refusal.singleton, 'accepted');
    assert.equal(refusal.writerRelation, 'owned-root');

    completeObserver.resolve();
    assert.equal((await helperRun).error, stop);
    assert.deepEqual(sleeps, [200, 20]);
    assert.equal(helperObservationCount, 1);
    assert.equal(observerPending, false);

    const state = createState({ native: bootstrapNative, sleep: async () => assert.fail('controls must not sleep') });
    // A chosen later snapshot is a control, not evidence that retry fixes any historical failure.
    scanRows = [row(helper), row(self)];
    const control = await state.excludeWriters(f.record, before, [self, helper]);
    assert.deepEqual(Array.from(control.processes, value => value.pid), [helper.pid, self.pid]);

    const cases = [
      { name: 'same-inventory-path-different-observer', value: identity(inventoryPath(f.record.targetPath), syntheticPid(606)), ppid: helper.pid,
        executableClass: 'inventory', rootClass: 'target-bundle', parent: 'helper' },
      { name: 'bundle-main-first', value: identity(self.executable, syntheticPid(606)), ppid: self.pid,
        executableClass: 'bundle-main', rootClass: 'target-bundle', parent: 'self' },
      { name: 'framework-first', value: identity(framework.executable, syntheticPid(606)), ppid: self.pid,
        executableClass: 'framework-child', rootClass: 'target-bundle', parent: 'self' },
      { name: 'self-pid-reused', value: { ...self, start: '1792663202:000003' }, ppid: helper.pid,
        executableClass: 'bundle-main', rootClass: 'target-bundle', parent: 'helper', reused: 'self' },
      { name: 'helper-pid-reused', value: { ...helper, start: '1792663202:000003' }, ppid: self.pid,
        executableClass: 'bundle-main', rootClass: 'transaction-bundle', parent: 'self', reused: 'helper' },
      { name: 'self-executable-mismatch', value: { ...self, executable: framework.executable }, ppid: helper.pid,
        executableClass: 'framework-child', rootClass: 'target-bundle', parent: 'helper', reused: 'self' },
    ];
    for (const scenario of cases) await t.test(scenario.name, async () => {
      // Keep PID uniqueness required by the real parser even for identity reuse.
      const allowedRows = [helper, self].filter(value => value.pid !== scenario.value.pid).map(value => row(value));
      const later = scenario.executableClass === 'inventory' ? framework : row(identity(inventoryPath(f.record.targetPath), syntheticPid(707)), self.pid);
      scanRows = [...allowedRows, row(scenario.value, scenario.ppid), later];
      let failure;
      const scanCount = scans.length;
      await assert.rejects(state.excludeWriters(f.record, before, [self, helper]), error => {
        failure = error;
        assert.equal(error.code, 'busy');
        assert.equal(error.message, 'A live HQ app or helper blocks replacement.');
        assert.equal(error.refusal.guard, 'writer-process');
        assert.equal(error.refusal.writerRelation, 'owned-root');
        return true;
      });
      assert.equal(scans.length, scanCount + 1);
      assert.equal(scans.at(-1).processes.some(value => value.pid === bootstrapObserverPid), false);
      assert.ok(scans.at(-1).processes.length <= 4);
      const actual = failure.refusal.writerEvidence;
      assert.equal(actual.executableClass, scenario.executableClass, 'first refusing row wins over a later differently classified blocker');
      assert.equal(actual.rootClass, scenario.rootClass);
      for (const key of ['self', 'helper']) assert.deepEqual(actual[key], scenario.reused === key
        ? { pidEqual: true, identityEqual: false } : differentIdentity);
      assert.deepEqual(actual.initiating, unknownIdentity);
      assert.equal(actual.parent.match, 'unique');
      assert.equal(actual.parent.executableClass, 'bundle-main');
      assert.equal(actual.parent.rootClass, scenario.parent === 'helper' ? 'transaction-bundle' : 'target-bundle');
      for (const key of ['self', 'helper']) assert.deepEqual(actual.parent[key], scenario.parent === key ? equalIdentity : differentIdentity);
      assert.deepEqual(actual.parent.initiating, unknownIdentity);
      const projected = await retainDiagnostic(f, failure, scenario.name);
      assert.equal(projected.writerEvidence.executableClass, scenario.executableClass);
    });
    assert.equal(await fs.readFile(journalFile, 'utf8'), journalBytes);
  } finally {
    letHelperContend.resolve();
    completeObserver.resolve();
    await helperRun;
  }
});
