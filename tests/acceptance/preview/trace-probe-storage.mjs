import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inspectStorage, requireAdmission, resolveDestination, contains, identity, LOCK_NAME, settings } from '../../../tools/storage/admission.mjs';

export const MiB = 1024 ** 2;
export const LIMITS = Object.freeze({ ordinary: 114 * MiB + 4096, closure: 8 * MiB, artifacts: 256, artifact: 32 * MiB, chunk: 65536,
  rawNormal: 16 * MiB, rawTiny: 4096, json: 32 * MiB, query: 64 * MiB, text: MiB, stderr: MiB, electron: MiB });
export const SLOTS = Object.freeze({ 'normal.pftrace': 16 * MiB, 'tiny.pftrace': 4096, 'normal.json': 32 * MiB, 'tiny.json': 32 * MiB,
  tools: 24 * MiB, logs: 8 * MiB, facts: 2 * MiB });
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const component = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const nofollow = constants.O_NOFOLLOW;
export function boundedCounter(limit) {
  let bytes = 0;
  return { add(size) { if (!Number.isSafeInteger(size) || size < 0 || bytes + size > limit) throw Error('byte-limit'); bytes += size; }, get bytes() { return bytes; } };
}
export async function writeAll(fd, bytes, position = null) {
  for (let offset = 0; offset < bytes.length;) {
    const n = Math.min(LIMITS.chunk, bytes.length - offset);
    const { bytesWritten } = await fd.write(bytes, offset, n, position === null ? null : position + offset);
    if (!bytesWritten) throw Error('write-no-progress');
    offset += bytesWritten;
  }
}
function safeFile(s, { dev, producer = false } = {}) {
  const mode = Number(s.mode & 0o777n);
  if (!s.isFile() || s.uid !== BigInt(process.getuid()) || s.nlink !== 1n || (dev !== undefined && String(s.dev) !== String(dev)) ||
      !(mode === 0o600 || (producer && mode === 0o644))) throw Error('unsafe-file');
}
export async function snapshotFile(filename, { limit, dev, producer = false } = {}) {
  const fd = await fs.open(filename, constants.O_RDONLY | nofollow);
  try {
    const s = await fd.stat({ bigint: true }); safeFile(s, { dev, producer });
    if (!Number.isSafeInteger(Number(s.size)) || s.size > BigInt(limit)) throw Error('file-limit');
    const hash = createHash('sha256'), buffer = Buffer.alloc(LIMITS.chunk);
    let offset = 0;
    for (;;) {
      const { bytesRead } = await fd.read(buffer, 0, Math.min(buffer.length, limit - offset + 1), offset);
      if (!bytesRead) break;
      if (offset + bytesRead > limit) throw Error('file-limit');
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    const after = await fd.stat({ bigint: true });
    if (identity(s) !== identity(after) || s.size !== after.size || Number(s.size) !== offset) throw Error('file-changed');
    return { dev: String(s.dev), ino: String(s.ino), size: offset, mode: Number(s.mode & 0o777n), sha256: hash.digest('hex') };
  } finally { await fd.close(); }
}
export function sameSnapshot(a, b) { return ['dev', 'ino', 'size', 'sha256'].every(k => a[k] === b[k]); }
export async function absent(filename) {
  try { await fs.lstat(filename); throw Error('destination-exists'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}
export async function readBounded(filename, limit) {
  const fd = await fs.open(filename, constants.O_RDONLY | nofollow);
  try {
    const s = await fd.stat({ bigint: true }); safeFile(s);
    if (s.size > BigInt(limit)) throw Error('file-limit');
    const bytes = Buffer.alloc(Number(s.size)); let off = 0;
    while (off < bytes.length) { const { bytesRead } = await fd.read(bytes, off, Math.min(LIMITS.chunk, bytes.length - off), off); if (!bytesRead) throw Error('short-file'); off += bytesRead; }
    if ((await fd.stat({ bigint: true })).size !== s.size) throw Error('file-changed');
    return bytes;
  } finally { await fd.close(); }
}

// A separate process-local owner accounts external raw slots before the producer.
// No root-writer adoption, transferable reservation, quota or stale-lock eviction.
export async function openProbeStorage({ worktree, parent, scratchParent }, { testContext } = {}) {
  const policy = settings(testContext).policy;
  if (LIMITS.ordinary > policy.evidenceOrdinaryBytes || LIMITS.closure > policy.evidenceClosureBytes ||
      LIMITS.ordinary + LIMITS.closure > policy.evidenceRunBytes || LIMITS.artifact > policy.artifactBytes) throw Error('policy-limit');
  const plan = { worktree, roots: [{ kind: 'evidence', path: parent }, { kind: 'scratch', path: scratchParent }] };
  const before = await inspectStorage(plan, { testContext }); requireAdmission(before, policy);
  const [evidence, scratch] = before.roots;
  const parentStat = await fs.lstat(parent, {bigint:true});
  if ((parentStat.mode & 0o077n) || parentStat.uid !== BigInt(process.getuid())) throw Error('private-evidence-parent');
  if (contains(parent, scratchParent) || contains(scratchParent, parent) || evidence.dev !== scratch.dev) throw Error('same-filesystem-required');
  const nonce = randomUUID(), lockPath = path.join(parent, LOCK_NAME);
  const lock = await fs.open(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | nofollow, 0o600);
  const lockId = identity(await lock.stat({ bigint: true }));
  await writeAll(lock, Buffer.from(JSON.stringify({ nonce, pid: process.pid })));
  let directory, closure, closed = false, busy = false, closePromise, primary;
  const files = new Map(), counters = new Map(Object.entries(SLOTS).map(([k,v]) => [k, boundedCounter(v)]));
  const failures = [];
  const observe = error => { const reason = typeof error === 'string' ? error : error?.message ?? 'unknown'; failures.push(reason.slice(0, 160)); primary ??= reason; };
  async function unlock() {
    try {
      const current = await resolveDestination(parent, { mustExist: true });
      const s = await fs.lstat(lockPath, { bigint: true }); safeFile(s, { dev: evidence.dev });
      if (current.dev !== evidence.dev || identity(s) !== lockId || (await readBounded(lockPath, 512)).toString() !== JSON.stringify({ nonce, pid: process.pid })) throw Error('lock-changed');
      await fs.unlink(lockPath);
    } finally { await lock.close(); }
  }
  try {
    const after = await inspectStorage(plan, { testContext, previous: before }); requireAdmission(after, policy);
    directory = path.join(parent, `qpv4-${nonce}`); await fs.mkdir(directory, { mode: 0o700 });
    closure = await fs.open(path.join(directory, '.closure.json'), constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | nofollow, 0o600);
    const zero = Buffer.alloc(LIMITS.chunk, 0x20);
    for (let p = 0; p < LIMITS.closure; p += zero.length) await writeAll(closure, zero, p);
    await closure.sync();
    await fs.mkdir(scratchParent, { recursive: true, mode: 0o700 });
  } catch (error) {
    observe(error);
    if (closure) { try { await writeAll(closure, Buffer.from(JSON.stringify({ outcome: 'INCOMPLETE', failures })), 0); await closure.sync(); } finally { await closure.close(); } }
    await unlock(); throw error;
  }
  function checkName(name) { if (!component.test(name) || name === '.closure.json' || files.has(name) || files.size >= LIMITS.artifacts - 1) throw Error('artifact-limit-or-duplicate'); }
  async function serialized(fn) {
    if (closed || busy) { const error = Error(closed ? 'writer-closed' : 'pending-write-limit'); observe(error); throw error; }
    busy = true;
    try { return await fn(); } catch (e) { observe(e); throw e; } finally { busy = false; }
  }
  return {
    directory, scratchParent, dev: evidence.dev, failures, observe,
    get primary() { return primary; },
    async write(name, bytes, slot = 'facts') {
      return serialized(async () => {
        checkName(name); bytes = Buffer.from(bytes);
        if (bytes.length > LIMITS.artifact) throw Error('artifact-limit');
        counters.get(slot)?.add(bytes.length); if (!counters.has(slot)) throw Error('unknown-slot');
        const filename = path.join(directory, name);
        const fd = await fs.open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | nofollow, 0o600);
        files.set(name, { slot, size: bytes.length, complete: false });
        try { await writeAll(fd, bytes); await fd.sync(); files.set(name, { slot, size: bytes.length, sha256: sha256(bytes), complete: true }); } finally { await fd.close(); }
        return filename;
      });
    },
    // First-sink bounded streaming: exactly one accepted chunk is written before
    // requesting the next. Partial refused files remain labelled by closure.
    async stream(name, stream, slot, limit, { expectedSize, expectedHash } = {}) {
      return serialized(async () => {
        checkName(name); if (!counters.has(slot)) throw Error('unknown-slot');
        const count = boundedCounter(Math.min(limit, SLOTS[slot], LIMITS.artifact)), hash = createHash('sha256');
        const filename = path.join(directory, name);
        const fd = await fs.open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | nofollow, 0o600);
        files.set(name, { slot, complete: false, size: 0 });
        try {
          for await (const input of stream) {
            const b = Buffer.from(input);
            if (b.length > LIMITS.chunk) throw Error('chunk-limit');
            count.add(b.length); counters.get(slot).add(b.length);
            await writeAll(fd, b); hash.update(b); files.get(name).size = count.bytes;
          }
          const digest = hash.digest('hex');
          if ((expectedSize !== undefined && count.bytes !== expectedSize) || (expectedHash !== undefined && digest !== expectedHash)) throw Error('tool-size-or-hash');
          await fd.sync(); files.set(name, { slot, complete: true, size: count.bytes, sha256: digest });
          return filename;
        } finally { await fd.close(); }
      });
    },
    async retainRaw(source, caseName, initial, privateRoot) {
      return serialized(async () => {
        const name = `${caseName}.pftrace`, cap = caseName === 'normal' ? LIMITS.rawNormal : caseName === 'tiny' ? LIMITS.rawTiny : 0;
        if (!cap || !contains(path.resolve(privateRoot), source)) throw Error('raw-scope');
        const root = await fs.lstat(privateRoot, { bigint: true });
        if (!root.isDirectory() || root.uid !== BigInt(process.getuid()) || (root.mode & 0o077n) || String(root.dev) !== evidence.dev) throw Error('raw-root');
        const current = await snapshotFile(source, { limit: cap, dev: evidence.dev, producer: true });
        if (!sameSnapshot(initial, current)) throw Error('post-snapshot-mutation');
        checkName(name); counters.get(name).add(cap);
        const fd = await fs.open(source, constants.O_RDWR | nofollow);
        try { if (identity(await fd.stat({ bigint: true })) !== `${initial.dev}:${initial.ino}`) throw Error('raw-changed'); await fd.chmod(0o600); }
        finally { await fd.close(); }
        const destination = path.join(directory, name); await absent(destination);
        await fs.rename(source, destination);
        const after = await snapshotFile(destination, { limit: cap, dev: evidence.dev });
        if (!sameSnapshot(initial, after)) throw Error('rename-identity');
        await absent(source); files.set(name, { slot: name, ...after, complete: true }); return destination;
      });
    },
    // Precharging a cap is not a file allocation or a reservation of free space.
    rawCharge(caseName) { if (closed || !['normal','tiny'].includes(caseName)) throw Error('raw-charge'); return SLOTS[`${caseName}.pftrace`]; },
    close(outcome = 'INCOMPLETE') {
      return closePromise ??= (async () => {
        if (busy) throw Error('pending-write-at-close'); closed = true;
        const body = Buffer.from(JSON.stringify({ schema: 'hq-qpv4-closure/v1', outcome, failures, primary, files: Object.fromEntries(files), prechargedOrdinary: LIMITS.ordinary }) + '\n');
        try { if (body.length > LIMITS.closure) throw Error('closure-limit'); await writeAll(closure, body, 0); await closure.sync(); }
        finally { try { await closure.close(); } finally { await unlock(); } }
        const filename = path.join(directory, '.closure.json');
        return { filename, ...await snapshotFile(filename, {limit: LIMITS.closure, dev: evidence.dev}) };
      })();
    },
  };
}
