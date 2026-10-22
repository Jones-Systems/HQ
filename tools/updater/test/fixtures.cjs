'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { candidateId, receiptOf, readBuildReceipt, canonical, ensure, recordPath, atomicWrite, sameProcess } = require('../contract.cjs');
const { createTransaction } = require('../transaction.cjs');

const roots = new Set();
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => {
  void Promise.allSettled([...roots].map(root => fs.rm(root, { recursive: true, force: true }))).then(() => process.exit(code));
});
function manifest(overrides = {}, synthetic = true) {
  return {
    schemaVersion: 1, product: 'hq', version: '1.0.2', buildSequence: 2,
    sourceSha: 'a'.repeat(40), sourceTree: 'b'.repeat(40), channel: 'preview', compatibilityEpoch: 'hq-profile-1',
    electronVersion: '44.9.0', appName: synthetic ? 'HQ Updater Test' : 'HQ',
    bundleId: synthetic ? 'org.jones-systems.hq.updater-test' : 'org.jones-systems.hq.local', architecture: 'arm64',
    repository: { name: 'Jones-Systems/HQ', id: 1001, ownerId: 1002 }, platform: 'darwin', releaseTag: 'hq-preview-2',
    workflow: '.github/workflows/hq-desktop-package.yml', runId: '1003', runAttempt: 1, event: 'push', publishedAt: '2026-10-22T10:00:00Z', signing: 'adhoc',
    archive: { name: 'hq-arm64.zip', size: 100, sha256: 'c'.repeat(64), expandedSize: 1000, fileCount: 10 }, attestation: 'hq-arm64.intoto.json', ...overrides,
  };
}
function identity(executable, pid = 101, extra = {}) { return { pid, start: `start-${pid}`, boot: 'synthetic-boot', executable, ...extra }; }
async function writeBundle(directory, receipt) {
  const app = path.join(directory, 'Contents/Resources/app');
  await fs.mkdir(app, { recursive: true });
  await fs.mkdir(path.join(directory, 'Contents/MacOS'), { recursive: true });
  await atomicWrite(path.join(app, 'build-receipt.json'), receipt);
  await atomicWrite(path.join(app, 'package.json'), { name: receipt.bundleId.endsWith('updater-test') ? 'hq-updater-test' : 'hq', productName: receipt.appName });
  await fs.writeFile(path.join(app, 'local-bootstrap.cjs'), 'synthetic bootstrap');
  await fs.mkdir(path.join(app, 'apps/desktop/dist-electron'), { recursive: true });
  await fs.writeFile(path.join(app, 'apps/desktop/dist-electron/main.js'), 'synthetic main');
  await fs.writeFile(path.join(directory, 'Contents/MacOS', receipt.appName), `synthetic executable ${receipt.buildSequence}`);
}
async function legacyIdentity(directory) {
  const root = path.join(directory, 'Contents/Resources/app');
  const result = { kind: 'legacy' };
  for (const [key, filename] of Object.entries({ bootstrapSha256: 'local-bootstrap.cjs', packageSha256: 'package.json', mainSha256: 'apps/desktop/dist-electron/main.js' })) result[key] = crypto.createHash('sha256').update(await fs.readFile(path.join(root, filename))).digest('hex');
  return result;
}
async function fixture(t, { kind = 'update', checkpoint, synthetic = true, fs: injectedFs } = {}) {
  const parent = path.resolve(__dirname, '../.test-scratch');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'case-'));
  roots.add(root);
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); roots.delete(root); });
  const targetPath = path.join(root, 'Applications', synthetic ? 'HQ Updater Test.app' : 'HQ.app');
  const stateRoot = path.join(root, 'updates');
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.mkdir(stateRoot, { mode: 0o700 });
  const release = manifest({}, synthetic);
  const candidate = { schemaVersion: 1, candidateId: candidateId(release, { synthetic }), manifest: release, bundlePath: path.join(stateRoot, 'download-cache', 'candidate', path.basename(targetPath)) };
  const prior = receiptOf(manifest({ version: '1.0.1', buildSequence: 1, sourceSha: 'd'.repeat(40) }, synthetic));
  await writeBundle(candidate.bundlePath, receiptOf(release));
  if (kind !== 'fresh') await writeBundle(targetPath, prior);
  const record = {
    schemaVersion: 1, product: 'hq', installationId: 'synthetic-installation', targetPath, stateRoot,
    userData: path.join(root, 'profile/userData'), sessionData: path.join(root, 'profile/sessionData'), appName: release.appName, bundleId: release.bundleId,
    channel: 'preview', compatibilityEpoch: kind === 'adopt' ? 'unknown' : release.compatibilityEpoch,
    profileCreation: kind === 'fresh' ? 'allowed-until-first-health' : 'forbidden', synthetic,
    installed: kind === 'adopt' ? await legacyIdentity(targetPath) : kind === 'fresh' ? receiptOf(release) : prior,
  };
  if (kind !== 'fresh') {
    await fs.mkdir(record.userData, { recursive: true });
    await fs.mkdir(record.sessionData, { recursive: true });
    await fs.writeFile(path.join(record.userData, 'untouched.data'), 'synthetic profile bytes');
  }
  const calls = [];
  const processes = new Map();
  const helperIdentity = identity(path.join(candidate.bundlePath, 'Contents/MacOS', record.appName));
  let self = helperIdentity;
  processes.set(self.pid, { ...self, ppid: 0 });
  let complete = true;
  let now = 100000;
  const native = {
    platform: 'darwin', architecture: 'arm64', supported() {},
    identity: async () => self,
    observe: async expected => {
      if (!complete) return 'unknown';
      if (expected.boot !== 'synthetic-boot') return 'stale';
      const found = processes.get(expected.pid);
      return !found ? 'dead' : sameProcess(found, expected) ? 'live' : 'stale';
    },
    processTable: async () => ({ complete, boot: 'synthetic-boot', processes: [...processes.values()] }),
    runtimePath: (bundlePath, receipt) => path.join(bundlePath, 'Contents/MacOS', receipt.appName),
    verifyBundle: async (bundlePath, expected) => {
      calls.push(['verifyBundle', bundlePath]);
      ensure(canonical(await readBuildReceipt(bundlePath, { synthetic })) === canonical(expected), 'Synthetic bundle mismatch.', 'integrity');
      return expected;
    },
    legacyIdentity,
    verifyLegacy: async (bundlePath, expected) => { ensure(canonical(await legacyIdentity(bundlePath)) === canonical(expected), 'Legacy mismatch.', 'integrity'); return expected; },
    checkTarget: async (value, bytes) => { calls.push(['checkTarget', value.targetPath, bytes]); },
    copyBundle: async (source, destination) => { calls.push(['copyBundle', source, destination]); await fs.cp(source, destination, { recursive: true, force: false, errorOnExist: true }); },
    spawnHelper: async (...args) => { calls.push(['spawnHelper', ...args]); return { pid: 202 }; },
    launch: async (value, journal) => {
      calls.push(['launch', value.targetPath, journal.sequence]);
      const launched = identity(path.join(value.targetPath, 'Contents/MacOS', value.appName), 303);
      processes.set(launched.pid, { ...launched, ppid: self.pid });
      return { pid: launched.pid };
    },
  };
  const adapters = { native, clock: () => now, checkpoint, ...(injectedFs ? { fs: injectedFs } : {}) };
  const engine = createTransaction(adapters);
  const locked = operation => engine.state.withGate(record, self, operation);
  const prepare = () => locked(() => engine.prepare(record, candidate, { kind }));
  const activate = () => locked(() => engine.activate(record, self));
  const start = async () => {
    await prepare();
    let journal = await activate();
    journal = await locked(() => engine.requestLaunch(record, journal, self));
    const launched = processes.get(303);
    const processIdentity = { pid: launched.pid, start: launched.start, boot: launched.boot, executable: launched.executable };
    journal = await locked(() => engine.registerLaunch(record, processIdentity, journal.operationId, journal.sequence));
    return { journal, launched: processIdentity };
  };
  return { root, record, candidate, prior, native, engine, calls, processes, adapters, locked, prepare, activate, start, helperIdentity,
    get self() { return self; }, setSelf(value) { self = value; if (!processes.has(value.pid)) processes.set(value.pid, { ...value, ppid: 0 }); },
    setComplete(value) { complete = value; }, setNow(value) { now = value; },
    async writeRecord() { await atomicWrite(recordPath(targetPath), record); },
  };
}
function fakeApp(name) {
  const app = new EventEmitter();
  const calls = [];
  Object.assign(app, { isPackaged: true, calls, getName: () => name,
    setPath: (key, value) => calls.push(['setPath', key, value]), requestSingleInstanceLock: () => { calls.push(['singleton']); return true; },
    releaseSingleInstanceLock: () => calls.push(['releaseSingleton']), exit: code => calls.push(['exit', code]),
    quit: () => { throw new Error('Updater must never quit an app'); }, setName: () => { throw new Error('Updater must not manufacture application identity'); },
  });
  return app;
}
module.exports = { manifest, fixture, identity, writeBundle, legacyIdentity, fakeApp };
