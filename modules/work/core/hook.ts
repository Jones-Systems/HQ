import { useEffect, useSyncExternalStore } from 'react';
import type { WorkState, WorkStore } from './store';

export const VERSION_POLL_MS = 20_000;

/**
 * Subscribes a component to a module-level WorkStore. It loads the snapshot on
 * first use and polls the version while the document is visible. Unmounting
 * stops polling only; the store keeps its state, queue and undo stack.
 */
export function useWorkState(store: WorkStore, { pollMs = VERSION_POLL_MS }: { pollMs?: number } = {}): WorkState {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  useEffect(() => {
    if (store.getState().load === 'idle') void store.load();
    const doc = typeof document === 'undefined' ? null : document;
    const visible = () => !doc || doc.visibilityState === 'visible';
    const timer = setInterval(() => {
      if (visible()) void store.poll();
    }, pollMs);
    const onVisibility = () => {
      if (visible()) void store.poll();
    };
    doc?.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      doc?.removeEventListener('visibilitychange', onVisibility);
    };
  }, [store, pollMs]);
  return state;
}
