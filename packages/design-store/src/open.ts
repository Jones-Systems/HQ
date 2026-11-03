import { dirname, isAbsolute, join } from 'node:path';
import type {
  Clock,
  Migration,
  MigrationReport,
  NamespaceConfig,
  NamespaceId,
  OpenReport,
  ReadOnlyReason,
  StoragePort,
} from './contract.ts';
import {
  copyTree,
  describeTree,
  DurabilityProbe,
  ensureDir,
  listOrEmpty,
  randomId,
  readOrNull,
  syncDir,
  unlinkIfPresent,
  writeAtomic,
  type TreeEntry,
} from './durable.ts';
import { StoreError } from './errors.ts';
import { nodeFs, type StoreFs } from './fs.ts';
import { GenerationStore } from './generation-store.ts';
import { namespaceId } from './ids.ts';
import { canonicalBytes, canonicalize, sha256Hex } from './jcs.ts';
import {
  CURRENT_FORMAT,
  generationName,
  LAYOUT_FORMAT,
  parseGenerationName,
  rootPaths,
  SNAPSHOT_FORMAT,
  TEMP_PREFIX,
  type RootPaths,
} from './layout.ts';
import { acquireLock, defaultIsProcessAlive } from './lock.ts';

export const MIGRATION_MARKER_FORMAT = 'hq.design.store.migration/v1';
const MIB = 1024 * 1024;

/** `workspace` is authoritative and backed up; `cache` is bounded, evictable and never exported. */
export const DEFAULT_NAMESPACES: readonly NamespaceConfig[] = [
  { id: 'workspace' as NamespaceId, storageClass: 'authoritative' },
  { id: 'cache' as NamespaceId, storageClass: 'evictable', budgetBytes: 512 * MIB, maxItemBytes: 64 * MIB },
];

export const systemClock: Clock = { now: () => new Date().toISOString() };

export interface OpenFileStoreOptions {
  /** Absolute store directory. Its parent must exist; the directory is created on first open. */
  readonly root: string;
  /** Application schema version this build reads and writes. */
  readonly schemaVersion: number;
  readonly namespaces?: readonly NamespaceConfig[];
  /** Contiguous `n → n+1` steps from any older stored version up to `schemaVersion`. */
  readonly migrations?: readonly Migration[];
  /** Open without the writer lock, recovery or migration. */
  readonly readOnly?: boolean;
  /** Default true. When false a missing store is `not-found` instead of being created. */
  readonly create?: boolean;
  readonly clock?: Clock;
  readonly fs?: StoreFs;
  readonly processId?: number;
  readonly isProcessAlive?: (pid: number) => boolean;
}

export interface OpenedStore {
  readonly store: StoragePort;
  readonly report: OpenReport;
}

interface SnapshotManifest {
  readonly format: typeof SNAPSHOT_FORMAT;
  readonly id: string;
  readonly sourceGeneration: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly files: readonly TreeEntry[];
  readonly treeDigest: string;
}

interface Context {
  readonly fs: StoreFs;
  readonly clock: Clock;
  readonly paths: RootPaths;
  readonly probe: DurabilityProbe;
  readonly namespaces: ReadonlyMap<NamespaceId, NamespaceConfig>;
  readonly supported: number;
  readonly knownDirs: Set<string>;
  readonly quarantined: string[];
}

/**
 * Opens (or creates) a file-backed store. Read-write opens take the single-writer lock, finish
 * interrupted work and migrate older schemas through a retained snapshot. A store written by a
 * newer schema opens read-only and is never modified.
 */
export async function openFileStore(options: OpenFileStoreOptions): Promise<OpenedStore> {
  const ctx = createContext(options);
  const { fs, paths } = ctx;
  const migrations = options.migrations ?? [];
  validateMigrations(migrations);
  const pointer = await readCurrent(fs, paths);
  if (pointer) {
    const header = await readHeader(fs, join(paths.generations, pointer));
    if (options.readOnly || header > ctx.supported) {
      return openReadOnly(ctx, pointer, header, options.readOnly ? 'requested' : 'future-schema');
    }
    // A missing step is reported before the lock or any other write.
    resolveChain(migrations, header, ctx.supported);
  } else if (options.readOnly || options.create === false) {
    throw new StoreError('not-found', `No store exists at ${paths.root}`);
  } else {
    await assertInitializable(ctx);
  }

  if (!(await fs.stat(paths.root))) {
    await fs.mkdir(paths.root);
    await syncDir(fs, dirname(paths.root), ctx.probe);
  }
  const release = await acquireLock({
    fs,
    root: paths.root,
    lockPath: paths.lock,
    pid: options.processId ?? process.pid,
    isProcessAlive: options.isProcessAlive ?? defaultIsProcessAlive,
  });
  try {
    await sweepRootTemps(ctx);
    const lockedPointer = await readCurrent(fs, paths);
    if (!lockedPointer) return await initialize(ctx, release);
    await resolveInterruptedMigration(ctx, lockedPointer);
    await quarantineLeftovers(ctx);
    const generation = (await readCurrent(fs, paths)) ?? lockedPointer;
    const stored = await readHeader(fs, join(paths.generations, generation));
    if (stored > ctx.supported) {
      await release();
      return await openReadOnly(ctx, generation, stored, 'future-schema');
    }
    const chain = resolveChain(migrations, stored, ctx.supported);
    const live = makeStore(ctx, generation, stored, 'read-write', null);
    const { recovered, discarded } = await live.recover();
    const base = { recoveredTransactions: recovered, discardedTempFiles: discarded, quarantined: ctx.quarantined, createdStore: false };
    if (chain.length === 0) {
      return { store: makeStore(ctx, generation, stored, 'read-write', null, release), report: { ...base, migration: null } };
    }
    const migrated = await migrate(ctx, generation, stored, chain);
    return {
      store: makeStore(ctx, migrated.generation, ctx.supported, 'read-write', null, release),
      report: { ...base, migration: migrated.report },
    };
  } catch (error) {
    await release().catch(() => undefined);
    throw error;
  }
}

function createContext(options: OpenFileStoreOptions): Context {
  if (typeof options.root !== 'string' || !isAbsolute(options.root)) throw new StoreError('invalid-argument', 'Store root must be an absolute path');
  if (!Number.isSafeInteger(options.schemaVersion) || options.schemaVersion < 1) throw new StoreError('invalid-argument', 'schemaVersion must be a positive integer');
  const namespaces = new Map<NamespaceId, NamespaceConfig>();
  for (const config of options.namespaces ?? DEFAULT_NAMESPACES) {
    const id = namespaceId(config.id);
    if (namespaces.has(id)) throw new StoreError('invalid-argument', `Namespace ${id} is configured twice`);
    if (config.storageClass !== 'authoritative' && config.storageClass !== 'evictable') throw new StoreError('invalid-argument', `Namespace ${id} has an unknown storage class`);
    for (const limit of [config.budgetBytes, config.maxItemBytes]) {
      if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) throw new StoreError('invalid-argument', `Namespace ${id} has an invalid byte limit`);
    }
    if (config.budgetBytes !== undefined && config.storageClass !== 'evictable') throw new StoreError('invalid-argument', `Only evictable namespaces have a budget (${id})`);
    namespaces.set(id, { ...config, id });
  }
  const paths = rootPaths(options.root);
  return {
    fs: options.fs ?? nodeFs,
    clock: options.clock ?? systemClock,
    paths,
    probe: new DurabilityProbe(),
    namespaces,
    supported: options.schemaVersion,
    knownDirs: new Set([paths.root]),
    quarantined: [],
  };
}

function makeStore(ctx: Context, generation: string, stored: number, mode: 'read-write' | 'read-only', reason: ReadOnlyReason | null, onClose?: () => Promise<void>): GenerationStore {
  return new GenerationStore({
    fs: ctx.fs,
    rootDir: ctx.paths.root,
    generationDir: join(ctx.paths.generations, generation),
    generation,
    namespaces: ctx.namespaces,
    clock: ctx.clock,
    mode,
    readOnlyReason: reason,
    storedSchemaVersion: stored,
    supportedSchemaVersion: ctx.supported,
    probe: ctx.probe,
    ...(onClose ? { onClose } : {}),
  });
}

async function openReadOnly(ctx: Context, generation: string, stored: number, reason: ReadOnlyReason): Promise<OpenedStore> {
  const store = makeStore(ctx, generation, stored, 'read-only', reason);
  await store.loadOverlay();
  return {
    store,
    report: { recoveredTransactions: 0, discardedTempFiles: 0, quarantined: [], migration: null, createdStore: false },
  };
}

async function initialize(ctx: Context, release: () => Promise<void>): Promise<OpenedStore> {
  const { fs, paths } = ctx;
  await assertInitializable(ctx);
  const first = generationName(1);
  const dir = join(paths.generations, first);
  await ensureDir(fs, paths.root, dir, ctx.probe, ctx.knownDirs);
  await writeAtomic(fs, join(dir, 'HEADER.json'), headerBytes(ctx.supported), ctx.probe);
  await writePointer(ctx, first);
  return {
    store: makeStore(ctx, first, ctx.supported, 'read-write', null, release),
    report: { recoveredTransactions: 0, discardedTempFiles: 0, quarantined: [], migration: null, createdStore: true },
  };
}

/** Only an empty directory or the leftovers of an interrupted initialization may become a store. */
async function assertInitializable(ctx: Context): Promise<void> {
  const { fs, paths } = ctx;
  const foreign = (await listOrEmpty(fs, paths.root)).filter((name) => !['generations', 'LOCK'].includes(name) && !name.startsWith(TEMP_PREFIX));
  const generations = await listOrEmpty(fs, paths.generations);
  const first = generationName(1);
  const leftovers = generations.includes(first) ? await listOrEmpty(fs, join(paths.generations, first)) : [];
  if (foreign.length > 0 || generations.some((name) => name !== first) || leftovers.some((name) => name !== 'HEADER.json' && !name.startsWith(TEMP_PREFIX))) {
    throw new StoreError('unsupported-format', `Refusing to initialize a store over unrecognized data in ${paths.root}`);
  }
}

// ------------------------------------------------------------------ pointer and header

async function readCurrent(fs: StoreFs, paths: RootPaths): Promise<string | null> {
  const bytes = await readOrNull(fs, paths.current);
  if (!bytes) return null;
  const value = parseObject(bytes);
  const generation = value?.generation;
  if (!value || value.format !== CURRENT_FORMAT || typeof generation !== 'string' || parseGenerationName(generation) === null) {
    throw new StoreError('unsupported-format', 'The store pointer has an unrecognized format; it was not modified');
  }
  return generation;
}

async function readHeader(fs: StoreFs, dir: string): Promise<number> {
  const value = parseObject((await readOrNull(fs, join(dir, 'HEADER.json'))) ?? new Uint8Array());
  if (!value || value.format !== LAYOUT_FORMAT || !Number.isSafeInteger(value.schemaVersion) || (value.schemaVersion as number) < 1) {
    throw new StoreError('unsupported-format', 'The store header has an unrecognized layout; it was not modified');
  }
  return value.schemaVersion as number;
}

function headerBytes(schemaVersion: number): Uint8Array {
  return canonicalBytes({ format: LAYOUT_FORMAT, schemaVersion });
}

async function writePointer(ctx: Context, generation: string): Promise<void> {
  await writeAtomic(ctx.fs, ctx.paths.current, canonicalBytes({ format: CURRENT_FORMAT, generation }), ctx.probe);
}

function parseObject(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ migrations

function validateMigrations(migrations: readonly Migration[]): void {
  for (const migration of migrations) {
    if (!Number.isSafeInteger(migration.from) || migration.to !== migration.from + 1 || typeof migration.run !== 'function') {
      throw new StoreError('invalid-argument', 'Each migration must step exactly one schema version with a run function');
    }
  }
}

function resolveChain(migrations: readonly Migration[], from: number, to: number): Migration[] {
  const chain: Migration[] = [];
  for (let version = from; version < to; version += 1) {
    const steps = migrations.filter((migration) => migration.from === version);
    if (steps.length !== 1) {
      throw new StoreError('migration-failed', `No single migration from schema ${version} to ${version + 1}; nothing was modified`, { missingFrom: version });
    }
    chain.push(steps[0] as Migration);
  }
  return chain;
}

/**
 * Migration copies forward: snapshot the live generation (retained), write a durable marker, run
 * every step against a working copy, then switch CURRENT atomically. The live generation is never
 * handed to a migration. On failure it is verified against the snapshot and, if anything differs,
 * restored from it into a fresh generation.
 */
async function migrate(ctx: Context, generation: string, from: number, chain: readonly Migration[]): Promise<{ generation: string; report: MigrationReport }> {
  const { fs, paths, probe } = ctx;
  const snapshot = await takeSnapshot(ctx, generation, from);
  await writeAtomic(fs, migrationMarker(paths), canonicalBytes({ format: MIGRATION_MARKER_FORMAT, snapshotId: snapshot.id, fromGeneration: generation }), probe);
  const next = generationName(await nextGenerationIndex(ctx));
  const work = join(paths.generations, `${next}.migrating`);
  const steps: string[] = [];
  let workStore: GenerationStore | null = null;
  let failedStep: string | null = null;
  try {
    await copyTree(fs, snapshotData(paths, snapshot.id), work, probe);
    await syncDir(fs, paths.generations, probe);
    const store = new GenerationStore({
      fs, rootDir: paths.root, generationDir: work, generation: next, namespaces: ctx.namespaces, clock: ctx.clock,
      mode: 'read-write', readOnlyReason: null, storedSchemaVersion: from, supportedSchemaVersion: ctx.supported, probe,
    });
    workStore = store;
    for (const step of chain) {
      failedStep = `${step.from}->${step.to}`;
      await step.run({ store, from: step.from, to: step.to });
      await writeAtomic(fs, join(work, 'HEADER.json'), headerBytes(step.to), probe);
      store.setStoredSchemaVersion(step.to);
      steps.push(`${step.from}->${step.to}: ${step.description}`);
    }
    failedStep = 'commit';
    await store.close();
    await fs.rename(work, join(paths.generations, next));
    await syncDir(fs, paths.generations, probe);
    await writePointer(ctx, next);
  } catch (cause) {
    await workStore?.close().catch(() => undefined);
    if (await fs.stat(work)) await moveToQuarantine(ctx, work);
    const restoration = await ensureLiveMatchesSnapshot(ctx, generation, snapshot);
    await unlinkIfPresent(fs, migrationMarker(paths));
    await syncDir(fs, paths.root, probe);
    throw new StoreError('migration-failed', `Migration ${failedStep ?? 'setup'} failed; the store was left at schema ${from} (${restoration.outcome})`, {
      snapshotId: snapshot.id, failedStep, restoration: restoration.outcome, generation: restoration.generation,
    }, cause);
  }
  await unlinkIfPresent(fs, migrationMarker(paths));
  await syncDir(fs, paths.root, probe);
  return { generation: next, report: { from, to: ctx.supported, snapshotId: snapshot.id, steps } };
}

async function takeSnapshot(ctx: Context, generation: string, schemaVersion: number): Promise<SnapshotManifest> {
  const { fs, paths, probe } = ctx;
  const id = `${generation}-v${schemaVersion}-${randomId(4)}`;
  const source = join(paths.generations, generation);
  await ensureDir(fs, paths.root, paths.snapshots, probe, ctx.knownDirs);
  const partial = join(paths.snapshots, `${id}.partial`);
  await fs.mkdir(partial);
  await copyTree(fs, source, join(partial, 'data'), probe);
  const files = await describeTree(fs, join(partial, 'data'), sha256Hex);
  if (canonicalize(files) !== canonicalize(await describeTree(fs, source, sha256Hex))) {
    throw new StoreError('integrity', 'Snapshot copy does not match the live generation; migration not started');
  }
  const manifest: SnapshotManifest = {
    format: SNAPSHOT_FORMAT, id, sourceGeneration: generation, schemaVersion, createdAt: ctx.clock.now(), files,
    treeDigest: sha256Hex(canonicalize(files)),
  };
  await writeAtomic(fs, join(partial, 'SNAPSHOT.json'), canonicalBytes(manifest), probe);
  await syncDir(fs, partial, probe);
  await fs.rename(partial, join(paths.snapshots, id));
  await syncDir(fs, paths.snapshots, probe);
  return manifest;
}

async function readSnapshot(ctx: Context, id: string): Promise<SnapshotManifest> {
  const value = parseObject((await readOrNull(ctx.fs, join(ctx.paths.snapshots, id, 'SNAPSHOT.json'))) ?? new Uint8Array());
  if (!value || value.format !== SNAPSHOT_FORMAT || value.id !== id || !Array.isArray(value.files)) {
    throw new StoreError('integrity', `Snapshot ${id} is missing or unreadable; the store was not modified`, { snapshotId: id });
  }
  return value as unknown as SnapshotManifest;
}

/** Proves the live generation equals the snapshot, restoring an exact copy into a new generation if not. */
async function ensureLiveMatchesSnapshot(ctx: Context, generation: string, snapshot: SnapshotManifest): Promise<{ outcome: 'verified-unchanged' | 'restored-from-snapshot'; generation: string }> {
  const { fs, paths, probe } = ctx;
  const live = await describeTree(fs, join(paths.generations, generation), sha256Hex);
  if (canonicalize(live) === canonicalize(snapshot.files)) return { outcome: 'verified-unchanged', generation };
  const restored = generationName(await nextGenerationIndex(ctx));
  const staging = join(paths.generations, `${restored}.restoring`);
  await copyTree(fs, snapshotData(paths, snapshot.id), staging, probe);
  if (canonicalize(await describeTree(fs, staging, sha256Hex)) !== canonicalize(snapshot.files)) {
    throw new StoreError('integrity', `Restored copy of snapshot ${snapshot.id} does not match its manifest`, { snapshotId: snapshot.id });
  }
  await fs.rename(staging, join(paths.generations, restored));
  await syncDir(fs, paths.generations, probe);
  await writePointer(ctx, restored);
  return { outcome: 'restored-from-snapshot', generation: restored };
}

/** A marker left by a crash mid-migration: completed if CURRENT moved, otherwise verify/restore. */
async function resolveInterruptedMigration(ctx: Context, generation: string): Promise<void> {
  const bytes = await readOrNull(ctx.fs, migrationMarker(ctx.paths));
  if (!bytes) return;
  const marker = parseObject(bytes);
  if (!marker || marker.format !== MIGRATION_MARKER_FORMAT || typeof marker.snapshotId !== 'string' || typeof marker.fromGeneration !== 'string') {
    throw new StoreError('integrity', 'The migration marker is unreadable; refusing to guess the live generation');
  }
  if (marker.fromGeneration === generation) {
    await ensureLiveMatchesSnapshot(ctx, generation, await readSnapshot(ctx, marker.snapshotId));
  }
  await ctx.fs.unlink(migrationMarker(ctx.paths));
  await syncDir(ctx.fs, ctx.paths.root, ctx.probe);
}

async function quarantineLeftovers(ctx: Context): Promise<void> {
  for (const name of await listOrEmpty(ctx.fs, ctx.paths.generations)) {
    if (parseGenerationName(name) === null && !name.startsWith(TEMP_PREFIX)) await moveToQuarantine(ctx, join(ctx.paths.generations, name));
  }
  for (const name of await listOrEmpty(ctx.fs, ctx.paths.snapshots)) {
    if (name.endsWith('.partial')) await moveToQuarantine(ctx, join(ctx.paths.snapshots, name));
  }
}

async function moveToQuarantine(ctx: Context, path: string): Promise<void> {
  await ensureDir(ctx.fs, ctx.paths.root, ctx.paths.quarantine, ctx.probe, ctx.knownDirs);
  const name = `${path.slice(dirname(path).length + 1)}-${randomId(4)}`;
  await ctx.fs.rename(path, join(ctx.paths.quarantine, name));
  await syncDir(ctx.fs, dirname(path), ctx.probe);
  await syncDir(ctx.fs, ctx.paths.quarantine, ctx.probe);
  ctx.quarantined.push(`quarantine/${name}`);
}

async function sweepRootTemps(ctx: Context): Promise<void> {
  let removed = false;
  for (const name of await listOrEmpty(ctx.fs, ctx.paths.root)) {
    // Held under the writer lock, so any remaining temp (including a crashed lock attempt) is stale.
    if (name.startsWith(TEMP_PREFIX)) {
      await ctx.fs.unlink(join(ctx.paths.root, name));
      removed = true;
    }
  }
  if (removed) await syncDir(ctx.fs, ctx.paths.root, ctx.probe);
}

async function nextGenerationIndex(ctx: Context): Promise<number> {
  let highest = 0;
  for (const name of await listOrEmpty(ctx.fs, ctx.paths.generations)) {
    const match = /^g(\d{6})/u.exec(name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return highest + 1;
}

function migrationMarker(paths: RootPaths): string {
  return join(paths.root, 'MIGRATION.json');
}

function snapshotData(paths: RootPaths, id: string): string {
  return join(paths.snapshots, id, 'data');
}
