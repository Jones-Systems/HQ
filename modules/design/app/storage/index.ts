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

export { createDiscoveryCacheReader, DISCOVERY_CATALOG_CACHE_KEY, DiscoveryCacheScopeError } from './discovery-cache.ts';
export type { DiscoveryCacheReader } from './discovery-cache.ts';
export { TEXT_FORMAT } from './text-envelope.ts';

export {
  classifyRequestsKey, createRequestsExport, EXPORT_SCHEMA, EXPORT_STATUS, ExportDisabledError, ExportProjectionError,
  projectCandidate, projectFreezeRecord, projectReviewEvent, REQUESTS_PACKET_PIN, reviewStreamOf,
} from './export.ts';
export type {
  CandidateProjection, ExportedBlob, OmittedStore, ProjectedFreezeRecord, RequestsExportPort, RequestsKeyClass, RequestsProjection,
} from './export.ts';

export type { WorkspaceDocuments } from './backing.ts';
export { DEVICE_STORAGE_LABEL, PROJECTS_KEY_ROOT, COMPONENTS_KEY_ROOT, FLOWS_KEY_ROOT, COMPARE_KEY_ROOT, ANNOTATIONS_KEY_ROOT, SectionStorageScopeError } from './section-documents.ts';
export { createProjectsStorage } from './projects.ts';
export type { ProjectDocumentPort } from './projects.ts';
export { createComponentsStorage } from './components.ts';
export type { ComponentDocumentPort } from './components.ts';
export { createFlowsStorage } from './flows.ts';
export type { FlowDocumentPort } from './flows.ts';
export { createCompareStorage } from './compare.ts';
export type { CompareDocumentPort } from './compare.ts';
export { createAnnotationsStorage } from './annotations.ts';
export type { AnnotationDocumentPort } from './annotations.ts';
