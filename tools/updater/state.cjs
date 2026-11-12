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
