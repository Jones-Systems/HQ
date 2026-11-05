/** Node-only manifest-visible imports. Raw store access is outside the reader-atomicity contract. */
import { createHash } from 'node:crypto';
import type { StoragePort, BlobDigest, NamespaceId, StreamId, JsonValue, RepairResult, StoreHealth } from '../../../../packages/design-store/src/contract.ts';
import { StoreError } from '../../../../packages/design-store/src/errors.ts';
import { documentKey, blobDigest } from '../../../../packages/design-store/src/ids.ts';
import { encodeName } from '../../../../packages/design-store/src/layout.ts';
import { cloneJson, canonicalBytes, digestOfBytes, digestOfJson } from '../../../../packages/design-store/src/jcs.ts';
import { StorageConflictError } from '../../imports/src/contract.ts';
import type { WriteOp, StoragePort as ImportsStoragePort } from '../../imports/src/contract.ts';
import { bindWorkspace, isStoreErrorCode, type WorkspaceBacking, type PutOp } from './backing.ts';
import { TransactionGate } from './transaction-gate.ts';

export const TRANSACTION_STATUS = Object.freeze({ accepted: false as const, state: 'disabled' as const });
export const IMPORT_TRANSACTION_SCHEMA = 'hq.design.storage.import-txn/v1';
const INTENTS = 'design/storage/intents/';
const META = 'design/storage/blob-meta/';
const runtimes = new WeakMap<DesignTransactions, TransactionRuntime>();
const NS = 'workspace' as NamespaceId;
const ROOTS = ['projects', 'components', 'flows', 'compare', 'annotations', 'requests', 'references', 'connector', 'imports'].map(s => `design/${s}/`);
export const IMPORT_LIMITS = Object.freeze({ totalBytes: 64 * 1024 * 1024, blobBytes: 16 * 1024 * 1024, ops: 10_000 });
export type Unavailable = { readonly ok: false; readonly kind: 'unavailable'; readonly reason: 'disabled' | 'stream-enumeration' };
export type EngineResult<T> = { readonly ok: true; readonly value: T } | Unavailable;
export const disabled = (): Unavailable => ({ ok: false, kind: 'unavailable', reason: 'disabled' });
export interface BlockedIntent { readonly txnId: string; readonly keys: readonly string[]; readonly streams: readonly string[]; readonly reason: string }
export interface RecoveryReport { readonly applied: readonly string[]; readonly blocked: readonly BlockedIntent[] }
export interface RepairReport { readonly txnId: string; readonly quarantine: readonly RepairResult[] }
export interface StorageDiagnostics {
  readonly orphanBlobs: { readonly count: number; readonly bytes: number };
  readonly pending: readonly string[];
  readonly blocked: readonly BlockedIntent[];
  readonly directoryFsync: StoreHealth['directoryFsync'];
}
export interface DesignTransactions {
  readonly status: typeof TRANSACTION_STATUS;
  readonly workspace: WorkspaceBacking;
  commit(ops: readonly WriteOp[]): Promise<EngineResult<{ readonly txnId: string }>>;
  recover(): Promise<EngineResult<RecoveryReport>>;
  repair(txnId: string): Promise<EngineResult<RepairReport>>;
  diagnostics(): Promise<EngineResult<StorageDiagnostics>>;
}
interface IntentStream { stream: string; baseSeq: number; payloadDigests: string[]; payloads: JsonValue[] }
interface Intent { schema: typeof IMPORT_TRANSACTION_SCHEMA; txnId: string; state: 'committed' | 'applied'; keys: string[]; blobs: string[]; streams: IntentStream[] }
interface Pending { intent: Intent; revision: number; reason: string }
export interface TransactionRuntime {
  readonly port: DesignTransactions;
  readonly raw: WorkspaceBacking;
  readonly gate: TransactionGate;
  readonly store: StoragePort;
  readonly blocked: () => readonly BlockedIntent[];
  readonly visibleBlob: (digest: string) => Promise<boolean>;
  initialize(): Promise<void>;
}
const fail = (message: string): never => { throw new StoreError('invalid-argument', message); };
const conflict = (message: string): never => { throw new StoreError('conflict', message); };
export function designKey(key: string, stream = false): string {
  documentKey(key);
  if ((!ROOTS.some(root => key.startsWith(root) && key.length > root.length)
    && !key.startsWith('design.canvas.arrangement.v1/') && !(stream && key === 'design/imports'))
    || key.split('/').includes('..') || encodeName(key).startsWith('=')) fail('Invalid, reserved or non-enumerable Design key');
  return key;
}
function revision(value: string | null): number | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value))) fail('Invalid expected revision');
  return Number(value);
}
const typeOf = (stream: string) => stream.startsWith('design/requests/') ? 'requests.event-bytes' : 'imports.event';
function snapshot(ops: readonly WriteOp[]): { ops: WriteOp[]; txnId: string } {
  if (!Array.isArray(ops) || ops.length > IMPORT_LIMITS.ops || !ops.length) fail('Invalid operation count');
  const copied: WriteOp[] = [];
  let size = 0;
  for (const op of ops) {
    if (!op || op.namespace !== 'workspace') fail('Only workspace imports are supported');
    const allowed = op.op === 'put-document' ? ['op', 'namespace', 'key', 'value', 'expectedRevision']
      : op.op === 'put-blob' ? ['op', 'namespace', 'digest', 'mediaType', 'bytes']
      : op.op === 'append-event' ? ['op', 'namespace', 'stream', 'payload', 'expectedSeq'] : fail('Unknown operation');
    if (Object.keys(op).length !== allowed.length || Object.keys(op).some(k => !allowed.includes(k))) fail('Invalid operation fields');
    if (op.op === 'put-document') {
      designKey(op.key); revision(op.expectedRevision);
      const value = cloneJson(op.value); size += canonicalBytes(value).byteLength;
      copied.push({ ...op, value });
    } else if (op.op === 'put-blob') {
      blobDigest(op.digest);
      if (!(op.bytes instanceof Uint8Array) || op.bytes.byteLength > IMPORT_LIMITS.blobBytes || typeof op.mediaType !== 'string' || !op.mediaType.trim() || op.mediaType.length > 256) fail('Invalid blob');
      const bytes = new Uint8Array(op.bytes);
      if (String(digestOfBytes(bytes)) !== op.digest) fail('Blob digest mismatch');
      size += bytes.byteLength;
      copied.push({ ...op, bytes });
    } else {
      designKey(op.stream, true);
      if (!Number.isSafeInteger(op.expectedSeq) || op.expectedSeq < 0) fail('Invalid expected sequence');
      const payload = cloneJson(op.payload); size += canonicalBytes(payload).byteLength;
      copied.push({ ...op, payload });
    }
    // Count the complete canonical representation as well, including keys and base64 overhead.
    if (size > IMPORT_LIMITS.totalBytes) fail('Import exceeds total byte cap');
  }
  const bytes = canonicalBytes(copied.map(op => op.op === 'put-blob' ? { ...op, bytes: Buffer.from(op.bytes).toString('base64') } : op));
  if (bytes.byteLength > IMPORT_LIMITS.totalBytes) fail('Canonical import exceeds total byte cap');
  return { ops: copied, txnId: createHash('sha256').update(bytes).digest('hex') };
}
function parseIntent(value: JsonValue, key: string): Intent {
  const intent = value as unknown as Intent;
  if (!intent || intent.schema !== IMPORT_TRANSACTION_SCHEMA || !/^[0-9a-f]{64}$/u.test(intent.txnId)
    || key !== INTENTS + intent.txnId || !['committed', 'applied'].includes(intent.state)
    || !Array.isArray(intent.keys) || !Array.isArray(intent.blobs) || !Array.isArray(intent.streams)) throw new StoreError('integrity', 'Invalid import intent');
  for (const key of intent.keys) designKey(key);
  for (const digest of intent.blobs) blobDigest(digest);
  for (const s of intent.streams) {
    designKey(s.stream, true);
    if (!Number.isSafeInteger(s.baseSeq) || s.baseSeq < 0 || !Array.isArray(s.payloads) || !Array.isArray(s.payloadDigests)
      || s.payloads.length !== s.payloadDigests.length || s.payloads.some((p, i) => digestOfJson(p) !== s.payloadDigests[i])) throw new StoreError('integrity', 'Invalid replay payloads');
  }
  return intent;
}

/** Internal constructor. Only test/engine-fixture.ts requests enablement; node.ts never does. */
export async function createTransactionRuntime(store: StoragePort, enabled = false): Promise<TransactionRuntime> {
  const raw = await bindWorkspace(store);
  const gate = new TransactionGate();
  const pending = new Map<string, Pending>();
  const blocked = (): BlockedIntent[] => [...pending.values()].map(p => ({ txnId: p.intent.txnId, keys: p.intent.keys, streams: p.intent.streams.map(s => s.stream), reason: p.reason }));
  const blockedKey = (key: string, stream = false) => [...pending.values()].some(p => stream ? p.intent.streams.some(s => s.stream === key) : p.intent.keys.includes(key));
  const assertAvailable = (key: string, stream = false) => {
    if (key.startsWith('design/storage/') || blockedKey(key, stream)) throw new StoreError('stream-unavailable', 'Import scope unavailable');
  };
  const meta = async (digest: string) => raw.getDocument(META + digest);
  const visibleBlob = async (digest: string) => {
    if ([...pending.values()].some(p => p.intent.blobs.includes(digest))) return false;
    return (await meta(digest)) !== null;
  };
  const scan = async () => {
    for (const key of await raw.listDocuments(INTENTS)) {
      const doc = await raw.getDocument(key);
      if (!doc) throw new StoreError('integrity', 'Missing listed intent');
      // The unchanged, unaccepted proposal has its own format and recovery owner.
      if (doc.value && typeof doc.value === 'object' && !Array.isArray(doc.value)
        && (doc.value as { format?: unknown }).format === 'hq.design.storage.txn-intent/v1') continue;
      const intent = parseIntent(doc.value, key);
      if (intent.state === 'committed' && !pending.has(intent.txnId)) pending.set(intent.txnId, { intent, revision: doc.revision, reason: 'pending' });
    }
  };
  const replay = async (p: Pending) => {
    if (p.reason === 'reopen-required') throw new StoreError('stream-unavailable', 'Reopen required');
    for (const [s, stream] of p.intent.streams.entries()) {
      const read = await raw.readEvents(stream.stream);
      if (read.status.state !== 'ok') throw new StoreError('stream-unavailable', read.status.state);
      const suffix = read.events.slice(stream.baseSeq);
      if ((read.head?.seq ?? 0) < stream.baseSeq || suffix.length > stream.payloads.length) conflict('Replay sequence diverged');
      for (const [i, event] of suffix.entries()) {
        if (event.clientEventId !== `${p.intent.txnId}:${s}:${i}` || event.type !== typeOf(stream.stream)
          || digestOfJson(event.payload) !== stream.payloadDigests[i]) conflict('Replay suffix diverged');
      }
      for (const [i, payload] of stream.payloads.entries()) await raw.appendEvent(stream.stream, { type: typeOf(stream.stream), payload, clientEventId: `${p.intent.txnId}:${s}:${i}` });
    }
    await raw.putDocument(INTENTS + p.intent.txnId, { ...p.intent, state: 'applied' } as unknown as JsonValue, { expectedRevision: p.revision });
    pending.delete(p.intent.txnId);
  };
  const recover = async (): Promise<RecoveryReport> => {
    await scan();
    const applied: string[] = [];
    for (const p of pending.values()) {
      if (p.reason === 'reopen-required') continue;
      try { await replay(p); applied.push(p.intent.txnId); }
      catch (error) {
        if (!isStoreErrorCode(error, 'stream-unavailable') && !isStoreErrorCode(error, 'conflict')) throw error;
        p.reason = error instanceof Error ? error.message : 'blocked';
      }
    }
    return { applied, blocked: blocked() };
  };
  const workspace: WorkspaceBacking = Object.freeze({
    kind: 'workspace', namespace: 'workspace',
    getDocument: key => gate.shared(async () => { assertAvailable(key); return raw.getDocument(key); }),
    putDocument: (key, value, options) => gate.shared(async () => { assertAvailable(key); return raw.putDocument(key, value, options); }),
    listDocuments: prefix => gate.shared(async () => (await raw.listDocuments(prefix)).filter(k => !k.startsWith('design/storage/') && !blockedKey(k))),
    commitPuts: puts => gate.shared(async () => { for (const p of puts) assertAvailable(p.key); return raw.commitPuts(puts); }),
    putBlob: (bytes, options) => gate.shared(async () => {
      const digest = digestOfBytes(bytes);
      if ([...pending.values()].some(p => p.intent.blobs.includes(digest))) throw new StoreError('stream-unavailable', 'Blob unavailable');
      const blob = await raw.putBlob(bytes, options);
      if (!await meta(digest)) {
        try { await raw.putDocument(META + digest, { digest, bytes: blob.bytes, mediaType: 'application/octet-stream' }, { expectedRevision: null }); }
        catch (error) { if (!isStoreErrorCode(error, 'conflict') || !await meta(digest)) throw error; }
      }
      return blob;
    }),
    getBlob: digest => gate.shared(async () => {
      if ([...pending.values()].some(p => p.intent.blobs.includes(digest))) throw new StoreError('stream-unavailable', 'Blob unavailable');
      return await visibleBlob(digest) ? raw.getBlob(digest) : null;
    }),
    hasBlob: digest => gate.shared(async () => {
      if ([...pending.values()].some(p => p.intent.blobs.includes(digest))) throw new StoreError('stream-unavailable', 'Blob unavailable');
      return await visibleBlob(digest) && await raw.hasBlob(digest);
    }),
    listBlobs: () => gate.shared(async () => {
      const out = [];
      for (const blob of await raw.listBlobs()) if (await visibleBlob(blob.digest)) out.push(blob);
      return out;
    }),
    appendEvent: (stream, event) => gate.shared(async () => { assertAvailable(stream, true); return raw.appendEvent(stream, event); }),
    readEvents: stream => gate.shared(async () => { assertAvailable(stream, true); return raw.readEvents(stream); }),
    listStreams: prefix => gate.shared(async () => (await raw.listStreams(prefix)).filter(s => !blockedKey(s, true))),
  } satisfies WorkspaceBacking);
  const port: DesignTransactions = Object.freeze({
    status: TRANSACTION_STATUS,
    workspace,
    async commit(input) {
      if (!enabled) return disabled();
      const captured = snapshot(input);
      return gate.exclusive(async () => {
        const { ops, txnId } = captured;
        const existing = await raw.getDocument(INTENTS + txnId);
        if (pending.get(txnId)?.reason === 'reopen-required') throw new StoreError('stream-unavailable', 'Reopen required');
        if (existing) {
          const intent = parseIntent(existing.value, INTENTS + txnId);
          if (intent.state === 'committed') {
            const p = pending.get(txnId) ?? { intent, revision: existing.revision, reason: 'pending' };
            pending.set(txnId, p); await replay(p);
          }
          pending.delete(txnId);
          return { ok: true, value: { txnId } };
        }
        const puts: PutOp[] = [], keys = new Set<string>(), streams = new Map<string, IntentStream>();
        const blobs = new Map<string, Extract<WriteOp, { op: 'put-blob' }>>();
        for (const op of ops) {
          if (op.op === 'put-document') {
            assertAvailable(op.key);
            if (keys.has(op.key)) fail('Duplicate document');
            keys.add(op.key);
            const expectedRevision = revision(op.expectedRevision);
            if (((await raw.getDocument(op.key))?.revision ?? null) !== expectedRevision) conflict('Document revision mismatch');
            puts.push({ key: op.key, value: op.value, expectedRevision });
          } else if (op.op === 'append-event') {
            assertAvailable(op.stream, true);
            let stream = streams.get(op.stream);
            if (!stream) {
              const read = await raw.readEvents(op.stream);
              if (read.status.state !== 'ok') throw new StoreError('stream-unavailable', read.status.state);
              stream = { stream: op.stream, baseSeq: read.head?.seq ?? 0, payloads: [], payloadDigests: [] };
              streams.set(op.stream, stream);
            }
            if (stream.baseSeq + stream.payloads.length !== op.expectedSeq) conflict('Event sequence mismatch');
            stream.payloads.push(op.payload); stream.payloadDigests.push(digestOfJson(op.payload));
          } else {
            if ([...pending.values()].some(p => p.intent.blobs.includes(op.digest))) throw new StoreError('stream-unavailable', 'Blob unavailable');
            const previous = blobs.get(op.digest);
            if (previous && previous.mediaType !== op.mediaType) conflict('Conflicting blob metadata');
            const stored = await meta(op.digest);
            const value = { digest: op.digest, bytes: op.bytes.byteLength, mediaType: op.mediaType };
            if (stored && digestOfJson(stored.value) !== digestOfJson(value)) conflict('Blob metadata mismatch');
            if (!stored && !previous) puts.push({ key: META + op.digest, value, expectedRevision: null });
            blobs.set(op.digest, op);
          }
        }
        const intent: Intent = { schema: IMPORT_TRANSACTION_SCHEMA, txnId, state: 'committed', keys: [...keys], blobs: [...blobs.keys()], streams: [...streams.values()] };
        for (const blob of blobs.values()) await raw.putBlob(blob.bytes, { expectedDigest: blob.digest as string as BlobDigest });
        const p: Pending = { intent, revision: 1, reason: 'pending' };
        pending.set(txnId, p);
        try { await raw.commitPuts([...puts, { key: INTENTS + txnId, value: intent as unknown as JsonValue, expectedRevision: null }]); }
        catch (error) { p.reason = 'reopen-required'; throw error; }
        try { await replay(p); }
        catch (error) { p.reason = error instanceof Error ? error.message : 'blocked'; throw error; }
        return { ok: true, value: { txnId } };
      });
    },
    recover: () => enabled ? gate.exclusive(async () => ({ ok: true as const, value: await recover() })) : Promise.resolve(disabled()),
    repair: txnId => enabled ? gate.exclusive(async () => {
      const p = pending.get(txnId);
      if (!p || p.reason === 'reopen-required') throw new StoreError('stream-unavailable', 'No repairable intent; reopen may be required');
      const torn: string[] = [];
      for (const stream of p.intent.streams) {
        const read = await raw.readEvents(stream.stream);
        if (read.status.state === 'corrupt') throw new StoreError('stream-unavailable', 'Corrupt streams are never repaired');
        if (read.status.state === 'torn-tail') torn.push(stream.stream);
      }
      const quarantine: RepairResult[] = [];
      for (const stream of torn) quarantine.push(await store.repairTornTail(NS, stream as StreamId));
      await replay(p);
      return { ok: true as const, value: { txnId, quarantine } };
    }) : Promise.resolve(disabled()),
    diagnostics: () => gate.shared(async () => {
      try { await raw.listStreams(); }
      catch (error) { if (isStoreErrorCode(error, 'integrity')) return { ok: false as const, kind: 'unavailable' as const, reason: 'stream-enumeration' as const }; throw error; }
      let count = 0, bytes = 0;
      for (const blob of await raw.listBlobs()) if (!await meta(blob.digest) && !await visibleBlob(blob.digest)) { count++; bytes += blob.bytes; }
      return { ok: true as const, value: { orphanBlobs: { count, bytes }, pending: [...pending.keys()], blocked: blocked(), directoryFsync: store.health().directoryFsync } };
    }),
  } satisfies DesignTransactions);
  const runtime: TransactionRuntime = { port, raw, store, gate, blocked, visibleBlob, initialize: () => gate.exclusive(async () => { if (enabled) await recover(); else await scan(); }) };
  runtimes.set(port, runtime);
  return runtime;
}

/** Maps the existing imports lane's relative names to the Design-only engine. */
export function createImportsStorage(transactions: DesignTransactions): ImportsStoragePort {
  const w = transactions.workspace;
  const key = (value: string) => value.startsWith('imports/') ? `design/${value}` : value;
  const stream = (value: string) => value === 'imports' ? 'design/imports' : key(value);
  const unmap = (value: string) => value.startsWith('design/imports') ? value.slice(7) : value;
  const ns = (namespace: string) => { if (namespace !== 'workspace') fail('Unknown namespace'); };
  return {
    async namespaces() { return [{ name: 'workspace', class: 'workspace' }]; },
    async getDocument(namespace, id) { ns(namespace); const d = await w.getDocument(key(id)); return d ? { key: id, value: d.value, revision: String(d.revision) } : null; },
    async listDocuments(namespace, prefix = '') {
      ns(namespace); const out = [];
      for (const id of await w.listDocuments(prefix ? key(prefix) : undefined)) { const d = await w.getDocument(id); if (d) out.push({ key: unmap(id), value: d.value, revision: String(d.revision) }); }
      return out.sort((a, b) => a.key < b.key ? -1 : 1);
    },
    async getBlob(namespace, digest) { ns(namespace); return w.getBlob(digest); },
    async listBlobs(namespace) {
      ns(namespace);
      const runtime = runtimes.get(transactions);
      if (!runtime) throw new StoreError('invalid-argument', 'Imports requires a bound transaction runtime');
      return runtime.gate.shared(async () => {
        const out = [];
        for (const b of await runtime.raw.listBlobs()) if (await runtime.visibleBlob(b.digest)) {
          const metadata = (await runtime.raw.getDocument(META + b.digest))?.value as { mediaType?: unknown } | undefined;
          out.push({ ...b, digest: b.digest as string as import('../../imports/src/contract.ts').Sha256Digest,
            mediaType: typeof metadata?.mediaType === 'string' ? metadata.mediaType : 'application/octet-stream' });
        }
        return out.sort((a, b) => a.digest < b.digest ? -1 : 1);
      });
    },
    async listStreams(namespace) { ns(namespace); return (await w.listStreams()).map(unmap).sort(); },
    async readEvents(namespace, id) { ns(namespace); const r = await w.readEvents(stream(id)); if (r.status.state !== 'ok') throw new StoreError('stream-unavailable', r.status.state); return r.events.map(e => ({ seq: e.seq, payload: e.payload })); },
    async commit(ops) {
      try {
        const result = await transactions.commit(ops.map(op => op.op === 'put-document' ? { ...op, key: key(op.key) } : op.op === 'append-event' ? { ...op, stream: stream(op.stream) } : op));
        if (!result.ok) throw new StoreError('stream-unavailable', result.reason);
      } catch (error) {
        if (isStoreErrorCode(error, 'conflict')) throw new StorageConflictError(error instanceof Error ? error.message : 'Import conflict');
        throw error;
      }
    },
  };
}
