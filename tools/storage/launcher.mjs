import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { integer, sum } from './policy.mjs';
import {
  LOCK_NAME, contains, identity, inspectStorage, requireAdmission, resolveDestination, settings,
} from './admission.mjs';

const contexts = new WeakMap();

function live(context) {
  const state = contexts.get(context);
  if (!state?.active || state.pid !== process.pid || (state.parent && !state.parent.active)) {
    throw new Error('Invalid or expired live parent context');
  }
  state.signal?.throwIfAborted();
  return state;
}

async function acquireLocks(snapshot, timeoutMs, signal) {
  const deadline = performance.now() + timeoutMs;
  const nonce = randomUUID();
  const metadata = JSON.stringify({ nonce, pid: process.pid });
  const held = [];
  const release = async ({ preserve = false } = {}) => {
    const errors = [];
    for (const lock of [...held].reverse()) {
      try {
        if (preserve) continue;
        const current = await fs.lstat(lock.path, { bigint: true });
        if (!current.isFile() || identity(current) !== lock.identity ||
            (lock.written && await fs.readFile(lock.path, 'utf8') !== metadata)) throw new Error(`Lock ownership changed; preserved: ${lock.path}`);
        await fs.unlink(lock.path);
      } catch (error) { errors.push(error); }
      finally { await lock.handle.close().catch(error => errors.push(error)); }
    }
    held.length = 0;
    return errors;
  };
  const resources = [snapshot.worktree, ...snapshot.roots.filter(root => root.kind === 'evidence')]
    .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  try {
    for (const resource of resources) {
      const lockPath = path.join(resource.path, LOCK_NAME);
      for (;;) {
        signal?.throwIfAborted();
        const resolved = await resolveDestination(resource.path, { mustExist: true });
        if (resolved.dev !== resource.dev || resolved.anchors.at(-1).identity !== resource.anchors.at(-1).identity) {
          throw new Error('Lock directory changed');
        }
        if (performance.now() > deadline) throw new Error(`Lock deadline; existing owner requires disposition: ${lockPath}`);
        let handle;
        try { handle = await fs.open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          // Live, stale, unreadable and incomplete locks all remain with their owner.
          await delay(Math.min(25, Math.max(1, deadline - performance.now())), undefined, { signal });
          continue;
        }
        let lockIdentity;
        try { lockIdentity = identity(await handle.stat({ bigint: true })); }
        catch (error) {
          await handle.close();
          throw new Error(`Created lock identity unreadable; preserved: ${lockPath}`, { cause: error });
        }
        const lock = { path: lockPath, handle, identity: lockIdentity };
        held.push(lock);
        await handle.writeFile(metadata);
        lock.written = true;
        await handle.sync();
        if (performance.now() > deadline) throw new Error(`Lock deadline exceeded: ${lockPath}`);
        break;
      }
    }
    return release;
  } catch (error) {
    error.cleanupErrors = await release();
    throw error;
  }
}

async function recheck(state, prospective = false) {
  const top = state.top ?? state;
  const snapshot = await inspectStorage(top.plan, { testContext: top.testContext, previous: top.snapshot });
  requireAdmission(snapshot, top.policy, { prospective });
  top.snapshot = snapshot;
  return snapshot;
}

function serialize(state, operation) {
  if (state.busy) {
    const error = new Error('Invocation operations must be awaited serially');
    (state.failures ??= []).push(error.message);
    const rejected = Promise.reject(error);
    rejected.catch(() => {});
    return rejected;
  }
  state.busy = true;
  const pending = Promise.resolve().then(operation);
  state.pending = pending;
  // Observe the promise even when a caller forgets to await it; finalization drains it.
  pending.then(value => {
    state.busy = false;
    if (value?.signal || value?.code > 0) state.firstFailure ??= normalizeResult(value);
  }, error => {
    state.busy = false;
    (state.failures ??= []).push(error.message);
  });
  return pending;
}

function charge(state, bytes, roots = state.roots) {
  integer(bytes, 'declared additional bytes');
  if (!bytes) throw new Error('Producer requires a positive additional byte allowance');
  const devices = new Set(roots.map(root => root.dev));
  for (const device of devices) if (bytes > (state.remaining.get(device) ?? 0)) throw new Error('Remaining allowance exceeded');
  for (const device of devices) state.remaining.set(device, state.remaining.get(device) - bytes);
}

async function removeScratch(record) {
  const root = await resolveDestination(record.path, { mustExist: true });
  if (root.dev !== record.dev || root.anchors.at(-1).identity !== record.identity) throw new Error(`Scratch ownership changed; preserved: ${record.path}`);
  const remove = async name => {
    const stat = await fs.lstat(name, { bigint: true });
    if (String(stat.dev) !== record.dev || stat.uid !== BigInt(process.getuid()) || stat.isSymbolicLink() ||
        (!stat.isFile() && !stat.isDirectory())) throw new Error(`Unsafe scratch entry; preserved: ${name}`);
    if (stat.isDirectory()) {
      const dir = await fs.opendir(name);
      for await (const entry of dir) await remove(path.join(name, entry.name));
      if (identity(await fs.lstat(name, { bigint: true })) !== identity(stat)) throw new Error(`Scratch changed: ${name}`);
      await fs.rmdir(name);
    } else {
      if (identity(await fs.lstat(name, { bigint: true })) !== identity(stat)) throw new Error(`Scratch changed: ${name}`);
      await fs.unlink(name);
    }
  };
  await remove(record.path);
}

function makeContext(state) {
  const context = Object.freeze({
    async scratch(parent) {
      live(context);
      return serialize(state, async () => {
        const root = state.roots.find(root => root.kind === 'scratch' && root.path === parent);
        if (!root) throw new Error('Scratch parent is outside the invocation scope');
        await recheck(state);
        await resolveDestination(parent, { mustExist: true });
        const name = await fs.mkdtemp(path.join(parent, '.hq-storage-scratch-'));
        const stat = await fs.lstat(name, { bigint: true });
        state.scratch.push({ path: name, dev: String(stat.dev), identity: identity(stat) });
        return name;
      });
    },
    launch(options) {
      live(context);
      return serialize(state, () => launch(state, options));
    },
  });
  contexts.set(context, state);
  return context;
}

async function launch(state, { command, args = [], bytes, cwd = state.plan.worktree, env = process.env,
  stdio = 'inherit', signal, monitorMs = 1000 } = {}) {
  if (typeof command !== 'string' || !command || !Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw new Error('Invalid producer command');
  if (!['inherit', 'ignore'].includes(stdio)) throw new Error('Captured output requires a bounded evidence writer');
  if (!Number.isSafeInteger(monitorMs) || monitorMs < 10 || monitorMs > 1000) throw new Error('Invalid monitoring interval');
  const producerCwd = await resolveDestination(cwd, { mustExist: true });
  if (!contains(state.plan.worktree, producerCwd.path)) throw new Error('Producer cwd is outside the worktree');
  charge(state, bytes);
  const snapshot = await recheck(state);
  for (const fs of snapshot.filesystems.filter(fs => state.remaining.has(fs.id))) {
    if (fs.availableBytes < sum(state.policy.reserveBytes, bytes)) throw new Error('Insufficient capacity immediately before launch');
  }
  state.signal?.throwIfAborted();
  signal?.throwIfAborted();
  const child = spawn(command, args, { cwd: producerCwd.path, env, stdio, shell: false, detached: true });
  const diagnostics = [];
  let ended = false;
  let requestedSignal;
  let stopTimer;
  const stop = value => {
    requestedSignal ??= value;
    if (!ended && child.pid) {
      try { process.kill(-child.pid, value); }
      catch (error) { if (error.code !== 'ESRCH') diagnostics.push(error.message); }
      stopTimer ??= setTimeout(() => {
        if (ended) return;
        try {
          process.kill(-child.pid, 'SIGKILL');
          diagnostics.push(`Owned producer did not stop after ${requestedSignal}; sent SIGKILL`);
        } catch (error) { if (error.code !== 'ESRCH') diagnostics.push(error.message); }
      }, 1000);
    }
  };
  const abort = () => stop(state.signal?.reason?.signal ?? 'SIGTERM');
  const forward = value => () => stop(value);
  const handlers = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map(value => [value, forward(value)]));
  for (const [value, handler] of handlers) process.on(value, handler);
  state.signal?.addEventListener('abort', abort, { once: true });
  signal?.addEventListener('abort', abort, { once: true });
  let monitoring = Promise.resolve();
  let checking = false;
  const timer = setInterval(() => {
    if (checking || ended || requestedSignal) return;
    checking = true;
    monitoring = recheck(state).catch(error => {
      diagnostics.push(error.message);
      stop('SIGTERM');
    }).finally(() => { checking = false; });
  }, monitorMs);
  const result = await new Promise(resolve => {
    child.once('error', error => { diagnostics.push(error.message); });
    child.once('close', (code, childSignal) => {
      ended = true;
      resolve({ code: code !== null && code < 0 ? 1 : code, signal: childSignal ?? requestedSignal ?? null, diagnostics });
    });
  });
  clearInterval(timer);
  clearTimeout(stopTimer);
  await monitoring;
  for (const [value, handler] of handlers) process.off(value, handler);
  state.signal?.removeEventListener('abort', abort);
  signal?.removeEventListener('abort', abort);
  // A foreground producer must keep its descendants in this owned process group.
  // Escaping/daemonizing commands are outside this cooperative launcher contract.
  if (child.pid) {
    const groupAlive = () => {
      try { process.kill(-child.pid, 0); return true; }
      catch (error) { if (error.code === 'ESRCH') return false; throw error; }
    };
    try {
      if (groupAlive()) {
        process.kill(-child.pid, 'SIGTERM');
        const deadline = performance.now() + 1000;
        while (groupAlive() && performance.now() < deadline) await delay(20);
        if (groupAlive()) {
          (state.top ?? state).cleanupUnsafe = true;
          diagnostics.push('Owned descendants still live; scratch and locks preserved for owner recovery');
        }
      }
    } catch (error) {
      (state.top ?? state).cleanupUnsafe = true;
      diagnostics.push(`Descendant state unknown: ${error.message}`);
    }
  }
  try { await recheck(state); } catch (error) { diagnostics.push(error.message); }
  if (result.code === 0 && diagnostics.length) result.code = 1;
  return result;
}

function normalizeResult(value) {
  if (!value || (value.code !== null && (!Number.isInteger(value.code) || value.code < 0)) ||
      (value.signal !== null && typeof value.signal !== 'string')) throw new Error('Callback must return a producer result');
  return { code: value.code, signal: value.signal, diagnostics: [...(value.diagnostics ?? [])] };
}

async function execute(state, callback, preserveEvidence, release = async () => []) {
  const context = makeContext(state);
  let result;
  const diagnostics = [];
  try { result = normalizeResult(await callback(context)); }
  catch (error) {
    result = state.signal?.aborted
      ? { code: null, signal: state.signal.reason?.signal ?? 'SIGTERM', diagnostics: [error.message] }
      : { code: 1, signal: null, diagnostics: [error.message] };
  }
  // A returned callback cannot abandon a producer and release its locks underneath it.
  try {
    const pendingResult = await state.pending;
    if (pendingResult && (pendingResult.signal || pendingResult.code > 0) && result.code === 0) result = normalizeResult(pendingResult);
  } catch { /* serialize already retained this failure. */ }
  if (state.firstFailure) {
    diagnostics.push(...result.diagnostics.filter(message => !state.firstFailure.diagnostics.includes(message)));
    result = state.firstFailure;
  }
  diagnostics.push(...(state.failures ?? []));
  state.active = false;
  try { await preserveEvidence?.(result, state.scratch.map(record => record.path)); }
  catch (error) { diagnostics.push(`Evidence preservation failed: ${error.message}`); }
  try { await recheck(state); } catch (error) { diagnostics.push(error.message); }
  if (!(state.top ?? state).cleanupUnsafe) {
    for (const record of [...state.scratch].reverse()) {
      try { await removeScratch(record); } catch (error) { diagnostics.push(`Cleanup failed: ${error.message}`); }
    }
    for (const error of await release()) diagnostics.push(error.message);
  } else {
    for (const error of await release({ preserve: true })) diagnostics.push(error.message);
    diagnostics.push('Cleanup held because descendant termination is unproved');
  }
  result.diagnostics.push(...diagnostics);
  if (result.code === 0 && result.diagnostics.length) result.code = 1;
  return result;
}

// Nested callers must hold this process's live capability. Serialized/env copies
// cannot inherit locks. This deliberately supplies no cross-process token broker.
export function withStorageInvocation(plan, callback, { parent, allowanceBytes, testContext,
  signal, preserveEvidence } = {}) {
  if (typeof callback !== 'function') return Promise.reject(new Error('Producer callback required'));
  // Capture the caller's declaration before the first await; locks bind this plan.
  plan = { worktree: plan.worktree, roots: plan.roots?.map(({ path, kind }) => ({ path, kind })) };
  if (parent !== undefined) {
    const ancestor = live(parent);
    return serialize(ancestor, async () => {
      if (testContext !== undefined || signal !== undefined) throw new Error('Nested calls inherit policy and cancellation');
      const snapshot = await inspectStorage(plan, { testContext: ancestor.testContext });
      if (snapshot.worktree.path !== ancestor.plan.worktree) throw new Error('Nested worktree mismatch');
      for (const root of snapshot.roots) {
        if (!ancestor.roots.some(outer => outer.kind === root.kind && outer.dev === root.dev && contains(outer.path, root.path))) {
          throw new Error('Nested root exceeds parent scope');
        }
      }
      await recheck(ancestor);
      charge(ancestor, allowanceBytes, snapshot.roots);
      const state = {
        plan: { ...plan, worktree: snapshot.worktree.path }, roots: snapshot.roots,
        policy: ancestor.policy, testContext: ancestor.testContext, signal: ancestor.signal,
        top: ancestor.top ?? ancestor, parent: ancestor, active: true, pid: process.pid, scratch: [],
        remaining: new Map(snapshot.filesystems.map(fs => [fs.id, allowanceBytes])),
      };
      return execute(state, callback, preserveEvidence);
    });
  }
  return (async () => {
    const originalSignal = signal;
    const controller = new AbortController();
    let cancelled;
    const handlers = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map(value => [value, () => {
      cancelled ??= value;
      controller.abort(Object.assign(new Error(`Cancelled: ${value}`), { signal: value }));
    }]));
    const abort = () => { cancelled ??= 'SIGTERM'; controller.abort(originalSignal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
    for (const [value, handler] of handlers) process.on(value, handler);
    try {
      const { policy } = settings(testContext);
      originalSignal?.throwIfAborted();
      let snapshot = await inspectStorage(plan, { testContext });
      requireAdmission(snapshot, policy);
      const release = await acquireLocks(snapshot, policy.lockTimeoutMs, controller.signal);
      try {
        snapshot = await inspectStorage(plan, { testContext, previous: snapshot });
        requireAdmission(snapshot, policy);
        controller.signal.throwIfAborted();
      } catch (error) {
        error.cleanupErrors = await release();
        throw error;
      }
      const state = {
        plan: { worktree: snapshot.worktree.path, roots: snapshot.roots.map(({ path, kind }) => ({ path, kind })) },
        snapshot, roots: snapshot.roots, policy, testContext, signal: controller.signal, active: true, pid: process.pid, scratch: [],
        remaining: new Map(snapshot.filesystems.map(fs => [fs.id, policy.peakBytes])),
      };
      const result = await execute(state, callback, preserveEvidence, release);
      if (cancelled && result.code === 0 && !result.signal) { result.code = null; result.signal = cancelled; }
      return result;
    } catch (error) {
      if (cancelled) return { code: null, signal: cancelled, diagnostics: [error.message, ...(error.cleanupErrors ?? []).map(item => item.message)] };
      throw error;
    } finally {
      for (const [value, handler] of handlers) process.off(value, handler);
      // The original signal is retained separately because descendants use the controller.
      originalSignal?.removeEventListener('abort', abort);
    }
  })();
}
