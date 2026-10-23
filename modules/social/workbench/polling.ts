import { isActiveRun, type RunRecord } from '../core';

/**
 * Run status polling (RR-4): a read-class `run(id)` call, made only while the run is queued or running and
 * the page is visible. It never submits anything; a failed read leaves the last status in place.
 */

export const POLL_INTERVAL_MS = 2000;

export interface Visibility {
  isVisible(): boolean;
  /** Calls `listener` when visibility changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export const documentVisibility: Visibility = {
  isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  subscribe(listener) {
    if (typeof document === 'undefined') return () => {};
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
};

export interface RunWatch {
  readonly load: (id: string) => Promise<RunRecord>;
  readonly onRecord: (run: RunRecord) => void;
  readonly onError: (reason: unknown) => void;
  readonly visibility?: Visibility;
  readonly intervalMs?: number;
}

/**
 * Watches one run. With an active `initial` record the first read waits one interval; without one it reads
 * as soon as the page is visible. Returns `stop`, which also cancels a read whose result has not arrived.
 */
export function watchRun(id: string, initial: RunRecord | null, watch: RunWatch): () => void {
  const visibility = watch.visibility ?? documentVisibility;
  const interval = watch.intervalMs ?? POLL_INTERVAL_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  /** Set when a tick was due while hidden; the next visible change reads immediately. */
  let waiting = false;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(tick, interval);
  };

  function tick() {
    timer = null;
    if (stopped || inFlight) return;
    if (!visibility.isVisible()) {
      waiting = true;
      return;
    }
    waiting = false;
    inFlight = true;
    watch.load(id).then((run) => {
      inFlight = false;
      if (stopped) return;
      watch.onRecord(run);
      if (isActiveRun(run)) schedule();
      else stop();
    }, (reason: unknown) => {
      inFlight = false;
      if (stopped) return;
      watch.onError(reason);
      stop();
    });
  }

  const unsubscribe = visibility.subscribe(() => {
    if (!stopped && waiting && visibility.isVisible()) tick();
  });

  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribe();
  }

  if (initial && !isActiveRun(initial)) stop();
  else if (initial) schedule();
  else tick();
  return stop;
}
