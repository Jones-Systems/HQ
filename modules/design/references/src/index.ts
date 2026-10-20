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

/* Reference graph (hq.design.reference-graph/v1). */
export type * from './graph-contract.ts';
export {
  ANCHOR_KINDS, CAPTURE_ORIGINS, CAPTURE_SUBJECT_KINDS, CONTENT_AVAILABILITY, GRAPH_DOCUMENT_KEY, GRAPH_SCHEMA,
  SOURCE_AVAILABILITY, SUBJECT_KINDS,
} from './graph-contract.ts';
export {
  deriveAnchorId, deriveCaptureId, derivePinId, deriveSubjectId, normalizeOrigin,
} from './graph-identity.ts';
export type { PreparedCapture, PreparedGraph } from './graph-import.ts';
export { APP_HOME_SCREEN, emptyGraph, INERT_MEDIA_TYPES } from './graph-import.ts';
export type { BrowseNode, PinRequest } from './graph-ops.ts';
export {
  availabilityLabel, browseGraph, capturesOfSubject, headCapture, lineageOf, pinsForProject, referencedGraphDigests,
} from './graph-ops.ts';
export type { FlatAdoptionPlan } from './graph-flat.ts';
export { planFlatAdoption } from './graph-flat.ts';
export type { ParsedGraph } from './graph-persist.ts';
export { parseGraphDocument, parseGraphStructure, verifyGraphIdentities } from './graph-persist.ts';
export type { GraphAccess, GraphPorts } from './graph-service.ts';
export { ReferenceGraph } from './graph-service.ts';
export type { RightsMapping } from './rights.ts';
export {
  HQ_RIGHTS_VOCABULARY, isGraphPublishable, mapDeclaredRights, publishBlock, REA_RIGHTS_VOCABULARY,
  RIGHTS_VOCABULARIES, STUDY_RIGHTS_VOCABULARY,
} from './rights.ts';
