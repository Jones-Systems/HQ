/**
 * Per-project async caches that follow project content (B3 backend contract; see BACKEND-CONTRACT.md).
 *
 * React views read these accessors with `use()`, which needs the same promise back until something changed.
 * A cache entry is therefore keyed by the project's content revision from `ProjectContentEvents`: the same
 * promise is returned while the revision is unchanged, and one change to that project builds a new value on
 * the next call. Other projects' changes never touch the entry. The cache subscribes to nothing; views learn
 * that content changed through `useProjectContentRevision` (`content-revision.ts`).
 *
 * A view that passes the revision it is showing gets stale-while-revalidate: a request for an older
 * revision is answered with the newest value that already resolved, so a refresh in the background never
 * puts a mounted view back into its loading state. Only the up-to-date request waits for the new value.
 */
import type { ProjectContext } from '@hq/contracts';
import type { ProjectContentEvents } from './content-events.ts';

export interface RevisionRead {
  /**
   * The revision the view is showing, from `useProjectContentRevision`. Omit it to read the live revision.
   * Older than the live one means "serve what is ready"; the up-to-date request builds the new value.
   */
  readonly revision?: number;
  /** Which of several values for one project to read, for example an annotation version id. */
  readonly selection?: string;
}

export interface RevisionCacheOptions {
  /**
   * `rebuild` (default): any change to the project's content builds a new value.
   * `keep`: the value follows content changes by itself (it subscribed to the change feed, or it owns state
   * that a rebuild would discard). A successful value survives changes; a failed build is retried by the
   * next change, which is what makes a reload possible.
   */
  readonly onChange?: 'rebuild' | 'keep';
  /** Most selections kept per project; the least recently read goes first. Default 4. */
  readonly maxSelections?: number;
}

interface Entry<T> {
  readonly revision: number;
  readonly promise: Promise<T>;
  state: 'pending' | 'fulfilled' | 'rejected';
}

interface Slot<T> {
  /** The most recent build. */
  newest: Entry<T>;
  /** The most recent build that resolved, kept so a stale request is answered without waiting. */
  ready: Entry<T> | null;
}

/**
 * Memoises `build` per project and optional selection. A failed build is cached like a success until the next
 * change to that project, so a permanent failure cannot make a suspended view re-read in a loop.
 */
export function perProjectRevision<T>(
  events: Pick<ProjectContentEvents, 'revision'>,
  build: (project: ProjectContext, selection: string | undefined) => Promise<T>,
  options: RevisionCacheOptions = {},
): (project: ProjectContext, read?: RevisionRead) => Promise<T> {
  const keep = options.onChange === 'keep';
  const maxSelections = Math.max(1, options.maxSelections ?? 4);
  const projects = new Map<string, Map<string, Slot<T>>>();
  return (project, read) => {
    const live = events.revision(project.id);
    const wanted = Math.min(read?.revision ?? live, live);
    const key = read?.selection ?? '';
    let slots = projects.get(project.id);
    const slot = slots?.get(key);
    if (slot && slots) {
      const { newest, ready } = slot;
      const served = newest.revision === wanted ? newest
        : ready?.revision === wanted ? ready
          : keep && newest.state !== 'rejected' ? newest
            : wanted < live && ready ? ready
              : newest.revision === live ? newest : null;
      if (served) {
        // Most recently read last, so the selection on screen is the last one dropped.
        slots.delete(key);
        slots.set(key, slot);
        return served.promise;
      }
    }
    if (!slots) { slots = new Map(); projects.set(project.id, slots); }
    const promise = build(project, read?.selection);
    const entry: Entry<T> = { revision: live, promise, state: 'pending' };
    const next: Slot<T> = slot ?? { newest: entry, ready: null };
    next.newest = entry;
    // The consumer's own `use()` handles a rejection; these handlers only record how the build ended.
    promise.then(() => {
      entry.state = 'fulfilled';
      if (next.ready === null || next.ready.revision <= entry.revision) next.ready = entry;
    }, () => { entry.state = 'rejected'; });
    slots.delete(key);
    slots.set(key, next);
    while (slots.size > maxSelections) slots.delete(slots.keys().next().value!);
    return promise;
  };
}
