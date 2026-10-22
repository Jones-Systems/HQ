'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { createNativeAdapter } = require('./native.cjs');
const { createState } = require('./state.cjs');
const { UpdateError, ensure, object, validateInstallation, validatePreparedCandidate, validateProcess, validateLegacy, validateBuildReceipt, sameProcess, candidateId, canonical, digest, clone, receiptOf, inside, absolute, recordPath, assertNoSymlink, syncDirectory, transactionPaths, MAX_RETAINED_OPERATIONS } = require('./contract.cjs');

const STATES = ['prepared', 'staged', 'prior-retained', 'replacement-installed', 'awaiting-health', 'committed', 'restored', 'held'];
const TERMINAL = ['committed', 'restored'];
function binding(record) {
  return digest(Object.fromEntries(['installationId', 'targetPath', 'stateRoot', 'userData', 'sessionData', 'appName', 'bundleId', 'channel', 'synthetic'].map(key => [key, record[key]])));
}
const paths = transactionPaths;
function validateJournal(value, record) {
  const keys = ['schemaVersion', 'installationId', 'binding', 'operationId', 'sequence', 'state', 'resumeState', 'kind', 'candidate', 'prior', 'priorEpoch', 'targetPath', 'stagePath', 'priorPath', 'failedPath', 'initiating', 'helper', 'launch', 'profileOpened', 'launchAttempted', 'health', 'deadline', 'reason'];
  if (value && Object.hasOwn(value, 'consentId')) keys.push('consentId');
  object(value, keys, 'transaction journal');
  ensure(value.schemaVersion === 1 && value.installationId === record.installationId && value.binding === binding(record), 'Transaction binding differs.', 'recovery-required');
  ensure(typeof value.operationId === 'string' && /^[a-f0-9]{32}$/.test(value.operationId) && Number.isSafeInteger(value.sequence) && value.sequence > 0 && STATES.includes(value.state), 'Invalid transaction sequence or state.', 'recovery-required');
  ensure(value.resumeState === null || STATES.filter(state => state !== 'held').includes(value.resumeState), 'Invalid recovery phase.', 'recovery-required');
  ensure((value.state === 'held') === (value.resumeState !== null), 'Invalid held transaction.', 'recovery-required');
  ensure(['fresh', 'adopt', 'update'].includes(value.kind), 'Invalid transaction kind.', 'recovery-required');
  ensure(value.consentId === undefined || (value.kind === 'update' && typeof value.consentId === 'string' && /^[a-f0-9]{32}$/.test(value.consentId)), 'Invalid transaction consent binding.', 'recovery-required');
  validatePreparedCandidate(value.candidate, { synthetic: record.synthetic });
  ensure(inside(record.stateRoot, value.candidate.bundlePath), 'Candidate is outside installation-owned storage.', 'recovery-required');
  if (value.prior !== null) {
    if (value.prior.kind === 'legacy') validateLegacy(value.prior); else validateBuildReceipt(value.prior, { synthetic: record.synthetic });
  }
  ensure((value.kind === 'fresh') === (value.prior === null), 'Invalid prior bundle identity.', 'recovery-required');
  ensure(typeof value.priorEpoch === 'string', 'Invalid prior compatibility epoch.', 'recovery-required');
  if (value.prior?.kind === 'legacy') ensure(value.kind === 'adopt' && value.priorEpoch === 'unknown', 'Legacy recovery compatibility is unknown.', 'recovery-required');
  else if (value.prior !== null) ensure(value.kind === 'update' && value.priorEpoch === value.prior.compatibilityEpoch && value.priorEpoch === value.candidate.manifest.compatibilityEpoch && value.prior.buildSequence < value.candidate.manifest.buildSequence, 'Prior build compatibility differs.', 'recovery-required');
  else ensure(value.priorEpoch === value.candidate.manifest.compatibilityEpoch, 'Fresh compatibility epoch differs.', 'recovery-required');
  const expectedInstalled = value.prior ?? receiptOf(value.candidate.manifest);
  ensure(canonical(record.installed) === canonical(expectedInstalled) || (value.state === 'committed' && canonical(record.installed) === canonical(receiptOf(value.candidate.manifest))), 'Recorded current build differs from the transaction.', 'recovery-required');
  const expected = paths(record, value.operationId);
  ensure(value.targetPath === record.targetPath && Object.keys(expected).every(key => expected[key] === value[key]), 'Unexpected transaction paths.', 'recovery-required');
  for (const key of ['initiating', 'helper', 'launch']) if (value[key] !== null) validateProcess(value[key]);
  ensure(typeof value.profileOpened === 'boolean' && typeof value.launchAttempted === 'boolean' && Number.isSafeInteger(value.deadline) && value.deadline >= 0, 'Invalid launch state.', 'recovery-required');
  ensure(value.reason === null || ['live-process', 'unknown-process', 'unknown-effect', 'health-timeout', 'incompatible-recovery', 'unexpected-identity'].includes(value.reason), 'Invalid recovery reason.', 'recovery-required');
  ensure(value.launch === null || (value.launchAttempted && value.helper !== null), 'Unbound candidate process.', 'recovery-required');
  ensure(!value.profileOpened || value.launch !== null, 'Profile-opened lacks an exact launch process.', 'recovery-required');
  ensure(value.state !== 'committed' || value.health !== null, 'Committed transaction lacks health.', 'recovery-required');
  ensure(value.state !== 'restored' || value.prior !== null, 'Restored transaction lacks a prior bundle.', 'recovery-required');
  if (value.health !== null) validateHealth(value.health, value);
  return value;
}
function validateHealth(value, journal) {
  object(value, ['schemaVersion', 'operationId', 'candidateId', 'sequence', 'process', 'main', 'renderer'], 'health receipt');
  ensure(value.schemaVersion === 1 && value.operationId === journal.operationId && value.candidateId === journal.candidate.candidateId && Number.isSafeInteger(value.sequence) && value.sequence > 0 && value.main === true && value.renderer === true, 'Health receipt binding differs.', 'recovery-required');
  validateProcess(value.process);
  ensure(journal.launch !== null && sameProcess(value.process, journal.launch) && journal.profileOpened, 'Health process identity differs.', 'recovery-required');
  return value;
}
function createTransaction({ native = createNativeAdapter(), clock = Date.now, checkpoint = async () => {}, ...options } = {}) {
  const state = createState({ ...options, native, checkpoint });
  const io = state.fs;
  const journalFile = record => path.join(record.stateRoot, 'transaction.json');
  const healthFile = record => path.join(record.stateRoot, 'health.json');
  async function read(record) {
    const current = await state.optional(journalFile(record));
    return current === null ? null : validateJournal(current, record);
  }
  async function save(record, expected, changes) {
    const current = await read(record);
    ensure(current !== null && current.operationId === expected.operationId && current.sequence === expected.sequence && digest(current) === digest(expected), 'Transaction sequence changed.', 'stale-candidate');
    const next = validateJournal({ ...current, ...changes, sequence: current.sequence + 1 }, record);
    await state.write(journalFile(record), next);
    await checkpoint(next.state, clone(next));
    return next;
  }
  function admit(record, candidate, kind = 'update') {
    validateInstallation(record);
    validatePreparedCandidate(candidate, { synthetic: record.synthetic });
    ensure(inside(record.stateRoot, candidate.bundlePath), 'Candidate must stay in installation-owned storage.');
    ensure(candidate.manifest.channel === record.channel && candidate.manifest.appName === record.appName && candidate.manifest.bundleId === record.bundleId, 'Candidate installation identity differs.', 'incompatible');
    if (record.installed.kind !== 'legacy') {
      ensure(candidate.manifest.architecture === record.installed.architecture, 'Candidate architecture differs.', 'incompatible');
      ensure(candidate.manifest.compatibilityEpoch === record.compatibilityEpoch, 'Candidate profile epoch differs.', 'incompatible');
      ensure(kind === 'fresh' || candidate.manifest.buildSequence > record.installed.buildSequence, 'Candidate is not a newer build.', 'stale-candidate');
    } else ensure(kind === 'adopt', 'Legacy adoption requires a prepared installer operation.', 'incompatible');
  }
  async function verifyIdentity(bundlePath, expected, record) {
    if (expected.kind === 'legacy') return native.verifyLegacy(bundlePath, expected, record);
    return native.verifyBundle(bundlePath, expected);
  }
  async function absent(bundlePath) {
    try { await io.lstat(bundlePath); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
  }
  async function exact(bundlePath, expected, record) {
    ensure(!await absent(bundlePath), 'Expected bundle is missing.', 'recovery-required');
    await assertNoSymlink(bundlePath, { fs: io });
    await verifyIdentity(bundlePath, expected, record);
    return true;
  }
  async function archiveTerminal(record, previous) {
    if (previous === null) return;
    ensure(TERMINAL.includes(previous.state), 'An existing transaction requires recovery.', 'recovery-required');
    const directory = path.join(record.stateRoot, 'history');
    await io.mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await assertNoSymlink(directory, { fs: io });
    const names = await io.readdir(directory);
    ensure(names.every(name => /^[a-f0-9]{32}\.json$/.test(name)) && names.length <= MAX_RETAINED_OPERATIONS && (names.includes(`${previous.operationId}.json`) || names.length < MAX_RETAINED_OPERATIONS), 'Retained recovery artifacts reached their bounded limit.', 'space');
    const archive = path.join(directory, `${previous.operationId}.json`);
    const existing = await state.optional(archive);
    ensure(existing === null || digest(existing) === digest(previous), 'Retained operation identity differs.', 'recovery-required');
    if (!existing) await state.write(archive, previous);
  }
  async function prepare(record, candidate, { kind = 'update', initiating = null, consentId = null } = {}) {
    admit(record, candidate, kind);
    if (initiating) validateProcess(initiating);
    await native.verifyBundle(candidate.bundlePath, receiptOf(candidate.manifest));
    if (kind === 'fresh') ensure(await absent(record.targetPath), 'Fresh installation target already exists.', 'recovery-required');
    else await verifyIdentity(record.targetPath, record.installed, record);
    await archiveTerminal(record, await read(record));
    const operationId = crypto.randomBytes(16).toString('hex');
    const journal = {
      schemaVersion: 1, installationId: record.installationId, binding: binding(record), operationId, sequence: 1,
      state: 'prepared', resumeState: null, kind, candidate: clone(candidate), prior: kind === 'fresh' ? null : clone(record.installed),
      priorEpoch: record.compatibilityEpoch, targetPath: record.targetPath, ...paths(record, operationId),
      initiating, helper: null, launch: null, profileOpened: false, launchAttempted: false, health: null, deadline: 0, reason: null,
      ...(consentId === null ? {} : { consentId }),
    };
    for (const filename of [journal.stagePath, journal.priorPath, journal.failedPath]) ensure(await absent(filename), 'Transaction staging path already exists.', 'recovery-required');
    await state.write(journalFile(record), validateJournal(journal, record));
    await checkpoint('prepared', clone(journal));
    return journal;
  }
  async function hold(record, journal, reason) {
    if (TERMINAL.includes(journal.state)) return journal;
    return save(record, journal, { state: 'held', resumeState: journal.resumeState ?? journal.state, reason });
  }
  async function rename(record, journal, from, to, label, self, beforeRename = async () => {}) {
    await state.excludeWriters(record, journal, self ? [self] : []);
    await assertNoSymlink(from, { fs: io });
    ensure(await absent(to), 'Rename destination already exists.', 'recovery-required');
    const fromParent = await io.stat(path.dirname(from));
    const toParent = await io.stat(path.dirname(to));
    ensure(fromParent.dev === toParent.dev, 'Replacement must stay on the target filesystem.', 'recovery-required');
    await checkpoint(`before-${label}`, clone(journal));
    await beforeRename();
    await io.rename(from, to);
    await checkpoint(`after-${label}`, clone(journal));
    await syncDirectory(path.dirname(to), { fs: io });
    if (path.dirname(from) !== path.dirname(to)) await syncDirectory(path.dirname(from), { fs: io });
  }
  async function resume(record, journal) {
    if (journal.state !== 'held') return journal;
    return save(record, journal, { state: journal.resumeState, resumeState: null, reason: null });
  }
  const stageClaimFile = (record, journal) => path.join(record.stateRoot, `stage-${journal.operationId}.json`);
  function stageBinding(record, journal) {
    return digest({ installation: binding(record), operationId: journal.operationId, candidate: journal.candidate, prior: journal.prior, targetPath: journal.targetPath, ...paths(record, journal.operationId) });
  }
  function fileIdentity(stat) { return { dev: String(stat.dev), ino: String(stat.ino), uid: String(stat.uid) }; }
  function validateFileIdentity(value) {
    object(value, ['dev', 'ino', 'uid'], 'stage filesystem identity');
    ensure(Object.values(value).every(part => typeof part === 'string' && /^[0-9]{1,24}$/.test(part)), 'Invalid stage filesystem identity.', 'recovery-required');
  }
  function validateStageClaim(value, record, journal) {
    object(value, ['schemaVersion', 'binding', 'phase', 'parent', 'partial'], 'stage ownership record');
    ensure(value.schemaVersion === 1 && value.binding === stageBinding(record, journal) && ['copying', 'quarantining', 'retrying'].includes(value.phase), 'Stage ownership binding differs.', 'recovery-required');
    validateFileIdentity(value.parent);
    ensure(value.parent.uid === String(process.getuid()), 'Stage owner differs.', 'recovery-required');
    if (value.partial !== null) validateFileIdentity(value.partial);
    ensure((value.phase === 'copying') === (value.partial === null), 'Stage recovery identity is incomplete.', 'recovery-required');
    ensure(value.phase !== 'retrying' || journal.kind === 'fresh', 'Only fresh preparation may retry a quarantined stage.', 'recovery-required');
    return value;
  }
  async function stageParent(record, claim) {
    const parentPath = path.dirname(record.targetPath);
    await assertNoSymlink(parentPath, { fs: io });
    const parent = await io.lstat(parentPath, { bigint: true });
    ensure(parent.isDirectory() && String(parent.uid) === String(process.getuid()), 'Stage parent ownership differs.', 'recovery-required');
    const identity = fileIdentity(parent);
    if (claim) ensure(canonical(identity) === canonical(claim.parent), 'Stage parent identity changed.', 'recovery-required');
    return identity;
  }
  async function ownedStage(record, filename, claim, expected = null) {
    await stageParent(record, claim);
    await assertNoSymlink(filename, { fs: io });
    const stat = await io.lstat(filename, { bigint: true });
    const identity = fileIdentity(stat);
    ensure(stat.isDirectory() && identity.uid === claim.parent.uid && identity.dev === claim.parent.dev, 'Partial stage ownership differs.', 'recovery-required');
    if (expected) ensure(canonical(identity) === canonical(expected), 'Partial stage filesystem identity changed.', 'recovery-required');
    return identity;
  }
  async function untouchedTarget(record, journal) {
    if (journal.prior) await exact(record.targetPath, journal.prior, record);
    else ensure(await absent(record.targetPath), 'Fresh target is no longer absent.', 'recovery-required');
    ensure(await absent(journal.priorPath), 'Prior retention has an unknown effect.', 'recovery-required');
  }
  async function readStageClaim(record, journal) {
    const claim = await state.optional(stageClaimFile(record, journal));
    return claim === null ? null : validateStageClaim(claim, record, journal);
  }
  async function claimStageCopy(record, journal, claim) {
    if (claim !== null) { await stageParent(record, claim); return claim; }
    ensure(await absent(journal.stagePath) && await absent(journal.failedPath), 'Stage preparation is not uniquely absent.', 'recovery-required');
    claim = { schemaVersion: 1, binding: stageBinding(record, journal), phase: 'copying', parent: await stageParent(record), partial: null };
    await state.write(stageClaimFile(record, journal), claim);
    return claim;
  }
  async function quarantineStage(record, journal, self, claim) {
    ensure(claim !== null, 'Partial stage lacks durable ownership evidence.', 'recovery-required');
    await untouchedTarget(record, journal);
    await state.excludeWriters(record, journal, [self]);
    if (claim.phase === 'retrying') return { journal: await hold(record, journal, 'unknown-effect'), claim };
    if (claim.phase === 'copying') {
      ensure(await absent(journal.failedPath), 'Partial-stage quarantine is already occupied.', 'recovery-required');
      claim = { ...claim, phase: 'quarantining', partial: await ownedStage(record, journal.stagePath, claim) };
      // The inode-bound intent precedes the rename so interruption cannot make a retry guess.
      await state.write(stageClaimFile(record, journal), claim);
      await checkpoint('stage-quarantine-recorded', clone(journal));
    }
    const stageExists = !await absent(journal.stagePath);
    const failedExists = !await absent(journal.failedPath);
    ensure(stageExists !== failedExists, 'Partial-stage quarantine effect is unknown.', 'recovery-required');
    if (stageExists) {
      await rename(record, journal, journal.stagePath, journal.failedPath, 'quarantine-stage', self, async () => {
        ensure(digest(await read(record)) === digest(journal), 'Stage transaction changed.', 'stale-candidate');
        await untouchedTarget(record, journal);
        await ownedStage(record, journal.stagePath, claim, claim.partial);
        ensure(await absent(journal.failedPath), 'Partial-stage quarantine is already occupied.', 'recovery-required');
      });
    } else await ownedStage(record, journal.failedPath, claim, claim.partial);
    await syncDirectory(path.dirname(journal.failedPath), { fs: io });
    await untouchedTarget(record, journal);
    if (journal.prior) return { journal: await save(record, journal, { state: 'restored', resumeState: null, reason: null }), claim };
    // Fresh recovery keeps its one quarantine slot; a second partial copy or failed health must hold.
    claim = { ...claim, phase: 'retrying' };
    await state.write(stageClaimFile(record, journal), claim);
    await checkpoint('stage-retry-ready', clone(journal));
    return { journal, claim };
  }
  async function activate(record, self) {
    let journal = await read(record);
    ensure(journal && !TERMINAL.includes(journal.state), 'No prepared transaction is available.', 'recovery-required');
    if (journal.initiating) {
      const evidence = await native.observe(journal.initiating);
      if (!['dead', 'stale'].includes(evidence)) return hold(record, journal, evidence === 'live' ? 'live-process' : 'unknown-process');
    }
    if (journal.helper && !sameProcess(journal.helper, self)) {
      const evidence = await native.observe(journal.helper);
      if (!['dead', 'stale'].includes(evidence)) return hold(record, journal, evidence === 'live' ? 'live-process' : 'unknown-process');
    }
    await state.excludeWriters(record, journal, [self]);
    if (!journal.helper || !sameProcess(journal.helper, self)) journal = await save(record, journal, { helper: self });
    journal = await resume(record, journal);
    await native.verifyBundle(journal.candidate.bundlePath, receiptOf(journal.candidate.manifest));
    await native.checkTarget(record, 0);
    const receipt = receiptOf(journal.candidate.manifest);
    if (journal.state === 'prepared') {
      await untouchedTarget(record, journal);
      let claim = await readStageClaim(record, journal);
      if (claim?.phase === 'quarantining') ({ journal, claim } = await quarantineStage(record, journal, self, claim));
      if (journal.state !== 'prepared') return journal;
      if (claim?.phase === 'retrying') await ownedStage(record, journal.failedPath, claim, claim.partial);
      else ensure(await absent(journal.failedPath), 'Partial-stage quarantine is unexpectedly occupied.', 'recovery-required');
      if (!await absent(journal.stagePath)) {
        try { await exact(journal.stagePath, receipt, record); } catch (error) {
          if (!['ENOENT', 'ENOTDIR', 'integrity', 'invalid'].includes(error.code)) throw error;
          ({ journal, claim } = await quarantineStage(record, journal, self, claim));
          if (journal.state !== 'prepared') return journal;
        }
      }
      if (await absent(journal.stagePath)) {
        claim = await claimStageCopy(record, journal, claim);
        await state.excludeWriters(record, journal, [self]);
        await untouchedTarget(record, journal);
        await checkpoint('before-stage-copy', clone(journal));
        await stageParent(record, claim);
        ensure(await absent(journal.stagePath), 'Stage destination changed before copying.', 'recovery-required');
        await native.checkTarget(record, journal.candidate.manifest.archive.expandedSize * 2 + 64 * 1024 * 1024);
        await native.copyBundle(journal.candidate.bundlePath, journal.stagePath);
        await checkpoint('after-stage-copy', clone(journal));
      }
      await exact(journal.stagePath, receipt, record);
      journal = await save(record, journal, { state: 'staged' });
    }
    if (journal.state === 'staged') {
      await exact(journal.stagePath, receipt, record);
      if (journal.prior) {
        const priorExists = !await absent(journal.priorPath);
        const targetExists = !await absent(record.targetPath);
        ensure(priorExists !== targetExists, 'Prior-retention effect is unknown.', 'recovery-required');
        if (priorExists) await exact(journal.priorPath, journal.prior, record);
        else {
          await exact(record.targetPath, journal.prior, record);
          await rename(record, journal, record.targetPath, journal.priorPath, 'retain-prior', self);
        }
      } else ensure(await absent(record.targetPath) && await absent(journal.priorPath), 'Fresh target changed.', 'recovery-required');
      journal = await save(record, journal, { state: 'prior-retained' });
    }
    if (journal.state === 'prior-retained') {
      if (journal.prior) await exact(journal.priorPath, journal.prior, record);
      const stageExists = !await absent(journal.stagePath);
      const targetExists = !await absent(record.targetPath);
      ensure(stageExists !== targetExists, 'Replacement effect is unknown.', 'recovery-required');
      if (targetExists) await exact(record.targetPath, receipt, record);
      else {
        await exact(journal.stagePath, receipt, record);
        await rename(record, journal, journal.stagePath, record.targetPath, 'install-replacement', self);
      }
      journal = await save(record, journal, { state: 'replacement-installed' });
    }
    if (journal.state === 'replacement-installed') {
      await exact(record.targetPath, receipt, record);
      journal = await save(record, journal, { state: 'awaiting-health', deadline: clock() + 60000 });
    }
    return journal;
  }
  async function requestLaunch(record, journal, self) {
    ensure(journal.state === 'awaiting-health' && sameProcess(journal.helper, self), 'Helper does not own this launch.', 'recovery-required');
    ensure(!journal.launchAttempted, 'A prior launch result requires reconciliation.', 'recovery-required');
    await state.excludeWriters(record, journal, [self]);
    await exact(record.targetPath, receiptOf(journal.candidate.manifest), record);
    journal = await save(record, journal, { launchAttempted: true });
    await checkpoint('before-launch', clone(journal));
    await native.launch(record, journal);
    await checkpoint('after-launch', clone(journal));
    return journal;
  }
  async function registerLaunch(record, identity, operationId, expectedSequence) {
    let journal = await read(record);
    ensure(journal && journal.operationId === operationId && journal.sequence === expectedSequence && journal.state === 'awaiting-health' && journal.launchAttempted && !journal.profileOpened && journal.launch === null, 'Launch binding or sequence differs.', 'stale-candidate');
    ensure(identity.executable === native.runtimePath(record.targetPath, journal.candidate.manifest), 'Launch executable differs.', 'recovery-required');
    await exact(record.targetPath, receiptOf(journal.candidate.manifest), record);
    const table = await native.processTable();
    const row = table.processes.find(item => sameProcess(item, identity));
    ensure(table.complete && row && journal.helper && row.ppid === journal.helper.pid && await native.observe(journal.helper) === 'live', 'Launch parent identity differs.', 'recovery-required');
    journal = await save(record, journal, { launch: identity, profileOpened: true });
    await checkpoint('profile-opened', clone(journal));
    return journal;
  }
  async function commit(record, journal, receipt) {
    validateHealth(receipt, journal);
    ensure(receipt.sequence === journal.sequence || (journal.state === 'committed' && receipt.sequence === journal.sequence - 1), 'Health sequence differs.', 'stale-candidate');
    await exact(record.targetPath, receiptOf(journal.candidate.manifest), record);
    if (journal.state !== 'committed') journal = await save(record, journal, { state: 'committed', resumeState: null, reason: null, health: receipt });
    const updated = validateInstallation({ ...record, installed: receiptOf(journal.candidate.manifest), compatibilityEpoch: journal.candidate.manifest.compatibilityEpoch, profileCreation: 'forbidden' });
    await state.write(recordPath(record.targetPath), updated);
    await checkpoint('installation-record-committed', clone(journal));
    return { journal, record: updated };
  }
  async function acknowledge(record, identity, operationId, acceptedCandidate) {
    const journal = await read(record);
    ensure(journal && journal.operationId === operationId && journal.candidate.candidateId === acceptedCandidate && sameProcess(journal.launch, identity) && journal.profileOpened, 'Health does not match this transaction.', 'stale-candidate');
    ensure(journal.state === 'awaiting-health' || (journal.state === 'held' && journal.resumeState === 'awaiting-health') || journal.state === 'committed', 'Transaction cannot accept health.', 'recovery-required');
    if (journal.state === 'committed') return commit(record, journal, journal.health);
    // Prove liveness before recording health; a durable exact receipt survives that process's later exit.
    ensure(await native.observe(identity) === 'live', 'Healthy process identity is not live.', 'recovery-required');
    const receipt = { schemaVersion: 1, operationId, candidateId: acceptedCandidate, sequence: journal.sequence, process: identity, main: true, renderer: true };
    await state.write(healthFile(record), receipt);
    await checkpoint('health-receipt', clone(journal));
    return commit(record, journal, receipt);
  }
  async function reconcileHealth(record, journal) {
    if (journal.state === 'committed') return commit(record, journal, journal.health);
    const receipt = await state.optional(healthFile(record));
    if (receipt === null || receipt.operationId !== journal.operationId) return null;
    validateHealth(receipt, journal);
    ensure(receipt.sequence === journal.sequence, 'Recorded health sequence changed.', 'recovery-required');
    return commit(record, journal, receipt);
  }
  async function recover(record, self, { operationId, expectedSequence, timeout = false } = {}) {
    let journal = await read(record);
    ensure(journal && journal.operationId === operationId && journal.sequence === expectedSequence, 'Recovery operation or sequence differs.', 'stale-candidate');
    if (journal.state === 'restored') return journal;
    const healthy = await reconcileHealth(record, journal);
    if (healthy) return healthy.journal;
    if (journal.state === 'committed') return journal;
    if (journal.launch) {
      const evidence = await native.observe(journal.launch);
      if (!['dead', 'stale'].includes(evidence)) return hold(record, journal, evidence === 'live' ? 'health-timeout' : 'unknown-process');
    }
    try { await state.excludeWriters(record, journal, [self]); } catch (error) {
      if (['busy', 'recovery-required'].includes(error.code)) return hold(record, journal, error.code === 'busy' ? 'live-process' : 'unknown-process');
      throw error;
    }
    const phase = journal.resumeState ?? journal.state;
    if (!['awaiting-health', 'replacement-installed'].includes(phase)) return activate(record, self);
    if (journal.profileOpened && journal.priorEpoch === 'unknown') return hold(record, journal, 'incompatible-recovery');
    if (journal.prior === null) return hold(record, journal, timeout ? 'health-timeout' : 'unknown-effect');
    ensure(journal.priorEpoch === 'unknown' || journal.priorEpoch === journal.candidate.manifest.compatibilityEpoch, 'Rollback epoch differs.', 'incompatible');
    const targetExists = !await absent(record.targetPath);
    const failedExists = !await absent(journal.failedPath);
    const priorExists = !await absent(journal.priorPath);
    if (priorExists) {
      await exact(journal.priorPath, journal.prior, record);
      ensure(targetExists !== failedExists, 'Failed-bundle retention effect is unknown.', 'recovery-required');
      if (targetExists) {
        await exact(record.targetPath, receiptOf(journal.candidate.manifest), record);
        await rename(record, journal, record.targetPath, journal.failedPath, 'retain-failed', self);
      } else await exact(journal.failedPath, receiptOf(journal.candidate.manifest), record);
      await rename(record, journal, journal.priorPath, record.targetPath, 'restore-prior', self);
    } else {
      ensure(targetExists && failedExists, 'Prior restoration effect is unknown.', 'recovery-required');
      await exact(record.targetPath, journal.prior, record);
      await exact(journal.failedPath, receiptOf(journal.candidate.manifest), record);
    }
    journal = await save(record, journal, { state: 'restored', resumeState: null, reason: null });
    await state.write(recordPath(record.targetPath), validateInstallation({ ...record, installed: journal.prior, compatibilityEpoch: journal.priorEpoch, profileCreation: 'forbidden' }));
    return journal;
  }
  function publicRecovery(journal) {
    if (!journal || journal.state === 'committed') return null;
    if (journal.state === 'restored') return { state: 'restored', message: 'The prior HQ bundle was restored. Profile files were preserved.' };
    if (journal.state === 'held') return { state: 'held', message: journal.reason === 'incompatible-recovery' ? 'The new app opened the existing profile. Both bundles are retained; compatibility must be checked before recovery.' : 'The update is held. No live app is stopped and profile files are preserved. Use the installer to inspect recovery.' };
    return { state: journal.state, message: 'An HQ update is awaiting startup health. Profile files remain in place.' };
  }
  return { native, state, read, save, prepare, admit, activate, requestLaunch, registerLaunch, acknowledge, reconcileHealth, recover, hold, verifyIdentity, publicRecovery, journalFile, healthFile };
}
async function isCandidateRetained(stateRoot, acceptedId, options = {}) {
  absolute(stateRoot, 'state root');
  ensure(typeof acceptedId === 'string' && /^[a-f0-9]{64}$/.test(acceptedId), 'Invalid candidate ID.');
  const io = options.fs ?? require('node:fs/promises');
  const { optionalJson } = require('./contract.cjs');
  await assertNoSymlink(stateRoot, { fs: io });
  const references = [];
  const active = await optionalJson(path.join(stateRoot, 'transaction.json'), { fs: io });
  if (active !== null) references.push(active);
  const history = path.join(stateRoot, 'history');
  let names;
  try { await assertNoSymlink(history, { fs: io }); names = await io.readdir(history); } catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
  ensure(names.length <= MAX_RETAINED_OPERATIONS && names.every(name => /^[a-f0-9]{32}\.json$/.test(name)), 'Retention metadata needs inspection.', 'recovery-required');
  for (const name of names) references.push(await optionalJson(path.join(history, name), { fs: io }));
  for (const value of references) ensure(value && value.schemaVersion === 1 && typeof value.candidate?.candidateId === 'string' && /^[a-f0-9]{64}$/.test(value.candidate.candidateId), 'Retention metadata is incomplete.', 'recovery-required');
  return references.some(value => value.candidate.candidateId === acceptedId);
}
module.exports = { createTransaction, validateJournal, validateHealth, binding, paths, isCandidateRetained, MAX_RETAINED_OPERATIONS };
