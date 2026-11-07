import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { inspectStorage, requireAdmission, resolveDestination, contains, identity, LOCK_NAME, settings } from '../../../tools/storage/admission.mjs';

export const MiB = 1024 ** 2;
export const LIMITS = Object.freeze({ ordinary: 114 * MiB + 4096, closure: 8 * MiB, artifacts: 256, artifact: 32 * MiB, chunk: 65536,
  rawNormal: 16 * MiB, rawTiny: 4096, json: 32 * MiB, query: 64 * MiB, text: MiB, stderr: MiB, electron: MiB });
export const SLOTS = Object.freeze({ 'normal.pftrace': 16 * MiB, 'tiny.pftrace': 4096, 'normal.json': 32 * MiB, 'tiny.json': 32 * MiB,
  tools: 24 * MiB, logs: 8 * MiB, facts: 2 * MiB });
export const PUBLICATION = Object.freeze({ facts: 2060288, file: 4096, public: 16384, receipt: 16384, lock: 4096, ordinaryArtifacts: 249 });
export const PUBLIC_FILES = Object.freeze(['report.json', 'closure.json', 'config-normal.json', 'config-tiny.json']);
const bindingKeys = ['repository','repositoryId','pr','runId','attempt','event','action','label','headRepositoryId','baseRepositoryId','draft','head','base','actor','sourceHead'];
export function canonical(value) {
  function ordered(v) {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return v.map(ordered);
    if (v && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.keys(v).sort().map(k => [k, ordered(v[k])]));
    throw Error('publication-encoding');
  }
  return Buffer.from(JSON.stringify(ordered(value)) + '\n');
}
export function publicationBinding(input) {
  if (!input || canonical(Object.keys(input).sort()).toString() !== canonical([...bindingKeys].sort()).toString()) throw Error('publication-binding');
  const b = Object.fromEntries(bindingKeys.map(k => [k, input[k]]));
  if (b.repository !== 'Jones-Systems/HQ' || b.repositoryId !== 1426280211 || b.pr !== 194 ||
      b.headRepositoryId !== b.repositoryId || b.baseRepositoryId !== b.repositoryId || b.draft !== false ||
      b.attempt !== 1 || b.event !== 'pull_request' || b.action !== 'labeled' || b.label !== 'hq-qpv4-trace-probe' ||
      !/^[1-9][0-9]{0,31}$/.test(b.runId) || typeof b.runId !== 'string' ||
      !/^[a-f0-9]{40}$/.test(b.head) || !/^[a-f0-9]{40}$/.test(b.base) || b.sourceHead !== b.head ||
      typeof b.actor !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(b.actor) || canonical(b).length > PUBLICATION.lock) throw Error('publication-binding');
  return Object.freeze(b);
}
export const bindingDigest = binding => sha256(canonical(publicationBinding(binding)));
export const publicationDirectory = (parent, binding) => path.join(parent, `public-${bindingDigest(binding)}`);
const receiptName = digest => `.publication-${digest}.json`;
const sameRecord = (a, b) => sameSnapshot(a, b) && a.mode === b.mode;
function keys(value, expected) { assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), 'publication-schema'); }
async function privateDirectory(filename, dev) {
  const s = await fs.lstat(filename, { bigint: true });
  if (!s.isDirectory() || s.uid !== BigInt(process.getuid()) || (s.mode & 0o777n) !== 0o700n ||
      (dev !== undefined && String(s.dev) !== String(dev))) throw Error('publication-directory');
  return { dev: String(s.dev), ino: String(s.ino) };
}
async function syncDirectory(filename) {
  const fd = await fs.open(filename, constants.O_RDONLY | nofollow);
  try { await fd.sync(); } finally { await fd.close(); }
}
async function recordedBytes(filename, record, limit) {
  const before = await snapshotFile(filename, { limit, dev: record.dev });
  if (!sameRecord(record, before)) throw Error('publication-file-identity');
  const bytes = await readBounded(filename, limit);
  if (bytes.length !== record.size || sha256(bytes) !== record.sha256 || !sameRecord(before, await snapshotFile(filename, { limit, dev: record.dev }))) throw Error('publication-file-changed');
  return bytes;
}
async function encodePublic(report, closure, binding, projectClosed) {
  const event = { head: binding.head, base: binding.base, actor: binding.actor };
  const { sanitizedBundle } = await import('./trace-probe.mjs');
  const expected = sanitizedBundle({ ...report, closure }, event);
  const value = await projectClosed({ ...report, closure }, event);
  keys(value, PUBLIC_FILES);
  const encoded = {};
  for (const name of PUBLIC_FILES) {
    const bytes = canonical(value[name]);
    if (bytes.length > PUBLICATION.file || !bytes.equals(canonical(expected[name]))) throw Error('publication-projection');
    encoded[name] = bytes;
  }
  return encoded;
}

// This verifier consumes closed facts only. It never owns, repairs or reopens a run.
export async function verifyPublication({ parent, publicDirectory, expectedBinding }) {
  const binding = publicationBinding(expectedBinding), digest = bindingDigest(binding);
  if (publicDirectory !== publicationDirectory(parent, binding)) throw Error('publication-destination');
  await resolveDestination(parent, { mustExist: true });
  const parentId = await privateDirectory(parent);
  await absent(path.join(parent, LOCK_NAME));
  const receiptPath = path.join(parent, receiptName(digest));
  const receiptSnapshot = await snapshotFile(receiptPath, { limit: PUBLICATION.receipt, dev: parentId.dev });
  const receipt = JSON.parse(await recordedBytes(receiptPath, receiptSnapshot, PUBLICATION.receipt));
  keys(receipt, ['schema','binding','bindingSha256','nonce','parent','run','publication','report','closure','files','reservations']);
  keys(receipt.parent, ['dev','ino']); keys(receipt.run, ['name','dev','ino']);
  keys(receipt.publication, ['name','stagingName','dev','ino']);
  for (const record of [receipt.report, receipt.closure, ...Object.values(receipt.files)]) keys(record, ['dev','ino','size','mode','sha256']);
  if (receipt.schema !== 'hq-qpv4-publication/v1' || receipt.bindingSha256 !== digest || !canonical(receipt.binding).equals(canonical(binding)) ||
      !canonical(receipt.parent).equals(canonical(parentId)) || !/^[a-f0-9-]{36}$/.test(receipt.nonce) ||
      receipt.run.name !== `qpv4-${receipt.nonce}` || receipt.publication.name !== path.basename(publicDirectory) ||
      receipt.publication.stagingName !== `.publication-${digest}-${receipt.nonce}` || !canonical(receipt.reservations).equals(canonical(PUBLICATION))) throw Error('publication-receipt');
  const run = path.join(parent, receipt.run.name), stage = path.join(parent, receipt.publication.stagingName);
  assert.deepEqual(await privateDirectory(run, parentId.dev), { dev: receipt.run.dev, ino: receipt.run.ino });
  assert.deepEqual(await privateDirectory(publicDirectory, parentId.dev), { dev: receipt.publication.dev, ino: receipt.publication.ino });
  await absent(stage);
  const report = JSON.parse(await recordedBytes(path.join(run, 'report.json'), receipt.report, PUBLICATION.facts));
  const closed = JSON.parse(await recordedBytes(path.join(run, '.closure.json'), receipt.closure, LIMITS.closure));
  if (report.schema !== 'hq-qpv4-diagnostic/v1' || closed.schema !== 'hq-qpv4-closure/v1' ||
      receipt.closure.size !== LIMITS.closure || !canonical(report.binding).equals(canonical(binding)) ||
      !canonical(closed.binding).equals(canonical(binding)) || closed.outcome !== report.outcome ||
      closed.prechargedOrdinary !== LIMITS.ordinary || !canonical(closed.publication).equals(canonical({ bindingSha256: digest, reservations: PUBLICATION })) ||
      !closed.files?.['report.json']?.complete || closed.files['report.json'].slot !== 'facts' || !sameRecord(closed.files['report.json'], receipt.report)) throw Error('publication-closed-facts');
  if (Object.keys(closed.files).length > PUBLICATION.ordinaryArtifacts) throw Error('publication-inventory');
  assert.deepEqual((await fs.readdir(run)).sort(), [...Object.keys(closed.files), '.closure.json'].sort());
  const charges = Object.fromEntries(Object.keys(SLOTS).map(k => [k, 0]));
  for (const [name, record] of Object.entries(closed.files)) {
    if (!component.test(name) || name === '.closure.json') throw Error('publication-inventory');
    const charge = record.charged ?? (record.slot === name && ['normal.pftrace','tiny.pftrace'].includes(name) ? SLOTS[name] : NaN);
    if (!Object.hasOwn(charges, record.slot) || !Number.isSafeInteger(charge) || charge < record.size) throw Error('publication-inventory-charge');
    charges[record.slot] += charge;
    if (charges[record.slot] > (record.slot === 'facts' ? PUBLICATION.facts : SLOTS[record.slot])) throw Error('publication-inventory-charge');
    await recordedBytes(path.join(run, name), record, LIMITS.artifact);
  }
  keys(receipt.files, PUBLIC_FILES);
  assert.deepEqual((await fs.readdir(publicDirectory)).sort(), [...PUBLIC_FILES].sort());
  const { sanitizedBundle } = await import('./trace-probe.mjs');
  const encoded = await encodePublic(report, receipt.closure, binding, sanitizedBundle);
  for (const name of PUBLIC_FILES) {
    const bytes = await recordedBytes(path.join(publicDirectory, name), receipt.files[name], PUBLICATION.file);
    if (!bytes.equals(encoded[name])) throw Error('publication-projection');
  }
  await absent(path.join(parent, LOCK_NAME));
  if (!sameRecord(receiptSnapshot, await snapshotFile(receiptPath, { limit: PUBLICATION.receipt, dev: parentId.dev }))) throw Error('publication-receipt-changed');
  return { state: 'VERIFIED' };
}
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
export async function openProbeStorage({ worktree, parent, scratchParent, publication }, { testContext, boundary } = {}) {
  if (boundary && !testContext) throw Error('fixture-port-only');
  const policy = settings(testContext).policy;
  const binding = publication ? publicationBinding(publication.binding) : undefined;
  const digest = binding && bindingDigest(binding);
  if (publication && publication.publicDirectory !== publicationDirectory(parent, binding)) throw Error('publication-destination');
  const point = async name => { if (boundary) await boundary(name); };
  if (LIMITS.ordinary > policy.evidenceOrdinaryBytes || LIMITS.closure > policy.evidenceClosureBytes ||
      LIMITS.ordinary + LIMITS.closure > policy.evidenceRunBytes || LIMITS.artifact > policy.artifactBytes) throw Error('policy-limit');
  const plan = { worktree, roots: [{ kind: 'evidence', path: parent }, { kind: 'scratch', path: scratchParent }] };
  const before = await inspectStorage(plan, { testContext }); requireAdmission(before, policy);
  const [evidence, scratch] = before.roots;
  const parentStat = await fs.lstat(parent, {bigint:true});
  if ((parentStat.mode & 0o077n) || parentStat.uid !== BigInt(process.getuid())) throw Error('private-evidence-parent');
  if (contains(parent, scratchParent) || contains(scratchParent, parent) || evidence.dev !== scratch.dev) throw Error('same-filesystem-required');
  const parentId = binding && await privateDirectory(parent, evidence.dev);
  if (binding) {
    await absent(publication.publicDirectory); await absent(path.join(parent, receiptName(digest)));
    // Fixed reservations exist before even the lock's first byte is written.
    assert.equal(PUBLICATION.facts + PUBLICATION.public + PUBLICATION.receipt + PUBLICATION.lock, SLOTS.facts);
    await point('reserved');
  }
  const nonce = randomUUID(), lockPath = path.join(parent, LOCK_NAME);
  const lock = await fs.open(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | nofollow, 0o600);
  const lockId = identity(await lock.stat({ bigint: true }));
  const lockBytes = Buffer.from(JSON.stringify({ nonce, pid: process.pid, ...(binding ? { bindingSha256: digest } : {}) }));
  let lockClosed = false;
  try { if (lockBytes.length > PUBLICATION.lock) throw Error('lock-limit'); await point('lock-write'); await writeAll(lock, lockBytes); }
  catch (e) { await lock.close(); throw e; }
  let directory, closure, closed = false, busy = false, closePromise, primary;
  const files = new Map(), counters = new Map(Object.entries(SLOTS).map(([k,v]) => [k, boundedCounter(binding && k === 'facts' ? PUBLICATION.facts : v)]));
  const failures = [], rawReservations = new Set();
  const observe = error => { const reason = typeof error === 'string' ? error : error?.message ?? 'unknown'; failures.push(reason.slice(0, 160)); primary ??= reason; };
  async function unlock() {
    const current = await resolveDestination(parent, { mustExist: true });
    const s = await fs.lstat(lockPath, { bigint: true }); safeFile(s, { dev: evidence.dev });
    if (current.dev !== evidence.dev || identity(s) !== lockId || !(await readBounded(lockPath, PUBLICATION.lock)).equals(lockBytes)) throw Error('lock-changed');
    await point('lock-close'); await lock.close(); lockClosed = true;
    const after = await fs.lstat(lockPath, { bigint: true });
    if (identity(after) !== lockId || !(await readBounded(lockPath, PUBLICATION.lock)).equals(lockBytes)) throw Error('lock-changed');
    await point('lock-unlink'); await fs.unlink(lockPath); await absent(lockPath);
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
  function checkName(name) { if (!component.test(name) || name === '.closure.json' || files.has(name) || files.size >= (binding ? PUBLICATION.ordinaryArtifacts : LIMITS.artifacts - 1)) throw Error('artifact-limit-or-duplicate'); }
  async function serialized(fn) {
    if (closed || busy) { const error = Error(closed ? 'writer-closed' : 'pending-write-limit'); observe(error); throw error; }
    busy = true;
    try { return await fn(); } catch (e) { observe(e); throw e; } finally { busy = false; }
  }
  let ownerState = 'OPEN', sealAttempted = false;
  async function seal(outcome) {
    if (sealAttempted) throw Error('seal-already-attempted');
    sealAttempted = true;
    // No accepted sink is live here. Failed partials retain their charged bytes
    // and positions; the inventory records the bytes actually left on disk.
    for (const [name, record] of files) {
      const snapshot = await snapshotFile(path.join(directory, name), { limit: LIMITS.artifact, dev: evidence.dev });
      if (record.complete && !sameRecord(record, snapshot)) throw Error('ordinary-file-changed');
      files.set(name, { ...record, ...snapshot });
    }
    const body = Buffer.from(JSON.stringify({ schema: 'hq-qpv4-closure/v1', outcome, failures, primary,
      files: Object.fromEntries(files), prechargedOrdinary: LIMITS.ordinary,
      ...(binding ? { binding, publication: { bindingSha256: digest, reservations: PUBLICATION } } : {}) }) + '\n');
    if (body.length > LIMITS.closure) throw Error('closure-limit');
    await point('closure-write'); await writeAll(closure, body, 0);
    await point('closure-sync'); await closure.sync();
    await point('closure-close'); await closure.close(); closure = undefined;
    const filename = path.join(directory, '.closure.json');
    const snapshot = { filename, ...await snapshotFile(filename, { limit: LIMITS.closure, dev: evidence.dev }) };
    if (snapshot.size !== LIMITS.closure) throw Error('closure-size');
    ownerState = 'ORDINARY_SEALED'; return snapshot;
  }
  async function exclusiveFile(filename, bytes, prefix, limit) {
    if (bytes.length > limit) throw Error('publication-capacity');
    await point(`${prefix}-create`);
    const fd = await fs.open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | nofollow, 0o600);
    try {
      await point(`${prefix}-write`); await writeAll(fd, bytes);
      await point(`${prefix}-sync`); await fd.sync();
      await point(`${prefix}-close`);
    } finally { await fd.close(); }
    return snapshotFile(filename, { limit, dev: evidence.dev });
  }
  async function publish(outcome, { projectClosed, signal } = {}) {
    let snapshot, committing = false, uncertain = false;
    const cancel = () => { signal?.throwIfAborted(); };
    try {
      cancel();
      const record = files.get('report.json');
      if (!record?.complete) {
        observe('publication-report-missing'); snapshot = await seal(outcome);
        await unlock(); ownerState = 'UNPUBLISHED';
        return { state: 'UNPUBLISHED', closure: snapshot, reason: 'report-missing' };
      }
      const report = JSON.parse(await recordedBytes(path.join(directory, 'report.json'), record, PUBLICATION.facts));
      if (report.schema !== 'hq-qpv4-diagnostic/v1' || !canonical(report.binding).equals(canonical(binding)) || report.outcome !== outcome || typeof projectClosed !== 'function') throw Error('publication-report-binding');
      snapshot = await seal(outcome); cancel();
      const encoded = await encodePublic(report, snapshot, binding, projectClosed);
      // Every public byte is checked before the first public file exists.
      ownerState = 'STAGING_PUBLICATION';
      const stageName = `.publication-${digest}-${nonce}`, stage = path.join(parent, stageName);
      await point('stage-create'); await fs.mkdir(stage, { mode: 0o700 });
      const stageId = await privateDirectory(stage, evidence.dev), publicRecords = {};
      for (const name of PUBLIC_FILES) { cancel(); uncertain = true; publicRecords[name] = await exclusiveFile(path.join(stage, name), encoded[name], `public-${name}`, PUBLICATION.file); uncertain = false; }
      await point('stage-sync'); await syncDirectory(stage);
      assert.deepEqual((await fs.readdir(stage)).sort(), [...PUBLIC_FILES].sort());
      for (const name of PUBLIC_FILES) await recordedBytes(path.join(stage, name), publicRecords[name], PUBLICATION.file);
      const runId = await privateDirectory(directory, evidence.dev);
      const receipt = { schema: 'hq-qpv4-publication/v1', binding, bindingSha256: digest, nonce, parent: parentId,
        run: { name: path.basename(directory), ...runId }, publication: { name: path.basename(publication.publicDirectory), stagingName: stageName, ...stageId },
        report: { dev: record.dev, ino: record.ino, size: record.size, mode: record.mode, sha256: record.sha256 },
        closure: { dev: snapshot.dev, ino: snapshot.ino, size: snapshot.size, mode: snapshot.mode, sha256: snapshot.sha256 },
        files: publicRecords, reservations: PUBLICATION };
      const receiptBytes = canonical(receipt);
      if (receiptBytes.length > PUBLICATION.receipt) throw Error('publication-receipt-capacity');
      cancel(); uncertain = true;
      const receiptSnapshot = await exclusiveFile(path.join(parent, receiptName(digest)), receiptBytes, 'receipt', PUBLICATION.receipt);
      uncertain = false;
      await absent(publication.publicDirectory);
      assert.deepEqual(await privateDirectory(parent, evidence.dev), parentId);
      assert.deepEqual(await privateDirectory(stage, evidence.dev), stageId);
      if (identity(await fs.lstat(lockPath, { bigint: true })) !== lockId || !(await readBounded(lockPath, PUBLICATION.lock)).equals(lockBytes)) throw Error('lock-changed');
      cancel(); ownerState = 'COMMITTING'; committing = true;
      await point('rename'); await fs.rename(stage, publication.publicDirectory); await point('renamed');
      await point('parent-sync'); await syncDirectory(parent);
      assert.deepEqual(await privateDirectory(publication.publicDirectory, evidence.dev), stageId); await absent(stage);
      assert.deepEqual((await fs.readdir(publication.publicDirectory)).sort(), [...PUBLIC_FILES].sort());
      for (const name of PUBLIC_FILES) await recordedBytes(path.join(publication.publicDirectory, name), publicRecords[name], PUBLICATION.file);
      await recordedBytes(path.join(parent, receiptName(digest)), receiptSnapshot, PUBLICATION.receipt);
      await point('committed-readback'); await unlock();
      // The lock is absent only after durable final readback. Nothing writes
      // artifacts after this release; verification is an independent reader.
      await verifyPublication({ parent, publicDirectory: publication.publicDirectory, expectedBinding: binding });
      ownerState = 'PUBLISHED'; return { state: 'PUBLISHED', closure: snapshot };
    } catch (e) {
      observe(e);
      if (!snapshot && !committing && !uncertain) {
        if (sealAttempted) uncertain = true;
        else { try { snapshot = await seal(outcome); } catch { uncertain = true; } }
      }
      if (committing || uncertain) {
        ownerState = 'UNKNOWN';
        if (closure) { try { await closure.close(); closure = undefined; } catch {} }
        if (!lockClosed) { try { await lock.close(); lockClosed = true; } catch {} }
        return { state: 'UNKNOWN', ...(snapshot ? { closure: snapshot } : {}), reason: 'publication-unknown' };
      }
      try { await unlock(); } catch {
        ownerState = 'UNKNOWN';
        if (!lockClosed) { try { await lock.close(); lockClosed = true; } catch {} }
        return { state: 'UNKNOWN', ...(snapshot ? { closure: snapshot } : {}), reason: 'release-unknown' };
      }
      ownerState = 'UNPUBLISHED';
      return { state: 'UNPUBLISHED', ...(snapshot ? { closure: snapshot } : {}), reason: signal?.aborted ? 'cancelled' : 'publication-refused' };
    }
  }
  return {
    directory, scratchParent, dev: evidence.dev, failures, observe,
    get primary() { return primary; },
    get state() { return ownerState; },
    async write(name, bytes, slot = 'facts') {
      return serialized(async () => {
        checkName(name); bytes = Buffer.from(bytes);
        if (bytes.length > LIMITS.artifact) throw Error('artifact-limit');
        counters.get(slot)?.add(bytes.length); if (!counters.has(slot)) throw Error('unknown-slot');
        const filename = path.join(directory, name);
        const fd = await fs.open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | nofollow, 0o600);
        files.set(name, { slot, charged: bytes.length, size: bytes.length, complete: false });
        try { await writeAll(fd, bytes); await fd.sync(); } finally { await fd.close(); }
        files.set(name, { slot, charged: bytes.length, ...await snapshotFile(filename, { limit: LIMITS.artifact, dev: evidence.dev }), complete: true });
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
        files.set(name, { slot, complete: false, size: 0, charged: 0 });
        try {
          for await (const input of stream) {
            const b = Buffer.from(input);
            if (b.length > LIMITS.chunk) throw Error('chunk-limit');
            count.add(b.length); counters.get(slot).add(b.length); files.get(name).charged = count.bytes;
            await writeAll(fd, b); hash.update(b); files.get(name).size = count.bytes;
          }
          const digest = hash.digest('hex');
          if ((expectedSize !== undefined && count.bytes !== expectedSize) || (expectedHash !== undefined && digest !== expectedHash)) throw Error('tool-size-or-hash');
          await fd.sync(); files.set(name, { slot, complete: true, charged: count.bytes, ...await snapshotFile(filename, { limit: LIMITS.artifact, dev: evidence.dev }), sha256: digest });
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
        checkName(name); if (!rawReservations.has(caseName)) throw Error('raw-not-precharged');
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
    rawCharge(caseName) { if (closed || !['normal','tiny'].includes(caseName) || rawReservations.has(caseName)) throw Error('raw-charge'); const bytes = SLOTS[`${caseName}.pftrace`]; counters.get(`${caseName}.pftrace`).add(bytes); rawReservations.add(caseName); return bytes; },
    close(outcome = 'INCOMPLETE', options) {
      if (closePromise) return closePromise;
      closed = true; ownerState = 'SEALING_ORDINARY';
      if (busy) {
        observe('pending-write-at-close'); ownerState = 'UNKNOWN';
        // Keep the lock and untouched closure. The accepted sink's eventual
        // completion cannot restart finalization or publish a partial run.
        closePromise = (async () => { await closure.close(); closure = undefined; await lock.close(); lockClosed = true; return { state: 'UNKNOWN', reason: 'pending-write-at-close' }; })();
      } else if (binding) closePromise = publish(outcome, options);
      else closePromise = (async () => { const snapshot = await seal(outcome); await unlock(); return snapshot; })();
      return closePromise;
    },
  };
}
