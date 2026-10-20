/** Validated renderer boundary. No transport operation is retried or replaced by fake storage. */
import type { DesignServiceTransport, DesignServiceRoute, DesignServiceParams, JsonValue, StoredDocument as WireDocument } from '@hq/contracts/services';
import type { WorkspaceDocuments } from '../storage/index.ts';
import { canonicalize } from './canonical.ts';

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
function json(value: unknown, seen = new Set<object>()): boolean {
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

export function createBridgeWorkspaceDocuments(transport: DesignServiceTransport): WorkspaceDocuments {
  const namespace = 'workspace';
  async function call<R extends DesignServiceRoute>(route: R, params: DesignServiceParams[R]): Promise<unknown> {
    const uncertain = route === 'doc.put' ? 'unknown' : 'unavailable';
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
  return Object.freeze({
    kind: 'workspace', namespace,
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
