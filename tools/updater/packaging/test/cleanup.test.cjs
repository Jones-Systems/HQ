'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { withOwnedDirectory } = require('../owned-directory.cjs');

const scratch = path.resolve(__dirname, '../.scratch');

test('code-zero installer handoff still fails at 45s and snapshots before drain/removal', async () => {
  const { runInNewContext } = require('node:vm');
  await withOwnedDirectory(scratch, 'handoff-timeout-', async root => {
    const output = path.join(root, 'output'), nativeScratch = path.join(root, 'native');
    const bundle = path.join(output, 'HQ.app/Contents/Resources/app');
    fs.mkdirSync(path.join(bundle, 'tools/updater'), { recursive: true });
    fs.writeFileSync(path.join(bundle, 'package.json'), '{}');
    fs.writeFileSync(path.join(bundle, 'local-bootstrap.cjs'), "require('./tools/updater/bootstrap.cjs').run({importMain: () => import('./apps/desktop/dist-electron/main.js')});");
    fs.writeFileSync(path.join(bundle, 'tools/updater/helper.cjs'), 'never executed');
    const archive = { sha256: 'b'.repeat(64), size: 100, expandedSize: 200, fileCount: 1 };
    const production = { bundleId: 'synthetic.fixture', sourceSha: 'a'.repeat(40), sourceTree: 'c'.repeat(40), architecture: 'arm64' };
    fs.writeFileSync(path.join(output, 'package-evidence.json'), JSON.stringify({ archive }));
    const sentinel = 'PRIVATE_DIAGNOSTIC_SENTINEL';
    let elapsed = 0, installed = false, drained = false, owned;
    const primary = path.join(output, 'native-smoke-primary-failure.json');
    const journal = { state: 'awaiting-health', sequence: 4, resumeState: null, reason: null, launch: null, helper: {}, launchAttempted: true, profileOpened: false, health: null, private: sentinel };
    const fakeProcess = Object.assign(new EventEmitter(), {
      platform: 'darwin', arch: 'arm64', env: { GITHUB_SHA: production.sourceSha },
      stdout: { write() {} }, stderr: { write() {} },
    });
    const dependencies = {
      './identity.cjs': { PRODUCT: { bundleId: production.bundleId }, SYNTHETIC: {} },
      './package.cjs': { archiveMetrics: () => archive, stampBundle() {}, signAndVerify() {}, command: () => '1', contained: () => false },
      './native-scenario-plan.cjs': { scenarioPlan: activeRoot => {
        owned = activeRoot;
        const stateRoot = path.join(activeRoot, 'lifecycle/state');
        return [{ name: 'lifecycle', record: { stateRoot, targetPath: path.join(activeRoot, 'lifecycle/Applications/HQ.app') }, steps: [{ journey: 'fresh', receipt: { ...production, buildSequence: 1 }, candidate: { bundlePath: path.join(stateRoot, 'candidate-0/HQ.app') } }] }];
      } },
      './native-storage.cjs': { admitNativeStorage: () => ({ bundleCopies: 2 }) },
      '../native.cjs': { createNativeAdapter: () => ({ verifyBundle: async () => {}, runtimePath: () => 'never-executed', processTable: async () => {
        assert.equal(fs.existsSync(primary), true, 'primary snapshot must precede the first cleanup inventory');
        drained = true;
        return { complete: true, processes: [] };
      } }) },
      '../transaction.cjs': { createTransaction: () => ({ state: { initialize: async record => {
        fs.mkdirSync(record.stateRoot, { recursive: true });
        fs.writeFileSync(path.join(record.stateRoot, 'transaction.json'), JSON.stringify(journal));
      } }, read: async () => journal }) },
      '../contract.cjs': { readBuildReceipt: async () => production, atomicWrite: async (file, value) => fs.writeFileSync(file, JSON.stringify(value)) },
      './owned-directory.cjs': { withOwnedDirectory },
      './fixtures/native-diagnostics.cjs': require('../fixtures/native-diagnostics.cjs'),
      'node:child_process': { spawn: () => {
        const child = Object.assign(new EventEmitter(), { stderr: new EventEmitter() });
        queueMicrotask(() => { installed = true; child.stderr.emit('data', Buffer.from(sentinel)); child.emit('exit', 0, null); });
        return child;
      } },
    };
    const module = { exports: {} };
    runInNewContext(fs.readFileSync(path.join(__dirname, '../native-smoke.cjs'), 'utf8'), {
      require: name => dependencies[name] ?? require(name), module, process: fakeProcess, JSON, __dirname: path.resolve(__dirname, '..'),
      Date: { now: () => elapsed }, setTimeout: (callback, ms) => { elapsed += ms; queueMicrotask(callback); },
    });
    await assert.rejects(module.exports.smoke({ output, scratchParent: nativeScratch }), /Native smoke timed out: lifecycle fresh commits/);
    assert.equal(installed, true);
    assert.equal(elapsed, 45000);
    assert.equal(drained, true);
    assert.equal(fs.existsSync(owned), false);
    const raw = fs.readFileSync(primary, 'utf8'), snapshot = JSON.parse(raw);
    assert.equal(snapshot.sourceSha, production.sourceSha);
    assert.equal(snapshot.sourceTree, production.sourceTree);
    assert.equal(snapshot.archive.sha256, archive.sha256);
    assert.equal(snapshot.scenario, 'lifecycle');
    assert.equal(snapshot.journey, 'fresh');
    assert.equal(snapshot.journal.state, 'awaiting-health');
    assert.equal(snapshot.handoff.code, 0);
    assert.equal(snapshot.handoff.stderrObserved, true);
    assert.equal(raw.includes(sentinel), false);
    assert.equal(raw.includes(root), false);
    assert.ok(Buffer.byteLength(raw) <= 32768);
    assert.deepEqual(snapshot, JSON.parse(fs.readFileSync(primary, 'utf8')), 'cleanup cannot mutate primary evidence');
  });
});

test('owned scratch waits for an asynchronous cleanup safety gate', async () => {
  let owned, completed = false;
  await withOwnedDirectory(scratch, 'async-cleanup-', async root => { owned = root; }, {
    signals: new EventEmitter(),
    async remove(root, options) {
      await Promise.resolve();
      assert.equal(fs.existsSync(root), true);
      fs.rmSync(root, options);
      completed = true;
    },
  });
  assert.equal(completed, true);
  assert.equal(fs.existsSync(owned), false);
});

test('an asynchronous unknown-process gate retains scratch and rejects completion', async () => {
  let owned;
  const signals = new EventEmitter();
  try {
    await assert.rejects(withOwnedDirectory(scratch, 'unknown-process-', async root => { owned = root; }, {
      signals,
      async remove() { await Promise.resolve(); throw new Error('native inventory is unknown'); },
    }), /native inventory is unknown/);
    assert.equal(fs.existsSync(owned), true);
    assert.equal(signals.listenerCount('SIGINT'), 0);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
  } finally {
    if (owned) fs.rmSync(owned, { recursive: true, force: true });
  }
});

test('native smoke preserves its original failure when unknown inventory prevents cleanup', async t => {
  const { runInNewContext } = require('node:vm');
  await withOwnedDirectory(scratch, 'smoke-errors-', async root => {
    const original = new Error('original smoke failure');
    const cleanup = new Error('inventory cleanup unknown');
    const output = path.join(root, 'output'), nativeScratch = path.join(root, 'native');
    fs.mkdirSync(output);
    const archive = { sha256: 'b'.repeat(64), size: 100, expandedSize: 200, fileCount: 1 };
    fs.writeFileSync(path.join(output, 'package-evidence.json'), JSON.stringify({ archive }));
    const production = { bundleId: 'synthetic.fixture', sourceSha: 'a'.repeat(40), sourceTree: 'c'.repeat(40), architecture: 'arm64' };
    const messages = [];
    t.mock.method(process.stderr, 'write', text => { messages.push(text); return true; });
    const fakeProcess = Object.assign(new EventEmitter(), {
      platform: 'darwin', arch: 'arm64', env: { GITHUB_SHA: production.sourceSha },
      stdout: { write() {} }, stderr: { write: text => messages.push(text) },
    });
    const dependencies = {
      './identity.cjs': { PRODUCT: { bundleId: production.bundleId }, SYNTHETIC: {} },
      './package.cjs': { archiveMetrics: () => archive },
      './native-scenario-plan.cjs': { scenarioPlan: () => { throw original; } },
      './native-storage.cjs': {},
      '../native.cjs': { createNativeAdapter: () => ({ verifyBundle: async () => {}, processTable: async () => { throw cleanup; } }) },
      '../transaction.cjs': {},
      '../contract.cjs': { readBuildReceipt: async () => production },
      './owned-directory.cjs': { withOwnedDirectory },
      './fixtures/native-diagnostics.cjs': require('../fixtures/native-diagnostics.cjs'),
      'node:child_process': { spawn: () => { throw new Error('synthetic fixture must not launch a child'); } },
    };
    const module = { exports: {} };
    runInNewContext(fs.readFileSync(path.join(__dirname, '../native-smoke.cjs'), 'utf8'), {
      require: name => dependencies[name] ?? require(name), module, process: fakeProcess, JSON,
    });
    await assert.rejects(module.exports.smoke({ output, scratchParent: nativeScratch }), error => error === original);
    const evidence = JSON.parse(fs.readFileSync(path.join(output, 'native-smoke-failure.json'), 'utf8'));
    assert.equal(evidence.failure.category, 'other-error');
    assert.equal(evidence.primarySnapshot, 'persisted');
    assert.equal(evidence.scratchRemoved, false);
    assert.ok(messages.some(message => message.includes(cleanup.message)));
    assert.equal(fs.readdirSync(nativeScratch).length, 1);
    assert.equal(fakeProcess.listenerCount('SIGINT'), 0);
    assert.equal(fakeProcess.listenerCount('SIGTERM'), 0);
  });
});
