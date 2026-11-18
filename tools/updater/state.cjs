'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { UpdateError, ensure, object, validateProcess, sameProcess, digest, inside, readJson, optionalJson, atomicWrite, syncDirectory, assertNoSymlink, transactionPaths, MAX_RETAINED_OPERATIONS } = require('./contract.cjs');

function annotateRefusal(error, project) {
  // Diagnostic failure must leave the original safety refusal authoritative.
  try { error.refusal = Object.freeze(project()); } catch {}
  return error;
}
function ensureRefusal(condition, message, code, project) {
  try { ensure(condition, message, code); }
  catch (error) { throw annotateRefusal(error, project); }
}
function relation(subject, identity) { return identity ? (sameProcess(subject, identity) ? 'self' : 'other') : 'unknown'; }
function observed(value) { return ['live', 'dead', 'stale'].includes(value) ? value : 'unknown'; }

function writerEvidence(subject, table, roots, record, journal, allowed) {
  try {
    if (table.processes.length > 32768 || roots.length > 6 + 4 * MAX_RETAINED_OPERATIONS) throw new Error('Diagnostic bound');
    const reference = value => { try { return validateProcess(value); } catch { return null; } };
    // Every current production caller supplies self first, or an empty allowed list.
    const references = { self: reference(allowed[0]), helper: reference(journal?.helper), initiating: reference(journal?.initiating) };
    const compare = (row, identity) => ({
      pidEqual: row && identity ? row.pid === identity.pid : null,
      identityEqual: row && identity ? sameProcess(row, identity) : null,
    });
    const classify = row => {
      if (!row) return { executableClass: 'unknown', rootClass: 'unknown' };
      const matches = [...new Set(roots.filter(root => inside(root, row.executable)))].sort((a, b) => b.length - a.length);
      const root = matches[0];
      if (!root) return { executableClass: 'other', rootClass: 'other' };
      const rootClass = root === record.targetPath ? 'target-bundle' : root === record.stateRoot ? 'state-root'
        : journal && [journal.stagePath, journal.priorPath, journal.failedPath, journal.candidate.bundlePath].includes(root) ? 'transaction-bundle' : 'retained-bundle';
      // Path classes describe this scan only; they never exempt a process from exclusion.
      const executableClass = rootClass === 'state-root' ? 'other'
        : row.executable === path.join(root, 'Contents/Resources/app/tools/updater/process-inventory') ? 'inventory'
          : row.executable === path.join(root, 'Contents/MacOS', record.appName) ? 'bundle-main'
            : inside(path.join(root, 'Contents/Frameworks'), row.executable) ? 'framework-child' : 'other';
      return { executableClass, rootClass };
    };
    const project = row => ({ ...classify(row), ...Object.fromEntries(Object.entries(references).map(([key, identity]) => [key, compare(row, identity)])) });
    const parents = Number.isSafeInteger(subject.ppid) && subject.ppid > 0 ? table.processes.filter(row => row.pid === subject.ppid) : [];
    // A unique same-scan row is neither durable parentage nor a new liveness observation.
    const parent = parents.length === 1 ? parents[0] : null;
    return { status: 'available', ...project(subject), parent: { match: parent ? 'unique' : 'unknown', ...project(parent) } };
  } catch { return { status: 'unavailable', reason: 'classification-failed' }; }
}

function createState({ fs: io = fs, native, checkpoint = async () => {}, sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)) }) {
  const json = filename => readJson(filename, { fs: io });
  const optional = filename => optionalJson(filename, { fs: io });
  const write = (filename, value) => atomicWrite(filename, value, { fs: io, checkpoint });
  async function initialize(record) {
    await assertNoSymlink(path.dirname(record.stateRoot), { fs: io });
    await io.mkdir(record.stateRoot, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    await assertNoSymlink(record.stateRoot, { fs: io });
    const stat = await io.stat(record.stateRoot);
    ensure(stat.isDirectory() && (!process.getuid || stat.uid === process.getuid()) && (stat.mode & 0o022) === 0, 'Updater state ownership differs.', 'permission');
  }
  function validateLease(value, record) {
    object(value, ['schemaVersion', 'installationId', 'nonce', 'process'], 'lease');
    ensure(value.schemaVersion === 1 && value.installationId === record.installationId && /^[a-f0-9]{32}$/.test(value.nonce), 'Invalid installation lease.', 'recovery-required');
    validateProcess(value.process);
    return value;
  }
  async function acquireGate(record, identity) {
    validateProcess(identity);
    const directory = path.join(record.stateRoot, 'gate');
    const reaper = path.join(record.stateRoot, 'gate-reconciliation');
    const ownerFile = path.join(directory, 'owner.json');
    const lease = { schemaVersion: 1, installationId: record.installationId, nonce: crypto.randomBytes(16).toString('hex'), process: identity };
    let reaping = false;
    try {
      try { await io.lstat(reaper); throw annotateRefusal(new UpdateError('recovery-required', 'Gate reconciliation requires inspection.'), () => ({ guard: 'gate-reconciliation-present' })); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { await io.mkdir(directory, { mode: 0o700 }); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        await assertNoSymlink(directory, { fs: io });
        const previous = validateLease(await json(ownerFile), record);
        const evidence = await native.observe(previous.process);
        ensureRefusal(evidence === 'dead' || evidence === 'stale', 'Another process owns the installation gate.', evidence === 'live' ? 'busy' : 'recovery-required', () => ({ guard: 'installation-gate-owner', ownerRelation: relation(previous.process, identity), helperRelation: 'unknown', liveness: observed(evidence) }));
        try { await io.mkdir(reaper, { mode: 0o700 }); } catch (failure) { if (failure.code === 'EEXIST') throw annotateRefusal(new UpdateError('busy', 'Gate reconciliation is already running.'), () => ({ guard: 'gate-reconciliation-contended' })); throw failure; }
        reaping = true;
        await write(path.join(reaper, 'owner.json'), lease);
        ensureRefusal(digest(await json(ownerFile)) === digest(previous), 'Gate ownership changed.', 'busy', () => ({ guard: 'gate-owner-changed' }));
        const evidenceAgain = await native.observe(previous.process);
        ensureRefusal(evidenceAgain === 'dead' || evidenceAgain === 'stale', 'Gate ownership cannot be proved stale.', 'recovery-required', () => ({ guard: 'gate-owner-liveness', ownerRelation: relation(previous.process, identity), helperRelation: 'unknown', liveness: observed(evidenceAgain) }));
        const archive = path.join(record.stateRoot, `abandoned-gate-${previous.nonce}`);
        await io.rename(directory, archive);
        await syncDirectory(record.stateRoot, { fs: io });
        try { await io.mkdir(directory, { mode: 0o700 }); } catch (failure) { if (failure.code === 'EEXIST') throw annotateRefusal(new UpdateError('busy', 'Another bootstrap acquired the gate.'), () => ({ guard: 'gate-acquisition-race' })); throw failure; }
      }
      await write(ownerFile, lease);
      await syncDirectory(record.stateRoot, { fs: io });
    } finally {
      if (reaping) {
        await io.unlink(path.join(reaper, 'owner.json'));
        await io.rmdir(reaper);
        await syncDirectory(record.stateRoot, { fs: io });
      }
    }
    let released = false;
    return {
      lease,
      async release() {
        if (released) return;
        ensure(digest(await json(ownerFile)) === digest(lease), 'Gate ownership changed before release.', 'recovery-required');
        await io.unlink(ownerFile);
        await io.rmdir(directory);
        await syncDirectory(record.stateRoot, { fs: io });
        released = true;
      },
    };
  }
  async function withGate(record, identity, action) {
    let gate;
    for (let attempt = 0; !gate; attempt++) {
      try { gate = await acquireGate(record, identity); } catch (error) {
        if (error.code !== 'busy' || attempt >= 49) throw error;
        await sleep(20);
      }
    }
    let failure;
    try { return await action(gate); } catch (error) { failure = error; throw error; } finally {
      try { await gate.release(); } catch (error) { if (failure) failure.releaseError = error; else throw error; }
    }
  }
  async function session(record) {
    const current = await optional(path.join(record.stateRoot, 'session.json'));
    return current === null ? null : validateLease(current, record);
  }
  async function claimSession(record, identity) {
    const previous = await session(record);
    if (previous !== null && !sameProcess(previous.process, identity)) {
      const evidence = await native.observe(previous.process);
      ensureRefusal(evidence === 'dead' || evidence === 'stale', 'The existing HQ session has not exited.', evidence === 'live' ? 'busy' : 'recovery-required', () => ({ guard: 'session-claim', ownerRelation: relation(previous.process, identity), helperRelation: 'unknown', liveness: observed(evidence), writerRelation: 'session' }));
    }
    const lease = { schemaVersion: 1, installationId: record.installationId, nonce: crypto.randomBytes(16).toString('hex'), process: identity };
    await write(path.join(record.stateRoot, 'session.json'), lease);
    return lease;
  }
  async function releaseSession(record, lease) {
    const current = await session(record);
    if (current === null) return;
    ensure(digest(current) === digest(lease), 'Session ownership changed.', 'recovery-required');
    await io.unlink(path.join(record.stateRoot, 'session.json'));
    await syncDirectory(record.stateRoot, { fs: io });
  }
  async function excludeWriters(record, journal, allowed = []) {
    const table = await native.processTable();
    ensureRefusal(table?.complete === true && typeof table.boot === 'string' && Array.isArray(table.processes), 'Process exclusion evidence is unavailable.', 'recovery-required', () => ({ guard: 'writer-inventory' }));
    const roots = [record.targetPath, record.stateRoot];
    const history = path.join(record.stateRoot, 'history');
    let names;
    try { await assertNoSymlink(history, { fs: io }); names = await io.readdir(history); } catch (error) { if (error.code !== 'ENOENT') throw error; names = []; }
    ensure(names.length <= MAX_RETAINED_OPERATIONS && names.every(name => /^[a-f0-9]{32}\.json$/.test(name)), 'Retained process paths need inspection.', 'recovery-required');
    for (const name of names) {
      const prior = await json(path.join(history, name));
      ensure(prior?.schemaVersion === 1 && prior.installationId === record.installationId && prior.targetPath === record.targetPath && prior.operationId === name.slice(0, -5), 'Retained installation identity differs.', 'recovery-required');
      const retained = transactionPaths(record, prior.operationId);
      ensure(Object.keys(retained).every(key => prior[key] === retained[key]), 'Retained bundle path differs.', 'recovery-required');
      roots.push(...Object.values(retained));
    }
    if (journal) roots.push(journal.stagePath, journal.priorPath, journal.failedPath, journal.candidate.bundlePath);
    const sessionLease = await session(record);
    const descendants = new Set();
    for (const process of table.processes) {
      validateProcess({ pid: process.pid, start: process.start, boot: process.boot, executable: process.executable });
      if (roots.some(root => inside(root, process.executable)) || (sessionLease && sameProcess(sessionLease.process, process))) descendants.add(process.pid);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const process of table.processes) if (descendants.has(process.ppid) && !descendants.has(process.pid)) { descendants.add(process.pid); changed = true; }
    }
    for (const process of table.processes) if (descendants.has(process.pid)) ensureRefusal(allowed.some(identity => sameProcess(identity, process)), 'A live HQ app or helper blocks replacement.', 'busy', () => ({
      guard: 'writer-process', ownerRelation: allowed.length ? 'other' : 'unknown',
      helperRelation: journal?.helper ? (sameProcess(process, journal.helper) ? 'helper' : 'other') : 'unknown',
      liveness: 'live', writerRelation: roots.some(root => inside(root, process.executable)) ? 'owned-root' : sessionLease && sameProcess(sessionLease.process, process) ? 'session' : 'descendant',
      writerEvidence: writerEvidence(process, table, roots, record, journal, allowed),
    }));
    if (sessionLease && !allowed.some(identity => sameProcess(identity, sessionLease.process))) {
      const evidence = await native.observe(sessionLease.process);
      ensureRefusal(evidence === 'dead' || evidence === 'stale', 'A session lease cannot be proved inactive.', evidence === 'live' ? 'busy' : 'recovery-required', () => ({ guard: 'writer-session', ownerRelation: allowed.length ? 'other' : 'unknown', helperRelation: journal?.helper ? (sameProcess(sessionLease.process, journal.helper) ? 'helper' : 'other') : 'unknown', liveness: observed(evidence), writerRelation: 'session' }));
    }
    return table;
  }
  return { fs: io, initialize, json, optional, write, acquireGate, withGate, session, claimSession, releaseSession, excludeWriters };
}
module.exports = { createState, annotateRefusal, ensureRefusal };
