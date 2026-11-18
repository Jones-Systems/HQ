import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspectStorage, requireAdmission, resolveDestination, settings, identity, LOCK_NAME } from '../../tools/storage/admission.mjs';
import { integer, sum } from '../../tools/storage/policy.mjs';

// Standalone, cooperating-writer limits, not quotas on existing producers or raw
// traces. Counts are provisional; byte/reserve settings come from Stage A.
export const EVIDENCE_COUNTS = Object.freeze({ artifacts: 256, pendingWrites: 8 });
export const CLOSURE_NAME = '.closure.json';
const component = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const nofollow = constants.O_NOFOLLOW;

function name(value) {
  if (typeof value !== 'string' || !component.test(value) || value === CLOSURE_NAME) {
    throw new Error('Invalid evidence name');
  }
  return value;
}

function privateFile(stat, dev) {
  if (!stat.isFile() || stat.uid !== BigInt(process.getuid()) || stat.nlink !== 1n ||
      (stat.mode & 0o077n) || String(stat.dev) !== dev) throw new Error('Unsafe evidence file');
  return identity(stat);
}

async function writeAll(handle, buffer, position = 0) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(buffer, offset, buffer.length - offset, position + offset);
    if (!bytesWritten) throw new Error('Evidence write made no progress');
    offset += bytesWritten;
  }
}

function outcome(value) {
  const code = value?.code ?? null;
  const signal = value?.signal ?? null;
  if ((code !== null && (!Number.isInteger(code) || code < 0 || code > 255)) ||
      (signal !== null && (typeof signal !== 'string' || !/^SIG[A-Z0-9]{1,24}$/.test(signal))) ||
      (code === null && signal === null) || (code !== null && signal !== null)) throw new Error('Invalid producer outcome');
  return { code, signal };
}

/**
 * Allocate one new retained run under an existing admitted evidence parent.
 * This standalone API holds Stage A's parent lock; calling it from inside an
 * already locked invocation is unsupported until an explicit integration seam
 * is allocated. No environment token transports ownership or admission.
 *
 * Only this API's write/append operations are bounded. Existing harnesses do not
 * import it. It does not launch producers, delete runs, or enforce a sandbox
 * against hostile same-user mutation. testContext is Stage A's fixture-only DI.
 */
export async function openEvidenceRun({ worktree, parent, runId, signal }, {
  testContext, maxArtifacts = EVIDENCE_COUNTS.artifacts,
  maxPendingWrites = EVIDENCE_COUNTS.pendingWrites,
} = {}) {
  name(runId);
  for (const [value, ceiling] of [[maxArtifacts, EVIDENCE_COUNTS.artifacts], [maxPendingWrites, EVIDENCE_COUNTS.pendingWrites]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > ceiling) throw new Error('Invalid evidence count limit');
  }
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error('Invalid cancellation signal');
  signal?.throwIfAborted();
  const { policy, measureFilesystem } = settings(testContext);
  if (policy.evidenceClosureBytes < 2048) throw new Error('Insufficient closure reservation');
  const plan = { worktree, roots: [{ kind: 'evidence', path: parent }] };
  const before = await inspectStorage(plan, { testContext });
  requireAdmission(before, policy);
  const root = before.roots[0];
  const lockPath = path.join(root.path, LOCK_NAME);
  const nonce = randomUUID();
  // O_EXCL preserves stale/foreign locks. No recovery, eviction or PID killing.
  const lock = await fs.open(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | nofollow, 0o600);
  let lockId;
  let closure;
  const artifacts = new Map();

  async function verifyParent() {
    const current = await resolveDestination(root.path, { mustExist: true });
    if (current.dev !== root.dev || root.anchors.some(a =>
      !current.anchors.some(b => a.path === b.path && a.identity === b.identity))) {
      throw new Error('Evidence parent changed');
    }
  }

  async function unlock() {
    try {
      await verifyParent();
      const stat = await fs.lstat(lockPath, { bigint: true });
      if (privateFile(stat, root.dev) !== lockId) throw new Error('Evidence lock changed');
      const bytes = Buffer.alloc(256);
      const { bytesRead } = await lock.read(bytes, 0, bytes.length, 0);
      if (JSON.parse(bytes.subarray(0, bytesRead).toString()).nonce !== nonce) throw new Error('Evidence lock changed');
      await fs.unlink(lockPath);
    } finally {
      await lock.close();
    }
  }

  let directory;
  let directoryId;
  let closureId;
  try {
    lockId = privateFile(await lock.stat({ bigint: true }), root.dev);
    await lock.writeFile(JSON.stringify({ nonce, pid: process.pid }));
    const snapshot = await inspectStorage(plan, { testContext, previous: before });
    requireAdmission(snapshot, policy);
    signal?.throwIfAborted();
    directory = path.join(root.path, runId);
    await fs.mkdir(directory, { mode: 0o700 });
    const stat = await fs.lstat(directory, { bigint: true });
    if (!stat.isDirectory() || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o077n) || String(stat.dev) !== root.dev) {
      throw new Error('Unsafe evidence run');
    }
    directoryId = identity(stat);
    closure = await fs.open(path.join(directory, CLOSURE_NAME), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | nofollow, 0o600);
    closureId = privateFile(await closure.stat({ bigint: true }), root.dev);
    // Actually write the reserve before accepting payloads. truncate alone may
    // leave a sparse file. An absent/torn/incomplete receipt never means pass.
    const reserve = Buffer.alloc(policy.evidenceClosureBytes, 0x20);
    reserve.write(JSON.stringify({ format: 'hq.evidence-closure/v1', status: 'incomplete' }));
    await writeAll(closure, reserve);
    await closure.sync();
  } catch (error) {
    await closure?.close().catch(() => {});
    try { await unlock(); } catch (cleanupError) { error.cleanupError = cleanupError; }
    // Newly allocated incomplete bytes are retained too, never swept here.
    throw error;
  }

  let ordinaryBytes = 0;
  let pending = 0;
  let failure;
  let closing = false;
  let closed;
  let tail = Promise.resolve();
  const fail = error => { failure ??= error; return error; };
  const abort = () => fail(new Error('Evidence writing cancelled'));
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();

  async function verifyRun() {
    await verifyParent();
    const stat = await fs.lstat(directory, { bigint: true });
    if (!stat.isDirectory() || identity(stat) !== directoryId || (stat.mode & 0o077n) ||
        stat.uid !== BigInt(process.getuid())) throw new Error('Evidence run changed');
  }

  async function capacity(bytes) {
    const measured = await measureFilesystem(root);
    const expected = before.filesystems[0];
    if (!measured || measured.id !== root.dev || measured.type !== expected.type ||
        measured.blockBytes !== expected.blockBytes) throw new Error('Unknown evidence filesystem');
    const available = integer(measured.availableBytes, 'available evidence capacity');
    if (available < sum(policy.reserveBytes, bytes)) throw new Error('Evidence capacity refused');
  }

  function enqueue(filename, data, append) {
    try {
      if (closing) throw new Error('Evidence run is closing');
      if (failure) throw failure;
      name(filename);
      if (typeof data !== 'string' && !Buffer.isBuffer(data)) throw new Error('Evidence must be a string or Buffer');
      const size = Buffer.byteLength(data);
      const prior = artifacts.get(filename);
      if (prior && !append) throw new Error('Evidence overwrite refused');
      if (!prior && artifacts.size >= maxArtifacts) throw new Error('Evidence artifact count exceeded');
      if (pending >= maxPendingWrites) throw new Error('Evidence pending-write count exceeded');
      if (sum(prior?.reserved ?? 0, size) > policy.artifactBytes) throw new Error('Evidence artifact byte limit exceeded');
      if (sum(ordinaryBytes, size) > policy.evidenceOrdinaryBytes ||
          sum(ordinaryBytes, size, policy.evidenceClosureBytes) > policy.evidenceRunBytes) {
        throw new Error('Evidence run byte limit exceeded');
      }
      // Reserve synchronously before queueing or copying. Failed/partial writes
      // never refund bytes; otherwise a retry could exceed the admitted bound.
      ordinaryBytes += size;
      const entry = prior ?? { reserved: 0, written: 0, handle: undefined, id: undefined };
      entry.reserved += size;
      artifacts.set(filename, entry);
      const buffer = Buffer.from(data);
      pending++;
      const operation = tail.then(async () => {
        if (failure) throw failure;
        await verifyRun();
        await capacity(size);
        const target = path.join(directory, filename);
        if (!entry.handle) {
          entry.handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | nofollow, 0o600);
          entry.id = privateFile(await entry.handle.stat({ bigint: true }), root.dev);
        }
        if (privateFile(await fs.lstat(target, { bigint: true }), root.dev) !== entry.id ||
            privateFile(await entry.handle.stat({ bigint: true }), root.dev) !== entry.id) throw new Error('Evidence artifact changed');
        await writeAll(entry.handle, buffer, entry.written);
        entry.written += size;
        await entry.handle.sync();
        return { bytes: size };
      }).catch(error => { throw fail(error); }).finally(() => { pending--; });
      tail = operation.catch(() => {});
      return operation;
    } catch (error) {
      return Promise.reject(fail(error));
    }
  }

  function close(result = { code: 0, signal: null }) {
    if (closed) return closed;
    // Invalid caller outcomes are programming errors; keep the run and lock
    // open so a valid close can still preserve the real producer outcome.
    const primary = outcome(result);
    closing = true;
    closed = (async () => {
      await tail;
      signal?.removeEventListener('abort', abort);
      for (const entry of artifacts.values()) {
        try { await entry.handle?.close(); } catch (error) { fail(error); }
      }
      const finalOutcome = () => failure && primary.code === 0 && primary.signal === null ? { code: 1, signal: null } : primary;
      async function persistReceipt(finalized) {
        await verifyRun();
        const stat = await fs.lstat(path.join(directory, CLOSURE_NAME), { bigint: true });
        if (privateFile(stat, root.dev) !== closureId ||
            privateFile(await closure.stat({ bigint: true }), root.dev) !== closureId ||
            stat.size !== BigInt(policy.evidenceClosureBytes)) throw new Error('Closure reserve changed');
        const final = finalOutcome();
        const receipt = Buffer.from(JSON.stringify({
          format: 'hq.evidence-closure/v1',
          status: !finalized || failure ? 'incomplete' : final.code === 0 && final.signal === null ? 'complete' : 'failed',
          code: final.code, signal: final.signal,
          reservedOrdinaryBytes: ordinaryBytes, artifacts: artifacts.size,
          writerFailure: failure ? String(failure.message).slice(0, 160) : null,
        }) + '\n');
        if (receipt.length > policy.evidenceClosureBytes) throw new Error('Closure diagnostic limit exceeded');
        // Keep the allocated reserve until retention ends. The last receipt can
        // report unlock failure without requiring new blocks on a full device.
        const padded = Buffer.alloc(policy.evidenceClosureBytes, 0x20);
        receipt.copy(padded);
        await writeAll(closure, padded);
        await closure.sync();
      }
      try { await persistReceipt(false); } catch (error) { fail(error); }
      try { await unlock(); } catch (error) { fail(error); }
      try { await persistReceipt(true); } catch (error) { fail(error); }
      try { await closure.close(); } catch (error) { fail(error); }
      return Object.freeze({ ...finalOutcome(), incomplete: Boolean(failure), diagnostics: failure ? [String(failure.message).slice(0, 160)] : [] });
    })();
    return closed;
  }

  return Object.freeze({ directory, write: (file, bytes) => enqueue(file, bytes, false),
    append: (file, bytes) => enqueue(file, bytes, true), close });
}
