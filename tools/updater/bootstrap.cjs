'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { createTransaction } = require('./transaction.cjs');
const { ensure, UpdateError, object, validateInstallation, validatePreparedCandidate, validateProcess, sameProcess, receiptOf, digest, recordPath, readBuildReceipt, assertNoSymlink, syncDirectory } = require('./contract.cjs');

let context = null;
function getContext() { return context; }
function bundleFromExecutable(executable) {
  const match = executable.match(/^(.*\.app)\/Contents\/MacOS\/[^/]+$/);
  ensure(match, 'Packaged HQ bundle path is unavailable.', 'unavailable');
  return match[1];
}
function validateArguments(argv, environment) {
  ensure(!['HQ_USER_DATA_DIR', 'ELECTRON_USER_DATA_DIR'].some(key => environment[key]), 'Packaged profile overrides are forbidden.', 'invalid');
  ensure(!argv.some(argument => /^--(?:user-data-dir|session-data-dir|profile-directory|disk-cache-dir|hq-synthetic-profile-root)(?:=|$)/.test(argument)), 'Packaged profile arguments are forbidden.', 'invalid');
}
function launchArguments(argv) {
  const operation = argv.filter(arg => arg.startsWith('--hq-update-operation='));
  const sequence = argv.filter(arg => arg.startsWith('--hq-update-sequence='));
  ensure(operation.length <= 1 && sequence.length <= 1 && operation.length === sequence.length, 'Invalid bootstrap launch binding.');
  if (operation.length === 0) return null;
  const operationId = operation[0].slice('--hq-update-operation='.length);
  const expectedSequence = Number(sequence[0].slice('--hq-update-sequence='.length));
  ensure(/^[a-f0-9]{32}$/.test(operationId) && Number.isSafeInteger(expectedSequence) && expectedSequence > 0, 'Invalid bootstrap launch binding.');
  return { operationId, expectedSequence };
}
function validateConsentShape(value) {
  const keys = ['schemaVersion', 'installationId', 'installedId', 'candidate'];
  if (value && Object.hasOwn(value, 'consentId')) keys.push('consentId');
  object(value, keys, 'update consent');
  ensure(value.consentId === undefined || (typeof value.consentId === 'string' && /^[a-f0-9]{32}$/.test(value.consentId)), 'Invalid consent identity.', 'stale-candidate');
  return value;
}
function validateConsent(value, record, engine) {
  validateConsentShape(value);
  ensure(value.schemaVersion === 1 && value.installationId === record.installationId && value.installedId === digest(record.installed), 'Scheduled installation identity changed.', 'stale-candidate');
  engine.admit(record, value.candidate);
  return value;
}
async function run({ app, importMain, bundlePath, adapters = {} }) {
  ensure(app && typeof importMain === 'function', 'Bootstrap dependencies are unavailable.', 'unavailable');
  context = null;
  if (!app.isPackaged && !adapters.allowSynthetic) { await importMain(); return { state: 'development' }; }
  const engine = createTransaction(adapters);
  const { native, state } = engine;
  const argv = adapters.argv ?? process.argv;
  const environment = adapters.environment ?? process.env;
  const target = bundlePath ?? bundleFromExecutable(adapters.executable ?? process.execPath);
  validateArguments(argv, environment);
  const launch = launchArguments(argv);
  await assertNoSymlink(recordPath(target), { fs: state.fs });
  let record = validateInstallation(await state.json(recordPath(target)));
  ensure(record.targetPath === target, 'Installation target does not match this executable.', 'recovery-required');
  ensure(app.getName() === record.appName, 'Effective application identity differs from the installation record.', 'incompatible');
  native.supported();
  await state.initialize(record);
  for (const pin of [record.userData, record.sessionData]) {
    if (record.profileCreation === 'allowed-until-first-health') await state.fs.mkdir(pin, { recursive: true, mode: 0o700 });
    else {
      const stat = await state.fs.stat(pin);
      ensure(stat.isDirectory(), 'A preserved profile binding is unavailable.', 'recovery-required');
    }
  }
  app.setPath('userData', record.userData);
  app.setPath('sessionData', record.sessionData);
  const self = validateProcess(await native.identity());
  let lease = null;
  let ownsSingleton = false;
  let gate;
  let journal;
  let handoff = false;
  const consentFile = path.join(record.stateRoot, 'scheduled.json');
  async function consumeTransactionConsent(current, consent) {
    if (consent === null) return null;
    validateConsentShape(consent);
    const matches = current.kind === 'update' && current.prior !== null
      && (current.consentId ?? null) === (consent.consentId ?? null)
      && consent.installationId === record.installationId
      && consent.installedId === digest(current.prior)
      && digest(consent.candidate) === digest(current.candidate);
    if (!matches) {
      ensure(['committed', 'restored'].includes(current.state), 'Scheduled consent differs from the prepared transaction.', 'stale-candidate');
      return consent;
    }
    validateConsent(consent, { ...record, installed: current.prior, compatibilityEpoch: current.priorEpoch }, engine);
    ensure(digest(await state.json(consentFile)) === digest(consent), 'Scheduled consent changed before consumption.', 'stale-candidate');
    await state.fs.unlink(consentFile);
    await syncDirectory(record.stateRoot, { fs: state.fs });
    return null;
  }
  try {
    gate = await state.acquireGate(record, self);
    journal = await engine.read(record);
    if (journal && (journal.state === 'committed' || journal.state === 'awaiting-health' || (journal.state === 'held' && journal.resumeState === 'awaiting-health'))) {
      const result = await engine.reconcileHealth(record, journal);
      if (result) { record = result.record; journal = result.journal; }
    }
    ownsSingleton = app.requestSingleInstanceLock();
    ensure(ownsSingleton, 'An HQ session already owns this profile.', 'busy');
    if (launch) {
      ensure(journal, 'No update owns this launch.', 'stale-candidate');
      await state.excludeWriters(record, journal, [self, journal.helper].filter(Boolean));
      await consumeTransactionConsent(journal, await state.optional(consentFile));
      lease = await state.claimSession(record, self);
      journal = await engine.registerLaunch(record, self, launch.operationId, launch.expectedSequence);
    } else {
      await state.excludeWriters(record, journal, [self]);
      let consent = await state.optional(consentFile);
      if (journal) consent = await consumeTransactionConsent(journal, consent);
      if (journal && !['committed', 'restored'].includes(journal.state)) {
        if (journal.launch) {
          const evidence = await native.observe(journal.launch);
          ensure(evidence === 'dead' || evidence === 'stale', 'An update is still running or has an unknown process.', 'recovery-required');
        }
        if (journal.state === 'held' && journal.reason === 'incompatible-recovery') throw new UpdateError('recovery-required', 'Legacy profile compatibility requires explicit recovery.');
        await native.verifyBundle(journal.candidate.bundlePath, receiptOf(journal.candidate.manifest));
        journal = await engine.save(record, journal, { initiating: self });
        handoff = true;
      } else if (consent !== null) {
        validateConsent(consent, record, engine);
        journal = await engine.prepare(record, consent.candidate, { initiating: self, consentId: consent.consentId ?? null });
        await consumeTransactionConsent(journal, consent);
        handoff = true;
      } else {
        ensure(!launch, 'Unexpected launch state.');
        await engine.verifyIdentity(record.targetPath, record.installed, record);
        lease = await state.claimSession(record, self);
      }
      if (handoff) {
        await native.spawnHelper(record, journal.candidate, journal.operationId);
        await gate.release();
        gate = null;
        app.releaseSingleInstanceLock();
        ownsSingleton = false;
        // This bootstrap has never imported main or opened a store. The helper still proves its exit before a rename.
        app.exit(0);
        return { state: 'handoff', operationId: journal.operationId };
      }
    }
    await gate.release();
    gate = null;
  } catch (error) {
    if (gate) await gate.release().catch(() => {});
    if (ownsSingleton) app.releaseSingleInstanceLock();
    if (adapters.onHold) await adapters.onHold({ state: 'held', code: error.code ?? 'recovery-required' });
    throw error;
  }
  let disposed = false;
  let mainReady = false;
  let rendererReady = false;
  let healthy = false;
  let healthPromise = null;
  const installed = record.installed.kind === 'legacy' ? null : record.installed;
  async function markReady() {
    ensure(!disposed, 'Bootstrap is disposed.', 'unavailable');
    if (!mainReady || !rendererReady) return false;
    if (healthy) return true;
    if (!healthPromise) healthPromise = state.withGate(record, self, async () => {
      if (launch) {
        const result = await engine.acknowledge(record, self, launch.operationId, journal.candidate.candidateId);
        record = result.record;
        journal = result.journal;
      } else if (record.profileCreation !== 'forbidden') {
        record = validateInstallation({ ...record, profileCreation: 'forbidden' });
        await state.write(recordPath(record.targetPath), record);
      }
      healthy = true;
      return true;
    }).catch(error => { healthPromise = null; throw error; });
    return healthPromise;
  }
  async function dispose() {
    if (disposed) return;
    disposed = true;
    if (healthPromise) await healthPromise.catch(() => {});
    if (lease) await state.withGate(record, self, () => state.releaseSession(record, lease));
    app.removeListener?.('will-quit', onQuit);
  }
  function onQuit() { void dispose().catch(() => {}); }
  context = Object.freeze({
    get record() { return record; },
    get installed() { return launch ? receiptOf(journal.candidate.manifest) : installed; },
    get recovery() { return engine.publicRecovery(journal); },
    async markMainReady() { mainReady = true; return markReady(); },
    async markRendererReady() { rendererReady = true; return markReady(); },
    dispose,
    async schedule(value) {
      ensure(!disposed, 'Bootstrap is disposed.', 'unavailable');
      const candidate = validatePreparedCandidate(value, { synthetic: record.synthetic });
      return state.withGate(record, self, async () => {
        const current = validateInstallation(await state.json(recordPath(record.targetPath)));
        ensure(digest(current) === digest(record), 'Installation changed while accepting the update.', 'stale-candidate');
        const active = await engine.read(record);
        ensure(!active || ['committed', 'restored'].includes(active.state), 'Another transaction needs recovery.', 'recovery-required');
        engine.admit(record, candidate);
        await native.verifyBundle(candidate.bundlePath, receiptOf(candidate.manifest));
        await state.write(path.join(record.stateRoot, 'scheduled.json'), { schemaVersion: 1, installationId: record.installationId, installedId: digest(record.installed), consentId: crypto.randomBytes(16).toString('hex'), candidate });
      });
    },
    async cancelScheduled() {
      ensure(!disposed, 'Bootstrap is disposed.', 'unavailable');
      return state.withGate(record, self, async () => {
        const filename = path.join(record.stateRoot, 'scheduled.json');
        const consent = await state.optional(filename);
        if (consent === null) return;
        validateConsent(consent, record, engine);
        await state.fs.unlink(filename);
        await syncDirectory(record.stateRoot, { fs: state.fs });
      });
    },
  });
  app.on('will-quit', onQuit);
  await importMain();
  return { state: 'running', context };
}
module.exports = { run, getContext, bundleFromExecutable, validateArguments, launchArguments, validateConsent };
