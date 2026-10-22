'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PRODUCT, SYNTHETIC } = require('./identity.cjs');
const { stampBundle, signAndVerify, archiveMetrics, command, contained } = require('./package.cjs');
const { scenarioPlan } = require('./native-scenario-plan.cjs');
const { admitNativeStorage } = require('./native-storage.cjs');
const { withOwnedDirectory } = require('./owned-directory.cjs');
const { createNativeAdapter } = require('../native.cjs');
const { createTransaction } = require('../transaction.cjs');
const { recordPath, validateInstallation, readBuildReceipt, atomicWrite } = require('../contract.cjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
async function until(label, condition, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await condition(); if (result) return result; await sleep(150); }
  throw new Error(`Native smoke timed out: ${label}`);
}

async function syntheticClone(source, destination, receipt) {
  fs.cpSync(source, destination, { recursive: true, dereference: false, verbatimSymlinks: true, errorOnExist: true, force: false });
  const appRoot = path.join(destination, 'Contents/Resources/app');
  const pkg = read(path.join(appRoot, 'package.json'));
  fs.writeFileSync(path.join(appRoot, 'package.json'), `${JSON.stringify({ ...pkg, name: SYNTHETIC.name, productName: SYNTHETIC.productName })}\n`);
  fs.writeFileSync(path.join(appRoot, 'build-receipt.json'), `${JSON.stringify(receipt)}\n`);
  const bootstrap = fs.readFileSync(path.join(appRoot, 'local-bootstrap.cjs'), 'utf8');
  assert.ok(bootstrap.includes("import('./apps/desktop/dist-electron/main.js')"));
  fs.writeFileSync(path.join(appRoot, 'local-bootstrap.cjs'), bootstrap.replace("import('./apps/desktop/dist-electron/main.js')", "import('./synthetic-native/native-main.cjs')"));
  fs.cpSync(path.join(__dirname, 'fixtures'), path.join(appRoot, 'synthetic-native'), { recursive: true, errorOnExist: true });
  fs.renameSync(path.join(appRoot, 'tools/updater/helper.cjs'), path.join(appRoot, 'tools/updater/helper-implementation.cjs'));
  fs.copyFileSync(path.join(__dirname, 'fixtures/native-helper.cjs'), path.join(appRoot, 'tools/updater/helper.cjs'));
  stampBundle(destination, receipt);
  signAndVerify(destination, receipt.architecture);
}

async function smoke({ output = process.env.HQ_PACKAGE_OUTPUT, scratchParent = process.env.HQ_NATIVE_SCRATCH } = {}) {
  if (process.platform !== 'darwin' || !output || !scratchParent) throw new Error('Native macOS output and task-owned scratch parent are required');
  output = fs.realpathSync(output);
  fs.mkdirSync(scratchParent, { recursive: true }); scratchParent = fs.realpathSync(scratchParent);
  const source = path.join(output, 'HQ.app'), evidence = read(path.join(output, 'package-evidence.json'));
  let activeRoot;
  const native = createNativeAdapter({ spawn: (file, args, options) => spawn(file, options.env.ELECTRON_RUN_AS_NODE === '1' ? args : [...args, '--use-mock-keychain'], { ...options, env: { ...options.env, ...(activeRoot ? { HOME: path.join(activeRoot, 'synthetic-home'), TMPDIR: path.join(activeRoot, 'tmp') } : {}) } }) });
  const production = await readBuildReceipt(source);
  assert.equal(production.bundleId, PRODUCT.bundleId);
  assert.equal(production.sourceSha, process.env.GITHUB_SHA);
  assert.equal(production.architecture, process.arch);
  assert.deepEqual(archiveMetrics(path.join(output, `hq-darwin-${process.arch}.zip`)), evidence.archive);
  await native.verifyBundle(source, production);
  const result = { sourceSha: production.sourceSha, sourceTree: production.sourceTree, architecture: process.arch, syntheticIdentity: SYNTHETIC, archive: evidence.archive, checks: [], scenarios: [], sampledPeakDiskBytes: 0 };
  const signals = new EventEmitter();
  let cancellation;
  const interrupt = () => { cancellation = 'SIGINT'; }, terminate = () => { cancellation = 'SIGTERM'; };
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  async function ownProcesses(root) {
    const table = await native.processTable();
    assert.equal(table.complete, true);
    return table.processes.filter(item => contained(root, item.executable));
  }
  async function drain(root, stop = false) {
    const processes = await ownProcesses(root);
    if (stop) for (const item of processes) {
      const identity = { pid: item.pid, start: item.start, boot: item.boot, executable: item.executable };
      if (await native.observe(identity) === 'live') process.kill(item.pid, 'SIGTERM');
    }
    await until('synthetic processes exit', async () => (await ownProcesses(root)).length === 0, 30000);
  }
  try {
    await withOwnedDirectory(scratchParent, 'hq-native-', async scratch => {
      activeRoot = fs.realpathSync(scratch);
      const sampleDisk = () => { result.sampledPeakDiskBytes = Math.max(result.sampledPeakDiskBytes, Number(command('/usr/bin/du', ['-sk', activeRoot]).trim().split(/\s+/)[0]) * 1024); if (cancellation) throw new Error(`Native smoke cancelled: ${cancellation}`); };
      try {
        const plan = scenarioPlan(activeRoot, production, evidence.archive);
        const bundleCopies = plan.reduce((count, scenario) => count + 2 * scenario.steps.length, 0);
        result.storage = admitNativeStorage({ sourceBundle: source, outputDirectory: activeRoot, bundleCopies });
        const run = (executable, args, environment = {}) => new Promise((resolve, reject) => {
          const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: path.join(activeRoot, 'synthetic-home'), TMPDIR: path.join(activeRoot, 'tmp'), LANG: 'en_US.UTF-8', ...environment } });
          let stderr = '';
          child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-4096); });
          child.once('error', reject); child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Synthetic launch exited ${code ?? signal}: ${stderr}`)));
        });
        fs.mkdirSync(path.join(activeRoot, 'synthetic-home')); fs.mkdirSync(path.join(activeRoot, 'tmp'));
        for (const scenario of plan) {
          let record = scenario.record;
          const targetPath = record.targetPath;
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          let engine = createTransaction({ native });
          await engine.state.initialize(record);
          for (const step of scenario.steps) {
            fs.mkdirSync(path.dirname(step.candidate.bundlePath), { recursive: true });
            await syntheticClone(source, step.candidate.bundlePath, step.receipt); sampleDisk();
          }
          const scenarioEvidence = { name: scenario.name, checks: [] };
          result.scenarios.push(scenarioEvidence);
          const passed = (...names) => { scenarioEvidence.checks.push(...names); for (const name of names) if (!result.checks.includes(name)) result.checks.push(name); };
          let first;
          const committed = async step => {
            await until(`${scenario.name} ${step.journey} commits`, async () => (await engine.read(record))?.state === 'committed');
            await drain(activeRoot);
            record = validateInstallation(read(recordPath(targetPath)));
            assert.deepEqual(record.installed, step.receipt);
            assert.deepEqual(await readBuildReceipt(targetPath, { synthetic: true }), step.receipt);
            const observed = read(path.join(record.stateRoot, `smoke-${step.receipt.buildSequence}.json`));
            assert.equal(observed.appName, SYNTHETIC.productName); assert.equal(observed.userData, record.userData); assert.equal(observed.sessionData, record.sessionData); assert.equal(observed.healthy, true);
            if (first) { assert.equal(observed.userData, first.userData); assert.equal(observed.sessionData, first.sessionData); }
            else first = observed;
          };
          for (let index = 0; index < scenario.steps.length; index++) {
            const step = scenario.steps[index], prior = record.installed;
            if (step.journey === 'fresh') {
              const next = scenario.steps[index + 1];
              if (next?.journey === 'next-launch') await atomicWrite(path.join(record.stateRoot, 'smoke-control.json'), { mode: 'schedule', candidate: next.candidate });
              const installInput = path.join(record.stateRoot, 'smoke-install-input.json');
              await atomicWrite(installInput, { record, candidate: step.candidate });
              await run(native.runtimePath(step.candidate.bundlePath, step.receipt), [path.join(step.candidate.bundlePath, 'Contents/Resources/app/synthetic-native/native-install.cjs'), installInput], { ELECTRON_RUN_AS_NODE: '1' });
              await committed(step);
              passed('fresh-installer-bundled-runtime-and-retained-helper', 'first-launch-native-name-and-profile-pins');
              if (next?.journey === 'next-launch') {
                assert.equal(fs.existsSync(path.join(record.stateRoot, 'scheduled.json')), true);
                passed('schedule-leaves-current-binary-in-place');
                result.oldBuild = step.receipt;
              }
            } else if (step.journey === 'next-launch') {
              await run(native.runtimePath(targetPath, record.installed), ['--use-mock-keychain']);
              await committed(step);
              assert.deepEqual(await readBuildReceipt((await engine.read(record)).priorPath, { synthetic: true }), prior);
              passed('retained-helper-next-launch-commits', 'prior-binary-receipt-retained');
            } else if (step.journey === 'interrupted-recovery') {
              const self = await native.identity();
              let interrupted = false;
              engine = createTransaction({ native, checkpoint: async name => { if (name === 'staged' && !interrupted) { interrupted = true; throw new Error('synthetic staged interruption'); } } });
              await engine.state.withGate(record, self, () => engine.prepare(record, step.candidate));
              await assert.rejects(engine.state.withGate(record, self, () => engine.activate(record, self)), /synthetic staged interruption/);
              assert.equal((await engine.read(record)).state, 'staged'); sampleDisk();
              engine = createTransaction({ native });
              await engine.state.withGate(record, self, async () => {
                const before = await engine.read(record);
                const resumed = await engine.recover(record, self, { operationId: before.operationId, expectedSequence: before.sequence });
                assert.equal(resumed.state, 'awaiting-health');
                await engine.requestLaunch(record, resumed, self);
              });
              await committed(step);
              passed('durable-stage-interruption-reconciled');
              result.newBuild = step.receipt;
            } else if (step.journey === 'failed-health') {
              const self = await native.identity();
              await atomicWrite(path.join(record.stateRoot, 'smoke-control.json'), { mode: 'fail-health' });
              await engine.state.withGate(record, self, async () => { await engine.prepare(record, step.candidate); const activated = await engine.activate(record, self); await engine.requestLaunch(record, activated, self); });
              await until('failed candidate process exits', async () => { const journal = await engine.read(record); return journal?.profileOpened && journal.launch && ['dead', 'stale'].includes(await native.observe(journal.launch)); });
              const restored = await engine.state.withGate(record, self, async () => { const journal = await engine.read(record); return engine.recover(record, self, { operationId: journal.operationId, expectedSequence: journal.sequence }); });
              assert.equal(restored.state, 'restored');
              assert.deepEqual(await readBuildReceipt(targetPath, { synthetic: true }), prior);
              assert.deepEqual(await readBuildReceipt(restored.failedPath, { synthetic: true }), step.receipt);
              assert.equal(fs.readFileSync(path.join(record.userData, 'post-open-synthetic-write.txt'), 'utf8'), 'preserve after failed health');
              assert.equal(fs.readFileSync(path.join(record.userData, 'synthetic-preserved.txt'), 'utf8'), 'same profile across updates');
              record = validateInstallation(read(recordPath(targetPath)));
              assert.deepEqual(record.installed, prior);
              result.failedHealth = { priorBuild: prior, failedBuild: step.receipt, restoredBuild: record.installed };
              passed('dead-failed-health-restores-compatible-binary', 'failed-binary-retained', 'post-open-and-post-commit-profile-writes-preserved');
            } else throw new Error(`Unknown native journey: ${step.journey}`);
            sampleDisk();
          }
        }
        await drain(activeRoot);
      } finally {
        // These are newly created synthetic apps inside this invocation's root; real HQ/Jones paths never qualify.
        await drain(activeRoot, true);
      }
    }, { signals, async remove(root, options) {
      assert.equal(root, activeRoot);
      if ((await ownProcesses(root)).length) throw new Error('Synthetic process remains live; native scratch is retained');
      fs.rmSync(root, options);
    } });
    assert.equal(fs.existsSync(activeRoot), false);
    result.checks.push('owned-native-scratch-removed');
    fs.writeFileSync(path.join(output, 'native-smoke.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (error.storage) result.storage = error.storage;
    fs.writeFileSync(path.join(output, 'native-smoke-failure.json'), `${JSON.stringify({ ...result, failure: { name: error.name, message: error.message }, scratchRemoved: activeRoot ? !fs.existsSync(activeRoot) : true }, null, 2)}\n`);
    throw error;
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
}

if (require.main === module) smoke().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
module.exports = { smoke, syntheticClone };
