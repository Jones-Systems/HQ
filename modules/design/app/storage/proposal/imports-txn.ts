/**
 * UNACCEPTED PROPOSAL — conformance scaffolding, not a durability claim.
 *
 * T13's `commit(ops)` promises atomicity across documents, blobs and events. T9's document CAS
 * and its multi-document manifest cover documents only: document CAS alone does NOT establish
 * atomicity across T13's documents, blobs and events, and nothing here changes that statement.
 *
 * This file sketches one way to get there so crash/replay checks can exercise it:
 *   1. stage content-addressed blobs (idempotent; an orphan blob is invisible and harmless);
 *   2. publish ONE T9 manifest holding the document puts, the blob-visibility records and an
 *      intent document that journals the event appends. That manifest rename is the commit point;
 *   3. replay the journalled events with `clientEventId = <txn>:<index>` (T9 makes a repeat a
 *      no-op) and mark the intent applied. Every operation, reads included, replays pending
 *      intents first, so a restart finishes whatever a crash interrupted.
 *
 * What the tests can and cannot show: after recovery the outcome is all-or-nothing for this
 * proposal on this fault model (process kill, not power loss). Between the commit point and the
 * replay, the raw store shows documents without their events; visibility is eventual, not atomic.
 * Staged orphan blobs and applied intents are never deleted here (retention is not decided).
 * A crash that tears an event append leaves that journal fail-closed in T9 (it never repairs a torn
 * tail on its own), so replay stays blocked, with the documents already visible, until the owner runs
 * T9's explicit `repairTornTail`; the tests exercise exactly that.
 * No production code imports this module. Accepting it is the integration owner's decision.
 */
import { isStoreErrorCode, type BlobDigest, type PutOp, type WorkspaceBacking } from '../backing.ts';

export const PROPOSAL_STATUS = Object.freeze({
  accepted: false as const,
  label: 'UNACCEPTED PROPOSAL: T13 docs+blobs+events transaction conformance scaffolding',
});

export const RESERVED_KEY_ROOT = 'design/storage/';
const INTENT_ROOT = `${RESERVED_KEY_ROOT}intents/`;
const BLOB_META_ROOT = `${RESERVED_KEY_ROOT}blob-meta/`;
const INTENT_FORMAT = 'hq.design.storage.txn-intent/v1';
const BLOB_META_FORMAT = 'hq.design.storage.blob-meta/v1';
const EVENT_TYPE = 'imports.event';

type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export type ProposedWriteOp =
  | { readonly op: 'put-document'; readonly namespace: string; readonly key: string; readonly value: Json; readonly expectedRevision: string | null }
  | { readonly op: 'put-blob'; readonly namespace: string; readonly digest: string; readonly mediaType: string; readonly bytes: Uint8Array }
  | { readonly op: 'append-event'; readonly namespace: string; readonly stream: string; readonly payload: Json; readonly expectedSeq: number };

export interface ProposedStoredDocument {
  readonly key: string;
  readonly value: Json;
  readonly revision: string;
}

export interface ProposedBlobInfo {
  readonly digest: string;
  readonly mediaType: string;
  readonly bytes: number;
}

export interface ProposedStoredEvent {
  readonly seq: number;
  readonly payload: Json;
}

/** Structurally T13's `StoragePort`. */
export interface ProposedImportsStorage {
  namespaces(): Promise<readonly { readonly name: string; readonly class: 'workspace' | 'draft' | 'cache' }[]>;
  getDocument(namespace: string, key: string): Promise<ProposedStoredDocument | null>;
  listDocuments(namespace: string, prefix?: string): Promise<readonly ProposedStoredDocument[]>;
  getBlob(namespace: string, digest: string): Promise<Uint8Array | null>;
  listBlobs(namespace: string): Promise<readonly ProposedBlobInfo[]>;
  listStreams(namespace: string): Promise<readonly string[]>;
  readEvents(namespace: string, stream: string): Promise<readonly ProposedStoredEvent[]>;
  commit(ops: readonly ProposedWriteOp[]): Promise<void>;
}

export interface ProposedImportsOptions {
  /** The single T13 namespace this scaffolding serves. */
  readonly namespace?: string;
  /** Builds the conflict error; pass T13's `StorageConflictError` for a drop-in. */
  readonly conflictError?: (message: string) => Error;
  readonly newTxnId?: () => string;
}

class ProposalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageConflictError';
  }
}

interface IntentEvent {
  readonly stream: string;
  readonly payload: Json;
}

interface Intent {
  readonly format: typeof INTENT_FORMAT;
  readonly txnId: string;
  readonly state: 'pending' | 'applied';
  readonly events: readonly IntentEvent[];
}

const isIntent = (value: unknown): value is Intent => typeof value === 'object' && value !== null
  && (value as Intent).format === INTENT_FORMAT && Array.isArray((value as Intent).events);

export function createProposedImportsStorage(workspace: WorkspaceBacking, options: ProposedImportsOptions = {}): ProposedImportsStorage {
  if (workspace.kind !== 'workspace') throw new ProposalConflictError('The proposal serves a workspace view only');
  const namespace = options.namespace ?? 'workspace';
  const conflict = options.conflictError ?? ((message: string) => new ProposalConflictError(message));
  const newTxnId = options.newTxnId ?? (() => globalThis.crypto.randomUUID());
  let queue: Promise<unknown> = Promise.resolve();
  let needsRecovery = true;

  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run, run);
    queue = next.then(() => undefined, () => undefined);
    return next;
  };
  const own = (ns: string): void => {
    if (ns !== namespace) throw conflict(`Unknown namespace ${JSON.stringify(ns)}`);
  };
  const userKey = (key: string): string => {
    if (key.startsWith(RESERVED_KEY_ROOT)) throw conflict(`Key ${JSON.stringify(key.slice(0, 60))} is reserved`);
    return key;
  };

  /** Replays every pending intent: idempotent events first, then the applied marker. */
  async function recover(): Promise<void> {
    if (!needsRecovery) return;
    for (const key of await workspace.listDocuments(INTENT_ROOT)) {
      const stored = await workspace.getDocument(key);
      if (!stored || !isIntent(stored.value) || stored.value.state !== 'pending') continue;
      const intent = stored.value;
      for (const [index, event] of intent.events.entries()) {
        await workspace.appendEvent(event.stream, { type: EVENT_TYPE, payload: event.payload, clientEventId: `${intent.txnId}:${index}` });
      }
      await workspace.putDocument(key, { format: INTENT_FORMAT, txnId: intent.txnId, state: 'applied', events: intent.events as unknown as Json }, { expectedRevision: stored.revision });
    }
    needsRecovery = false;
  }

  const read = <T>(run: () => Promise<T>): Promise<T> => serial(async () => {
    await recover();
    return run();
  });

  async function blobMeta(digest: string): Promise<ProposedBlobInfo | null> {
    const stored = await workspace.getDocument(`${BLOB_META_ROOT}${digest}`);
    const value = stored?.value as { format?: unknown; mediaType?: unknown; bytes?: unknown } | undefined;
    if (!stored || !value || value.format !== BLOB_META_FORMAT || typeof value.mediaType !== 'string' || typeof value.bytes !== 'number') return null;
    return { digest, mediaType: value.mediaType, bytes: value.bytes };
  }

  return Object.freeze({
    async namespaces() {
      return [{ name: namespace, class: 'workspace' as const }];
    },
    getDocument: (ns: string, key: string) => read(async () => {
      own(ns);
      const stored = await workspace.getDocument(userKey(key));
      return stored ? { key, value: stored.value as Json, revision: String(stored.revision) } : null;
    }),
    listDocuments: (ns: string, prefix = '') => read(async () => {
      own(ns);
      const out: ProposedStoredDocument[] = [];
      for (const key of await workspace.listDocuments(prefix)) {
        if (key.startsWith(RESERVED_KEY_ROOT)) continue;
        const stored = await workspace.getDocument(key);
        if (stored) out.push({ key, value: stored.value as Json, revision: String(stored.revision) });
      }
      return out;
    }),
    getBlob: (ns: string, digest: string) => read(async () => {
      own(ns);
      return (await blobMeta(digest)) ? workspace.getBlob(digest) : null; // visible only once its record is committed
    }),
    listBlobs: (ns: string) => read(async () => {
      own(ns);
      const out: ProposedBlobInfo[] = [];
      for (const blob of await workspace.listBlobs()) {
        const meta = await blobMeta(blob.digest);
        if (meta) out.push(meta);
      }
      return out.sort((a, b) => (a.digest < b.digest ? -1 : 1));
    }),
    listStreams: (ns: string) => read(async () => {
      own(ns);
      return workspace.listStreams();
    }),
    readEvents: (ns: string, stream: string) => read(async () => {
      own(ns);
      const events = await workspace.readEvents(stream);
      if (events.status.state !== 'ok') throw conflict(`Event stream ${stream} is ${events.status.state}`);
      return events.events.map((event) => ({ seq: event.seq, payload: event.payload as Json }));
    }),

    commit: (ops: readonly ProposedWriteOp[]) => serial(async () => {
      needsRecovery = true;
      await recover();
      // ---- validate everything against current state before any write
      const puts: PutOp[] = [];
      const blobs: Extract<ProposedWriteOp, { op: 'put-blob' }>[] = [];
      const seen = new Set<string>();
      const seqs = new Map<string, number>();
      const events: IntentEvent[] = [];
      for (const op of ops) {
        own(op.namespace);
        if (op.op === 'put-document') {
          userKey(op.key);
          if (seen.has(op.key)) throw conflict(`Document ${op.key} appears twice in one commit`);
          seen.add(op.key);
          const current = await workspace.getDocument(op.key);
          const revision = current ? String(current.revision) : null;
          if (revision !== op.expectedRevision) throw conflict(`Revision mismatch for ${op.key}`);
          puts.push({ key: op.key, value: op.value, expectedRevision: current ? current.revision : null });
        } else if (op.op === 'put-blob') {
          const meta = await blobMeta(op.digest);
          if (meta && meta.mediaType !== op.mediaType) throw conflict(`Blob media type mismatch for ${op.digest}`);
          blobs.push(op);
        } else {
          const base = seqs.get(op.stream) ?? (await workspace.readEvents(op.stream)).head?.seq ?? 0;
          if (base !== op.expectedSeq) throw conflict(`Sequence mismatch for ${op.stream}`);
          seqs.set(op.stream, base + 1);
          events.push({ stream: op.stream, payload: op.payload });
        }
      }
      // ---- 1. stage blobs (content-addressed; an orphan is invisible until its record commits)
      for (const blob of blobs) {
        try {
          await workspace.putBlob(blob.bytes, { expectedDigest: blob.digest as BlobDigest });
        } catch (error) {
          if (isStoreErrorCode(error, 'digest-mismatch')) throw conflict(`Blob digest mismatch for ${blob.digest}`);
          throw error;
        }
      }
      // ---- 2. the commit point: one manifest with documents, blob records and the event journal
      const txnId = newTxnId();
      const intentKey = `${INTENT_ROOT}${txnId}`;
      const manifest: PutOp[] = [...puts];
      for (const blob of blobs) {
        if (manifest.some((put) => put.key === `${BLOB_META_ROOT}${blob.digest}`) || (await blobMeta(blob.digest))) continue;
        manifest.push({ key: `${BLOB_META_ROOT}${blob.digest}`, value: { format: BLOB_META_FORMAT, mediaType: blob.mediaType, bytes: blob.bytes.byteLength }, expectedRevision: null });
      }
      if (events.length > 0) manifest.push({ key: intentKey, value: { format: INTENT_FORMAT, txnId, state: 'pending', events: events as unknown as Json }, expectedRevision: null });
      if (manifest.length > 0) {
        try {
          await workspace.commitPuts(manifest);
        } catch (error) {
          if (isStoreErrorCode(error, 'conflict')) throw conflict('A document changed while committing');
          throw error;
        }
      }
      // ---- 3. replay the journal; a crash from here on is finished by the next operation
      needsRecovery = true;
      await recover();
    }),
  });
}
