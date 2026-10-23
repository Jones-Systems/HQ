/**
 * Narrow adapter for the requests section (T6, bound to PR33 head 896a726d; same eight-method port as PR17 2438d6ff). It exposes exactly
 * the eight methods T6's StoragePort uses and nothing else: no delete, no blob listing, no
 * adoption. Keys are confined to `design/requests/`.
 *
 * Freeze depends on `createDocument` being write-once, so it maps to a store write with
 * `expectedRevision: null`: an existing document is never replaced, and the adapter reports
 * `exists-identical` only when the stored canonical bytes equal the offered bytes (which is what
 * lets a retry after an unknown outcome reconcile).
 *
 * T6 hands over canonical JSON bytes. The adapter stores them as a JSON document and re-emits the
 * canonical form, so bytes round-trip exactly; bytes that are not canonical JSON are refused.
 */
import { bytesEqual, canonicalBytes, parseCanonicalBytes } from './canonical.ts';
import { isStoreErrorCode, type CacheBacking, type WorkspaceRecords } from './backing.ts';

export const REQUESTS_KEY_ROOT = 'design/requests/';
export type RequestsNamespace = 'workspace' | 'cache';
export type RequestsCreateResult = 'created' | 'exists-identical' | 'exists-different';

/** Structurally T6's StoragePort; `D` carries T6's branded Digest type through. */
export interface RequestsStoragePort<D extends string = string> {
  readDocument(ns: RequestsNamespace, key: string): Promise<Uint8Array | null>;
  writeDocument(ns: RequestsNamespace, key: string, bytes: Uint8Array): Promise<void>;
  createDocument(ns: RequestsNamespace, key: string, bytes: Uint8Array): Promise<RequestsCreateResult>;
  listDocuments(ns: RequestsNamespace, prefix: string): Promise<readonly string[]>;
  putBlob(bytes: Uint8Array): Promise<D>;
  getBlob(digest: D): Promise<Uint8Array | null>;
  appendEvent(ns: RequestsNamespace, stream: string, bytes: Uint8Array): Promise<void>;
  readEvents(ns: RequestsNamespace, stream: string): Promise<readonly Uint8Array[]>;
}

export class RequestsStorageScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestsStorageScopeError';
  }
}

const EVENT_TYPE = 'requests.event-bytes';
const CLIENT_EVENT_ID = /^[A-Za-z0-9._:-]{1,160}$/u;

function inScope(key: string): string {
  if (!key.startsWith(REQUESTS_KEY_ROOT)) throw new RequestsStorageScopeError(`Key ${JSON.stringify(key.slice(0, 60))} is outside ${REQUESTS_KEY_ROOT}`);
  return key;
}

export function createRequestsStoragePort<D extends string = string>(backings: {
  readonly workspace: WorkspaceRecords;
  /** Optional: without it the cache namespace is unavailable rather than silently redirected. */
  readonly cache?: CacheBacking;
}): RequestsStoragePort<D> {
  const { workspace } = backings;
  if (workspace.kind !== 'workspace') throw new RequestsStorageScopeError('workspace backing must be a workspace view');
  if (backings.cache && backings.cache.kind !== 'cache') throw new RequestsStorageScopeError('cache backing must be a cache view');

  const docs = (ns: RequestsNamespace): WorkspaceRecords | CacheBacking => {
    if (ns === 'workspace') return workspace;
    if (ns === 'cache' && backings.cache) return backings.cache;
    throw new RequestsStorageScopeError(`Namespace ${JSON.stringify(ns)} is not available to the requests adapter`);
  };
  const eventsOnWorkspace = (ns: RequestsNamespace): WorkspaceRecords => {
    if (ns !== 'workspace') throw new RequestsStorageScopeError('Events live only in the workspace namespace');
    return workspace;
  };

  const port: RequestsStoragePort<D> = {
    async readDocument(ns, key) {
      const found = await docs(ns).getDocument(inScope(key));
      return found ? canonicalBytes(found.value) : null;
    },
    async writeDocument(ns, key, bytes) {
      await docs(ns).putDocument(inScope(key), parseCanonicalBytes(bytes));
    },
    async createDocument(ns, key, bytes) {
      const backing = docs(ns);
      const value = parseCanonicalBytes(bytes);
      const classify = (stored: unknown): RequestsCreateResult => (bytesEqual(canonicalBytes(stored), bytes) ? 'exists-identical' : 'exists-different');
      const existing = await backing.getDocument(inScope(key));
      if (existing) return classify(existing.value);
      try {
        await backing.putDocument(key, value, { expectedRevision: null });
        return 'created';
      } catch (error) {
        if (!isStoreErrorCode(error, 'conflict')) throw error;
        // Lost a race between the read and the write: report what won, never replace it.
        const winner = await backing.getDocument(key);
        if (winner) return classify(winner.value);
        throw error;
      }
    },
    async listDocuments(ns, prefix) {
      inScope(prefix);
      return docs(ns).listDocuments(prefix);
    },
    async putBlob(bytes) {
      return (await workspace.putBlob(bytes)).digest as string as D;
    },
    async getBlob(digest) {
      return workspace.getBlob(digest);
    },
    async appendEvent(ns, stream, bytes) {
      const value = parseCanonicalBytes(bytes);
      const eventId = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as { readonly eventId?: unknown }).eventId : undefined;
      // A stable eventId makes a retried append a no-op instead of a duplicate review entry.
      const clientEventId = typeof eventId === 'string' && CLIENT_EVENT_ID.test(eventId) ? eventId : undefined;
      await eventsOnWorkspace(ns).appendEvent(inScope(stream), { type: EVENT_TYPE, payload: value, ...(clientEventId === undefined ? {} : { clientEventId }) });
    },
    async readEvents(ns, stream) {
      const read = await eventsOnWorkspace(ns).readEvents(inScope(stream));
      if (read.status.state !== 'ok') throw new RequestsStorageScopeError(`Event stream ${stream} is ${read.status.state}; it fails closed until the owner repairs it`);
      return read.events.map((event) => canonicalBytes(event.payload));
    },
  };
  return Object.freeze(port);
}
