'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { withOwnedDirectory } = require('../owned-directory.cjs');

const scratch = path.resolve(__dirname, '../.scratch');

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
    fs.writeFileSync(path.join(output, 'package-evidence.json'), JSON.stringify({ archive: {} }));
    const production = { bundleId: 'synthetic.fixture', sourceSha: 'a'.repeat(40), architecture: 'arm64' };
    const messages = [];
    t.mock.method(process.stderr, 'write', text => { messages.push(text); return true; });
    const fakeProcess = Object.assign(new EventEmitter(), {
      platform: 'darwin', arch: 'arm64', env: { GITHUB_SHA: production.sourceSha },
      stdout: { write() {} }, stderr: { write: text => messages.push(text) },
    });
    const dependencies = {
      './identity.cjs': { PRODUCT: { bundleId: production.bundleId }, SYNTHETIC: {} },
      './package.cjs': { archiveMetrics: () => ({}) },
      './native-scenario-plan.cjs': { scenarioPlan: () => { throw original; } },
      './native-storage.cjs': {},
      '../native.cjs': { createNativeAdapter: () => ({ verifyBundle: async () => {}, processTable: async () => { throw cleanup; } }) },
      '../transaction.cjs': {},
      '../contract.cjs': { readBuildReceipt: async () => production },
      './owned-directory.cjs': { withOwnedDirectory },
      'node:child_process': { spawn: () => { throw new Error('synthetic fixture must not launch a child'); } },
    };
    const module = { exports: {} };
    runInNewContext(fs.readFileSync(path.join(__dirname, '../native-smoke.cjs'), 'utf8'), {
      require: name => dependencies[name] ?? require(name), module, process: fakeProcess, JSON,
    });
    await assert.rejects(module.exports.smoke({ output, scratchParent: nativeScratch }), error => error === original);
    const evidence = JSON.parse(fs.readFileSync(path.join(output, 'native-smoke-failure.json'), 'utf8'));
    assert.equal(evidence.failure.message, original.message);
    assert.equal(evidence.scratchRemoved, false);
    assert.ok(messages.some(message => message.includes(cleanup.message)));
    assert.equal(fs.readdirSync(nativeScratch).length, 1);
    assert.equal(fakeProcess.listenerCount('SIGINT'), 0);
    assert.equal(fakeProcess.listenerCount('SIGTERM'), 0);
  });
});
