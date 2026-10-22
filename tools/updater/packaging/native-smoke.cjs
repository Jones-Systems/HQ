'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { PRODUCT, SYNTHETIC, buildReceipt } = require('./identity.cjs');
const { stampBundle, signAndVerify, archiveMetrics, manifestFor, command, contained } = require('./package.cjs');
const { withOwnedDirectory } = require('./owned-directory.cjs');
const { createNativeAdapter } = require('../native.cjs');
const { createTransaction } = require('../transaction.cjs');
const { recordPath, candidateId, validateInstallation, readBuildReceipt, atomicWrite } = require('../contract.cjs');

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

function prepared(receipt, bundlePath, metrics) {
  const manifest = manifestFor(receipt, metrics, { releaseTag: `hq-desktop-synthetic-${receipt.buildSequence}`, runId: String(receipt.buildSequence), runAttempt: 1, event: 'push', publishedAt: '2026-10-22T00:00:00.000Z' });
  return { schemaVersion: 1, candidateId: candidateId(manifest, { synthetic: true }), manifest, bundlePath };
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
  const result = { sourceSha: production.sourceSha, sourceTree: production.sourceTree, architecture: process.arch, syntheticIdentity: SYNTHETIC, archive: evidence.archive, checks: [], sampledPeakDiskBytes: 0 };
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
        const receipts = [0, 1, 2, 3].map(index => buildReceipt({ ...production, buildSequence: production.buildSequence + index, synthetic: true }));
        const bundles = [];
        for (let index = 0; index < receipts.length; index++) {
          const directory = path.join(activeRoot, `candidate-${index}`); fs.mkdirSync(directory);
          const bundle = path.join(directory, 'HQ.app');
          await syntheticClone(source, bundle, receipts[index]); bundles.push(bundle); sampleDisk();
        }
        const targets = path.join(activeRoot, 'Applications'); fs.mkdirSync(targets);
        const targetPath = path.join(targets, 'HQ.app');
        let record = validateInstallation({ schemaVersion: 1, product: 'hq', installationId: randomUUID(), targetPath, stateRoot: path.join(activeRoot, 'state'), userData: path.join(activeRoot, 'profile/userData'), sessionData: path.join(activeRoot, 'profile/sessionData'), appName: SYNTHETIC.productName, bundleId: SYNTHETIC.bundleId, channel: 'preview', compatibilityEpoch: production.compatibilityEpoch, profileCreation: 'allowed-until-first-health', synthetic: true, installed: receipts[0] });
        let engine = createTransaction({ native });
        await engine.state.initialize(record);
        const candidates = receipts.map((receipt, index) => prepared(receipt, bundles[index], evidence.archive));
        await atomicWrite(path.join(record.stateRoot, 'smoke-control.json'), { mode: 'schedule', candidate: candidates[1] });
        const run = (executable, args, environment = {}) => new Promise((resolve, reject) => {
          const child = spawn(executable, args, { stdio: ['ignore', 'ignore', 'pipe'], env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin', HOME: path.join(activeRoot, 'synthetic-home'), TMPDIR: path.join(activeRoot, 'tmp'), LANG: 'en_US.UTF-8', ...environment } });
          let stderr = '';
          child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-4096); });
          child.once('error', reject); child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Synthetic launch exited ${code ?? signal}: ${stderr}`)));
        });
        const runTarget = () => run(native.runtimePath(targetPath, record.installed), ['--use-mock-keychain']);
        fs.mkdirSync(path.join(activeRoot, 'synthetic-home')); fs.mkdirSync(path.join(activeRoot, 'tmp'));
        const installInput = path.join(activeRoot, 'install-input.json');
        await atomicWrite(installInput, { record, candidate: candidates[0] });
        await run(native.runtimePath(bundles[0], receipts[0]), [path.join(bundles[0], 'Contents/Resources/app/synthetic-native/native-install.cjs'), installInput], { ELECTRON_RUN_AS_NODE: '1' });
        await until('fresh native installation commits', async () => (await engine.read(record))?.state === 'committed');
        await drain(activeRoot);
        record = validateInstallation(read(recordPath(targetPath)));
        const first = read(path.join(record.stateRoot, `smoke-${receipts[0].buildSequence}.json`));
        assert.equal(first.appName, SYNTHETIC.productName); assert.equal(first.userData, record.userData); assert.equal(first.sessionData, record.sessionData); assert.equal(first.healthy, true);
        assert.deepEqual(await readBuildReceipt(targetPath, { synthetic: true }), receipts[0]);
        assert.equal(fs.existsSync(path.join(record.stateRoot, 'scheduled.json')), true);
        result.checks.push('fresh-installer-bundled-runtime-and-retained-helper', 'first-launch-native-name-and-profile-pins', 'schedule-leaves-current-binary-in-place');
        await runTarget();
        await until('accepted next launch commits', async () => (await engine.read(record))?.state === 'committed');
        await drain(activeRoot);
        record = validateInstallation(read(recordPath(targetPath)));
        assert.deepEqual(record.installed, receipts[1]);
        const next = read(path.join(record.stateRoot, `smoke-${receipts[1].buildSequence}.json`));
        assert.equal(next.userData, first.userData); assert.equal(next.sessionData, first.sessionData);
        assert.deepEqual(await readBuildReceipt((await engine.read(record)).priorPath, { synthetic: true }), receipts[0]);
        result.checks.push('retained-helper-next-launch-commits', 'prior-binary-receipt-retained'); sampleDisk();

        const self = await native.identity();
        let interrupted = false;
        engine = createTransaction({ native, checkpoint: async name => { if (name === 'staged' && !interrupted) { interrupted = true; throw new Error('synthetic staged interruption'); } } });
        await engine.state.withGate(record, self, () => engine.prepare(record, candidates[2]));
        await assert.rejects(engine.state.withGate(record, self, () => engine.activate(record, self)), /synthetic staged interruption/);
        assert.equal((await engine.read(record)).state, 'staged'); sampleDisk();
        engine = createTransaction({ native });
        await engine.state.withGate(record, self, async () => {
          const before = await engine.read(record);
          const resumed = await engine.recover(record, self, { operationId: before.operationId, expectedSequence: before.sequence });
          assert.equal(resumed.state, 'awaiting-health');
          await engine.requestLaunch(record, resumed, self);
        });
        await until('interrupted native transaction commits', async () => (await engine.read(record))?.state === 'committed');
        await drain(activeRoot);
        record = validateInstallation(read(recordPath(targetPath)));
        assert.deepEqual(record.installed, receipts[2]);
        result.checks.push('durable-stage-interruption-reconciled'); sampleDisk();

        await atomicWrite(path.join(record.stateRoot, 'smoke-control.json'), { mode: 'fail-health' });
        await engine.state.withGate(record, self, async () => { await engine.prepare(record, candidates[3]); const activated = await engine.activate(record, self); await engine.requestLaunch(record, activated, self); });
        await until('failed candidate process exits', async () => { const journal = await engine.read(record); return journal?.profileOpened && journal.launch && ['dead', 'stale'].includes(await native.observe(journal.launch)); });
        const restored = await engine.state.withGate(record, self, async () => { const journal = await engine.read(record); return engine.recover(record, self, { operationId: journal.operationId, expectedSequence: journal.sequence }); });
        assert.equal(restored.state, 'restored');
        assert.deepEqual(await readBuildReceipt(targetPath, { synthetic: true }), receipts[2]);
        assert.deepEqual(await readBuildReceipt(restored.failedPath, { synthetic: true }), receipts[3]);
        assert.equal(fs.readFileSync(path.join(record.userData, 'post-open-synthetic-write.txt'), 'utf8'), 'preserve after failed health');
        assert.equal(fs.readFileSync(path.join(record.userData, 'synthetic-preserved.txt'), 'utf8'), 'same profile across updates');
        result.checks.push('dead-failed-health-restores-compatible-binary', 'failed-binary-retained', 'post-open-and-post-commit-profile-writes-preserved'); sampleDisk();
        result.oldBuild = receipts[0]; result.newBuild = receipts[2];
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
    fs.writeFileSync(path.join(output, 'native-smoke-failure.json'), `${JSON.stringify({ ...result, failure: { name: error.name, message: error.message }, scratchRemoved: activeRoot ? !fs.existsSync(activeRoot) : true }, null, 2)}\n`);
    throw error;
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
}

if (require.main === module) smoke().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
module.exports = { smoke, syntheticClone };
