/** Public entry for the Design reference library section (T8 / HQD-07). */
export type * from './contract.ts';
export {
  APP_PLATFORMS, CLAIM_LEVELS, EXPORT_SCHEMA, LIBRARY_DOCUMENT_KEY, LIBRARY_SCHEMA, NATIVE_RUNTIMES, REFERENCE_KINDS,
  RIGHTS_STATUSES,
} from './contract.ts';
export type { EvidenceDescription, ExecutionClass } from './provenance.ts';
export { describeEvidence, deriveReferenceId, isPublishPermitted, normalizeUrl } from './provenance.ts';
export type { ImportApplication, PreparedImport, Result } from './library.ts';
export {
  emptyLibrary, normalizeTag, normalizeTags, referencedBlobDigests, usesForProject, usesForReference,
} from './library.ts';
export type { ReferenceQuery } from './search.ts';
export { parseSearchText, searchReferences, tagCounts } from './search.ts';
export type { ExportedReference, ExportMode, ExportOptions, ReferenceExport } from './export.ts';
export { exportReferences } from './export.ts';
export type { ParsedLibrary } from './persist.ts';
export { parseLibraryDocument } from './persist.ts';
export type { LibraryAccess, MutationResult } from './service.ts';
export { ReferenceLibrary } from './service.ts';
export { REFERENCE_ENTITY_KIND, referenceDestination, toReferenceEnvelope } from './envelope.ts';
