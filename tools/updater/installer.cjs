'use strict';

const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createTransaction } = require('./transaction.cjs');
const { ensure, UpdateError, absolute, inside, digest, canonical, candidateId, validateInstallation, validatePreparedCandidate, validateLegacy, receiptOf, recordPath, readJson, assertNoSymlink, syncDirectory } = require('./contract.cjs');

async function makeDirectory(directory, io) {
  const parent = path.dirname(directory);
  if (parent === directory) return;
  try {
    const stat = await io.lstat(directory);
    ensure(stat.isDirectory() && !stat.isSymbolicLink(), 'Installation directory is not a plain directory.', 'permission');
    await assertNoSymlink(directory, { fs: io });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await makeDirectory(parent, io);
    await io.mkdir(directory, { mode: 0o700 });
    await syncDirectory(parent, { fs: io });
  }
}
async function prepareInstallation({ record, candidate, mode, expectedLegacy }, adapters = {}) {
  record = validateInstallation(record);
  candidate = validatePreparedCandidate(candidate, { synthetic: record.synthetic });
  ensure(mode === 'fresh' || mode === 'adopt', 'Select a fresh installation or exact legacy adoption.');
  ensure(mode === 'fresh' ? record.installed.kind !== 'legacy' && canonical(record.installed) === canonical(receiptOf(candidate.manifest)) && record.profileCreation === 'allowed-until-first-health' : record.installed.kind === 'legacy' && record.compatibilityEpoch === 'unknown', 'Installer mode does not match the record.');
  if (mode === 'adopt') ensure(canonical(validateLegacy(expectedLegacy)) === canonical(record.installed), 'Expected legacy source identity differs.', 'stale-candidate');
  const engine = createTransaction(adapters);
  const { state, native } = engine;
  native.supported();
  ensure(record.synthetic || typeof adapters.verifyCandidate === 'function', 'Independently authenticated installer input is required.', 'provenance');
  if (adapters.verifyCandidate) {
    const verified = validatePreparedCandidate(await adapters.verifyCandidate(candidate, record), { synthetic: record.synthetic });
    ensure(verified.candidateId === candidate.candidateId && verified.bundlePath === candidate.bundlePath, 'Independently verified candidate differs.', 'stale-candidate');
  }
  await native.verifyBundle(candidate.bundlePath, receiptOf(candidate.manifest));
  await assertNoSymlink(path.dirname(record.targetPath), { fs: state.fs });
  await assertNoSymlink(recordPath(record.targetPath), { fs: state.fs, missingLeaf: true });
  ensure(await state.optional(recordPath(record.targetPath)) === null, 'An installation record already exists; inspect it before retry.', 'recovery-required');
  await state.initialize(record);
  const self = await native.identity();
  return state.withGate(record, self, async () => {
    await state.excludeWriters(record, null, [self]);
    await native.checkTarget(record, candidate.manifest.archive.expandedSize * 2 + 64 * 1024 * 1024);
    if (mode === 'adopt') await native.verifyLegacy(record.targetPath, expectedLegacy, record);
    else {
      try { await state.fs.lstat(record.targetPath); throw new UpdateError('recovery-required', 'Fresh target already exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      for (const pin of [record.userData, record.sessionData]) {
        try { await state.fs.lstat(pin); throw new UpdateError('recovery-required', 'Fresh profile already exists.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
    await state.write(recordPath(record.targetPath), record);
    const journal = await engine.prepare(record, candidate, { kind: mode, initiating: self });
    return { record, journal };
  });
}
async function activatePrepared(record, adapters = {}) {
  record = validateInstallation(record);
  const engine = createTransaction(adapters);
  const self = await engine.native.identity();
  return engine.state.withGate(record, self, async () => {
    const journal = await engine.read(record);
    ensure(journal && journal.state === 'prepared' && journal.initiating && require('./contract.cjs').sameProcess(journal.initiating, self), 'Prepared installer ownership differs.', 'recovery-required');
    await engine.native.verifyBundle(journal.candidate.bundlePath, receiptOf(journal.candidate.manifest));
    await engine.native.spawnHelper(record, journal.candidate, journal.operationId);
    return { state: 'handoff', operationId: journal.operationId, sequence: journal.sequence, recordPath: recordPath(record.targetPath) };
  });
}
async function inspectInstallation(record, adapters = {}) {
  record = validateInstallation(record);
  const engine = createTransaction(adapters);
  const journal = await engine.read(record);
  return { installationId: record.installationId, targetPath: record.targetPath, stateRoot: record.stateRoot, installed: record.installed, transaction: journal === null ? null : { operationId: journal.operationId, sequence: journal.sequence, state: journal.state, profileOpened: journal.profileOpened, reason: journal.reason, priorPath: journal.priorPath, failedPath: journal.failedPath }, recovery: engine.publicRecovery(journal) };
}
async function recoverInstallation(record, { operationId, expectedSequence }, adapters = {}) {
  record = validateInstallation(record);
  const engine = createTransaction(adapters);
  const self = await engine.native.identity();
  ensure(!inside(record.targetPath, self.executable), 'Recovery must run outside the target app bundle.', 'recovery-required');
  return engine.state.withGate(record, self, () => engine.recover(record, self, { operationId, expectedSequence }));
}
function parseArguments(argv) {
  const [command, ...tail] = argv;
  ensure(['fresh', 'adopt', 'inspect', 'reconcile'].includes(command), 'Expected fresh, adopt, inspect or reconcile.');
  const allowed = { fresh: ['channel', 'target'], adopt: ['input'], inspect: ['target'], reconcile: ['target', 'operation', 'sequence'] }[command];
  const args = {};
  ensure(tail.length % 2 === 0, 'Installer arguments must be name/value pairs.');
  for (let i = 0; i < tail.length; i += 2) {
    const key = tail[i].startsWith('--') ? tail[i].slice(2) : '';
    ensure(allowed.includes(key) && !(key in args) && typeof tail[i + 1] === 'string' && !tail[i + 1].startsWith('--'), 'Invalid installer argument.');
    args[key] = tail[i + 1];
  }
  return { command, args };
}
async function releasePreparer() {
  const filename = path.resolve(__dirname, '../../apps/desktop/dist-electron/updates/installer.js');
  const module = await import(pathToFileURL(filename).href);
  ensure(typeof module.prepareRelease === 'function', 'The packaged provenance verifier is unavailable.', 'provenance');
  return module.prepareRelease;
}
async function cli(argv = process.argv.slice(2), adapters = {}) {
  const { command, args } = parseArguments(argv);
  const engine = createTransaction(adapters);
  if (command === 'inspect' || command === 'reconcile') {
    const target = absolute(args.target, 'target');
    const record = validateInstallation(await readJson(recordPath(target), { fs: engine.state.fs }));
    ensure(record.targetPath === target, 'Installer record target differs.');
    if (command === 'inspect') return inspectInstallation(record, adapters);
    ensure(/^[a-f0-9]{32}$/.test(args.operation) && /^[1-9][0-9]*$/.test(args.sequence), 'Exact operation and sequence are required.');
    return recoverInstallation(record, { operationId: args.operation, expectedSequence: Number(args.sequence) }, adapters);
  }
  engine.native.supported();
  const prepareRelease = adapters.prepareRelease ?? await releasePreparer();
  if (command === 'adopt') {
    absolute(args.input, 'operator metadata file');
    const input = await readJson(args.input, { fs: engine.state.fs });
    require('./contract.cjs').object(input, ['record', 'candidate', 'expectedLegacy'], 'adoption metadata');
    const record = validateInstallation(input.record);
    ensure(!record.synthetic, 'The public installer does not accept synthetic overrides.');
    const candidate = validatePreparedCandidate(input.candidate);
    const verifyCandidate = async () => {
      const verified = await prepareRelease({ stateRoot: record.stateRoot, channel: record.channel, architecture: candidate.manifest.architecture });
      ensure(verified.candidateId === candidate.candidateId, 'The selected legacy-adoption release changed.', 'stale-candidate');
      return verified;
    };
    await prepareInstallation({ ...input, mode: 'adopt' }, { ...adapters, verifyCandidate });
    return activatePrepared(record, adapters);
  }
  ensure(!args.channel || ['preview', 'stable'].includes(args.channel), 'Invalid installation channel.');
  const home = absolute(adapters.home ?? os.homedir(), 'home directory');
  const target = absolute(args.target ?? path.join(home, 'Applications/HQ.app'), 'target');
  ensure(inside(home, target) && target.endsWith('.app'), 'Fresh installation is limited to an explicit per-user app target.', 'permission');
  await assertNoSymlink(target, { fs: engine.state.fs, missingLeaf: true }).catch(error => { if (error.code !== 'ENOENT') throw error; });
  try { await engine.state.fs.lstat(target); throw new UpdateError('recovery-required', 'Fresh target already exists; adoption requires exact metadata.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  ensure(await engine.state.optional(recordPath(target)) === null, 'An installation record already exists; inspect it first.', 'recovery-required');
  const installationId = crypto.randomUUID();
  const support = path.join(home, 'Library/Application Support');
  const stateRoot = path.join(support, 'HQ Updater', installationId);
  const profileRoot = path.join(support, 'HQ Profiles', installationId);
  await makeDirectory(path.dirname(target), engine.state.fs);
  await makeDirectory(stateRoot, engine.state.fs);
  const candidate = validatePreparedCandidate(await prepareRelease({ stateRoot, channel: args.channel ?? 'preview', architecture: engine.native.architecture }));
  const record = validateInstallation({ schemaVersion: 1, product: 'hq', installationId, targetPath: target, stateRoot, userData: path.join(profileRoot, 'userData'), sessionData: path.join(profileRoot, 'sessionData'), appName: 'HQ', bundleId: 'org.jones-systems.hq.local', channel: candidate.manifest.channel, compatibilityEpoch: candidate.manifest.compatibilityEpoch, profileCreation: 'allowed-until-first-health', synthetic: false, installed: receiptOf(candidate.manifest) });
  await prepareInstallation({ record, candidate, mode: 'fresh' }, { ...adapters, verifyCandidate: async () => candidate });
  const result = await activatePrepared(record, adapters);
  return { ...result, targetPath: target, stateRoot, message: 'HQ will start after this installer exits. Keep the installation record and recovery cache.' };
}
if (require.main === module) cli().then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`), error => { process.stderr.write(`HQ installation held (${error.code ?? 'recovery-required'}). No running app is stopped. Inspect the exact installation record before retry.\n`); process.exitCode = 1; });
module.exports = { prepareInstallation, activatePrepared, inspectInstallation, recoverInstallation, parseArguments, cli };
