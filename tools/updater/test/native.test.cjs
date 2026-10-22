'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createNativeAdapter } = require('../native.cjs');
const { fixture } = require('./fixtures.cjs');
const { receiptOf, atomicWrite } = require('../contract.cjs');

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
        if (args[0] === '--verify' && overrides.failSeal) throw new Error('unsealed bundle');
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

test('bundle copy refuses escaped symlinks and preserves internal relative framework links', async t => {
  const f = await fixture(t);
  const native = createNativeAdapter({ platform: 'darwin', execFile: commands(f.record).execFile });
  const contents = path.join(f.candidate.bundlePath, 'Contents');
  await fs.mkdir(path.join(contents, 'internal'));
  await fs.writeFile(path.join(contents, 'internal/asset'), 'synthetic resource');
  await fs.symlink('internal', path.join(contents, 'relative-link'));
  const destination = path.join(path.dirname(f.record.targetPath), 'Stage.app');
  await native.copyBundle(f.candidate.bundlePath, destination);
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
