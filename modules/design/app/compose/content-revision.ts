import { useCallback, useDeferredValue, useSyncExternalStore } from 'react';
import type { ProjectContentEvents } from './content-events.ts';

/**
 * Re-renders the calling view when the project's content changes, and returns the revision to read.
 *
 * Views read durable accessors such as `workspace.contentFor(context)` with `use()`. Those accessors return a
 * new promise after a change, but React only calls them again when the view renders. Two small edits make the
 * view follow the content:
 *
 *     const revision = useProjectContentRevision(workspace, context.id);
 *     const { content } = use(workspace.contentFor(context, { revision }));
 *
 * The returned revision is deferred: the change renders in the background and the screen keeps showing the
 * previous content until the new content is ready, so a refresh never replaces a mounted view with its
 * loading state (a live preview beside it stays put). Without `{ revision }` the accessor reads the live
 * revision, which is correct but shows the loading state while it reloads.
 *
 * Works for the bridged and the fake workspace (the fake never changes, so its revision stays 0).
 */
export function useProjectContentRevision(workspace: { readonly contentEvents: ProjectContentEvents }, projectId: string): number {
  const { contentEvents } = workspace;
  const subscribe = useCallback((listener: () => void) => contentEvents.subscribe(projectId, listener), [contentEvents, projectId]);
  const read = useCallback(() => contentEvents.revision(projectId), [contentEvents, projectId]);
  return useDeferredValue(useSyncExternalStore(subscribe, read, read));
}
