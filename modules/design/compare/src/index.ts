/**
 * HQD-03 compare entry point. Root composes `CompareWorkspace` with a controller
 * built from qualified adapters; fakes are exported separately from `./fakes.ts`.
 */
export type * from './contract.ts';
export * from './ids.ts';
export * from './model.ts';
export { VIEWPORT_PRESETS, describeViewport, parseViewport, presetById, presetFor, sameViewport, type ViewportPreset } from './presets.ts';
export { fitScale, mapScroll, scrollRange, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH } from './geometry.ts';
export { labelSource, labelStatic, labelLive, ROLE_LABELS, type EvidenceClass, type SourceLabel } from './labels.ts';
export { COMPARISON_SCHEMA, comparisonKey, parseComparison, serializeComparison, type ParseResult } from './persist.ts';
export { createCompareController, loadComparison, type CompareController, type CompareDeps, type CompareSnapshot, type ControllerError, type LoadResult, type PanelRuntime, type PanelStatus } from './controller.ts';
