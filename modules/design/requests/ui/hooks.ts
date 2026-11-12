import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type AnimationEvent } from 'react';
import type { RequestSession, SessionState } from '../src/session.ts';

/** The current state of every session, re-read whenever any one of them changes. */
export function useSessionStates(sessions: readonly RequestSession[]): readonly SessionState[] {
  const cache = useRef<readonly SessionState[]>([]);
  const subscribe = useCallback((notify: () => void) => {
    const stops = sessions.map((session) => session.subscribe(() => notify()));
    return () => { for (const stop of stops) stop(); };
  }, [sessions]);
  const snapshot = useCallback(() => {
    const next = sessions.map((session) => session.state);
    const previous = cache.current;
    if (previous.length === next.length && next.every((state, index) => state === previous[index])) return previous;
    cache.current = next;
    return next;
  }, [sessions]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * A one-shot accent wash on an element whenever `value` changes after the first render, so a status change
 * shows where it landed. Colour only: it also plays under reduced motion. Spread the result on the element.
 */
export function useChangeFlash(value: string): { readonly className?: string; readonly onAnimationEnd: (event: AnimationEvent<HTMLElement>) => void } {
  const previous = useRef(value);
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setFlashing(true);
  }, [value]);
  const onAnimationEnd = useCallback((event: AnimationEvent<HTMLElement>) => {
    if (event.target === event.currentTarget) setFlashing(false);
  }, []);
  return flashing ? { className: 'hq-flash', onAnimationEnd } : { onAnimationEnd };
}

export type Loadable<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'error'; readonly message: string };

/**
 * Runs `load` in an effect (never during render) and reports loading, ready or error. `reload` runs it again and
 * keeps showing the previous value while it does. Pass `enabled: false` to wait.
 */
export function useLoadable<T>(load: () => Promise<T>, key: string, enabled = true): { readonly state: Loadable<T>; readonly reload: () => void } {
  const [state, setState] = useState<Loadable<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    latest.current().then((value) => { if (active) setState({ status: 'ready', value }); },
      (error: unknown) => { if (active) setState({ status: 'error', message: error instanceof Error ? error.message : String(error) }); });
    return () => { active = false; };
  }, [key, attempt, enabled]);
  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  return { state, reload };
}
