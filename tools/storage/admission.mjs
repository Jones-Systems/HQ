import * as fs from 'node:fs/promises';
import path from 'node:path';
import { POLICY, decideStorage, integer, sum, validatePolicy } from './policy.mjs';

const fixtures = new WeakMap();
const kinds = new Set(['compiled', 'cache', 'scratch', 'evidence']);
export const LOCK_NAME = '.hq-storage.lock';

// Explicit fixture-only injection; there is no environment or CLI policy override.
export function createTestContext({ policy = {}, measureFilesystem } = {}) {
  const context = Object.freeze({ fixture: true });
  fixtures.set(context, Object.freeze({
    policy: Object.freeze(validatePolicy({ ...POLICY, ...policy })),
    measureFilesystem: measureFilesystem ?? measureFilesystemNative,
  }));
  return context;
}

export function settings(testContext) {
  if (testContext === undefined) return { policy: POLICY, measureFilesystem: measureFilesystemNative };
  const config = fixtures.get(testContext);
  if (!config) throw new Error('Invalid test policy context');
  return config;
}

export function contains(parent, child) {
  return parent === child || child.startsWith(`${parent}${path.sep}`);
}

function owned(stat, name) {
  if (typeof process.getuid !== 'function' || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o022n)) {
    throw new Error(`Ambiguous ownership: ${name}`);
  }
}

export function identity(stat) { return `${stat.dev}:${stat.ino}`; }

export async function resolveDestination(input, { mustExist = false } = {}) {
  if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0') ||
      input.split(path.sep).includes('..')) throw new Error('Destination must be absolute without traversal');
  const destination = path.normalize(input);
  let current = path.parse(destination).root;
  let ancestor = current;
  let stat = await fs.lstat(current, { bigint: true });
  const anchors = [];
  let missing = false;
  for (const part of destination.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (missing) continue;
    try {
      stat = await fs.lstat(current, { bigint: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing = true;
      continue;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Unsafe destination component: ${current}`);
    // System-owned ancestors are allowed; writable ancestors need sticky semantics.
    if ((stat.mode & 0o022n) && !(stat.mode & 0o1000n)) throw new Error(`Writable ancestor: ${current}`);
    ancestor = current;
    anchors.push({ path: current, identity: identity(stat), dev: String(stat.dev) });
  }
  if (mustExist && missing) throw new Error(`Required directory is absent: ${destination}`);
  const ancestorStat = await fs.lstat(ancestor, { bigint: true });
  owned(ancestorStat, ancestor);
  if (await fs.realpath(ancestor) !== ancestor) throw new Error(`Noncanonical ancestor: ${ancestor}`);
  if (ancestorStat.dev <= 0n) throw new Error(`Unknown filesystem: ${ancestor}`);
  return { path: destination, ancestor, dev: String(ancestorStat.dev), anchors, exists: !missing };
}

export async function measureFilesystemNative(root) {
  const stat = await fs.statfs(root.ancestor, { bigint: true });
  if (stat.type <= 0n || stat.bsize <= 0n || stat.blocks <= 0n || stat.bavail < 0n ||
      stat.bfree < stat.bavail || stat.blocks < stat.bfree) throw new Error(`Unknown filesystem measurements: ${root.path}`);
  return {
    id: root.dev,
    type: String(stat.type),
    blockBytes: integer(Number(stat.bsize), 'filesystem block size'),
    availableBytes: integer(Number(stat.bavail * stat.bsize), 'available capacity'),
  };
}

function checkMeasurement(value, root) {
  if (!value || value.id !== root.dev || typeof value.type !== 'string' || !value.type || value.type === '0') {
    throw new Error(`Invalid filesystem identity: ${root.path}`);
  }
  integer(value.availableBytes, 'available capacity');
  if (!integer(value.blockBytes, 'filesystem block size')) throw new Error('Unknown block size');
  return value;
}

// Logical size rounded to filesystem blocks or allocated blocks, whichever is larger.
// This is retained accounting, not a prediction of APFS clone reclamation.
export async function measureTrees(roots) {
  const files = new Map();
  let entries = 0;
  const visit = async (name, root) => {
    if (++entries > 100000) throw new Error('Occupancy scan limit exceeded');
    const stat = await fs.lstat(name, { bigint: true });
    owned(stat, name);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error(`Unsafe retained entry: ${name}`);
    if (String(stat.dev) !== root.dev) throw new Error(`Mount variance: ${name}`);
    const key = identity(stat);
    if (files.has(key)) return;
    const logical = integer(Number(stat.size), 'logical size');
    const allocated = integer(Number(stat.blocks * 512n), 'allocated size');
    const bytes = Math.max(Math.ceil(logical / root.blockBytes) * root.blockBytes, allocated);
    files.set(key, integer(bytes, 'retained size'));
    if (stat.isDirectory()) {
      const directory = await fs.opendir(name);
      for await (const entry of directory) await visit(path.join(name, entry.name), root);
      if (identity(await fs.lstat(name, { bigint: true })) !== key) throw new Error(`Changed retained directory: ${name}`);
    }
  };
  for (const root of roots.sort((a, b) => a.path.length - b.path.length)) {
    if (root.exists) await visit(root.path, root);
  }
  return sum(...files.values());
}

export async function inspectStorage(plan, { testContext, previous } = {}) {
  const config = settings(testContext);
  const worktree = await resolveDestination(plan.worktree, { mustExist: true });
  if (!Array.isArray(plan.roots) || !plan.roots.length) throw new Error('Declare receiving roots');
  const roots = [];
  for (const entry of plan.roots) {
    if (!kinds.has(entry.kind)) throw new Error('Unknown storage lifecycle');
    const root = await resolveDestination(entry.path, { mustExist: entry.kind === 'evidence' });
    if (entry.kind !== 'evidence' && entry.kind !== 'scratch' && !contains(worktree.path, root.path)) {
      throw new Error('Generated roots must belong to the worktree');
    }
    if (root.path === worktree.path || contains(root.path, worktree.path)) throw new Error('Output cannot contain the worktree');
    if (!roots.some(other => other.path === root.path && other.kind === entry.kind)) roots.push({ ...root, kind: entry.kind });
  }
  for (const a of roots) for (const b of roots) {
    if (a === b || !(contains(a.path, b.path) || contains(b.path, a.path))) continue;
    if ((a.kind === 'evidence' || b.kind === 'evidence' || a.kind === 'scratch' || b.kind === 'scratch') && a.kind !== b.kind) {
      throw new Error('Evidence, scratch and generated roots must be disjoint');
    }
    if (a.kind === 'evidence' && a.path !== b.path) throw new Error('Nested evidence parents are ambiguous');
  }
  const filesystems = new Map();
  for (const root of roots) {
    const measured = checkMeasurement(await config.measureFilesystem(root), root);
    root.blockBytes = measured.blockBytes;
    const prior = filesystems.get(measured.id);
    if (prior && (prior.type !== measured.type || prior.blockBytes !== measured.blockBytes)) throw new Error('Filesystem measurement variance');
    filesystems.set(measured.id, { ...measured, availableBytes: Math.min(prior?.availableBytes ?? Infinity, measured.availableBytes) });
  }
  const snapshot = {
    worktree, roots, filesystems: [...filesystems.values()],
    compiledBytes: await measureTrees(roots.filter(root => root.kind === 'compiled')),
    generatedBytes: await measureTrees(roots.filter(root => ['compiled', 'cache'].includes(root.kind))),
    evidenceParents: [],
  };
  for (const root of roots.filter(root => root.kind === 'evidence')) {
    let runs = 0;
    const directory = await fs.opendir(root.path);
    for await (const entry of directory) if (entry.isDirectory()) runs++;
    snapshot.evidenceParents.push({ path: root.path, bytes: await measureTrees([root]), runs });
  }
  if (previous) {
    for (const before of [previous.worktree, ...previous.roots]) {
      const after = [worktree, ...roots].find(root => root.path === before.path);
      if (!after || before.dev !== after.dev || before.anchors.some(anchor =>
        !after.anchors.some(next => anchor.path === next.path && anchor.identity === next.identity))) {
        throw new Error(`Destination identity or mount changed: ${before.path}`);
      }
    }
    for (const before of previous.filesystems) {
      const after = filesystems.get(before.id);
      if (!after || before.type !== after.type || before.blockBytes !== after.blockBytes) throw new Error('Filesystem identity changed');
    }
  }
  return snapshot;
}

export function requireAdmission(snapshot, policy = POLICY, options) {
  const decision = decideStorage(snapshot, policy, options);
  if (!decision.allowed) throw new Error(`Storage refused: ${decision.reasons.join('; ')}`);
  return decision;
}
