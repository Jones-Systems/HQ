/**
 * Namespace-bound views over the T9 StoragePort. Renderer-safe: only erased type imports from the
 * store contract, which declares types only and imports nothing.
 *
 * A workspace view is built by listing properties, never by spreading or proxying the store, so
 * `deleteDocument`, `deleteBlob`, `adoptBlob` and general `commit` are absent at runtime and not
 * merely hidden by a type. That keeps the no-deletion/retention hold: nothing that holds a workspace
 * view can remove authoritative data. `deleteBlob` exists only on the cache view, which the store
 * itself restricts to evictable namespaces.
 */
import type {
  BlobDigest,
  BlobRef,
  DocumentKey,
  EventInput,
  EventRecord,
  EventStreamRead,
  JsonValue,
  NamespaceId,
  NamespaceUsage,
  PutBlobOptions,
  StoragePort,
  StoredDocument,
  StreamId,
} from '../../../../packages/design-store/src/contract.ts';

export type { BlobDigest, BlobRef, EventInput, EventRecord, EventStreamRead, JsonValue, NamespaceUsage, StoredDocument };

export class NamespaceClassError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NamespaceClassError';
  }
}

export interface PutOp {
  readonly key: string;
  readonly value: JsonValue;
  /** `null` means the key must not exist; a number must equal the current revision. */
  readonly expectedRevision?: number | null;
}

/** Authoritative data: editable, backed up, never deleted through this view. */
export interface WorkspaceBacking {
  readonly kind: 'workspace';
  readonly namespace: string;
  getDocument(key: string): Promise<StoredDocument | null>;
  putDocument(key: string, value: JsonValue, options?: { readonly expectedRevision?: number | null }): Promise<StoredDocument>;
  listDocuments(prefix?: string): Promise<readonly string[]>;
  /** Atomic multi-document write through the store's durable manifest. Puts only: no deletes. */
  commitPuts(puts: readonly PutOp[]): Promise<readonly StoredDocument[]>;
  putBlob(bytes: Uint8Array, options?: PutBlobOptions): Promise<BlobRef>;
  getBlob(digest: string): Promise<Uint8Array | null>;
  hasBlob(digest: string): Promise<boolean>;
  listBlobs(): Promise<readonly BlobRef[]>;
  appendEvent(stream: string, event: EventInput): Promise<EventRecord>;
  readEvents(stream: string): Promise<EventStreamRead>;
  listStreams(prefix?: string): Promise<readonly string[]>;
}

/** Document-only workspace capability for section adapters. */
export type WorkspaceDocuments = Pick<WorkspaceBacking, 'kind' | 'namespace' | 'getDocument' | 'putDocument' | 'listDocuments'>;

export type WorkspaceRecords = WorkspaceDocuments & Pick<WorkspaceBacking, 'putBlob' | 'getBlob' | 'hasBlob' | 'appendEvent' | 'readEvents'>;

/** Read-only subset used by export and inspection code. */
export type WorkspaceReader = Pick<WorkspaceBacking, 'kind' | 'namespace' | 'getDocument' | 'listDocuments' | 'getBlob' | 'hasBlob' | 'listBlobs' | 'readEvents' | 'listStreams'>;

/** Evictable data: bounded, rebuildable, never exported. The only view that can delete (blobs). */
export interface CacheBacking {
  readonly kind: 'cache';
  readonly namespace: string;
  getDocument(key: string): Promise<StoredDocument | null>;
  putDocument(key: string, value: JsonValue, options?: { readonly expectedRevision?: number | null }): Promise<StoredDocument>;
  listDocuments(prefix?: string): Promise<readonly string[]>;
  putBlob(bytes: Uint8Array, options?: PutBlobOptions): Promise<BlobRef>;
  getBlob(digest: string): Promise<Uint8Array | null>;
  hasBlob(digest: string): Promise<boolean>;
  listBlobs(): Promise<readonly BlobRef[]>;
  /** Evictable blobs only; the store refuses anything else. */
  deleteBlob(digest: string): Promise<boolean>;
}

const doc = (key: string) => key as DocumentKey;
const stream = (id: string) => id as StreamId;
const digest = (value: string) => value as BlobDigest;

async function requireClass(store: StoragePort, namespace: string, expected: 'authoritative' | 'evictable'): Promise<void> {
  const usage = await store.usage(namespace as NamespaceId);
  if (usage.storageClass !== expected) {
    throw new NamespaceClassError(`Namespace ${JSON.stringify(namespace)} is ${usage.storageClass}, not ${expected}`);
  }
}

export async function bindWorkspace(store: StoragePort, namespace = 'workspace'): Promise<WorkspaceBacking> {
  await requireClass(store, namespace, 'authoritative');
  const ns = namespace as NamespaceId;
  return Object.freeze({
    kind: 'workspace' as const,
    namespace,
    getDocument: (key: string) => store.getDocument(ns, doc(key)),
    putDocument: (key: string, value: JsonValue, options?: { readonly expectedRevision?: number | null }) => store.putDocument(ns, doc(key), value, options),
    listDocuments: async (prefix?: string) => (await store.listDocuments(ns, prefix === undefined ? {} : { prefix })) as readonly string[],
    commitPuts: async (puts: readonly PutOp[]) => (await store.commit(puts.map((put) => ({
      op: 'put' as const,
      namespace: ns,
      key: doc(put.key),
      value: put.value,
      ...(put.expectedRevision === undefined ? {} : { expectedRevision: put.expectedRevision }),
    })))).documents as readonly StoredDocument[],
    putBlob: (bytes: Uint8Array, options?: PutBlobOptions) => store.putBlob(ns, bytes, options),
    getBlob: (value: string) => store.getBlob(ns, digest(value)),
    hasBlob: (value: string) => store.hasBlob(ns, digest(value)),
    listBlobs: () => store.listBlobs(ns),
    appendEvent: (id: string, event: EventInput) => store.appendEvent(ns, stream(id), event),
    readEvents: (id: string) => store.readEvents(ns, stream(id)),
    listStreams: async (prefix?: string) => (await store.listStreams(ns, prefix === undefined ? {} : { prefix })) as readonly string[],
  });
}

export async function bindCache(store: StoragePort, namespace = 'cache'): Promise<CacheBacking> {
  await requireClass(store, namespace, 'evictable');
  const ns = namespace as NamespaceId;
  return Object.freeze({
    kind: 'cache' as const,
    namespace,
    getDocument: (key: string) => store.getDocument(ns, doc(key)),
    putDocument: (key: string, value: JsonValue, options?: { readonly expectedRevision?: number | null }) => store.putDocument(ns, doc(key), value, options),
    listDocuments: async (prefix?: string) => (await store.listDocuments(ns, prefix === undefined ? {} : { prefix })) as readonly string[],
    putBlob: (bytes: Uint8Array, options?: PutBlobOptions) => store.putBlob(ns, bytes, options),
    getBlob: (value: string) => store.getBlob(ns, digest(value)),
    hasBlob: (value: string) => store.hasBlob(ns, digest(value)),
    listBlobs: () => store.listBlobs(ns),
    deleteBlob: (value: string) => store.deleteBlob(ns, digest(value)),
  });
}

/** Read-only projection of a workspace view; `kind` is checked so a cache view can never be passed as one. */
export function asReader(workspace: WorkspaceBacking): WorkspaceReader {
  if (workspace.kind !== 'workspace') throw new NamespaceClassError('A workspace view is required');
  return Object.freeze({
    kind: workspace.kind,
    namespace: workspace.namespace,
    getDocument: workspace.getDocument,
    listDocuments: workspace.listDocuments,
    getBlob: workspace.getBlob,
    hasBlob: workspace.hasBlob,
    listBlobs: workspace.listBlobs,
    readEvents: workspace.readEvents,
    listStreams: workspace.listStreams,
  });
}

/** Duck-typed so renderer code need not import the store's error class. */
export function isStoreErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'StoreError' && (error as { code?: unknown }).code === code;
}
