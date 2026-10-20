/**
 * Renderer-safe storage seam for the Design app: ports, types and pure helpers only.
 *
 * Nothing here imports `node:*`, `electron`, or the store's Node filesystem code (the only store
 * import anywhere in this graph is an erased `import type` of the contract). The Node
 * implementation is `./node.ts`; main-process code opens a store there and hands these ports to
 * the renderer over its own typed bridge. test/renderer-safe.test.ts proves this file's import
 * graph statically.
 */
export { bindCache, bindWorkspace, asReader, NamespaceClassError, isStoreErrorCode } from './backing.ts';
export type { CacheBacking, PutOp, WorkspaceBacking, WorkspaceReader } from './backing.ts';

export { canonicalBytes, canonicalize, parseCanonicalBytes, toJson, CanonicalJsonError, NonCanonicalBytesError } from './canonical.ts';
export type { Json } from './canonical.ts';

export { createRequestsStoragePort, REQUESTS_KEY_ROOT, RequestsStorageScopeError } from './requests.ts';
export type { RequestsCreateResult, RequestsNamespace, RequestsStoragePort } from './requests.ts';

export { createOutboxAdapter, OUTBOX_KEY_ROOT, OutboxRecordError } from './outbox.ts';
export type { OutboxAdapter, OutboxAdapterOptions, OutboxPutResult, OutboxRecordShape, StoredOutboxRecord } from './outbox.ts';

export { createCanvasStorage, CANVAS_KEY_ROOT, CanvasScopeError, CanvasWriteConflictError } from './canvas.ts';
export type { CanvasDocumentPort } from './canvas.ts';

export {
  classifyRequestsKey, createRequestsExport, EXPORT_SCHEMA, EXPORT_STATUS, ExportDisabledError, ExportProjectionError,
  projectFreezeRecord, REQUESTS_PACKET_PIN, reviewStreamOf,
} from './export.ts';
export type {
  ExportedBlob, OmittedStore, ProjectedFreezeRecord, RequestsExportPort, RequestsKeyClass, RequestsProjection,
} from './export.ts';
