/**
 * Project content change notifications inside one Design composition (B3 backend contract; see BACKEND-CONTRACT.md).
 *
 * Several writers share one workspace store: the Projects section, live captures, Imports linking and
 * future producers. Each writer calls `notify(projectId)` after any attempt to write project content,
 * whether it succeeded, failed or has an unknown outcome, so readers re-read instead of trusting a cache.
 * A spurious notification only costs one re-read. Readers that cache project content subscribe and reload.
 * Notifications carry no data and never trigger writes or dispatch.
 */
export interface ProjectContentEvents {
  /** Marks the project's content as changed and calls its listeners synchronously. */
  notify(projectId: string): void;
  /**
   * Listens for one project's changes. Each call is its own subscription, even for the same function.
   * Returns an idempotent unsubscribe. A listener removed during a notification is not called afterwards.
   */
  subscribe(projectId: string, listener: () => void): () => void;
  /**
   * Listens for every project's changes (for example a gallery that shows all projects). Same rules as `subscribe`:
   * each call is its own subscription, and a listener removed during a notification is not called afterwards.
   */
  subscribeAll(listener: (projectId: string) => void): () => void;
  /** Monotonic per-project change counter; starts at 0. Usable as a React `use()` cache key. */
  revision(projectId: string): number;
}

interface Subscription<L> { readonly listener: L }

/** Calls one listener so that a synchronous throw or an asynchronous rejection never reaches the writer or the other readers. */
function callIsolated(run: () => unknown): void {
  try {
    const result = run();
    if (typeof (result as PromiseLike<unknown> | undefined)?.then === 'function') {
      (result as PromiseLike<unknown>).then(undefined, () => undefined);
    }
  } catch { /* isolated */ }
}

export function createProjectContentEvents(): ProjectContentEvents {
  const subscriptions = new Map<string, Set<Subscription<() => void>>>();
  const everyProject = new Set<Subscription<(projectId: string) => void>>();
  const revisions = new Map<string, number>();
  return {
    notify(projectId) {
      revisions.set(projectId, (revisions.get(projectId) ?? 0) + 1);
      // One failing reader, synchronous or asynchronous, must not block the others or escape as unhandled.
      const current = subscriptions.get(projectId);
      if (current) {
        for (const subscription of [...current]) {
          if (current.has(subscription)) callIsolated(() => subscription.listener());
        }
      }
      for (const subscription of [...everyProject]) {
        if (everyProject.has(subscription)) callIsolated(() => subscription.listener(projectId));
      }
    },
    subscribeAll(listener) {
      const subscription: Subscription<(projectId: string) => void> = { listener };
      everyProject.add(subscription);
      return () => { everyProject.delete(subscription); };
    },
    subscribe(projectId, listener) {
      let set = subscriptions.get(projectId);
      if (!set) { set = new Set(); subscriptions.set(projectId, set); }
      const subscription: Subscription<() => void> = { listener };
      set.add(subscription);
      return () => {
        const current = subscriptions.get(projectId);
        if (!current || !current.delete(subscription)) return;
        if (current.size === 0) subscriptions.delete(projectId);
      };
    },
    revision: (projectId) => revisions.get(projectId) ?? 0,
  };
}
