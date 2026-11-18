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
    assert.equal(report('error', Object.assign(new Error(sentinel), { code: 'busy', refusal: { guard: 'writer-session', liveness: 'unknown', arbitrary: sentinel } })), true);
    assert.equal(report('error', new Error('foreign retry')), false, 'milestone cannot overwrite an existing producer record');
    assert.equal(diagnostics.fixtureReporter(directory, 'main')('renderer-error', Object.assign(new Error(sentinel), { code: 'ERR_ASSERTION', refusal: { guard: sentinel } })), true);
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
    assert.equal(snapshot.milestones['helper:error'].refusal.guard, 'writer-session');
    assert.equal(snapshot.milestones['helper:error'].refusal.liveness, 'unknown');
    assert.equal(snapshot.milestones['helper:error'].refusal.ownerRelation, 'unknown');
    assert.equal(snapshot.milestones['main:renderer-error'].refusal.reason, 'invalid-refusal');
    assert.equal(snapshot.milestones['main:renderer-error'].category, 'assertion');
    assert.equal(snapshot.milestones['bootstrap:entered'].status, 'unavailable');
    const file = path.join(output, 'native-smoke-primary-failure.json'), raw = fs.readFileSync(file, 'utf8');
    assert.equal(raw.includes(sentinel), false); assert.equal(raw.includes(root), false);
    assert.ok(Buffer.byteLength(raw) <= 32768);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.throws(() => diagnostics.captureFailure(args), { code: 'EEXIST' });
    assert.equal(fs.readFileSync(file, 'utf8'), raw);
    const nextOutput = path.join(root, 'next-output'); fs.mkdirSync(nextOutput);
    assert.equal(diagnostics.fixtureReporter(directory, 'bootstrap')('error', Object.assign(new Error(sentinel), { code: 'busy', refusal: { guard: 'profile-singleton', singleton: 'refused', launchBinding: 'absent' } })), true);
    const next = diagnostics.captureFailure({ ...args, output: nextOutput, active: { ...args.active, journey: 'next-launch', buildSequence: 2, runtimeBuildSequence: 1 } });
    assert.equal(next.runtimeBuildSequence, 1);
    assert.equal(next.milestones['launching-runtime:bootstrap:error'].category, 'busy', 'next-launch observes the prior runtime bootstrap before candidate main exists');
    assert.equal(next.milestones['launching-runtime:bootstrap:error'].refusal.guard, 'profile-singleton');
    assert.equal(next.milestones['launching-runtime:bootstrap:error'].refusal.singleton, 'refused');
    const unknown = { pidEqual: null, identityEqual: null };
    const evidence = {
      status: 'available', executableClass: 'inventory', rootClass: 'transaction-bundle',
      self: { pidEqual: false, identityEqual: false }, helper: { ...unknown }, initiating: { ...unknown },
      parent: { match: 'unknown', executableClass: 'unknown', rootClass: 'unknown', self: { ...unknown }, helper: { ...unknown }, initiating: { ...unknown } },
    };
    const malformed = [
      null, [], { ...evidence, status: sentinel }, { ...evidence, executableClass: sentinel },
      { ...evidence, rootClass: sentinel }, { ...evidence, self: true },
      { ...evidence, self: { pidEqual: 'true', identityEqual: false } },
      { ...evidence, self: { pidEqual: null, identityEqual: false } },
      { ...evidence, helper: { pidEqual: false, identityEqual: true } },
      { ...evidence, initiating: { pidEqual: false } },
      { ...evidence, parent: { ...evidence.parent, match: sentinel } },
      { ...evidence, parent: { ...evidence.parent, executableClass: 'inventory' } },
      { ...evidence, parent: { ...evidence.parent, self: { pidEqual: true, identityEqual: true } } },
      { ...evidence, argv: [sentinel], environment: { private: sentinel }, profile: sentinel },
      { status: 'unavailable', reason: sentinel },
    ];
    for (const [index, writerEvidence] of [evidence, { status: 'unavailable', reason: 'classification-failed' }, ...malformed].entries()) {
      const buildSequence = index + 3;
      write(path.join(directory, 'diagnostic-binding.json'), { runRoot, stateRoot, buildSequence });
      assert.equal(diagnostics.fixtureReporter(directory, 'bootstrap')('error', Object.assign(new Error(sentinel), {
        code: 'busy', refusal: { guard: 'writer-process', writerEvidence },
      })), true);
      const projected = JSON.parse(fs.readFileSync(path.join(stateRoot, `diagnostic-bootstrap-${buildSequence}-error.json`), 'utf8'));
      assert.equal(projected.category, 'busy');
      if (index < 2) assert.deepEqual(projected.refusal.writerEvidence, writerEvidence);
      else assert.deepEqual(projected.refusal, { status: 'unavailable', reason: 'invalid-refusal' });
      const caseOutput = path.join(root, `projection-${index}`); fs.mkdirSync(caseOutput);
      const retained = diagnostics.captureFailure({ ...args, output: caseOutput, active: { ...args.active, buildSequence } });
      assert.deepEqual(retained.milestones['bootstrap:error'].refusal,
        index < 2 ? projected.refusal : { status: 'unavailable', reason: 'invalid-refusal' });
      assert.equal(fs.readFileSync(path.join(caseOutput, 'native-smoke-primary-failure.json'), 'utf8').includes(sentinel), false);
    }
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


test('real fresh helper gate, singleton and writer refusals remain distinct before health', async t => {
  const { fixture, identity, fakeApp } = require('../../test/fixtures.cjs');
  const { runHelper } = require('../../helper.cjs');
  const bootstrap = require('../../bootstrap.cjs');
  const writers = [
    { name: 'writer', executableClass: 'other', rootClass: 'target-bundle', parent: 'self' },
    { name: 'inventory-first', executableClass: 'inventory', rootClass: 'transaction-bundle', parent: 'self' },
    { name: 'framework-first', executableClass: 'framework-child', rootClass: 'target-bundle', parent: 'self' },
    { name: 'main-first', executableClass: 'bundle-main', rootClass: 'target-bundle', parent: 'self' },
    { name: 'self-pid-reused', executableClass: 'bundle-main', rootClass: 'target-bundle', parent: 'helper', reused: 'self' },
    { name: 'helper-pid-reused', executableClass: 'bundle-main', rootClass: 'transaction-bundle', parent: 'self', reused: 'helper' },
    { name: 'initiating-pid-reused', executableClass: 'bundle-main', rootClass: 'target-bundle', parent: 'self', reused: 'initiating' },
    { name: 'absent-parent', executableClass: 'other', rootClass: 'target-bundle', parent: 'absent' },
    { name: 'unmatched-parent', executableClass: 'other', rootClass: 'target-bundle', parent: 'unmatched' },
    { name: 'ambiguous-parent', executableClass: 'other', rootClass: 'target-bundle', parent: 'ambiguous' },
    { name: 'initiating-parent', executableClass: 'other', rootClass: 'target-bundle', parent: 'initiating' },
    { name: 'external-descendant', executableClass: 'other', rootClass: 'other', parent: 'self', writerRelation: 'descendant' },
    { name: 'state-root', executableClass: 'other', rootClass: 'state-root', parent: 'self' },
    { name: 'misleading-inventory-basename', executableClass: 'other', rootClass: 'target-bundle', parent: 'self' },
  ];
  for (const scenario of [{ kind: 'gate', name: 'gate' }, { kind: 'singleton', name: 'singleton' }, ...writers.map(value => ({ kind: 'writer', ...value }))]) await t.test(scenario.name, async t => {
    const { kind } = scenario;
    let reached, release;
    const checkpointReached = new Promise(resolve => { reached = resolve; });
    const barrier = new Promise(resolve => { release = resolve; });
    const stopped = new Error('portable helper checkpoint complete');
    const f = await fixture(t, { kind: 'fresh', checkpoint: async name => {
      if (name === 'after-launch') { reached(); if (kind === 'gate') await barrier; }
    } });
    const oldState = f.record.stateRoot;
    f.record.stateRoot = path.join(f.root, 'lifecycle/state');
    await fs.promises.mkdir(path.dirname(f.record.stateRoot));
    await fs.promises.rename(oldState, f.record.stateRoot);
    f.candidate.bundlePath = path.join(f.record.stateRoot, path.relative(oldState, f.candidate.bundlePath));
    const helper = Object.freeze(identity(path.join(f.candidate.bundlePath, 'Contents/MacOS', f.record.appName), 101));
    f.processes.clear(); f.setSelf(helper);
    const initiating = scenario.reused === 'initiating' || scenario.parent === 'initiating'
      ? Object.freeze(identity(path.join(f.record.targetPath, 'Contents/MacOS', f.record.appName), scenario.reused === 'initiating' ? 2147000001 : 707)) : null;
    const prepared = initiating ? await f.locked(() => f.engine.prepare(f.record, f.candidate, { kind: 'fresh', initiating })) : await f.prepare();
    await f.writeRecord();
    const helperNative = { ...f.native, identity: async () => helper };
    const pending = runHelper({ record: f.record, operationId: prepared.operationId, adapters: {
      ...f.adapters, native: helperNative, sleep: async () => { throw stopped; },
    } }).catch(error => { assert.equal(error, stopped); });
    try {
      await checkpointReached;
      if (kind !== 'gate') await pending;
      const before = await f.engine.read(f.record);
      assert.equal(before.sequence, 7); assert.equal(before.launchAttempted, true);
      const journalBytes = fs.readFileSync(path.join(f.record.stateRoot, 'transaction.json'), 'utf8');
      const gateFile = path.join(f.record.stateRoot, 'gate/owner.json');
      const custody = kind === 'gate' ? fs.readFileSync(gateFile, 'utf8') : null;
      const row = f.processes.get(303);
      const appIdentity = Object.freeze(identity(row.executable, row.pid));
      const counts = { identity: 0, table: 0, observe: 0 };
      const native = { ...f.native, identity: async () => { counts.identity++; return appIdentity; },
        processTable: async () => {
          counts.table++;
          const table = await f.native.processTable();
          if (scenario.parent === 'ambiguous') table.processes.push({ ...row });
          return table;
        },
        observe: async expected => { counts.observe++; return f.native.observe(expected); },
      };
      const app = fakeApp(f.record.appName);
      if (kind === 'singleton') app.requestSingleInstanceLock = () => { app.calls.push(['singleton']); return false; };
      if (kind === 'writer') {
        const bundle = scenario.rootClass === 'transaction-bundle' ? f.candidate.bundlePath : f.record.targetPath;
        const executable = scenario.executableClass === 'inventory' ? path.join(bundle, 'Contents/Resources/app/tools/updater/process-inventory')
          : scenario.executableClass === 'bundle-main' ? path.join(bundle, 'Contents/MacOS', f.record.appName)
            : scenario.executableClass === 'framework-child' ? path.join(bundle, 'Contents/Frameworks', sentinel, 'Contents/MacOS/child')
              : scenario.rootClass === 'other' ? path.join(f.root, sentinel)
                : scenario.rootClass === 'state-root' ? path.join(f.record.stateRoot, sentinel)
                  : scenario.name === 'misleading-inventory-basename' ? path.join(bundle, 'Contents/MacOS', sentinel, 'process-inventory')
                    : path.join(bundle, 'Contents/MacOS', sentinel);
        const pid = scenario.reused === 'self' ? appIdentity.pid : scenario.reused === 'helper' ? helper.pid : 2147000001;
        const ppid = scenario.parent === 'absent' ? 0 : scenario.parent === 'unmatched' ? 2147000002
          : scenario.parent === 'helper' ? helper.pid : scenario.parent === 'initiating' ? initiating.pid : appIdentity.pid;
        f.processes.set(pid, { ...identity(executable, pid, { start: sentinel }), ppid,
          argv: [sentinel], environment: { private: sentinel }, profile: sentinel });
        if (scenario.parent === 'initiating') f.processes.set(initiating.pid, { ...initiating, ppid: 0 });
        // A later, differently classified blocker must never replace the first refusal's evidence.
        f.processes.set(505, { ...identity(path.join(f.record.targetPath, 'Contents/Resources/app/tools/updater/process-inventory'), 505), ppid: 303 });
        if (scenario.executableClass === 'inventory') f.processes.get(505).executable = path.join(f.record.targetPath, 'Contents/Frameworks', sentinel, 'child');
      }
      const directory = path.join(f.root, 'fixture'), output = path.join(f.root, 'output');
      fs.mkdirSync(output);
      write(path.join(directory, 'diagnostic-binding.json'), { runRoot: f.root, stateRoot: f.record.stateRoot, buildSequence: 2 });
      const module = { exports: {} };
      let invoked = 0, original;
      runInNewContext(fs.readFileSync(path.resolve(__dirname, '../fixtures/native-bootstrap.cjs'), 'utf8'), {
        module, __dirname: directory, require: name => {
          if (name === './native-diagnostics.cjs') return diagnostics;
          if (name === '../tools/updater/bootstrap.cjs') return { run: async options => {
            invoked++;
            try { return await bootstrap.run(options); } catch (error) { original = error; throw error; }
          } };
          throw new Error('unexpected module');
        },
      });
      await assert.rejects(module.exports.run({ app, bundlePath: f.record.targetPath,
        importMain: async () => assert.fail('refusal imported main'), adapters: { ...f.adapters, native,
          environment: {}, argv: [`--hq-update-operation=${before.operationId}`, `--hq-update-sequence=${before.sequence}`],
        },
      }), error => error === original && error.code === 'busy');
      assert.equal(invoked, 1);
      assert.equal(counts.identity, 1);
      assert.equal(counts.table, kind === 'writer' ? 1 : 0);
      assert.equal(counts.observe, kind === 'gate' ? 1 : 0, 'annotation performs no identity, inventory or liveness enrichment');
      assert.deepEqual(await f.engine.read(f.record), before);
      assert.equal(fs.readFileSync(path.join(f.record.stateRoot, 'transaction.json'), 'utf8'), journalBytes);
      assert.equal(await f.engine.state.session(f.record), null);
      assert.equal(before.launch, null); assert.equal(before.profileOpened, false); assert.equal(before.health, null);
      assert.equal(app.listenerCount('will-quit'), 0);
      assert.equal(bootstrap.getContext(), null);
      assert.equal(fs.existsSync(path.join(f.record.stateRoot, 'health.json')), false);
      assert.equal(f.calls.filter(call => call[0] === 'launch').length, 1, 'helper launch precedes the refused bootstrap and main import');
      if (custody) assert.equal(fs.readFileSync(gateFile, 'utf8'), custody);
      else assert.equal(fs.existsSync(path.dirname(gateFile)), false);
      const snapshot = diagnostics.captureFailure({ output, root: f.root, production, archive,
        active: { scenario: 'lifecycle', journey: 'fresh', buildSequence: 2, stateRoot: f.record.stateRoot }, error: original });
      const refusal = snapshot.milestones['bootstrap:error'].refusal;
      assert.equal(refusal?.guard, { gate: 'installation-gate-owner', singleton: 'profile-singleton', writer: 'writer-process' }[kind]);
      assert.equal(refusal.launchBinding, 'present');
      assert.equal(refusal.singleton, { gate: 'not-attempted', singleton: 'refused', writer: 'accepted' }[kind]);
      if (kind === 'gate') {
        assert.equal(refusal.ownerRelation, 'other'); assert.equal(refusal.helperRelation, 'unknown'); assert.equal(refusal.liveness, 'live');
      }
      if (kind === 'writer') {
        assert.equal(refusal.ownerRelation, 'other'); assert.equal(refusal.helperRelation, 'other');
        if (scenario.writerRelation) assert.equal(refusal.writerRelation, scenario.writerRelation);
        else assert.equal(refusal.writerRelation, 'owned-root');
        assert.equal(original.message, 'A live HQ app or helper blocks replacement.');
        assert.equal(snapshot.failureCategory, 'busy');
        assert.equal(snapshot.milestones['bootstrap:error'].category, 'busy');
        const evidence = refusal.writerEvidence;
        assert.equal(evidence.status, 'available');
        assert.equal(evidence.executableClass, scenario.executableClass);
        assert.equal(evidence.rootClass, scenario.rootClass);
        for (const key of ['self', 'helper', 'initiating']) assert.deepEqual(evidence[key], key === 'initiating' && !initiating
          ? { pidEqual: null, identityEqual: null } : { pidEqual: scenario.reused === key, identityEqual: false });
        const knownParent = ['self', 'helper', 'initiating'].includes(scenario.parent);
        assert.equal(evidence.parent.match, knownParent ? 'unique' : 'unknown');
        assert.equal(evidence.parent.executableClass, knownParent ? 'bundle-main' : 'unknown');
        assert.equal(evidence.parent.rootClass, !knownParent ? 'unknown' : scenario.parent === 'helper' ? 'transaction-bundle' : 'target-bundle');
        for (const key of ['self', 'helper', 'initiating']) assert.deepEqual(evidence.parent[key], !knownParent || (key === 'initiating' && !initiating)
          ? { pidEqual: null, identityEqual: null } : { pidEqual: scenario.parent === key, identityEqual: scenario.parent === key });
        assert.deepEqual(original.refusal.writerEvidence, evidence, 'reporting retains only the first rejected row from the original scan');
      }
      const raw = fs.readFileSync(path.join(output, 'native-smoke-primary-failure.json'), 'utf8');
      assert.equal(raw.includes(sentinel), false); assert.equal(raw.includes(f.root), false);
      assert.equal(raw.includes('2147000001'), false); assert.equal(raw.includes('2147000002'), false);
      for (const key of ['pid', 'ppid', 'start', 'boot', 'executable', 'argv', 'environment', 'profile', 'events']) assert.equal(raw.includes(`"${key}":`), false);
    } finally { release(); await pending; }
    assert.equal(fs.existsSync(path.join(f.record.stateRoot, 'gate')), false);
  });
});
