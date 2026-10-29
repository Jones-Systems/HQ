'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createNativeAdapter } = require('../native.cjs');
const { fixture, identity, fakeApp, writeBundle } = require('./fixtures.cjs');
const { run, getContext } = require('../bootstrap.cjs');
const { runHelper } = require('../helper.cjs');
const { receiptOf, atomicWrite, readJson, digest } = require('../contract.cjs');

const inventoryPath = path.resolve(__dirname, '../process-inventory');
const observerPid = 0x7ffffffe;
function inventory(record) {
  const boot = '1792612800:000002';
  return { schemaVersion: 1, complete: true, boot, processes: [
    { pid: 101, ppid: 1, start: '1792663200:000001', boot, executable: path.join(record.targetPath, 'Contents/MacOS', record.appName) },
    { pid: observerPid, ppid: process.pid, start: '1792663201:000002', boot, executable: inventoryPath },
  ] };
}
function commands(record, overrides = {}) {
  const calls = [];
  const execFile = (file, args, options) => {
    calls.push({ file, args, options });
    const pending = (async () => {
      if (file === '/usr/libexec/PlistBuddy') {
        const key = args[1].slice('Print :'.length);
        return { stdout: `${({ CFBundleIdentifier: record.bundleId, CFBundleExecutable: record.appName, CFBundleName: record.appName, ...overrides.plist })[key]}\n` };
      }
      if (file === '/usr/bin/lipo') return { stdout: `${overrides.architecture ?? 'arm64'}\n` };
      if (file === '/usr/bin/codesign') {
        if (args[0] === '--verify' && overrides.failSeal) throw overrides.failSeal instanceof Error ? overrides.failSeal : new Error('unsealed bundle');
        return { stderr: `Identifier=${record.bundleId}\nSignature=adhoc\n` };
      }
      if (file === inventoryPath) {
        if (overrides.failInventory) throw new Error('native process inventory denied');
        return { stdout: overrides.rawInventory ?? JSON.stringify(overrides.inventory ?? inventory(record)) };
      }
      throw new Error('Unexpected native command');
    })();
    if (file === inventoryPath && !overrides.missingObserver) pending.child = { pid: observerPid };
    return pending;
  };
  return { calls, execFile };
}

test('native candidate verification binds receipt, package identity, architecture and strict seal', async t => {
  const f = await fixture(t);
  const command = commands(f.record);
  const native = createNativeAdapter({ platform: 'darwin', architecture: 'arm64', execFile: command.execFile });
  assert.deepEqual(await native.verifyBundle(f.candidate.bundlePath, receiptOf(f.candidate.manifest)), receiptOf(f.candidate.manifest));
  assert.ok(command.calls.some(call => call.file === '/usr/bin/codesign' && call.args.slice(0, 3).join(' ') === '--verify --deep --strict'));
  assert.ok(command.calls.every(call => !('shell' in call.options)));
  for (const overrides of [{ architecture: 'x86_64' }, { plist: { CFBundleIdentifier: 'another.app' } }, { failSeal: true }]) {
    const other = createNativeAdapter({ platform: 'darwin', architecture: 'arm64', execFile: commands(f.record, overrides).execFile });
    await assert.rejects(other.verifyBundle(f.candidate.bundlePath, receiptOf(f.candidate.manifest)));
  }
});

test('native metadata mismatch cannot be hidden behind matching source hashes', async t => {
  const f = await fixture(t, { kind: 'adopt' });
  const native = createNativeAdapter({ platform: 'darwin', execFile: commands(f.record).execFile });
  const filename = path.join(f.record.targetPath, 'Contents/Resources/app/package.json');
  await atomicWrite(filename, { name: 'wrong-name', productName: f.record.appName });
  const expected = await native.legacyIdentity(f.record.targetPath);
  await assert.rejects(native.verifyLegacy(f.record.targetPath, expected, f.record), { code: 'incompatible' });
});

test('process evidence distinguishes dead PID, reused start, reboot and unavailable inventory', async t => {
  const f = await fixture(t);
  const native = createNativeAdapter({ platform: 'darwin', execFile: commands(f.record).execFile });
  const current = await native.identity(101);
  assert.equal(await native.observe(current), 'live');
  assert.equal(await native.observe({ ...current, pid: 999 }), 'dead');
  assert.equal(await native.observe({ ...current, start: 'old start' }), 'stale');
  assert.equal(await native.observe({ ...current, boot: 'previous boot' }), 'stale');
  const uncertain = createNativeAdapter({ platform: 'darwin', execFile: commands(f.record, { rawInventory: 'incomplete output\n' }).execFile });
  assert.equal(await uncertain.observe(current), 'unknown');
  const denied = createNativeAdapter({ platform: 'darwin', execFile: commands(f.record, { failInventory: true }).execFile });
  assert.equal(await denied.observe(current), 'unknown');
});

test('inventory failure reports only bounded stage, errno, recheck and child status without native output', async () => {
  const cases = [
    [{ code: 2, signal: null, stderr: 'HQ inventory failure: stage=path-before errno=1\n', stdout: 'private process data' },
      { stage: 'path-before', errno: 1, exitCode: 2, signal: null }],
    [{ code: null, signal: 'SIGKILL', stderr: 'private path /fixture/private', stdout: 'private argv' },
      { stage: 'unavailable', errno: null, exitCode: null, signal: 'SIGKILL' }],
    [{ code: 'PRIVATE_CODE', signal: 'PRIVATE_SIGNAL', stderr: 'HQ inventory failure: stage=private-name errno=1\n', errno: -999999 },
      { stage: 'unavailable', errno: null, exitCode: null, signal: null }],
    [{ code: 999999, stderr: 'HQ inventory failure: stage=path-before errno=999999\n' },
      { stage: 'unavailable', errno: null, exitCode: null, signal: null }],
  ];
  for (const [fields, expected] of cases) {
    const cause = Object.assign(new Error('private command line'), fields);
    const native = createNativeAdapter({ platform: 'darwin', execFile: async () => { throw cause; } });
    await assert.rejects(native.processTable(), error => {
      assert.equal(error.code, 'recovery-required');
      const diagnostic = { ...expected, recheck: 'unavailable' };
      assert.deepEqual(error.inventoryFailure, diagnostic);
      assert.ok(error.message.includes(JSON.stringify(diagnostic)));
      assert.doesNotMatch(error.message, /private|PRIVATE|999999/);
      return true;
    });
    assert.equal(await native.observe({}), 'unknown');
  }
});

test('inventory lifetime recheck distinguishes same-live, reused and unavailable while holding activation', async () => {
  for (const stage of ['path-before', 'path-after']) for (const recheck of ['same-live', 'reused', 'unavailable']) {
    let queries = 0;
    const native = createNativeAdapter({ platform: 'darwin', execFile: async (file, args) => {
      queries++;
      assert.equal(file, inventoryPath);
      assert.deepEqual(args, []);
      throw Object.assign(new Error('private command line'), {
        code: 2, stderr: `HQ inventory failure: stage=${stage} errno=2 recheck=${recheck}\n`,
        stdout: 'private process data',
      });
    } });
    const expected = { stage, errno: 2, exitCode: 2, signal: null, recheck };
    await assert.rejects(native.processTable(), error => {
      assert.equal(error.code, 'recovery-required');
      assert.deepEqual(error.inventoryFailure, expected);
      assert.ok(error.message.includes(JSON.stringify(expected)));
      assert.doesNotMatch(error.message, /private/);
      return true;
    });
    assert.equal(queries, 1);
    await assert.rejects(native.identity(101), { code: 'recovery-required' });
    assert.equal(queries, 2);
    assert.equal(await native.observe({ pid: 101 }), 'unknown');
    assert.equal(queries, 3);
  }
});

test('inventory lifetime recheck accepts not-run and sanitizes unknown or malformed diagnostics', async () => {
  const valid = 'HQ inventory failure: stage=path-before errno=2 recheck=same-live';
  const cases = [
    ['HQ inventory failure: stage=enumeration errno=12 recheck=not-run\n', { stage: 'enumeration', errno: 12, recheck: 'not-run' }],
    ['HQ inventory failure: stage=path-after errno=4095 recheck=unavailable', { stage: 'path-after', errno: 4095, recheck: 'unavailable' }],
    ...[
      valid.replace('same-live', 'PRIVATE'), valid.replace('same-live', 'dead'),
      valid.replace('same-live', ''), valid.replace('same-live', '101'),
      valid.replace('same-live', '/private/path'), valid.replace('errno=2', 'errno=4096'),
      valid.replace('path-before', 'private-stage'), `${valid} pid=101`,
      `${valid} recheck=reused`, `${valid}\nprivate output`, `${valid}\n\n`,
    ].map(stderr => [stderr, { stage: 'unavailable', errno: null, recheck: 'unavailable' }]),
  ];
  for (const [stderr, fields] of cases) {
    const native = createNativeAdapter({ platform: 'darwin', execFile: async () => {
      throw Object.assign(new Error('private command line'), { code: 2, stderr });
    } });
    await assert.rejects(native.processTable(), error => {
      const expected = { stage: fields.stage, errno: fields.errno, exitCode: 2, signal: null, recheck: fields.recheck };
      assert.equal(error.code, 'recovery-required');
      assert.deepEqual(error.inventoryFailure, expected);
      assert.ok(error.message.includes(JSON.stringify(expected)));
      assert.doesNotMatch(error.message, /private|PRIVATE|pid=101/);
      return true;
    });
    assert.equal(await native.observe({}), 'unknown');
  }
});

test('inventory path diagnostic preserves only fixed before and same-birth recheck classes', async () => {
  for (const stage of ['path-before', 'path-after']) for (const pathResult of ['zero', 'negative', 'invalid-positive']) {
    for (const state of ['idle', 'run', 'sleep', 'stop', 'zombie', 'other']) {
      const before = { pid: 'pid1', parent: 'zero', system: 'yes', exiting: 'no', state, effectiveUid: 'root', realUid: 'caller', savedUid: 'other' };
      const recheckClass = { pid: 'pid1', parent: 'nonzero', system: 'no', exiting: 'yes', state: 'run', effectiveUid: 'other', realUid: 'root', savedUid: 'caller' };
      const stderr = `HQ inventory failure: stage=${stage} errno=2 recheck=same-live path-result=${pathResult} before=pid1,zero,yes,no,${state},root,caller,other recheck-class=pid1,nonzero,no,yes,run,other,root,caller\n`;
      let queries = 0;
      const native = createNativeAdapter({ platform: 'darwin', execFile: async (file, args) => {
        queries++;
        assert.equal(file, inventoryPath);
        assert.deepEqual(args, []);
        throw Object.assign(new Error('PRIVATE command'), { code: 2, stderr, stdout: 'PRIVATE process data' });
      } });
      await assert.rejects(native.processTable(), error => {
        const expected = { stage, errno: 2, exitCode: 2, signal: null, recheck: 'same-live', pathResult, before, recheckClass };
        assert.equal(error.code, 'recovery-required');
        assert.deepEqual(error.inventoryFailure, expected);
        assert.ok(error.message.includes(JSON.stringify(expected)));
        assert.doesNotMatch(error.message, /PRIVATE/);
        return true;
      });
      assert.equal(queries, 1);
      assert.equal(await native.observe({}), 'unknown');
      assert.equal(queries, 2);
    }
  }
});

test('inventory path diagnostic never trusts unavailable, reused or unrun recheck classes', async () => {
  for (const recheck of ['unavailable', 'reused', 'not-run']) {
    const recheckClass = recheck === 'not-run' ? 'not-run' : 'unknown';
    const stderr = `HQ inventory failure: stage=path-before errno=2 recheck=${recheck} path-result=zero before=other,nonzero,no,yes,sleep,caller,other,root recheck-class=${recheckClass}\n`;
    const native = createNativeAdapter({ platform: 'darwin', execFile: async () => {
      throw Object.assign(new Error('PRIVATE command'), { code: 2, stderr });
    } });
    await assert.rejects(native.processTable(), error => {
      assert.equal(error.code, 'recovery-required');
      assert.deepEqual(error.inventoryFailure, {
        stage: 'path-before', errno: 2, exitCode: 2, signal: null, recheck, pathResult: 'zero',
        before: { pid: 'other', parent: 'nonzero', system: 'no', exiting: 'yes', state: 'sleep', effectiveUid: 'caller', realUid: 'other', savedUid: 'root' }, recheckClass,
      });
      return true;
    });
    assert.equal(await native.observe({}), 'unknown');
  }
});

test('inventory path diagnostic rejects malformed, inconsistent and private class records', async () => {
  const classes = 'other,nonzero,no,yes,sleep,caller,other,root';
  const valid = `HQ inventory failure: stage=path-before errno=2 recheck=same-live path-result=zero before=${classes} recheck-class=${classes}`;
  const cases = [
    `${valid} pid=101`, `${valid} uid=501`, `${valid} flags=8192`, `${valid} path=/PRIVATE`,
    `${valid}\nPRIVATE`, `${valid}\n\n`, `${valid} recheck-class=unknown`,
    valid.replace('path-result=zero', 'path-result=4096'), valid.replace('errno=2', 'errno=4096'),
    valid.replace('path-before', 'enumeration'), valid.replace('before=other', 'before=101'),
    valid.replace('nonzero', '999'), valid.replace(',no,', ',8192,'), valid.replace(',yes,', ',true,'),
    valid.replace(',sleep,', ',PRIVATE,'), valid.replace(',caller,', ',501,'),
    valid.replace(',other,root', ',other,501'), valid.replace(',other,root', ',501,root'),
    valid.replace(`before=${classes}`, 'before=unknown'), valid.replace(`before=${classes}`, `before=${classes},PRIVATE`),
    valid.replace(`recheck-class=${classes}`, 'recheck-class=unknown'),
    valid.replace(`recheck-class=${classes}`, 'recheck-class=not-run'),
    valid.replace('recheck=same-live', 'recheck=unavailable'), valid.replace('recheck=same-live', 'recheck=reused'),
    valid.replace('recheck=same-live', 'recheck=not-run'),
    valid.replace(`recheck-class=${classes}`, 'recheck-class=other,nonzero,no,yes,zombie,caller,other,root'),
    valid.replace(`recheck-class=${classes}`, 'recheck-class=pid1,nonzero,no,yes,sleep,caller,other,root'),
    valid.replace('recheck=same-live', 'recheck=reused').replace(`recheck-class=${classes}`, 'recheck-class=not-run'),
    valid.replace('recheck=same-live', 'recheck=not-run').replace(`recheck-class=${classes}`, 'recheck-class=unknown'),
  ];
  for (const stderr of cases) {
    const native = createNativeAdapter({ platform: 'darwin', execFile: async () => {
      throw Object.assign(new Error('PRIVATE command'), { code: 2, stderr, stdout: 'PRIVATE process data' });
    } });
    await assert.rejects(native.processTable(), error => {
      const expected = { stage: 'unavailable', errno: null, exitCode: 2, signal: null, recheck: 'unavailable' };
      assert.deepEqual(error.inventoryFailure, expected);
      assert.ok(error.message.includes(JSON.stringify(expected)));
      assert.doesNotMatch(error.message, /PRIVATE|101|501|8192|4096/);
      return true;
    });
    assert.equal(await native.observe({}), 'unknown');
  }
});

test('bundle copy refuses escaped symlinks and preserves internal relative framework links', async t => {
  const f = await fixture(t);
  const native = createNativeAdapter({ platform: 'darwin', execFile: commands(f.record).execFile });
  const contents = path.join(f.candidate.bundlePath, 'Contents');
  await fs.mkdir(path.join(contents, 'internal'));
  await fs.writeFile(path.join(contents, 'internal/asset'), 'synthetic resource');
  await fs.symlink('internal', path.join(contents, 'relative-link'));
  const destination = path.join(path.dirname(f.record.targetPath), 'Stage.app');
  await fs.mkdir(destination);
  const stat = await fs.stat(destination, { bigint: true });
  await native.copyBundle(f.candidate.bundlePath, destination, Object.fromEntries(['dev', 'ino', 'uid'].map(key => [key, String(stat[key])])));
  assert.equal(await fs.readlink(path.join(destination, 'Contents/relative-link')), 'internal');
  await fs.writeFile(path.join(f.root, 'external'), 'outside');
  await fs.symlink(path.join(f.root, 'external'), path.join(contents, 'escaped'));
  await assert.rejects(native.inspectTree(f.candidate.bundlePath), { code: 'integrity' });
});

test('helper launch uses retained Electron and argv, never system Node or a shell', async t => {
  const f = await fixture(t);
  const launches = [];
  const spawn = (file, args, options) => {
    const child = new EventEmitter();
    child.pid = 10001;
    child.unref = () => {};
    launches.push({ file, args, options });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
  const native = createNativeAdapter({ platform: 'darwin', spawn });
  await native.spawnHelper(f.record, f.candidate, 'a'.repeat(32));
  assert.equal(launches[0].file, native.runtimePath(f.candidate.bundlePath, f.candidate.manifest));
  assert.equal(launches[0].options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(launches[0].options.detached, true);
  assert.equal(launches[0].args[0], path.join(f.candidate.bundlePath, 'Contents/Resources/app/tools/updater/helper.cjs'));
  assert.equal('shell' in launches[0].options, false);
});

test('native activation stays unavailable on unqualified platforms', () => {
  const native = createNativeAdapter({ platform: 'linux' });
  assert.throws(() => native.supported(), { code: 'unavailable' });
});

test('process inventory preserves executable-vnode paths and excludes only the exact completed observer', async t => {
  const f = await fixture(t);
  const value = inventory(f.record);
  value.processes.push({ pid: 100, ppid: 1, start: '1792663100:000001', boot: value.boot, executable: '/bin/zsh' });
  value.processes.push({ pid: 102, ppid: 1, start: '1792663101:000001', boot: value.boot, executable: inventoryPath });
  const command = commands(f.record, { inventory: value });
  const native = createNativeAdapter({ platform: 'darwin', execFile: command.execFile });
  const table = await native.processTable();
  assert.deepEqual(table.processes.map(row => row.pid), [101, 100, 102]);
  assert.equal(table.processes[1].executable, '/bin/zsh');
  assert.deepEqual(command.calls.map(call => [call.file, call.args]), [[inventoryPath, []]]);
  assert.equal(command.calls[0].options.maxBuffer, 4 * 1024 * 1024);
});

test('closed inventory rejects incomplete, ambiguous, reused and forged observer evidence', async t => {
  const f = await fixture(t);
  const mutations = [
    value => { value.complete = false; },
    value => { value.unknown = true; },
    value => { value.processes.push({ ...value.processes[0] }); },
    value => { value.processes[0].ppid = -1; },
    value => { value.processes[0].start = '0:000000'; },
    value => { value.processes[0].boot = '1792612801:000002'; },
    value => { value.processes[0].executable = '-zsh'; },
    value => { value.processes[0].executable = 'kernel_task'; },
    value => { value.processes[0].pid = 0; },
    value => { value.processes[0].argv = 'not collected'; },
    value => { value.processes.pop(); },
    value => { value.processes[1].executable = '/usr/bin/other'; },
    value => { value.processes[1].ppid = 0; },
  ];
  for (const mutate of mutations) {
    const value = inventory(f.record);
    mutate(value);
    const native = createNativeAdapter({ platform: 'darwin', execFile: commands(f.record, { inventory: value }).execFile });
    await assert.rejects(native.processTable(), { code: 'recovery-required' });
  }
  for (const overrides of [{ missingObserver: true }, { rawInventory: '{"schemaVersion":1' }, { rawInventory: ' '.repeat(4 * 1024 * 1024 + 1) }, { failInventory: true }]) {
    const native = createNativeAdapter({ platform: 'darwin', execFile: commands(f.record, overrides).execFile });
    await assert.rejects(native.processTable(), { code: 'recovery-required' });
  }
});

function interruptStageCopy(f, { repeat = false } = {}) {
  const copy = f.native.copyBundle;
  let attempts = 0;
  f.native.copyBundle = async (source, destination) => {
    attempts++;
    assert.equal(f.calls.at(-1)[0], 'checkTarget');
    assert.equal(f.calls.at(-1)[2], f.candidate.manifest.archive.expandedSize * 2 + 64 * 1024 * 1024);
    if (attempts === 1 || repeat) {
      assert.equal((await fs.lstat(destination)).isDirectory(), true);
      await fs.writeFile(path.join(destination, 'partial.data'), `partial attempt ${attempts}`);
      throw new Error('interrupted stage copy');
    }
    return copy(source, destination);
  };
  return () => attempts;
}
async function preparedPartial(f) {
  await f.prepare();
  await assert.rejects(f.activate(), /interrupted stage copy/);
  return f.engine.read(f.record);
}
async function recoverCurrent(f) {
  const journal = await f.engine.read(f.record);
  return f.locked(() => f.engine.recover(f.record, f.self, { operationId: journal.operationId, expectedSequence: journal.sequence }));
}

test('HQ-REV-004 fresh partial copy retries the exact candidate once and retains quarantine through failed health', async t => {
  const f = await fixture(t, { kind: 'fresh' });
  const attempts = interruptStageCopy(f);
  const partial = await preparedPartial(f);
  const ready = await recoverCurrent(f);
  assert.equal(ready.operationId, partial.operationId);
  assert.equal(ready.candidate.candidateId, partial.candidate.candidateId);
  assert.equal(ready.state, 'awaiting-health');
  assert.equal(attempts(), 2);
  assert.equal(await fs.readFile(path.join(ready.failedPath, 'partial.data'), 'utf8'), 'partial attempt 1');
  assert.deepEqual(await f.native.verifyBundle(f.record.targetPath, receiptOf(f.candidate.manifest)), receiptOf(f.candidate.manifest));
  const launching = await f.locked(() => f.engine.requestLaunch(f.record, ready, f.self));
  const row = f.processes.get(303);
  const child = { pid: row.pid, start: row.start, boot: row.boot, executable: row.executable };
  await f.locked(() => f.engine.registerLaunch(f.record, child, launching.operationId, launching.sequence));
  f.processes.delete(child.pid);
  const held = await recoverCurrent(f);
  assert.equal(held.state, 'held');
  assert.equal(await fs.readFile(path.join(held.failedPath, 'partial.data'), 'utf8'), 'partial attempt 1');
  await assert.rejects(fs.stat(f.record.userData), { code: 'ENOENT' });
});

test('HQ-REV-004 repeated fresh partial copy holds both bounded slots without another copy', async t => {
  const f = await fixture(t, { kind: 'fresh' });
  const attempts = interruptStageCopy(f, { repeat: true });
  const partial = await preparedPartial(f);
  await assert.rejects(recoverCurrent(f), /interrupted stage copy/);
  const held = await recoverCurrent(f);
  assert.equal(held.state, 'held');
  assert.equal(held.operationId, partial.operationId);
  assert.equal(attempts(), 2);
  assert.equal(await fs.readFile(path.join(held.failedPath, 'partial.data'), 'utf8'), 'partial attempt 1');
  assert.equal(await fs.readFile(path.join(held.stagePath, 'partial.data'), 'utf8'), 'partial attempt 2');
  await assert.rejects(fs.stat(f.record.targetPath), { code: 'ENOENT' });
});

for (const kind of ['update', 'fresh']) for (const boundary of ['stage-quarantine-recorded', 'before-quarantine-stage', 'after-quarantine-stage', ...(kind === 'fresh' ? ['stage-retry-ready'] : [])]) {
  test(`HQ-REV-004 ${kind} reconciles ${boundary} by exact quarantine identity`, async t => {
    let armed = false;
    const f = await fixture(t, { kind, checkpoint: async name => { if (armed && name === boundary) { armed = false; throw new Error('quarantine interruption'); } } });
    const attempts = interruptStageCopy(f);
    const partial = await preparedPartial(f);
    armed = true;
    await assert.rejects(recoverCurrent(f), /quarantine interruption/);
    const recovered = await recoverCurrent(f);
    assert.equal(recovered.operationId, partial.operationId);
    assert.equal(recovered.state, kind === 'fresh' ? 'awaiting-health' : 'restored');
    assert.equal(attempts(), kind === 'fresh' ? 2 : 1);
    assert.equal(await fs.readFile(path.join(recovered.failedPath, 'partial.data'), 'utf8'), 'partial attempt 1');
    assert.deepEqual(await f.native.verifyBundle(f.record.targetPath, kind === 'fresh' ? receiptOf(f.candidate.manifest) : f.prior), kind === 'fresh' ? receiptOf(f.candidate.manifest) : f.prior);
  });
}

test('HQ-REV-004 recovery does not require replacement space merely to return to the unchanged prior app', async t => {
  const f = await fixture(t);
  interruptStageCopy(f);
  await preparedPartial(f);
  f.native.checkTarget = async (_record, bytes) => { if (bytes !== 0) throw Object.assign(new Error('insufficient copy space'), { code: 'space' }); };
  assert.equal((await recoverCurrent(f)).state, 'restored');
  assert.deepEqual(await f.native.verifyBundle(f.record.targetPath, f.prior), f.prior);
});

for (const uncertainty of ['missing-claim', 'occupied-quarantine', 'verification-io']) test(`HQ-REV-004 ${uncertainty} preserves the stage and target`, async t => {
  const f = await fixture(t);
  interruptStageCopy(f);
  const partial = await preparedPartial(f);
  if (uncertainty === 'missing-claim') await fs.unlink(path.join(f.record.stateRoot, `stage-${partial.operationId}.json`));
  if (uncertainty === 'occupied-quarantine') {
    await fs.mkdir(partial.failedPath);
    await fs.writeFile(path.join(partial.failedPath, 'unrelated.data'), 'preserve occupied destination');
  }
  if (uncertainty === 'verification-io') {
    const verify = f.native.verifyBundle;
    f.native.verifyBundle = async (filename, expected) => {
      if (filename === partial.stagePath) throw Object.assign(new Error('unavailable read'), { code: 'EIO' });
      return verify(filename, expected);
    };
  }
  await assert.rejects(recoverCurrent(f));
  assert.equal(await fs.readFile(path.join(partial.stagePath, 'partial.data'), 'utf8'), 'partial attempt 1');
  assert.deepEqual(await f.native.verifyBundle(f.record.targetPath, f.prior), f.prior);
  if (uncertainty === 'occupied-quarantine') assert.equal(await fs.readFile(path.join(partial.failedPath, 'unrelated.data'), 'utf8'), 'preserve occupied destination');
  else await assert.rejects(fs.stat(partial.failedPath), { code: 'ENOENT' });
});

test('HQ-REV-004 a substituted stage inode after quarantine intent cannot be moved', async t => {
  let armed = false;
  const f = await fixture(t, { checkpoint: async name => { if (armed && name === 'stage-quarantine-recorded') { armed = false; throw new Error('quarantine interruption'); } } });
  interruptStageCopy(f);
  const partial = await preparedPartial(f);
  armed = true;
  await assert.rejects(recoverCurrent(f), /quarantine interruption/);
  const original = path.join(f.root, 'retained-original-stage');
  await fs.rename(partial.stagePath, original);
  await fs.mkdir(partial.stagePath);
  await fs.writeFile(path.join(partial.stagePath, 'other.data'), 'unknown replacement');
  await assert.rejects(recoverCurrent(f), { code: 'recovery-required' });
  assert.equal(await fs.readFile(path.join(original, 'partial.data'), 'utf8'), 'partial attempt 1');
  assert.equal(await fs.readFile(path.join(partial.stagePath, 'other.data'), 'utf8'), 'unknown replacement');
  await assert.rejects(fs.stat(partial.failedPath), { code: 'ENOENT' });
});

test('HQ-REV-004 original-target identity is rechecked immediately before quarantine rename', async t => {
  let armed = false;
  let f;
  f = await fixture(t, { checkpoint: async name => { if (armed && name === 'before-quarantine-stage') { armed = false; await writeBundle(f.record.targetPath, { ...f.prior, sourceSha: 'e'.repeat(40) }); } } });
  interruptStageCopy(f);
  const partial = await preparedPartial(f);
  armed = true;
  await assert.rejects(recoverCurrent(f), { code: 'integrity' });
  assert.equal(await fs.readFile(path.join(partial.stagePath, 'partial.data'), 'utf8'), 'partial attempt 1');
  await assert.rejects(fs.stat(partial.failedPath), { code: 'ENOENT' });
});

test('HQ-REV-004 native seal rejection is distinguishable from denied or interrupted verification', async t => {
  const f = await fixture(t);
  const rejection = Object.assign(new Error('seal rejected'), { code: 1 });
  const native = createNativeAdapter({ platform: 'darwin', execFile: commands(f.record, { failSeal: rejection }).execFile });
  await assert.rejects(native.verifyBundle(f.candidate.bundlePath, receiptOf(f.candidate.manifest)), { code: 'integrity' });
  for (const failure of [Object.assign(new Error('denied'), { code: 'EACCES' }), Object.assign(new Error('interrupted'), { code: 1, killed: true })]) {
    const uncertain = createNativeAdapter({ platform: 'darwin', execFile: commands(f.record, { failSeal: failure }).execFile });
    await assert.rejects(uncertain.verifyBundle(f.candidate.bundlePath, receiptOf(f.candidate.manifest)), error => error === failure);
  }
});

test('HQ-REV-001 a new exact acceptance after restoration is not consumed as old consent', async t => {
  const f = await fixture(t);
  await f.writeRecord();
  const { launched } = await f.start();
  f.processes.delete(launched.pid);
  const restored = await recoverCurrent(f);
  assert.equal(restored.state, 'restored');
  f.processes.clear();
  f.setSelf(identity(path.join(f.record.targetPath, 'Contents/MacOS', f.record.appName), 401));
  const options = () => ({ app: fakeApp(f.record.appName), bundlePath: f.record.targetPath, adapters: { ...f.adapters, argv: [], environment: {} }, importMain: async () => {} });
  await run(options());
  await getContext().schedule(f.candidate);
  const accepted = await readJson(path.join(f.record.stateRoot, 'scheduled.json'));
  assert.match(accepted.consentId, /^[a-f0-9]{32}$/);
  await getContext().dispose();
  f.processes.clear();
  f.setSelf(identity(path.join(f.record.targetPath, 'Contents/MacOS', f.record.appName), 402));
  assert.equal((await run(options())).state, 'handoff');
  const next = await f.engine.read(f.record);
  assert.notEqual(next.operationId, restored.operationId);
  assert.equal(next.consentId, accepted.consentId);
});

test('HQ-REV-001 existing nonce-less consent is consumed only by its exact prepared transaction', async t => {
  const f = await fixture(t);
  await f.writeRecord();
  const journal = await f.prepare();
  const filename = path.join(f.record.stateRoot, 'scheduled.json');
  await atomicWrite(filename, { schemaVersion: 1, installationId: f.record.installationId, installedId: digest(f.record.installed), candidate: f.candidate });
  f.processes.clear();
  f.setSelf(identity(path.join(f.record.targetPath, 'Contents/MacOS', f.record.appName), 401));
  assert.equal((await run({ app: fakeApp(f.record.appName), bundlePath: f.record.targetPath, adapters: { ...f.adapters, argv: [], environment: {} }, importMain: async () => assert.fail('resumed bootstrap imported main') })).state, 'handoff');
  assert.equal((await f.engine.read(f.record)).operationId, journal.operationId);
  await assert.rejects(fs.stat(filename), { code: 'ENOENT' });
});

async function resumePartialThroughBootstrap(f, partial) {
  await f.writeRecord();
  f.processes.clear();
  f.setSelf(identity(path.join(f.record.targetPath, 'Contents/MacOS', f.record.appName), 401));
  const handoff = await run({ app: fakeApp(f.record.appName), bundlePath: f.record.targetPath, adapters: { ...f.adapters, argv: [], environment: {} }, importMain: async () => assert.fail('partial preparation imported main') });
  assert.equal(handoff.state, 'handoff');
  assert.equal(handoff.operationId, partial.operationId);
  f.processes.clear();
  f.setSelf(f.helperIdentity);
  return runHelper({ record: f.record, operationId: partial.operationId, adapters: f.adapters });
}

for (const metadata of ['build-receipt.json', 'package.json']) test(`HQ-REV-004 truncated ${metadata} recovers through ordinary bootstrap`, async t => {
  const f = await fixture(t);
  const native = createNativeAdapter({ platform: 'darwin', architecture: 'arm64', execFile: commands(f.record).execFile });
  f.native.verifyBundle = native.verifyBundle;
  const copy = f.native.copyBundle;
  f.native.copyBundle = async (source, destination) => {
    await copy(source, destination);
    await fs.writeFile(path.join(destination, 'Contents/Resources/app', metadata), '{"interrupted":');
    throw new Error('interrupted metadata copy');
  };
  await f.prepare();
  await assert.rejects(f.activate(), /interrupted metadata copy/);
  const partial = await f.engine.read(f.record);
  const recovered = await resumePartialThroughBootstrap(f, partial);
  assert.equal(recovered.state, 'restored');
  assert.equal(recovered.operationId, partial.operationId);
  assert.equal(await fs.readFile(path.join(recovered.failedPath, 'Contents/Resources/app', metadata), 'utf8'), '{"interrupted":');
  assert.deepEqual(await native.verifyBundle(f.record.targetPath, f.prior), f.prior);
  f.processes.clear();
  f.setSelf(identity(path.join(f.record.targetPath, 'Contents/MacOS', f.record.appName), 402));
  let imported = false;
  assert.equal((await run({ app: fakeApp(f.record.appName), bundlePath: f.record.targetPath, adapters: { ...f.adapters, argv: [], environment: {} }, importMain: async () => { imported = true; } })).state, 'running');
  assert.equal(imported, true);
  await getContext().dispose();
  assert.equal(await fs.readFile(path.join(f.record.userData, 'untouched.data'), 'utf8'), 'synthetic profile bytes');
});

test('HQ-REV-004 uncertain metadata I/O remains held through ordinary bootstrap', async t => {
  const f = await fixture(t);
  let unavailable = null;
  const failure = Object.assign(new Error('metadata read unavailable'), { code: 'EIO' });
  const io = { ...fs, open: async (filename, ...args) => {
    if (filename === unavailable) throw failure;
    return fs.open(filename, ...args);
  } };
  const native = createNativeAdapter({ fs: io, platform: 'darwin', architecture: 'arm64', execFile: commands(f.record).execFile });
  f.native.verifyBundle = native.verifyBundle;
  const copy = f.native.copyBundle;
  f.native.copyBundle = async (source, destination) => {
    await copy(source, destination);
    throw new Error('interrupted metadata copy');
  };
  await f.prepare();
  await assert.rejects(f.activate(), /interrupted metadata copy/);
  const partial = await f.engine.read(f.record);
  unavailable = path.join(partial.stagePath, 'Contents/Resources/app/build-receipt.json');
  const stage = await fs.stat(partial.stagePath, { bigint: true });
  await assert.rejects(resumePartialThroughBootstrap(f, partial), error => error === failure);
  assert.equal((await fs.stat(partial.stagePath, { bigint: true })).ino, stage.ino);
  assert.equal((await f.engine.read(f.record)).state, 'prepared');
  await assert.rejects(fs.stat(partial.failedPath), { code: 'ENOENT' });
  assert.deepEqual(await native.verifyBundle(f.record.targetPath, f.prior), f.prior);
});

for (const replacement of ['partial', 'complete']) test(`HQ-REV-005 ${replacement} stage substitution before first quarantine intent is preserved without mutation`, async t => {
  const f = await fixture(t);
  f.native.copyBundle = async (_source, destination) => {
    await fs.mkdir(destination, { recursive: true });
    await fs.writeFile(path.join(destination, 'partial.data'), 'owned interrupted stage');
    throw new Error('interrupted stage copy');
  };
  const partial = await preparedPartial(f);
  const claimFile = path.join(f.record.stateRoot, `stage-${partial.operationId}.json`);
  const claim = await fs.readFile(claimFile, 'utf8');
  const original = path.join(f.root, 'retained-original-stage');
  await fs.rename(partial.stagePath, original);
  if (replacement === 'complete') await writeBundle(partial.stagePath, receiptOf(f.candidate.manifest));
  else await fs.mkdir(partial.stagePath);
  await fs.writeFile(path.join(partial.stagePath, 'foreign.data'), 'unowned replacement');
  const foreign = await fs.stat(partial.stagePath, { bigint: true });
  await assert.rejects(recoverCurrent(f), { code: 'recovery-required' });
  assert.equal((await fs.stat(partial.stagePath, { bigint: true })).ino, foreign.ino);
  assert.equal(await fs.readFile(path.join(partial.stagePath, 'foreign.data'), 'utf8'), 'unowned replacement');
  assert.equal(await fs.readFile(path.join(original, 'partial.data'), 'utf8'), 'owned interrupted stage');
  assert.equal(await fs.readFile(claimFile, 'utf8'), claim);
  assert.deepEqual(await f.engine.read(f.record), partial);
  await assert.rejects(fs.stat(partial.failedPath), { code: 'ENOENT' });
  await assert.rejects(fs.stat(partial.priorPath), { code: 'ENOENT' });
  assert.deepEqual(await f.native.verifyBundle(f.record.targetPath, f.prior), f.prior);
});

for (const boundary of ['stage-created', 'atomic-file-synced']) test(`HQ-REV-005 ${boundary} interruption before durable creation ownership holds the directory`, async t => {
  let armed = true;
  const f = await fixture(t, { checkpoint: async (name, value) => {
    if (armed && name === boundary && (name !== 'atomic-file-synced' || /\/stage-[a-f0-9]{32}\.json$/.test(value))) {
      armed = false;
      throw new Error('creation claim interruption');
    }
  } });
  await f.prepare();
  await assert.rejects(f.activate(), /creation claim interruption/);
  const partial = await f.engine.read(f.record);
  const created = await fs.stat(partial.stagePath, { bigint: true });
  await assert.rejects(fs.stat(path.join(f.record.stateRoot, `stage-${partial.operationId}.json`)), { code: 'ENOENT' });
  await assert.rejects(recoverCurrent(f), { code: 'recovery-required' });
  assert.equal((await fs.stat(partial.stagePath, { bigint: true })).ino, created.ino);
  assert.deepEqual(await fs.readdir(partial.stagePath), []);
  await assert.rejects(fs.stat(partial.failedPath), { code: 'ENOENT' });
  assert.deepEqual(await f.native.verifyBundle(f.record.targetPath, f.prior), f.prior);
  assert.equal(f.calls.some(call => call[0] === 'copyBundle'), false);
});

test('HQ-REV-005 durable creation ownership permits exact recovery before copying starts', async t => {
  let armed = true;
  const f = await fixture(t, { checkpoint: async name => {
    if (armed && name === 'stage-creation-recorded') { armed = false; throw new Error('claimed creation interruption'); }
  } });
  await f.prepare();
  await assert.rejects(f.activate(), /claimed creation interruption/);
  const partial = await f.engine.read(f.record);
  const created = await fs.stat(partial.stagePath, { bigint: true });
  const claim = await readJson(path.join(f.record.stateRoot, `stage-${partial.operationId}.json`));
  assert.deepEqual(claim.stage, Object.fromEntries(['dev', 'ino', 'uid'].map(key => [key, String(created[key])])));
  assert.equal((await recoverCurrent(f)).state, 'restored');
  assert.equal((await fs.stat(partial.failedPath, { bigint: true })).ino, created.ino);
  assert.deepEqual(await fs.readdir(partial.failedPath), []);
  assert.equal(f.calls.some(call => call[0] === 'copyBundle'), false);
});

test('HQ-REV-005 fresh retry interrupted before its durable creation claim preserves both slots', async t => {
  let armed = false;
  const f = await fixture(t, { kind: 'fresh', checkpoint: async name => {
    if (armed && name === 'stage-created') { armed = false; throw new Error('retry creation interruption'); }
  } });
  const attempts = interruptStageCopy(f);
  const partial = await preparedPartial(f);
  armed = true;
  await assert.rejects(recoverCurrent(f), /retry creation interruption/);
  const second = await fs.stat(partial.stagePath, { bigint: true });
  await assert.rejects(recoverCurrent(f), { code: 'recovery-required' });
  assert.equal((await fs.stat(partial.stagePath, { bigint: true })).ino, second.ino);
  assert.deepEqual(await fs.readdir(partial.stagePath), []);
  assert.equal(await fs.readFile(path.join(partial.failedPath, 'partial.data'), 'utf8'), 'partial attempt 1');
  assert.equal(attempts(), 1);
  await assert.rejects(fs.stat(f.record.targetPath), { code: 'ENOENT' });
});

for (const timing of ['before', 'during']) test(`HQ-REV-005 native copy refuses a destination replaced ${timing} copying`, async t => {
  const f = await fixture(t);
  const destination = path.join(path.dirname(f.record.targetPath), 'NativeStage.app');
  const retained = path.join(f.root, 'native-created-stage');
  await fs.mkdir(destination);
  const created = await fs.stat(destination, { bigint: true });
  const expected = Object.fromEntries(['dev', 'ino', 'uid'].map(key => [key, String(created[key])]));
  async function replace() {
    await fs.rename(destination, retained);
    await fs.mkdir(destination);
    await fs.writeFile(path.join(destination, 'foreign.data'), 'preserve unknown copy destination');
  }
  const io = { ...fs, cp: async (source, target, options) => { await replace(); return fs.cp(source, target, options); } };
  const native = createNativeAdapter({ fs: timing === 'during' ? io : fs, platform: 'darwin' });
  if (timing === 'before') await replace();
  await assert.rejects(native.copyBundle(f.candidate.bundlePath, destination, expected), { code: 'recovery-required' });
  assert.deepEqual(await fs.readdir(destination), ['foreign.data']);
  assert.equal(await fs.readFile(path.join(destination, 'foreign.data'), 'utf8'), 'preserve unknown copy destination');
  assert.deepEqual(await fs.readdir(retained), []);
});

test('HQ-REV-005 the created stage identity is rechecked immediately before installation rename', async t => {
  let f;
  f = await fixture(t, { checkpoint: async (name, journal) => {
    if (name === 'before-install-replacement') {
      await fs.rename(journal.stagePath, path.join(f.root, 'retained-complete-stage'));
      await writeBundle(journal.stagePath, receiptOf(f.candidate.manifest));
      await fs.writeFile(path.join(journal.stagePath, 'foreign.data'), 'preserve unowned ready stage');
    }
  } });
  await f.prepare();
  await assert.rejects(f.activate(), { code: 'recovery-required' });
  const journal = await f.engine.read(f.record);
  assert.equal(journal.state, 'prior-retained');
  assert.equal(await fs.readFile(path.join(journal.stagePath, 'foreign.data'), 'utf8'), 'preserve unowned ready stage');
  assert.deepEqual(await f.native.verifyBundle(journal.priorPath, f.prior), f.prior);
  await assert.rejects(fs.stat(f.record.targetPath), { code: 'ENOENT' });
  await assert.rejects(fs.stat(journal.failedPath), { code: 'ENOENT' });
  assert.equal(f.calls.some(call => call[0] === 'launch'), false);
});

test('production verification rejects wrong team, wrong ID, ad-hoc fallback and missing stable requirement or ticket', async t => {
  const { DEVELOPER_ID, requirement } = require('../signing.cjs');
  const f = await fixture(t, { synthetic: false });
  const receipt = { ...receiptOf(f.candidate.manifest), appName: 'HQ', bundleId: 'org.jones-systems.hq.local', signingPolicy: { ...DEVELOPER_ID } };
  await writeBundle(f.candidate.bundlePath, receipt);
  const record = { ...f.record, appName: 'HQ', bundleId: receipt.bundleId };
  const details = `Identifier=${receipt.bundleId}\nAuthority=Developer ID Application: Fixture (2CUPSQS986)\nTeamIdentifier=2CUPSQS986\nTimestamp=Oct 22, 2026 at 12:00:00\nCodeDirectory v=20500 flags=0x10000(runtime)\n`;
  const designated = `designated => ${requirement()}\n`;
  const verify = async (change = {}) => {
    const calls = [];
    const base = commands(record);
    const native = createNativeAdapter({ platform: 'darwin', execFile: async (file, args, options) => {
      calls.push([file, args]);
      if (file === '/usr/bin/codesign' && args[0] === '--display') return { stderr: args.includes('-r-') ? change.designated ?? designated : change.details ?? details };
      if (file === '/usr/bin/codesign' && args.includes('-R') && change.requirementFailed) throw Object.assign(new Error('wrong certificate'), { code: 1 });
      if (file === '/usr/bin/xcrun' || file === '/usr/sbin/spctl') {
        if (change.ticketFailed) throw Object.assign(new Error('ticket rejected'), { code: 65 });
        return { stdout: 'accepted' };
      }
      return base.execFile(file, args, options);
    } });
    await native.verifyBundle(f.candidate.bundlePath, receipt);
    return calls;
  };
  const calls = await verify();
  assert.ok(calls.some(([file, args]) => file === '/usr/bin/codesign' && args.includes(`=${requirement()}`)));
  assert.ok(calls.some(([file]) => file === '/usr/bin/xcrun'));
  for (const change of [
    { details: details.replaceAll('2CUPSQS986', 'WRONGTEAM00') },
    { details: details.replace(receipt.bundleId, 'other.app') },
    { details: `Identifier=${receipt.bundleId}\nSignature=adhoc\n` },
    { details: details.replace('Timestamp=', 'Signed Time=') },
    { details: details.replace('flags=0x10000(runtime)', 'flags=0x0(none)') },
    { designated: 'designated => cdhash H"abcdef"' },
    { designated: `${designated} or true` },
    { requirementFailed: true }, { ticketFailed: true },
  ]) await assert.rejects(verify(change), { code: 'integrity' });
});
