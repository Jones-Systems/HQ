// The renderer glob: every `modules/design/<id>/design-module.ts` is a section.
// Adding a directory is the only registration step; do not list sections here.
// Vite-only (import.meta.glob); the pure builder lives in registry.ts.
export const SECTION_ENTRIES: Readonly<Record<string, unknown>> = import.meta.glob('../../*/design-module.ts', { eager: true });
