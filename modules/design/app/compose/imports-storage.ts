/**
 * Imports `StoragePort` over the Design document bridge (B3 backend contract, section 7; see BACKEND-CONTRACT.md).
 *
 * The importer talks to a namespaced port: `imports/...` keys and the `imports` stream. The desktop host serves the
 * same records as `design/imports/...` documents and the `design/imports` stream, writes them only through the atomic
 * `import.commit`, and reads them through `doc.get` / `doc.list` / `event.read` / `blob.has`. This module maps between
 * the two. It mirrors `createImportsStorage` in `app/storage/transactions.ts`, the host-side twin of this adapter.
 *
 * Two layers:
 *  - `createImportsBridgeStorage` is faithful: a revision conflict is the imports `StorageConflictError`, a host
 *    refusal keeps its closed reason (`disabled`), and a transport loss during a write is an unknown outcome
 *    (`DesignBridgeError('unknown')`). It can append project-content operations to the same atomic batch (`link`).
 *  - `typeImportsStorage` wraps every method so a rejection is a `DesignOperationError` a view can toast.
 *
 * Backup and export cannot work here: the bridge has no route that lists blobs, streams or whole namespaces. Those
 * methods reject with a typed `disabled` failure before any call, so the export action fails safely and writes nothing.
 */
import type { DesignServiceParams, DesignServiceRoute, DesignServiceTransport } from '@hq/contracts/services';
import {
  StorageConflictError,
  type JsonValue, type NamespaceInfo, type Sha256Digest, type StoragePort, type StoredDocument, type StoredEvent, type WriteOp,
} from '../../imports/src/contract.ts';
import { brandWireDocument, bridgeResultValue, DesignBridgeConflictError, DesignBridgeError } from './bridge-documents.ts';
import { sha256Hex } from './canonical.ts';
import { designFailure, DesignOperationError, toDesignOperationError, type DesignFailureContext } from './errors.ts';

const WORKSPACE = 'workspace';
const IMPORTS_STREAM = 'imports';
const HOST_IMPORTS_STREAM = 'design/imports';
const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const DECIMAL_REVISION = /^[1-9][0-9]*$/u;
/** The host refuses an import batch above this many canonical bytes (`IMPORT_LIMITS.totalBytes`). */
const IMPORT_TOTAL_BYTES = 64 * 1024 * 1024;
const BLOB_BYTES = 16 * 1024 * 1024;
const FETCH_CHUNK = 16;

export type ImportsOperation = 'read' | 'apply' | 'undo' | 'resolve' | 'edit' | 'export';

/** Failure contexts of the Imports env, one per operation. The names are listed in BACKEND-CONTRACT.md. */
export const IMPORTS_CONTEXTS: Readonly<Record<ImportsOperation | 'pick', DesignFailureContext>> = Object.freeze({
  pick: { section: 'imports', operation: 'imports.pick', action: 'choose files', write: false },
  read: { section: 'imports', operation: 'imports.read', action: 'read your imports', write: false },
  apply: { section: 'imports', operation: 'imports.apply', action: 'apply the import', write: true },
  undo: { section: 'imports', operation: 'imports.undo', action: 'undo the import', write: true },
  resolve: { section: 'imports', operation: 'imports.resolve', action: 'resolve the conflict', write: true },
  edit: { section: 'imports', operation: 'imports.edit', action: 'save your edit', write: true },
  export: { section: 'imports', operation: 'imports.export', action: 'create the backup', write: false },
});

/** Operations that change project content alongside the imports records they commit. */
export interface ImportsCommitLink {
  /**
   * Extra operations for the SAME atomic batch (keys are already host keys, such as `design/projects/...`), plus the
   * projects whose content they change. `read` reads an imports document (`imports/...` key) from storage.
   * Planning performs no write.
   */
  plan(ops: readonly WriteOp[], read: (key: string) => Promise<StoredDocument | null>):
    Promise<{ readonly ops: readonly WriteOp[]; readonly projects: readonly string[] }>;
  /** The batch was sent and project content may have changed: it landed, was refused or has an unknown outcome. Readers should re-read. */
  changed(project: string): void;
}

export interface ImportsBridgeOptions {
  readonly transport: DesignServiceTransport;
  readonly link?: ImportsCommitLink;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Which Imports operation a batch belongs to, from the event it appends. A batch with no event is an owner edit. */
export function commitOperation(ops: readonly WriteOp[]): 'apply' | 'undo' | 'resolve' | 'edit' {
  for (const op of ops) {
    if (op.op !== 'append-event' || op.stream !== IMPORTS_STREAM || !isRecord(op.payload)) continue;
    if (op.payload.type === 'import.applied') return 'apply';
    if (op.payload.type === 'import.undone') return 'undo';
    if (op.payload.type === 'conflict.resolved') return 'resolve';
  }
  return 'edit';
}

/** Backup and export have no bridge route. This failure is definite: nothing was read or written. */
export function exportUnavailable(): DesignOperationError {
  return new DesignOperationError(designFailure('disabled', IMPORTS_CONTEXTS.export, {
    reason: 'disabled', message: 'Backup and export are not available in this build', description: 'Your imports are saved on this device. Nothing was changed.',
  }));
}

function workspaceOnly(namespace: string): void {
  if (namespace !== WORKSPACE) throw new DesignBridgeError('invalid');
}
function hostKey(id: string): string {
  if (typeof id !== 'string' || !id.startsWith('imports/') || id.length <= 'imports/'.length) throw new DesignBridgeError('invalid');
  return `design/${id}`;
}
function hostStream(stream: string): string {
  if (stream !== IMPORTS_STREAM) throw new DesignBridgeError('invalid');
  return HOST_IMPORTS_STREAM;
}
function blobDigest(digest: unknown): digest is Sha256Digest {
  return typeof digest === 'string' && DIGEST.test(digest);
}

type WireOp = DesignServiceParams['import.commit']['ops'][number];

function toWireOp(op: WriteOp, keys: 'imports' | 'host'): WireOp {
  if (!isRecord(op) || op.namespace !== WORKSPACE) throw new DesignBridgeError('invalid');
  if (op.op === 'put-document') {
    if (!(op.expectedRevision === null || (typeof op.expectedRevision === 'string' && DECIMAL_REVISION.test(op.expectedRevision)
      && Number.isSafeInteger(Number(op.expectedRevision))))) throw new DesignBridgeError('invalid');
    if (typeof op.key !== 'string') throw new DesignBridgeError('invalid');
    return { op: 'put-document', namespace: WORKSPACE, key: keys === 'imports' ? hostKey(op.key) : op.key, value: op.value, expectedRevision: op.expectedRevision };
  }
  if (op.op === 'put-blob') {
    if (!blobDigest(op.digest) || !(op.bytes instanceof Uint8Array) || op.bytes.byteLength > BLOB_BYTES
      || typeof op.mediaType !== 'string' || op.mediaType.trim() === '' || op.mediaType.length > 256) throw new DesignBridgeError('invalid');
    return { op: 'put-blob', namespace: WORKSPACE, digest: op.digest, mediaType: op.mediaType, bytes: new Uint8Array(op.bytes) };
  }
  if (op.op === 'append-event') {
    if (!Number.isSafeInteger(op.expectedSeq) || op.expectedSeq < 0) throw new DesignBridgeError('invalid');
    return { op: 'append-event', namespace: WORKSPACE, stream: hostStream(op.stream), payload: op.payload, expectedSeq: op.expectedSeq };
  }
  throw new DesignBridgeError('invalid');
}

/** Canonical size the host will count: documents and events as JSON, blobs as base64. */
function canonicalBytes(ops: readonly WireOp[]): number {
  const encoder = new TextEncoder();
  let total = 0;
  for (const op of ops) total += op.op === 'put-blob' ? Math.ceil(op.bytes.byteLength / 3) * 4 + 256 : encoder.encode(JSON.stringify(op)).byteLength;
  return total;
}

function eventsOf(value: unknown): readonly StoredEvent[] {
  if (!isRecord(value) || !Array.isArray(value.events) || !isRecord(value.status)) throw new DesignBridgeError('unavailable');
  // A torn or corrupt journal is never read as if it were whole: the importer would plan against a wrong sequence.
  if (value.status.state !== 'ok') throw new DesignBridgeError('unavailable');
  return value.events.map((event, index): StoredEvent => {
    if (!isRecord(event) || event.seq !== index + 1) throw new DesignBridgeError('unavailable');
    return { seq: event.seq, payload: event.payload as JsonValue };
  });
}

export function createImportsBridgeStorage(options: ImportsBridgeOptions): StoragePort {
  const { transport, link } = options;
  async function call<R extends DesignServiceRoute>(route: R, params: DesignServiceParams[R], uncertain: 'unknown' | 'unavailable'): Promise<unknown> {
    let result: unknown;
    try { result = await transport.call(route, params); } catch { throw new DesignBridgeError(uncertain); }
    return bridgeResultValue(result, uncertain);
  }
  async function getDocument(namespace: string, id: string): Promise<StoredDocument | null> {
    workspaceOnly(namespace);
    const key = hostKey(id);
    const value = await call('doc.get', { key }, 'unavailable');
    if (value === null) return null;
    let document;
    try { document = brandWireDocument(value, { namespace: WORKSPACE, key }); } catch { throw new DesignBridgeError('unavailable'); }
    return { key: id, value: document.value as JsonValue, revision: String(document.revision) };
  }
  const port: StoragePort = {
    async namespaces(): Promise<readonly NamespaceInfo[]> { return [{ name: WORKSPACE, class: 'workspace' }]; },
    getDocument,
    async listDocuments(namespace, prefix = '') {
      workspaceOnly(namespace);
      // A listing of the whole namespace exists only to build a bundle, which this port cannot do.
      if (prefix === '') throw exportUnavailable();
      const hostPrefix = hostKey(prefix);
      const keys = await call('doc.list', { prefix: hostPrefix }, 'unavailable');
      if (!Array.isArray(keys) || !keys.every((key) => typeof key === 'string' && key.startsWith(hostPrefix))) throw new DesignBridgeError('unavailable');
      const documents: StoredDocument[] = [];
      for (let start = 0; start < keys.length; start += FETCH_CHUNK) {
        const chunk = await Promise.all((keys as string[]).slice(start, start + FETCH_CHUNK).map((key) => getDocument(namespace, key.slice('design/'.length))));
        for (const document of chunk) if (document !== null) documents.push(document);
      }
      return documents.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    },
    async getBlob(namespace, digest) {
      workspaceOnly(namespace);
      if (!blobDigest(digest)) throw new DesignBridgeError('invalid');
      const value = await call('blob.get', { digest: digest as never }, 'unavailable');
      if (value === null) return null;
      if (!(value instanceof Uint8Array) || value.byteLength > BLOB_BYTES) throw new DesignBridgeError('unavailable');
      const copy = new Uint8Array(value);
      if (`sha256:${await sha256Hex(copy)}` !== digest) throw new DesignBridgeError('unavailable');
      return copy;
    },
    async hasBlob(namespace, digest) {
      workspaceOnly(namespace);
      if (!blobDigest(digest)) throw new DesignBridgeError('invalid');
      const value = await call('blob.has', { digest: digest as never }, 'unavailable');
      if (typeof value !== 'boolean') throw new DesignBridgeError('unavailable');
      return value;
    },
    async listBlobs() { throw exportUnavailable(); },
    async listStreams() { throw exportUnavailable(); },
    async readEvents(namespace, stream) {
      workspaceOnly(namespace);
      return eventsOf(await call('event.read', { stream: hostStream(stream) }, 'unavailable'));
    },
    async commit(ops) {
      if (!Array.isArray(ops) || ops.length === 0) throw new DesignBridgeError('invalid');
      const wire = ops.map((op) => toWireOp(op, 'imports'));
      const linked = link === undefined ? { ops: [], projects: [] } : await link.plan(ops, (key) => getDocument(WORKSPACE, key));
      wire.push(...linked.ops.map((op) => toWireOp(op, 'host')));
      if (wire.length > 10_000 || canonicalBytes(wire) > IMPORT_TOTAL_BYTES) {
        throw new DesignOperationError(designFailure('too-large', IMPORTS_CONTEXTS[commitOperation(ops)], { reason: 'import-total' }));
      }
      const changed = () => { for (const project of linked.projects) link?.changed(project); };
      try {
        const value = await call('import.commit', { ops: wire }, 'unknown');
        if (!isRecord(value) || typeof value.txnId !== 'string') throw new DesignBridgeError('unknown');
      } catch (error) {
        if (error instanceof DesignBridgeConflictError) throw new StorageConflictError('Imports changed after they were read');
        throw error;
      } finally {
        // Readers re-read after any attempt: it landed, it was refused, or its outcome is unknown.
        changed();
      }
    },
  };
  return port;
}

/** Every rejection of the returned port is a `DesignOperationError`; the original stays as its `cause`. */
export function typeImportsStorage(port: StoragePort): StoragePort {
  const reading = async <T>(run: () => Promise<T>): Promise<T> => {
    try { return await run(); } catch (error) { throw toDesignOperationError(error, IMPORTS_CONTEXTS.read); }
  };
  return {
    namespaces: () => reading(() => port.namespaces()),
    getDocument: (namespace, key) => reading(() => port.getDocument(namespace, key)),
    listDocuments: (namespace, prefix) => reading(() => port.listDocuments(namespace, prefix)),
    getBlob: (namespace, digest) => reading(() => port.getBlob(namespace, digest)),
    hasBlob: (namespace, digest) => reading(() => port.hasBlob!(namespace, digest)),
    listBlobs: (namespace) => reading(() => port.listBlobs(namespace)),
    listStreams: (namespace) => reading(() => port.listStreams(namespace)),
    readEvents: (namespace, stream) => reading(() => port.readEvents(namespace, stream)),
    async commit(ops) {
      try { await port.commit(ops); } catch (error) { throw toDesignOperationError(error, IMPORTS_CONTEXTS[commitOperation(ops)]); }
    },
  };
}
