/**
 * Design-scoped active project. Opening a project in Projects scopes Review (Canvas, Compare, Annotations)
 * and Requests/Runs to it for the composition's lifetime; until then they use the shell context. It records
 * nothing durable: a reload starts from the shell context again, as the Projects session does.
 */
import type { ProjectContext } from '@hq/contracts';

export interface ActiveProjectStore {
  readonly subscribe: (listener: () => void) => () => void;
  /** The project opened in Projects, or null while the shell context applies. */
  readonly current: () => ProjectContext | null;
  readonly set: (project: ProjectContext | null) => void;
}

export function createActiveProjectStore(): ActiveProjectStore {
  let current: ProjectContext | null = null;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    current: () => current,
    set(project) {
      if (project?.id === current?.id && project?.name === current?.name) return;
      current = project === null ? null : Object.freeze({ id: project.id, name: project.name });
      for (const listener of [...listeners]) listener();
    },
  };
}

/** The project a Design section works on: the opened project, else the shell context itself. */
export function resolveDesignProject(shell: ProjectContext, active: ProjectContext | null): ProjectContext {
  return active === null || active.id === shell.id ? shell : active;
}
