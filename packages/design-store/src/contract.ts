/**
 * Section-local StoragePort contract for HQ Design (T9 / HQD-08).
 *
 * This is the first-deliverable contract named in spec.hq-design#iface.contracts.001. It is
 * proposed for promotion on the coordination issue; until then consumers keep matching local
 * ports and labelled fakes. The file-backed implementation in this package is Node-only and is
 * wired to the Electron main process and typed IPC by the root integration owner.
 */

export type Brand<T, K extends string> = T & { readonly __kind: K };

/** Configured namespace such as `workspace` or `cache`: `^[a-z][a-z0-9-]{0,31}$`. */
export type NamespaceId = Brand<string, 'NamespaceId'>;
/** Document key: 1–256 characters, no control characters, never derived from a display title. */
export type DocumentKey = Brand<string, 'DocumentKey'>;
/** Event stream identifier, same rules as a document key. */
export type StreamId = Brand<string, 'StreamId'>;
/** Content digest in the form `sha256:<64 lowercase hex>`. */
export type BlobDigest = Brand<string, 'BlobDigest'>;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * `authoritative` data is editable, backed up and never silently repaired.
 * `evictable` data is bounded, may be evicted or rebuilt, and is excluded from bundles/backups.
 */
export type StorageClass = 'authoritative' | 'evictable';

export interface NamespaceConfig {
  readonly id: NamespaceId;
  readonly storageClass: StorageClass;
  /** Evictable namespaces only: total bytes kept before least-recently-used eviction. */
  readonly budgetBytes?: number;
  /** Largest single document or blob accepted in this namespace. */
  readonly maxItemBytes?: number;
}

export interface StoredDocument<T extends JsonValue = JsonValue> {
  readonly namespace: NamespaceId;
  readonly key: DocumentKey;
  /** Starts at 1 and increments on each committed write of this key. */
  readonly revision: number;
  /** Digest of the RFC 8785 canonical form of `value`. */
  readonly valueDigest: BlobDigest;
  readonly updatedAt: string;
  readonly value: T;
}

export interface WriteOptions {
  /** Optimistic check: `null` means the key must not exist; a number must equal the current revision. */
  readonly expectedRevision?: number | null;
}

export type TransactionOp =
  | {
    readonly op: 'put';
    readonly namespace: NamespaceId;
    readonly key: DocumentKey;
    readonly value: JsonValue;
    readonly expectedRevision?: number | null;
  }
  | {
    readonly op: 'delete';
    readonly namespace: NamespaceId;
    readonly key: DocumentKey;
    readonly expectedRevision?: number | null;
  };

export interface CommitResult {
  readonly transactionId: string;
  readonly documents: readonly StoredDocument[];
  readonly deleted: readonly { readonly namespace: NamespaceId; readonly key: DocumentKey }[];
}

export interface BlobRef {
  readonly digest: BlobDigest;
  readonly bytes: number;
}

export interface PutBlobOptions {
  /** When supplied, bytes whose digest differs are rejected without any write. */
  readonly expectedDigest?: BlobDigest;
}

export interface EventInput {
  readonly type: string;
  readonly payload: JsonValue;
  /** Idempotency key: same id and payload is a no-op, same id with a different payload conflicts. */
  readonly clientEventId?: string;
}

export interface EventRecord {
  readonly seq: number;
  /** Hash of the previous record, `null` for the first. */
  readonly prev: string | null;
  readonly at: string;
  readonly type: string;
  readonly payload: JsonValue;
  readonly clientEventId?: string;
  /** SHA-256 hex of the canonical record without `hash`. */
  readonly hash: string;
}

export interface StreamHead {
  readonly seq: number;
  readonly hash: string;
}

export type StreamStatus =
  | { readonly state: 'ok' }
  /** An incomplete final line from an interrupted append. Appends fail closed until explicit repair. */
  | { readonly state: 'torn-tail'; readonly validBytes: number; readonly tailBytes: number }
  /** A broken record or link before the tail. Never truncated automatically. */
  | { readonly state: 'corrupt'; readonly atSeq: number; readonly reason: string };

export interface EventStreamRead {
  /** Valid, verified prefix of the stream. */
  readonly events: readonly EventRecord[];
  readonly head: StreamHead | null;
  readonly status: StreamStatus;
}

export interface Projection<S extends JsonValue> {
  /** `^[a-z][a-z0-9-]{0,63}$`; part of the checkpoint identity together with `version`. */
  readonly name: string;
  /** Bump to discard checkpoints written by an older reducer. */
  readonly version: number;
  readonly initial: () => S;
  readonly reduce: (state: S, event: EventRecord) => S;
}

export interface ProjectionResult<S extends JsonValue> {
  readonly state: S;
  readonly head: StreamHead | null;
  readonly status: StreamStatus;
  /** `checkpoint`: resumed from a verified checkpoint; `rebuilt`: folded from the first event. */
  readonly source: 'checkpoint' | 'rebuilt';
}

export interface RepairResult {
  /** Store-relative path of the preserved original bytes. */
  readonly quarantinedAs: string;
  readonly removedTailBytes: number;
}

export interface NamespaceUsage {
  readonly namespace: NamespaceId;
  readonly storageClass: StorageClass;
  readonly items: number;
  readonly bytes: number;
  readonly budgetBytes: number | null;
}

export type StoreMode = 'read-write' | 'read-only';
export type ReadOnlyReason = 'requested' | 'future-schema' | 'unsupported-layout';

export interface StoreHealth {
  readonly mode: StoreMode;
  readonly readOnlyReason: ReadOnlyReason | null;
  readonly storedSchemaVersion: number;
  readonly supportedSchemaVersion: number;
  readonly generation: string;
  /** A committed transaction awaits roll-forward (read-only opens never perform it). */
  readonly pendingRecovery: boolean;
  /** Directory fsync may be unavailable on some platforms; durability is then weaker. */
  readonly directoryFsync: 'supported' | 'unsupported' | 'unknown';
}

export interface StoragePort {
  health(): StoreHealth;

  getDocument(namespace: NamespaceId, key: DocumentKey): Promise<StoredDocument | null>;
  putDocument(namespace: NamespaceId, key: DocumentKey, value: JsonValue, options?: WriteOptions): Promise<StoredDocument>;
  deleteDocument(namespace: NamespaceId, key: DocumentKey, options?: WriteOptions): Promise<boolean>;
  listDocuments(namespace: NamespaceId, options?: { readonly prefix?: string }): Promise<readonly DocumentKey[]>;
  /** Atomic multi-document commit through a durable manifest; all ops apply or none do. */
  commit(ops: readonly TransactionOp[]): Promise<CommitResult>;

  putBlob(namespace: NamespaceId, bytes: Uint8Array, options?: PutBlobOptions): Promise<BlobRef>;
  getBlob(namespace: NamespaceId, digest: BlobDigest): Promise<Uint8Array | null>;
  hasBlob(namespace: NamespaceId, digest: BlobDigest): Promise<boolean>;
  /** Copies a verified blob into another namespace (for example cache → workspace before eviction). */
  adoptBlob(from: NamespaceId, to: NamespaceId, digest: BlobDigest): Promise<BlobRef>;

  appendEvent(namespace: NamespaceId, stream: StreamId, event: EventInput): Promise<EventRecord>;
  readEvents(namespace: NamespaceId, stream: StreamId): Promise<EventStreamRead>;
  project<S extends JsonValue>(namespace: NamespaceId, stream: StreamId, projection: Projection<S>): Promise<ProjectionResult<S>>;
  /** Explicit owner action only: preserves the original journal, then removes an incomplete final line. */
  repairTornTail(namespace: NamespaceId, stream: StreamId): Promise<RepairResult>;

  usage(namespace: NamespaceId): Promise<NamespaceUsage>;
  close(): Promise<void>;
}

/** Injected wall clock; tests supply a deterministic fake. */
export interface Clock {
  now(): string;
}

/** A schema migration step. `run` receives a writable port over a working copy, never the live data. */
export interface Migration {
  readonly from: number;
  readonly to: number;
  readonly description: string;
  readonly run: (context: MigrationContext) => Promise<void>;
}

export interface MigrationContext {
  readonly store: StoragePort;
  readonly from: number;
  readonly to: number;
}

export interface MigrationReport {
  readonly from: number;
  readonly to: number;
  readonly snapshotId: string;
  readonly steps: readonly string[];
}

export interface OpenReport {
  /** Committed transactions rolled forward during open. */
  readonly recoveredTransactions: number;
  /** Uncommitted temp/staged files discarded during open. */
  readonly discardedTempFiles: number;
  /** Interrupted migration or snapshot working copies moved to quarantine. */
  readonly quarantined: readonly string[];
  readonly migration: MigrationReport | null;
  readonly createdStore: boolean;
}
