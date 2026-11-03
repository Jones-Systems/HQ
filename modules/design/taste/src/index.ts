/**
 * Renderer-safe entry for HQ Design taste. No Node imports. The main-side
 * journal, service and Node adapter are exported from ./main.ts.
 */
export * from './contract.ts';
export { DEFAULT_TASTE_FLAGS, resolveTasteFlags } from './flags.ts';
export { DEFAULT_SAMPLE_THRESHOLD, buildProfile, projectTaste, sampleLimit } from './profile.ts';
export { parseTasteEvent } from './events.ts';
export { DEFAULT_ASPECTS, type AspectDefinition } from './ui/view-model.ts';
export { TastePanel, type TastePanelProps } from './ui/TastePanel.tsx';
