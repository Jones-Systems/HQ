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
  /** Monotonic per-project change counter; starts at 0. Usable as a React `use()` cache key. */
  revision(projectId: string): number;
}

interface Subscription { readonly listener: () => void }

export function createProjectContentEvents(): ProjectContentEvents {
  const subscriptions = new Map<string, Set<Subscription>>();
  const revisions = new Map<string, number>();
  return {
    notify(projectId) {
      revisions.set(projectId, (revisions.get(projectId) ?? 0) + 1);
      const current = subscriptions.get(projectId);
      if (!current) return;
      for (const subscription of [...current]) {
        if (!current.has(subscription)) continue;
        // One failing reader, synchronous or asynchronous, must not block the others or escape as unhandled.
        try {
          const result: unknown = subscription.listener();
          if (typeof (result as PromiseLike<unknown> | undefined)?.then === 'function') {
            (result as PromiseLike<unknown>).then(undefined, () => undefined);
          }
        } catch { /* isolated */ }
      }
    },
    subscribe(projectId, listener) {
      let set = subscriptions.get(projectId);
      if (!set) { set = new Set(); subscriptions.set(projectId, set); }
      const subscription: Subscription = { listener };
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
