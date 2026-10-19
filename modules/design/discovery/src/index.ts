/**
 * Design discovery (T15 / HQD-14): laptop-led source catalog and local cache.
 *
 * Framework-free models and ports are exported here; the React view lives in `CatalogView.ts` so
 * consumers that only need models do not import React. Fakes are exported separately from `fakes.ts`
 * and are always labelled.
 */
export * from './contract.ts';
export { canonicalize, jcsSha256Hex, sha256Hex } from './jcs.ts';
export { deriveSourceProjectId, digestBytes, normalizeRemote, parseRepoIdentity } from './identity.ts';
export {
  EMPTY_CATALOG, LIMITS, initialSource, parsePreviewRef, parseSnapshot, recordsForHosts, reduceCatalog,
  type CatalogEvent, type CatalogRecord, type CatalogState, type HostConflict, type ReduceResult,
  type SnapshotParse, type SourceErrorInfo, type SourceErrorKind, type SourceState, type SourceStatus,
} from './catalog.ts';
export {
  CATALOG_CACHE_KEY, CATALOG_CACHE_SCHEMA, PreviewCache, loadCatalogCache, parseCatalogCache, serializeCatalogCache,
  type CacheLoad, type CacheLoadStatus, type PreviewCacheLimits,
} from './cache.ts';
export { acceptHostFingerprint, enrollSource, linkWorkspaceProject, type EnrollmentRequest, type EnrollmentResult } from './enrollment.ts';
export {
  DEFAULT_PREVIEW_LIMITS, PreviewError, PreviewLoader, planPreviewWindow,
  type PreviewLimits, type PreviewPriority, type PreviewStats,
} from './previews.ts';
export {
  DEFAULT_REFRESH_POLICY, DiscoveryService,
  type DiscoveryContext, type DiscoveryOptions, type DiscoveryState, type HostRefreshOutcome, type HostRefreshResult,
  type RefreshPolicy, type RefreshReport,
} from './discovery.ts';
export { ageLabel, buildCatalogView, type CatalogRow, type CatalogViewModel, type SourceRow, type ViewOptions } from './view-model.ts';
