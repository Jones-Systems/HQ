/** Framework-free entry for the annotations section. React views live in ./ui. */
export * from './contract.ts';
export { letterForIndex, indexForLetter } from './letters.ts';
export * from './geometry.ts';
export { LIMITS, kindMatchesTarget, parseAnchor, parseAnnotationDocument, parseAnnotationRef, parseTarget } from './validate.ts';
export type { DocumentParse } from './validate.ts';
export { ERASABLE_KINDS, HISTORY_LIMIT, TOOLS, createEditor, emptyDocument, isRevisit, reduce } from './editor.ts';
export type { DrawKind, EditorAction, EditorState, HistoryEntry, Outcome, RejectReason, Tool, Transition } from './editor.ts';
export { resolveAll, resolveForDisplay, resolveRequestFor } from './resolution.ts';
export type { AnchorStatus, DisplayFrame, ResolvedAnnotation } from './resolution.ts';
export { LOCAL_PATH_PLACEHOLDER, containsLocalPath, formatCopyExport, redactLocalPaths } from './export.ts';
export type { CopyExportOptions } from './export.ts';
export { AnnotationController, agentModeFor, loadAnnotations } from './controller.ts';
export type { AnnotationPorts, ControllerSnapshot, LoadResult } from './controller.ts';
