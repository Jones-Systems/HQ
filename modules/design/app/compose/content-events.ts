/**
 * Project content change notifications inside one Design composition (B3 backend contract; see BACKEND-CONTRACT.md).
 *
 * Several writers share one workspace store: the Projects section, live captures, Imports linking and
 * future producers. Each writer calls `notify(projectId)` after a durable project-content write succeeds
 * (or after an unknown outcome, so readers re-read instead of trusting a cache). Readers that cache project
 * content subscribe and reload. Notifications carry no data and never trigger writes or dispatch.
 */
export interface ProjectContentEvents {
  /** Marks the project's content as changed and calls its listeners synchronously. */
  notify(projectId: string): void;
  /** Listens for one project's changes. Returns an idempotent unsubscribe. */
  subscribe(projectId: string, listener: () => void): () => void;
  /** Listens for every project's changes (for example a gallery that shows all projects). Returns an idempotent unsubscribe. */
  subscribeAll(listener: (projectId: string) => void): () => void;
  /** Monotonic per-project change counter; starts at 0. Usable as a React `use()` cache key. */
  revision(projectId: string): number;
}

export function createProjectContentEvents(): ProjectContentEvents {
  const listeners = new Map<string, Set<() => void>>();
  const everyProject = new Set<(projectId: string) => void>();
  const revisions = new Map<string, number>();
  return {
    notify(projectId) {
      revisions.set(projectId, (revisions.get(projectId) ?? 0) + 1);
      for (const listener of [...(listeners.get(projectId) ?? [])]) {
        try { listener(); } catch { /* One failing reader must not block the others. */ }
      }
      for (const listener of [...everyProject]) {
        try { listener(projectId); } catch { /* Same isolation for readers of every project. */ }
      }
    },
    subscribeAll(listener) {
      everyProject.add(listener);
      return () => { everyProject.delete(listener); };
    },
    subscribe(projectId, listener) {
      let set = listeners.get(projectId);
      if (!set) { set = new Set(); listeners.set(projectId, set); }
      set.add(listener);
      return () => {
        const current = listeners.get(projectId);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) listeners.delete(projectId);
      };
    },
    revision: (projectId) => revisions.get(projectId) ?? 0,
  };
}
