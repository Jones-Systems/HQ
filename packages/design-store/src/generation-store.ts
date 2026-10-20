import { dirname, join, relative } from 'node:path';
import type {
  BlobDigest,
  BlobRef,
  Clock,
  CommitResult,
  DocumentKey,
  EventInput,
  EventRecord,
  EventStreamRead,
  JsonValue,
  NamespaceConfig,
  NamespaceId,
  NamespaceUsage,
  Projection,
  ProjectionResult,
  PutBlobOptions,
  ReadOnlyReason,
  RepairResult,
  StoragePort,
  StoredDocument,
  StoreHealth,
  StoreMode,
  StreamHead,
  StreamId,
  StreamStatus,
  TransactionOp,
  WriteOptions,
} from './contract.ts';
import {
  DurabilityProbe,
  ensureDir,
  listOrEmpty,
  randomId,
  readOrNull,
  syncDir,
  unlinkIfPresent,
  writeAtomic,
} from './durable.ts';
import { StoreError } from './errors.ts';
import { buildRecord, encodeRecord, parseStream } from './events.ts';
import type { StoreFs } from './fs.ts';
import { assertProjectionName, blobDigest, documentKey, namespaceId, streamId } from './ids.ts';
import { canonicalBytes, canonicalize, cloneJson, digestOfBytes, digestOfJson, sha256Hex } from './jcs.ts';
import {
  decodeName,
  DOC_FORMAT,
  GenerationPaths,
  PROJECTION_FORMAT,
  STAGE_PREFIX,
  TEMP_PREFIX,
  TXN_FORMAT,
} from './layout.ts';

export interface GenerationStoreOptions {
  readonly fs: StoreFs;
  readonly rootDir: string;
  readonly generationDir: string;
  readonly generation: string;
  readonly namespaces: ReadonlyMap<NamespaceId, NamespaceConfig>;
  readonly clock: Clock;
  readonly mode: StoreMode;
  readonly readOnlyReason: ReadOnlyReason | null;
  readonly storedSchemaVersion: number;
  readonly supportedSchemaVersion: number;
  readonly probe: DurabilityProbe;
  readonly onClose?: () => Promise<void>;
}

interface TxnPutEntry {
  readonly kind: 'put';
  readonly namespace: NamespaceId;
  readonly key: DocumentKey;
  readonly staged: string;
  readonly target: string;
  readonly sha256: string;
}

interface TxnDeleteEntry {
  readonly kind: 'delete';
  readonly namespace: NamespaceId;
  readonly key: DocumentKey;
  readonly target: string;
}

type TxnEntry = TxnPutEntry | TxnDeleteEntry;

interface TxnManifest {
  readonly format: typeof TXN_FORMAT;
  readonly id: string;
  readonly entries: readonly TxnEntry[];
}

interface StreamState {
  readonly status: StreamStatus;
  readonly head: StreamHead | null;
  readonly exists: boolean;
  readonly byClientId: Map<string, EventRecord>;
}

interface CacheEntry {
  bytes: number;
  tick: number;
}

type OverlayEntry = { readonly kind: 'put'; readonly staged: string; readonly target: string } | { readonly kind: 'delete' };

const MAX_EVENT_TYPE = 128;
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * File-backed StoragePort over one generation directory. All operations run through one serial
 * queue so a reader never observes a half-applied write from this process.
 */
export class GenerationStore implements StoragePort {
  readonly generation: string;
  private readonly fs: StoreFs;
  private readonly rootDir: string;
  private readonly paths: GenerationPaths;
  private readonly namespaces: ReadonlyMap<NamespaceId, NamespaceConfig>;
  private readonly clock: Clock;
  private readonly mode: StoreMode;
  private readonly readOnlyReason: ReadOnlyReason | null;
  private storedSchemaVersion: number;
  private readonly supportedSchemaVersion: number;
  private readonly probe: DurabilityProbe;
  private readonly onClose: (() => Promise<void>) | undefined;
  private readonly knownDirs = new Set<string>();
  private readonly streams = new Map<string, StreamState>();
  private readonly caches = new Map<NamespaceId, Map<string, CacheEntry>>();
  private overlay: Map<string, OverlayEntry> | null = null;
  private overlayBroken = false;
  private pendingRecovery = false;
  private tick = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(options: GenerationStoreOptions) {
    this.fs = options.fs;
    this.rootDir = options.rootDir;
    this.paths = new GenerationPaths(options.generationDir);
    this.generation = options.generation;
    this.namespaces = options.namespaces;
    this.clock = options.clock;
    this.mode = options.mode;
    this.readOnlyReason = options.readOnlyReason;
    this.storedSchemaVersion = options.storedSchemaVersion;
    this.supportedSchemaVersion = options.supportedSchemaVersion;
    this.probe = options.probe;
    this.onClose = options.onClose;
  }

  health(): StoreHealth {
    return {
      mode: this.mode,
      readOnlyReason: this.readOnlyReason,
      storedSchemaVersion: this.storedSchemaVersion,
      supportedSchemaVersion: this.supportedSchemaVersion,
      generation: this.generation,
      pendingRecovery: this.pendingRecovery,
      directoryFsync: this.probe.directoryFsync,
    };
  }

  /** Internal: migration steps record the schema version they produced. */
  setStoredSchemaVersion(version: number): void {
    this.storedSchemaVersion = version;
  }

  /** Internal: makes the instance unusable without releasing anything (used to seal migration copies). */
  seal(): void {
    this.closed = true;
  }

  // ---------------------------------------------------------------- documents

  getDocument(namespace: NamespaceId, key: DocumentKey): Promise<StoredDocument | null> {
    return this.serial(async () => {
      this.assertOpen();
      const config = this.namespace(namespace);
      documentKey(key);
      const overlay = this.overlayFor(namespace, key);
      if (overlay?.kind === 'delete') return null;
      if (overlay?.kind === 'put') {
        const staged = this.abs(overlay.staged);
        const path = (await this.fs.stat(staged)) ? staged : this.abs(overlay.target);
        return this.readDocument(config, key, path);
      }
      return this.readDocument(config, key, this.paths.docFile(namespace, key));
    });
  }

  putDocument(namespace: NamespaceId, key: DocumentKey, value: JsonValue, options: WriteOptions = {}): Promise<StoredDocument> {
    return this.serial(async () => {
      this.assertWritable();
      const config = this.namespace(namespace);
      documentKey(key);
      const path = this.paths.docFile(namespace, key);
      const current = await this.readDocument(config, key, path);
      checkExpected(namespace, key, current, options.expectedRevision);
      const { document, bytes } = this.buildDocument(namespace, key, value, (current?.revision ?? 0) + 1);
      this.checkItemSize(config, bytes.length);
      await this.ensure(this.paths.docsDir(namespace));
      await writeAtomic(this.fs, path, bytes, this.probe);
      await this.recordCacheWrite(config, path, bytes.length);
      return document;
    });
  }

  deleteDocument(namespace: NamespaceId, key: DocumentKey, options: WriteOptions = {}): Promise<boolean> {
    return this.serial(async () => {
      this.assertWritable();
      const config = this.namespace(namespace);
      documentKey(key);
      const path = this.paths.docFile(namespace, key);
      const current = await this.readDocument(config, key, path);
      checkExpected(namespace, key, current, options.expectedRevision);
      if (!current) return false;
      await this.fs.unlink(path);
      await syncDir(this.fs, dirname(path), this.probe);
      this.caches.get(namespace)?.delete(path);
      return true;
    });
  }

  listDocuments(namespace: NamespaceId, options: { readonly prefix?: string } = {}): Promise<readonly DocumentKey[]> {
    return this.serial(async () => {
      this.assertOpen();
      const config = this.namespace(namespace);
      const keys = new Set<string>();
      const dir = this.paths.docsDir(namespace);
      for (const name of await listOrEmpty(this.fs, dir)) {
        if (name.startsWith('.') || !name.endsWith('.json')) continue;
        const decoded = decodeName(name.slice(0, -'.json'.length));
        if (decoded !== null) {
          keys.add(decoded);
        } else {
          const bytes = await readOrNull(this.fs, join(dir, name));
          const envelope = bytes ? parseEnvelope(bytes) : null;
          if (envelope) keys.add(envelope.key);
          else if (config.storageClass === 'authoritative') throw integrity(`Unreadable document file ${name}`, { namespace });
        }
      }
      if (this.overlay) {
        for (const [id, entry] of this.overlay) {
          const [overlayNamespace, overlayKey] = splitOverlayId(id);
          if (overlayNamespace !== namespace) continue;
          if (entry.kind === 'put') keys.add(overlayKey);
          else keys.delete(overlayKey);
        }
      }
      const prefix = options.prefix ?? '';
      return [...keys].filter((key) => key.startsWith(prefix)).sort().map((key) => key as DocumentKey);
    });
  }

  /**
   * Multi-document atomicity: stage every new document (fsynced), then publish one manifest with
   * an atomic rename. That rename is the commit point; recovery rolls a committed manifest forward
   * and discards staging without one. Sequential renames alone are never treated as atomic.
   */
  commit(ops: readonly TransactionOp[]): Promise<CommitResult> {
    return this.serial(async () => {
      this.assertWritable();
      if (!Array.isArray(ops) || ops.length === 0) throw new StoreError('invalid-argument', 'A transaction needs at least one operation');
      const seen = new Set<string>();
      const id = randomId();
      const entries: TxnEntry[] = [];
      const documents: StoredDocument[] = [];
      const deleted: { namespace: NamespaceId; key: DocumentKey }[] = [];
      const staged: { path: string; bytes: Uint8Array; config: NamespaceConfig; target: string }[] = [];
      for (const [index, op] of ops.entries()) {
        const config = this.namespace(op.namespace);
        documentKey(op.key);
        const unique = overlayId(op.namespace, op.key);
        if (seen.has(unique)) throw new StoreError('invalid-argument', `Transaction touches ${op.namespace}/${op.key} twice`);
        seen.add(unique);
        const target = this.paths.docFile(op.namespace, op.key);
        const current = await this.readDocument(config, op.key, target);
        checkExpected(op.namespace, op.key, current, op.expectedRevision);
        if (op.op === 'put') {
          const { document, bytes } = this.buildDocument(op.namespace, op.key, op.value, (current?.revision ?? 0) + 1);
          this.checkItemSize(config, bytes.length);
          const path = join(this.paths.docsDir(op.namespace), `${STAGE_PREFIX}${id}-${index}`);
          entries.push({ kind: 'put', namespace: op.namespace, key: op.key, staged: this.rel(path), target: this.rel(target), sha256: sha256Hex(bytes) });
          staged.push({ path, bytes, config, target });
          documents.push(document);
        } else if (op.op === 'delete') {
          entries.push({ kind: 'delete', namespace: op.namespace, key: op.key, target: this.rel(target) });
          deleted.push({ namespace: op.namespace, key: op.key });
        } else {
          throw new StoreError('invalid-argument', 'Unknown transaction operation');
        }
      }
      const stagedDirs = new Set<string>();
      for (const item of staged) {
        const dir = dirname(item.path);
        await this.ensure(dir);
        await this.fs.writeNew(item.path, item.bytes);
        await this.fs.fsyncFile(item.path);
        stagedDirs.add(dir);
      }
      for (const dir of stagedDirs) await syncDir(this.fs, dir, this.probe);
      const manifest: TxnManifest = { format: TXN_FORMAT, id, entries };
      const manifestPath = join(this.paths.txnDir(), `${id}.commit`);
      await this.ensure(this.paths.txnDir());
      await writeAtomic(this.fs, manifestPath, canonicalBytes(manifest), this.probe);
      await this.applyManifest(manifest);
      await this.fs.unlink(manifestPath);
      await syncDir(this.fs, this.paths.txnDir(), this.probe);
      for (const item of staged) await this.recordCacheWrite(item.config, item.target, item.bytes.length);
      for (const entry of entries) if (entry.kind === 'delete') this.caches.get(entry.namespace)?.delete(this.abs(entry.target));
      return { transactionId: id, documents, deleted };
    });
  }

  // ---------------------------------------------------------------- blobs

  putBlob(namespace: NamespaceId, bytes: Uint8Array, options: PutBlobOptions = {}): Promise<BlobRef> {
    return this.serial(async () => {
      this.assertWritable();
      const config = this.namespace(namespace);
      if (!(bytes instanceof Uint8Array)) throw new StoreError('invalid-argument', 'Blob bytes must be a Uint8Array');
      const digest = digestOfBytes(bytes);
      if (options.expectedDigest !== undefined) {
        const expected = blobDigest(options.expectedDigest);
        if (expected !== digest) {
          throw new StoreError('digest-mismatch', 'Blob bytes do not match the expected digest', { expected, actual: digest });
        }
      }
      this.checkItemSize(config, bytes.length);
      const path = this.paths.blobFile(namespace, digest);
      const existing = await readOrNull(this.fs, path);
      if (existing) {
        if (digestOfBytes(existing) === digest) {
          this.touch(namespace, path);
          return { digest, bytes: bytes.length };
        }
        // Content-addressed, so verified bytes replace corrupt ones losslessly; authoritative bytes are kept.
        if (config.storageClass === 'authoritative') await this.quarantineBytes(`blob-${digest.slice(7)}`, existing);
      }
      await this.ensure(this.paths.blobFanout(namespace, digest));
      await writeAtomic(this.fs, path, bytes, this.probe);
      await this.recordCacheWrite(config, path, bytes.length);
      return { digest, bytes: bytes.length };
    });
  }

  getBlob(namespace: NamespaceId, digest: BlobDigest): Promise<Uint8Array | null> {
    return this.serial(() => this.readBlob(namespace, digest));
  }

  hasBlob(namespace: NamespaceId, digest: BlobDigest): Promise<boolean> {
    return this.serial(async () => (await this.readBlob(namespace, digest)) !== null);
  }

  listBlobs(namespace: NamespaceId): Promise<readonly BlobRef[]> {
    return this.serial(async () => {
      this.assertOpen();
      this.namespace(namespace);
      const refs: BlobRef[] = [];
      const dir = this.paths.blobsDir(namespace);
      for (const fanout of await listOrEmpty(this.fs, dir)) {
        if (fanout.startsWith('.')) continue;
        for (const name of await listOrEmpty(this.fs, join(dir, fanout))) {
          if (!/^[0-9a-f]{64}$/u.test(name)) continue;
          const info = await this.fs.stat(join(dir, fanout, name));
          if (info && !info.isDirectory) refs.push({ digest: `sha256:${name}` as BlobDigest, bytes: info.size });
        }
      }
      return refs;
    });
  }

  deleteBlob(namespace: NamespaceId, digest: BlobDigest): Promise<boolean> {
    return this.serial(async () => {
      this.assertWritable();
      const config = this.namespace(namespace);
      blobDigest(digest);
      if (config.storageClass !== 'evictable') {
        throw new StoreError('invalid-argument', `Blobs in authoritative namespace ${namespace} are immutable`, { namespace });
      }
      const path = this.paths.blobFile(namespace, digest);
      const removed = await unlinkIfPresent(this.fs, path);
      if (removed) await syncDir(this.fs, dirname(path), this.probe);
      this.caches.get(namespace)?.delete(path);
      return removed;
    });
  }

  async adoptBlob(from: NamespaceId, to: NamespaceId, digest: BlobDigest): Promise<BlobRef> {
    this.assertWritable();
    const bytes = await this.getBlob(from, digest);
    if (!bytes) throw new StoreError('not-found', `Blob ${digest} is not present in ${from}`, { namespace: from, digest });
    return this.putBlob(to, bytes, { expectedDigest: digest });
  }

  // ---------------------------------------------------------------- events

  appendEvent(namespace: NamespaceId, stream: StreamId, event: EventInput): Promise<EventRecord> {
    return this.serial(async () => {
      this.assertWritable();
      const config = this.namespace(namespace);
      streamId(stream);
      const input = validateEventInput(event);
      const id = overlayId(namespace, stream);
      const state = this.streams.get(id) ?? (await this.loadStream(namespace, stream));
      this.streams.set(id, state);
      if (state.status.state !== 'ok') {
        throw new StoreError('stream-unavailable', `Event stream ${namespace}/${stream} is fail-closed (${state.status.state})`, { status: state.status });
      }
      if (input.clientEventId !== undefined) {
        const prior = state.byClientId.get(input.clientEventId);
        if (prior) {
          if (prior.type === input.type && canonicalize(prior.payload) === canonicalize(input.payload)) return prior;
          throw new StoreError('conflict', `clientEventId ${input.clientEventId} was already used with a different event`, { seq: prior.seq });
        }
      }
      const record = buildRecord(state.head, this.clock.now(), input.type, input.payload, input.clientEventId);
      const line = encodeRecord(record);
      this.checkItemSize(config, line.length);
      const path = this.paths.eventFile(namespace, stream);
      await this.ensure(this.paths.eventsDir(namespace));
      // Any failure from here leaves the on-disk tail unknown to this instance: reload before reuse.
      this.streams.delete(id);
      await this.fs.append(path, line);
      await this.fs.fsyncFile(path);
      if (!state.exists) await syncDir(this.fs, dirname(path), this.probe);
      if (record.clientEventId !== undefined) state.byClientId.set(record.clientEventId, record);
      this.streams.set(id, { status: { state: 'ok' }, head: { seq: record.seq, hash: record.hash }, exists: true, byClientId: state.byClientId });
      return record;
    });
  }

  readEvents(namespace: NamespaceId, stream: StreamId): Promise<EventStreamRead> {
    return this.serial(async () => {
      this.assertOpen();
      this.namespace(namespace);
      streamId(stream);
      const bytes = await readOrNull(this.fs, this.paths.eventFile(namespace, stream));
      const parsed = parseStream(bytes ?? new Uint8Array());
      return { events: parsed.events, head: parsed.head, status: parsed.status };
    });
  }

  listStreams(namespace: NamespaceId, options: { readonly prefix?: string } = {}): Promise<readonly StreamId[]> {
    return this.serial(async () => {
      this.assertOpen();
      const config = this.namespace(namespace);
      const ids = new Set<string>();
      for (const name of await listOrEmpty(this.fs, this.paths.eventsDir(namespace))) {
        if (name.startsWith('.') || !name.endsWith('.jsonl')) continue;
        const decoded = decodeName(name.slice(0, -'.jsonl'.length));
        if (decoded !== null) {
          ids.add(decoded);
        } else if (config.storageClass === 'authoritative') {
          throw integrity(`Event journal ${name} has a hashed file name; its stream id cannot be listed`, { namespace });
        }
      }
      const prefix = options.prefix ?? '';
      return [...ids].filter((id) => id.startsWith(prefix)).sort().map((id) => streamId(id));
    });
  }

  project<S extends JsonValue>(namespace: NamespaceId, stream: StreamId, projection: Projection<S>): Promise<ProjectionResult<S>> {
    return this.serial(async () => {
      this.assertOpen();
      this.namespace(namespace);
      streamId(stream);
      assertProjectionName(projection.name);
      if (!Number.isSafeInteger(projection.version) || projection.version < 1) throw new StoreError('invalid-argument', 'Projection version must be a positive integer');
      const bytes = await readOrNull(this.fs, this.paths.eventFile(namespace, stream));
      const parsed = parseStream(bytes ?? new Uint8Array());
      const file = this.paths.projectionFile(namespace, projection.name, stream);
      const checkpoint = parseCheckpoint(await readOrNull(this.fs, file), projection, stream);
      let state: S;
      let start: number;
      let source: 'checkpoint' | 'rebuilt';
      const anchor = checkpoint ? parsed.events[checkpoint.seq - 1] : undefined;
      if (checkpoint && anchor && anchor.hash === checkpoint.hash) {
        state = checkpoint.state as S;
        start = checkpoint.seq;
        source = 'checkpoint';
      } else {
        state = cloneJson(projection.initial());
        start = 0;
        source = 'rebuilt';
      }
      for (const event of parsed.events.slice(start)) state = projection.reduce(state, event);
      state = cloneJson(state);
      const head = parsed.head;
      if (this.mode === 'read-write' && head && (!checkpoint || checkpoint.seq !== head.seq || checkpoint.hash !== head.hash || source === 'rebuilt')) {
        await this.ensure(this.paths.projectionsDir(namespace));
        const body = { format: PROJECTION_FORMAT, name: projection.name, version: projection.version, stream, seq: head.seq, hash: head.hash, state };
        await writeAtomic(this.fs, file, canonicalBytes(body), this.probe);
      }
      return { state, head, status: parsed.status, source };
    });
  }

  repairTornTail(namespace: NamespaceId, stream: StreamId): Promise<RepairResult> {
    return this.serial(async () => {
      this.assertWritable();
      this.namespace(namespace);
      streamId(stream);
      const path = this.paths.eventFile(namespace, stream);
      const bytes = await readOrNull(this.fs, path);
      const parsed = parseStream(bytes ?? new Uint8Array());
      if (!bytes || parsed.status.state !== 'torn-tail') {
        throw new StoreError('invalid-argument', `Stream ${namespace}/${stream} has no torn tail to repair`, { status: parsed.status });
      }
      const quarantined = await this.quarantineBytes(`journal-${namespace}-${sha256Hex(stream).slice(0, 16)}`, bytes);
      await writeAtomic(this.fs, path, bytes.subarray(0, parsed.validBytes), this.probe);
      this.streams.delete(overlayId(namespace, stream));
      return { quarantinedAs: quarantined, removedTailBytes: bytes.length - parsed.validBytes };
    });
  }

  // ---------------------------------------------------------------- usage / lifecycle

  usage(namespace: NamespaceId): Promise<NamespaceUsage> {
    return this.serial(async () => {
      this.assertOpen();
      const config = this.namespace(namespace);
      const entries = config.storageClass === 'evictable' ? await this.cacheIndex(namespace) : await this.scanNamespace(namespace);
      let bytes = 0;
      for (const entry of entries.values()) bytes += entry.bytes;
      return { namespace, storageClass: config.storageClass, items: entries.size, bytes, budgetBytes: config.budgetBytes ?? null };
    });
  }

  close(): Promise<void> {
    const wasClosed = this.closed;
    this.closed = true;
    const done = this.queue.then(() => undefined, () => undefined);
    if (wasClosed) return done;
    return done.then(async () => {
      await this.onClose?.();
    });
  }

  // ---------------------------------------------------------------- recovery (internal)

  /** Read-write open: roll committed manifests forward, then discard uncommitted temp/staging files. */
  async recover(): Promise<{ recovered: number; discarded: number }> {
    let recovered = 0;
    let discarded = 0;
    const txnDir = this.paths.txnDir();
    for (const name of await listOrEmpty(this.fs, txnDir)) {
      if (!name.endsWith('.commit')) continue;
      const manifest = parseManifest(await this.fs.readFile(join(txnDir, name)));
      if (!manifest) throw integrity(`Unreadable transaction manifest ${name}; refusing to guess`, { manifest: name });
      await this.applyManifest(manifest);
      await this.fs.unlink(join(txnDir, name));
      await syncDir(this.fs, txnDir, this.probe);
      recovered += 1;
    }
    const sweep = async (dir: string): Promise<void> => {
      let removed = false;
      for (const name of await listOrEmpty(this.fs, dir)) {
        const path = join(dir, name);
        if (name.startsWith(TEMP_PREFIX) || name.startsWith(STAGE_PREFIX)) {
          await this.fs.unlink(path);
          removed = true;
          discarded += 1;
        } else if ((await this.fs.stat(path))?.isDirectory) {
          await sweep(path);
        }
      }
      if (removed) await syncDir(this.fs, dir, this.probe);
    };
    await sweep(this.paths.dir);
    return { recovered, discarded };
  }

  /** Read-only open: present committed-but-unapplied transactions as applied, without writing. */
  async loadOverlay(): Promise<void> {
    const txnDir = this.paths.txnDir();
    const overlay = new Map<string, OverlayEntry>();
    for (const name of await listOrEmpty(this.fs, txnDir)) {
      if (!name.endsWith('.commit')) continue;
      this.pendingRecovery = true;
      const manifest = parseManifest(await this.fs.readFile(join(txnDir, name)));
      if (!manifest) {
        this.overlayBroken = true;
        continue;
      }
      for (const entry of manifest.entries) {
        overlay.set(overlayId(entry.namespace, entry.key), entry.kind === 'put' ? { kind: 'put', staged: entry.staged, target: entry.target } : { kind: 'delete' });
      }
    }
    this.overlay = overlay.size > 0 ? overlay : null;
  }

  // ---------------------------------------------------------------- helpers

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private assertOpen(): void {
    if (this.closed) throw new StoreError('closed', 'The store is closed');
  }

  private assertWritable(): void {
    this.assertOpen();
    if (this.mode !== 'read-write') {
      throw new StoreError('read-only', `The store is read-only (${this.readOnlyReason ?? 'unknown'})`, { reason: this.readOnlyReason });
    }
  }

  private namespace(namespace: NamespaceId): NamespaceConfig {
    namespaceId(namespace);
    const config = this.namespaces.get(namespace);
    if (!config) throw new StoreError('invalid-argument', `Namespace ${namespace} is not configured`, { namespace });
    return config;
  }

  private overlayFor(namespace: NamespaceId, key: string): OverlayEntry | undefined {
    if (this.overlayBroken) throw integrity('A pending transaction manifest is unreadable; documents cannot be read consistently');
    return this.overlay?.get(overlayId(namespace, key));
  }

  private abs(relativePath: string): string {
    return join(this.paths.dir, relativePath);
  }

  private rel(path: string): string {
    return relative(this.paths.dir, path);
  }

  private async ensure(dir: string): Promise<void> {
    await ensureDir(this.fs, this.rootDir, dir, this.probe, this.knownDirs);
  }

  private buildDocument(namespace: NamespaceId, key: DocumentKey, value: JsonValue, revision: number): { document: StoredDocument; bytes: Uint8Array } {
    const copy = cloneJson(value);
    const document: StoredDocument = { namespace, key, revision, valueDigest: digestOfJson(copy), updatedAt: this.clock.now(), value: copy };
    return { document, bytes: canonicalBytes({ format: DOC_FORMAT, ...document }) };
  }

  private checkItemSize(config: NamespaceConfig, bytes: number): void {
    const limit = Math.min(config.maxItemBytes ?? Number.POSITIVE_INFINITY, config.budgetBytes ?? Number.POSITIVE_INFINITY);
    if (bytes > limit) throw new StoreError('too-large', `Item of ${bytes} bytes exceeds the ${config.id} limit of ${limit}`, { bytes, limit, namespace: config.id });
  }

  private async readDocument(config: NamespaceConfig, key: string, path: string): Promise<StoredDocument | null> {
    const bytes = await readOrNull(this.fs, path);
    if (!bytes) return null;
    const envelope = parseEnvelope(bytes);
    if (envelope && envelope.namespace === config.id && envelope.key === key) {
      this.touch(config.id, path);
      return envelope;
    }
    return this.onCorrupt(config, path, `Document ${config.id}/${key} failed validation`);
  }

  private async readBlob(namespace: NamespaceId, digest: BlobDigest): Promise<Uint8Array | null> {
    this.assertOpen();
    const config = this.namespace(namespace);
    blobDigest(digest);
    const path = this.paths.blobFile(namespace, digest);
    const bytes = await readOrNull(this.fs, path);
    if (!bytes) return null;
    if (digestOfBytes(bytes) !== digest) return this.onCorrupt(config, path, `Blob ${digest} in ${namespace} does not match its digest`);
    this.touch(namespace, path);
    return bytes;
  }

  /** Evictable data is dropped and reported missing; authoritative data is never repaired silently. */
  private async onCorrupt(config: NamespaceConfig, path: string, message: string): Promise<null> {
    if (config.storageClass !== 'evictable') throw integrity(message, { namespace: config.id });
    if (this.mode === 'read-write') {
      await unlinkIfPresent(this.fs, path);
      await syncDir(this.fs, dirname(path), this.probe);
      this.caches.get(config.id)?.delete(path);
    }
    return null;
  }

  private async quarantineBytes(label: string, bytes: Uint8Array): Promise<string> {
    const dir = join(this.rootDir, 'quarantine');
    await this.ensure(dir);
    const path = join(dir, `${label}-${randomId(4)}`);
    await writeAtomic(this.fs, path, bytes, this.probe);
    return relative(this.rootDir, path);
  }

  private async applyManifest(manifest: TxnManifest): Promise<void> {
    const dirs = new Set<string>();
    for (const entry of manifest.entries) {
      const target = this.abs(entry.target);
      if (entry.kind === 'put') {
        const staged = this.abs(entry.staged);
        if (await this.fs.stat(staged)) {
          await this.fs.rename(staged, target);
        } else {
          const present = await readOrNull(this.fs, target);
          if (!present || sha256Hex(present) !== entry.sha256) {
            throw integrity(`Transaction ${manifest.id} cannot be completed: staged document for ${entry.namespace}/${entry.key} is missing`, { transaction: manifest.id });
          }
        }
      } else {
        await unlinkIfPresent(this.fs, target);
      }
      dirs.add(dirname(target));
    }
    for (const dir of dirs) await syncDir(this.fs, dir, this.probe);
  }

  private async loadStream(namespace: NamespaceId, stream: StreamId): Promise<StreamState> {
    const bytes = await readOrNull(this.fs, this.paths.eventFile(namespace, stream));
    const parsed = parseStream(bytes ?? new Uint8Array());
    const byClientId = new Map<string, EventRecord>();
    for (const event of parsed.events) if (event.clientEventId !== undefined) byClientId.set(event.clientEventId, event);
    return { status: parsed.status, head: parsed.head, exists: bytes !== null, byClientId };
  }

  private touch(namespace: NamespaceId, path: string): void {
    const entry = this.caches.get(namespace)?.get(path);
    if (entry) {
      this.tick += 1;
      entry.tick = this.tick;
    }
  }

  private async cacheIndex(namespace: NamespaceId): Promise<Map<string, CacheEntry>> {
    const existing = this.caches.get(namespace);
    if (existing) return existing;
    const scanned = await this.scanNamespace(namespace);
    const ordered = [...scanned.entries()].sort((left, right) => left[1].tick - right[1].tick);
    const index = new Map<string, CacheEntry>();
    for (const [path, entry] of ordered) {
      this.tick += 1;
      index.set(path, { bytes: entry.bytes, tick: this.tick });
    }
    this.caches.set(namespace, index);
    return index;
  }

  /** Documents and blobs (not journals or projections) with sizes; `tick` holds mtime for ordering. */
  private async scanNamespace(namespace: NamespaceId): Promise<Map<string, CacheEntry>> {
    const found = new Map<string, CacheEntry>();
    const add = async (path: string): Promise<void> => {
      const info = await this.fs.stat(path);
      if (info && !info.isDirectory) found.set(path, { bytes: info.size, tick: info.mtimeMs });
    };
    const docs = this.paths.docsDir(namespace);
    for (const name of await listOrEmpty(this.fs, docs)) if (!name.startsWith('.')) await add(join(docs, name));
    const blobs = this.paths.blobsDir(namespace);
    for (const fanout of await listOrEmpty(this.fs, blobs)) {
      if (fanout.startsWith('.')) continue;
      for (const name of await listOrEmpty(this.fs, join(blobs, fanout))) if (!name.startsWith('.')) await add(join(blobs, fanout, name));
    }
    return found;
  }

  private async recordCacheWrite(config: NamespaceConfig, path: string, bytes: number): Promise<void> {
    if (config.storageClass !== 'evictable') return;
    const index = await this.cacheIndex(config.id);
    this.tick += 1;
    index.set(path, { bytes, tick: this.tick });
    const budget = config.budgetBytes;
    if (budget === undefined) return;
    let total = 0;
    for (const entry of index.values()) total += entry.bytes;
    while (total > budget) {
      let victim: string | null = null;
      let oldest = Number.POSITIVE_INFINITY;
      for (const [candidate, entry] of index) {
        if (candidate !== path && entry.tick < oldest) {
          oldest = entry.tick;
          victim = candidate;
        }
      }
      if (victim === null) break;
      total -= index.get(victim)?.bytes ?? 0;
      index.delete(victim);
      await unlinkIfPresent(this.fs, victim);
      await syncDir(this.fs, dirname(victim), this.probe);
    }
  }
}

function checkExpected(namespace: NamespaceId, key: DocumentKey, current: StoredDocument | null, expected: number | null | undefined): void {
  if (expected === undefined) return;
  const actual = current?.revision ?? null;
  if (expected !== actual) {
    throw new StoreError('conflict', `Revision conflict for ${namespace}/${key}: expected ${String(expected)}, found ${String(actual)}`, { namespace, key, expected, actual });
  }
}

function integrity(message: string, details: Record<string, unknown> = {}): StoreError {
  return new StoreError('integrity', message, details);
}

function overlayId(namespace: string, key: string): string {
  return `${namespace}\u0000${key}`;
}

function splitOverlayId(id: string): [string, string] {
  const index = id.indexOf('\u0000');
  return [id.slice(0, index), id.slice(index + 1)];
}

function parseJson(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEnvelope(bytes: Uint8Array): StoredDocument | null {
  const value = parseJson(bytes);
  if (!isObject(value) || value.format !== DOC_FORMAT) return null;
  const { namespace, key, revision, valueDigest, updatedAt } = value;
  if (typeof namespace !== 'string' || typeof key !== 'string' || typeof updatedAt !== 'string' || typeof valueDigest !== 'string') return null;
  if (!Number.isSafeInteger(revision) || (revision as number) < 1 || !('value' in value)) return null;
  const json = value.value as JsonValue;
  try {
    if (digestOfJson(json) !== valueDigest) return null;
  } catch {
    return null;
  }
  return { namespace: namespace as NamespaceId, key: key as DocumentKey, revision: revision as number, valueDigest: valueDigest as BlobDigest, updatedAt, value: json };
}

function parseManifest(bytes: Uint8Array): TxnManifest | null {
  const value = parseJson(bytes);
  if (!isObject(value) || value.format !== TXN_FORMAT || typeof value.id !== 'string' || !Array.isArray(value.entries)) return null;
  for (const entry of value.entries) {
    if (!isObject(entry) || typeof entry.namespace !== 'string' || typeof entry.key !== 'string' || typeof entry.target !== 'string') return null;
    if (entry.target.startsWith('..') || entry.target.startsWith('/')) return null;
    if (entry.kind === 'put') {
      if (typeof entry.staged !== 'string' || typeof entry.sha256 !== 'string' || entry.staged.startsWith('..') || entry.staged.startsWith('/')) return null;
    } else if (entry.kind !== 'delete') {
      return null;
    }
  }
  return value as unknown as TxnManifest;
}

function parseCheckpoint<S extends JsonValue>(bytes: Uint8Array | null, projection: Projection<S>, stream: string): { seq: number; hash: string; state: JsonValue } | null {
  if (!bytes) return null;
  const value = parseJson(bytes);
  if (!isObject(value) || value.format !== PROJECTION_FORMAT || value.name !== projection.name || value.version !== projection.version || value.stream !== stream) return null;
  if (!Number.isSafeInteger(value.seq) || (value.seq as number) < 1 || typeof value.hash !== 'string' || !('state' in value)) return null;
  return { seq: value.seq as number, hash: value.hash, state: value.state as JsonValue };
}

function validateEventInput(event: EventInput): EventInput {
  if (!isObject(event)) throw new StoreError('invalid-argument', 'Event must be an object');
  const { type, payload, clientEventId } = event as EventInput;
  if (typeof type !== 'string' || type.length === 0 || type.length > MAX_EVENT_TYPE || /[\u0000-\u001f\u007f]/u.test(type)) {
    throw new StoreError('invalid-argument', 'Event type must be a short non-empty string');
  }
  if (clientEventId !== undefined) documentKey(clientEventId);
  return { type, payload: cloneJson(payload), ...(clientEventId === undefined ? {} : { clientEventId }) };
}
