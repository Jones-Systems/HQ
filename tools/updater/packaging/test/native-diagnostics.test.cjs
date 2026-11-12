'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { runInNewContext } = require('node:vm');
const { withOwnedDirectory } = require('../owned-directory.cjs');
const diagnostics = require('../fixtures/native-diagnostics.cjs');
const scratch = path.resolve(__dirname, '../.scratch');
const production = { sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40), architecture: 'arm64', bundleId: 'fixture.product' };
const archive = { sha256: 'c'.repeat(64), size: 100, expandedSize: 200, fileCount: 1 };
const sentinel = 'PRIVATE_SENTINEL_PATH_PROFILE_STDERR';
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };

test('snapshot projects only bounded known records and finite fixture categories', async () => {
  await withOwnedDirectory(scratch, 'diagnostic-projection-', async root => {
    const output = path.join(root, 'output'), runRoot = path.join(root, 'run'), stateRoot = path.join(runRoot, 'lifecycle/state');
    fs.mkdirSync(output); fs.mkdirSync(stateRoot, { recursive: true });
    const directory = path.join(root, 'fixture');
    write(path.join(directory, 'diagnostic-binding.json'), { runRoot, stateRoot, buildSequence: 1 });
    const report = diagnostics.fixtureReporter(directory, 'helper');
    assert.equal(report('entered'), true);
    assert.equal(report('error', Object.assign(new Error(sentinel), { code: 'busy' })), true);
    assert.equal(report('error', new Error('foreign retry')), false, 'milestone cannot overwrite an existing producer record');
    assert.equal(diagnostics.fixtureReporter(directory, 'main')('renderer-error', Object.assign(new Error(sentinel), { code: 'ERR_ASSERTION' })), true);
    write(path.join(stateRoot, 'transaction.json'), { state: 'held', sequence: 7, resumeState: 'awaiting-health', reason: 'live-process', launch: { executable: sentinel }, helper: {}, launchAttempted: true, profileOpened: false, health: null, arbitrary: sentinel });
    write(path.join(stateRoot, 'health.json'), { main: true, renderer: true, process: sentinel });
    write(path.join(stateRoot, 'smoke-1.json'), { healthy: true, userData: sentinel, installed: { private: sentinel } });
    write(path.join(stateRoot, 'arbitrary.json'), sentinel);
    write(path.join(runRoot, 'lifecycle/profile/userData/private'), sentinel);
    const args = { output, root: runRoot, production, archive, active: { scenario: 'lifecycle', journey: 'fresh', buildSequence: 1, stateRoot }, handoff: { status: 'exited', code: 0, stderrObserved: true, stderr: sentinel }, error: new Error(sentinel) };
    const snapshot = diagnostics.captureFailure(args);
    assert.equal(snapshot.journal.state, 'held'); assert.equal(snapshot.journal.sequence, 7);
    assert.equal(snapshot.journal.resumeState, 'awaiting-health'); assert.equal(snapshot.journal.reason, 'live-process');
    assert.equal(snapshot.health.renderer, true); assert.equal(snapshot.fixtureHealth.healthy, true);
    assert.equal(snapshot.milestones['helper:error'].category, 'busy');
    assert.equal(snapshot.milestones['main:renderer-error'].category, 'assertion');
    assert.equal(snapshot.milestones['bootstrap:entered'].status, 'unavailable');
    const file = path.join(output, 'native-smoke-primary-failure.json'), raw = fs.readFileSync(file, 'utf8');
    assert.equal(raw.includes(sentinel), false); assert.equal(raw.includes(root), false);
    assert.ok(Buffer.byteLength(raw) <= 32768);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.throws(() => diagnostics.captureFailure(args), { code: 'EEXIST' });
    assert.equal(fs.readFileSync(file, 'utf8'), raw);
    const nextOutput = path.join(root, 'next-output'); fs.mkdirSync(nextOutput);
    assert.equal(diagnostics.fixtureReporter(directory, 'bootstrap')('error', Object.assign(new Error(sentinel), { code: 'busy' })), true);
    const next = diagnostics.captureFailure({ ...args, output: nextOutput, active: { ...args.active, journey: 'next-launch', buildSequence: 2, runtimeBuildSequence: 1 } });
    assert.equal(next.runtimeBuildSequence, 1);
    assert.equal(next.milestones['launching-runtime:bootstrap:error'].category, 'busy', 'next-launch observes the prior runtime bootstrap before candidate main exists');
  });
});

test('diagnostic readers fail closed on missing, malformed, oversize, symlink and aggregate limits', async () => {
  await withOwnedDirectory(scratch, 'diagnostic-inputs-', async root => {
    const read = (name, budget) => diagnostics.readKnown(root, path.join(root, name), value => ({ healthy: value.healthy === true }), budget);
    assert.equal(read('missing').reason, 'missing');
    write(path.join(root, 'malformed'), '{' + sentinel);
    assert.equal(read('malformed').status, 'unavailable');
    write(path.join(root, 'oversize'), 'x'.repeat(65537));
    assert.equal(read('oversize').reason, 'input-limit');
    write(path.join(root, 'real/data'), { healthy: true });
    fs.symlinkSync(path.join(root, 'real/data'), path.join(root, 'linked-file'));
    fs.symlinkSync(path.join(root, 'real'), path.join(root, 'linked-directory'));
    assert.equal(read('linked-file').status, 'unavailable');
    assert.equal(read('linked-directory/data').status, 'unavailable');
    const budget = { remaining: 32768 };
    write(path.join(root, 'large'), { healthy: true, ignored: 'x'.repeat(20000) });
    assert.equal(read('large', budget).status, 'available');
    assert.equal(read('large', budget).reason, 'aggregate-limit');
    const journal = { state: sentinel, sequence: 1 };
    write(path.join(root, 'bad-enum'), journal);
    assert.equal(diagnostics.readKnown(root, path.join(root, 'bad-enum'), diagnostics.projectJournal).status, 'unavailable');
  });
});

test('synthetic bootstrap records pre-main failure and preserves the unmodified function error', async () => {
  await withOwnedDirectory(scratch, 'bootstrap-diagnostic-', async root => {
    const runRoot = path.join(root, 'run'), stateRoot = path.join(runRoot, 'lifecycle/state'), directory = path.join(root, 'fixture');
    fs.mkdirSync(stateRoot, { recursive: true });
    write(path.join(directory, 'diagnostic-binding.json'), { runRoot, stateRoot, buildSequence: 1 });
    const original = Object.assign(new Error(sentinel), { code: 'recovery-required' });
    const module = { exports: {} };
    let invoked = 0, imported = false;
    runInNewContext(fs.readFileSync(path.resolve(__dirname, '../fixtures/native-bootstrap.cjs'), 'utf8'), {
      module, __dirname: directory, require: name => {
        if (name === './native-diagnostics.cjs') return diagnostics;
        if (name === '../tools/updater/bootstrap.cjs') return { run: async () => { invoked++; throw original; } };
        throw new Error('unexpected module');
      },
    });
    await assert.rejects(module.exports.run({ importMain: () => { imported = true; } }), error => error === original);
    assert.equal(invoked, 1); assert.equal(imported, false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(stateRoot, 'diagnostic-bootstrap-1-entered.json'), 'utf8')).stage, 'entered');
    const raw = fs.readFileSync(path.join(stateRoot, 'diagnostic-bootstrap-1-error.json'), 'utf8');
    assert.equal(JSON.parse(raw).category, 'recovery-required'); assert.equal(raw.includes(sentinel), false);
  });
});

test('capture collision retains scratch after complete process closure without overwriting foreign evidence', async () => {
  await withOwnedDirectory(scratch, 'diagnostic-retain-', async root => {
    const output = path.join(root, 'output'), nativeScratch = path.join(root, 'native');
    fs.mkdirSync(output);
    write(path.join(output, 'package-evidence.json'), { archive });
    const primary = path.join(output, 'native-smoke-primary-failure.json');
    fs.writeFileSync(primary, 'foreign immutable evidence');
    const original = new Error(sentinel), module = { exports: {} };
    let completeReads = 0;
    const fakeProcess = Object.assign(new EventEmitter(), { platform: 'darwin', arch: 'arm64', env: { GITHUB_SHA: production.sourceSha }, stdout: { write() {} }, stderr: { write() {} } });
    const dependencies = {
      './identity.cjs': { PRODUCT: { bundleId: production.bundleId }, SYNTHETIC: {} },
      './package.cjs': { archiveMetrics: () => archive },
      './native-scenario-plan.cjs': { scenarioPlan: () => { throw original; } },
      './native-storage.cjs': {}, './owned-directory.cjs': { withOwnedDirectory },
      './fixtures/native-diagnostics.cjs': diagnostics,
      '../native.cjs': { createNativeAdapter: () => ({ verifyBundle: async () => {}, processTable: async () => { completeReads++; return { complete: true, processes: [] }; } }) },
      '../transaction.cjs': {}, '../contract.cjs': { readBuildReceipt: async () => production },
      'node:child_process': { spawn: () => { throw new Error('no OS process allowed'); } },
    };
    runInNewContext(fs.readFileSync(path.resolve(__dirname, '../native-smoke.cjs'), 'utf8'), { module, JSON, process: fakeProcess, require: name => dependencies[name] ?? require(name) });
    await assert.rejects(module.exports.smoke({ output, scratchParent: nativeScratch }), error => error === original);
    assert.ok(completeReads >= 2, 'drain and removal closure gates still run');
    assert.equal(fs.readdirSync(nativeScratch).length, 1);
    assert.equal(fs.readFileSync(primary, 'utf8'), 'foreign immutable evidence');
    const raw = fs.readFileSync(path.join(output, 'native-smoke-failure.json'), 'utf8'), receipt = JSON.parse(raw);
    assert.equal(receipt.scratchRemoved, false); assert.equal(receipt.primarySnapshot, 'unavailable');
    assert.equal(raw.includes(sentinel), false);
    assert.equal(fakeProcess.listenerCount('SIGINT'), 0); assert.equal(fakeProcess.listenerCount('SIGTERM'), 0);
  });
});
