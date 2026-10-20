/**
 * Synthetic seed plumbing for the preview. Each section seeds its own labelled
 * fakes once per fake project and keeps them for the page's lifetime, so a
 * Design → Social → Design switch remounts the real view over the same
 * in-memory state. Nothing here is durable, real or shared with HQ.
 */
import type { ProjectContext } from '@hq/contracts';

/** The fake shell's projects. Ids are synthetic and valid for every section's id grammar. */
export const PREVIEW_PROJECTS: readonly ProjectContext[] = [
  { id: 'project-alpha', name: 'Alpha site (synthetic)' },
  { id: 'project-beta', name: 'Beta app (synthetic)' },
];

/** Memoise one async seed per project id; the same promise is returned on every call. */
export function perProject<T>(create: (project: ProjectContext) => Promise<T>): (project: ProjectContext) => Promise<T> {
  const seeds = new Map<string, Promise<T>>();
  return (project) => {
    let seed = seeds.get(project.id);
    if (seed === undefined) {
      seed = create(project);
      seeds.set(project.id, seed);
    }
    return seed;
  };
}

/** Real timers for sections whose fakes schedule autosave (requests). Local UI timing only. */
export const browserScheduler = {
  setTimeout: (callback: () => void, ms: number): unknown => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle: unknown): void => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};
