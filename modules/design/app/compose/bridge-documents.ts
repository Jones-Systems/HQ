/** Validated renderer boundary. No transport operation is retried or replaced by fake storage. */
import type { DesignServiceTransport, DesignServiceRoute, DesignServiceParams, JsonValue, StoredDocument as WireDocument } from '@hq/contracts/services';
import type { WorkspaceDocuments, WorkspaceRecords } from '../storage/index.ts';
import { canonicalize, sha256Hex } from './canonical.ts';

type Document = Awaited<ReturnType<WorkspaceDocuments['putDocument']>>;
type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// The seam exports WorkspaceDocuments, not StoredDocument: derive its result, then erase metadata brands.
type ErasedDocument = { readonly [K in keyof Document]: K extends 'namespace' | 'key' | 'valueDigest' ? string : Document[K] };
export type WireDocumentAligned = Assert<Equal<WireDocument, ErasedDocument>>;
export type WireJsonAligned = Assert<Equal<JsonValue, Parameters<WorkspaceDocuments['putDocument']>[1]>>;

export type DesignBridgeErrorKind = 'read-only' | 'invalid' | 'unavailable' | 'unknown';
export class DesignBridgeError extends Error {
  readonly kind: DesignBridgeErrorKind;
  constructor(kind: DesignBridgeErrorKind) {
    super(`Design storage bridge: ${kind}`);
    this.name = 'DesignBridgeError';
    this.kind = kind;
  }
}

/** Matches F1's isStoreErrorCode without importing the Node store's error class. */
export class DesignBridgeConflictError extends Error {
  readonly code = 'conflict';
  constructor() { super('Design storage revision conflict'); this.name = 'StoreError'; }
}

const plain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  && Reflect.ownKeys(value).every((key) => typeof key === 'string' && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value'));
function json(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) return Reflect.ownKeys(value).length === value.length + 1
      && Array.from({ length: value.length }, (_, index) => Object.getOwnPropertyDescriptor(value, String(index)))
        .every((descriptor) => descriptor !== undefined && Object.hasOwn(descriptor, 'value') && json(descriptor.value, seen));
    return plain(value) && Object.values(Object.getOwnPropertyDescriptors(value)).every((descriptor) => json(descriptor.value, seen));
  } finally { seen.delete(value); }
}
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Reflect.ownKeys(value).length === keys.length
  && keys.every((key) => Object.hasOwn(value, key));
const DIGEST = /^sha256:[0-9a-f]{64}$/u; // Exact isBlobDigest pattern from design-store/src/ids.ts.

function brandWireDocument(wire: unknown, expected: { namespace: string; key: string }): Document {
  if (!plain(wire) || !exact(wire, ['namespace', 'key', 'revision', 'valueDigest', 'updatedAt', 'value'])
    || wire.namespace !== expected.namespace || wire.key !== expected.key
    || typeof wire.revision !== 'number' || !Number.isSafeInteger(wire.revision) || wire.revision <= 0
    || typeof wire.valueDigest !== 'string' || !DIGEST.test(wire.valueDigest) || typeof wire.updatedAt !== 'string') throw new Error('Malformed document');
  if (!json(wire.value)) throw new Error('Malformed JSON');
  canonicalize(wire.value); // Reject non-JSON, cycles, sparse arrays and non-plain objects.
  // The only brand assertion: metadata and JSON have been checked at the untrusted wire boundary.
  return wire as unknown as Document;
}

export function createBridgeWorkspaceDocuments(transport: DesignServiceTransport): WorkspaceRecords {
  const namespace = 'workspace';
  async function call<R extends DesignServiceRoute>(route: R, params: DesignServiceParams[R]): Promise<unknown> {
    const uncertain = ['doc.put', 'blob.put', 'event.append'].includes(route) ? 'unknown' : 'unavailable';
    let result: unknown;
    try { result = await transport.call(route, params); } catch { throw new DesignBridgeError(uncertain); }
    try {
      if (!plain(result)) throw new DesignBridgeError(uncertain);
      if (result.ok === true && exact(result, ['ok', 'value'])) return result.value;
      if (result.ok === false && exact(result, ['ok', 'kind'])) {
        if (result.kind === 'conflict') throw new DesignBridgeConflictError();
        if (result.kind === 'read-only' || result.kind === 'invalid' || result.kind === 'unavailable' || result.kind === 'unknown') throw new DesignBridgeError(result.kind);
      }
      throw new DesignBridgeError(uncertain);
    } catch (error) {
      if (error instanceof DesignBridgeError || error instanceof DesignBridgeConflictError) throw error;
      throw new DesignBridgeError(uncertain);
    }
  }
  const validate = (value: unknown, key: string, kind: 'unknown' | 'unavailable'): Document => {
    try { return brandWireDocument(value, { namespace, key }); } catch { throw new DesignBridgeError(kind); }
  };
  return Object.freeze<WorkspaceRecords>({
    kind: 'workspace', namespace,
    async putBlob(bytes, options) {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > BLOB_CAP) throw new DesignBridgeError('invalid');
      const copy = new Uint8Array(bytes);
      const digest = `sha256:${await sha256Hex(copy)}`;
      if (!blobDigest(digest) || (options?.expectedDigest !== undefined && options.expectedDigest !== digest)) throw new DesignBridgeError('invalid');
      const value = await call('blob.put', { bytes: copy, expectedDigest: digest });
      if (!plain(value) || !exact(value, ['digest', 'bytes']) || !blobDigest(value.digest)
        || value.digest !== digest || value.bytes !== copy.byteLength) throw new DesignBridgeError('unknown');
      return { digest: value.digest, bytes: copy.byteLength };
    },
    async getBlob(digest) {
      if (!blobDigest(digest)) throw new DesignBridgeError('invalid');
      const value = await call('blob.get', { digest });
      if (value === null) return null;
      if (!(value instanceof Uint8Array) || value.byteLength > BLOB_CAP) throw new DesignBridgeError('unavailable');
      const copy = new Uint8Array(value);
      if (`sha256:${await sha256Hex(copy)}` !== digest) throw new DesignBridgeError('unavailable');
      return copy;
    },
    async hasBlob(digest) {
      if (!blobDigest(digest)) throw new DesignBridgeError('invalid');
      const value = await call('blob.has', { digest });
      if (typeof value !== 'boolean') throw new DesignBridgeError('unavailable');
      return value;
    },
    async appendEvent(stream, event) {
      if (!requestsStream(stream) || !plain(event) || event.type !== 'requests.event-bytes'
        || !json(event.payload) || (event.clientEventId !== undefined
          && (typeof event.clientEventId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/u.test(event.clientEventId)))) throw new DesignBridgeError('invalid');
      try { canonicalize(event.payload); } catch { throw new DesignBridgeError('invalid'); }
      const value = await call('event.append', { stream, payload: event.payload,
        ...(event.clientEventId === undefined ? {} : { clientEventId: event.clientEventId }) });
      if (!eventProjection(value) || canonicalize(value.payload) !== canonicalize(event.payload)) throw new DesignBridgeError('unknown');
      return value;
    },
    async readEvents(stream) {
      if (!requestsStream(stream)) throw new DesignBridgeError('invalid');
      const value = await call('event.read', { stream });
      if (!eventRead(value)) throw new DesignBridgeError('unavailable');
      return value;
    },
    async getDocument(key: string) {
      const value = await call('doc.get', { key });
      return value === null ? null : validate(value, key, 'unavailable');
    },
    async putDocument(key: string, value: JsonValue, options?: { readonly expectedRevision?: number | null }) {
      return validate(await call('doc.put', { key, value, ...(options?.expectedRevision === undefined ? {} : { expectedRevision: options.expectedRevision }) }), key, 'unknown');
    },
    async listDocuments(prefix = '') {
      const value = await call('doc.list', { prefix });
      try {
        if (!Array.isArray(value) || !json(value) || !value.every((key) => typeof key === 'string' && key.startsWith(prefix))) throw new Error('Malformed list');
        return value as string[];
      } catch { throw new DesignBridgeError('unavailable'); }
    },
  });
}

const BLOB_CAP = 16 * 1024 * 1024;
type StoreDigest = Awaited<ReturnType<WorkspaceRecords['putBlob']>>['digest'];
type WireDigest = DesignServiceParams['blob.get']['digest'];
function blobDigest(value: unknown): value is StoreDigest & WireDigest {
  return typeof value === 'string' && DIGEST.test(value);
}
function requestsStream(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('design/requests/') && value.length > 'design/requests/'.length
    && value.length <= 256 && value.trim() === value && value.isWellFormed()
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value) && !value.split('/').includes('..');
}
function eventProjection(value: unknown): value is Awaited<ReturnType<WorkspaceRecords['appendEvent']>> {
  return plain(value) && exact(value, ['seq', 'payload']) && typeof value.seq === 'number'
    && Number.isSafeInteger(value.seq) && value.seq > 0 && json(value.payload);
}
function eventStatus(value: unknown): value is Awaited<ReturnType<WorkspaceRecords['readEvents']>>['status'] {
  if (!plain(value)) return false;
  const count = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
  if (value.state === 'ok') return exact(value, ['state']);
  if (value.state === 'torn-tail') return exact(value, ['state', 'validBytes', 'tailBytes']) && count(value.validBytes) && count(value.tailBytes);
  return value.state === 'corrupt' && exact(value, ['state', 'atSeq', 'reason']) && count(value.atSeq) && typeof value.reason === 'string';
}
function eventRead(value: unknown): value is Awaited<ReturnType<WorkspaceRecords['readEvents']>> {
  return plain(value) && exact(value, ['events', 'status']) && Array.isArray(value.events)
    && json(value.events) && value.events.every((event, index) => eventProjection(event) && event.seq === index + 1) && eventStatus(value.status);
}
