/**
 * Automatic refresh of enrolled project sources, driven from the renderer composition root.
 *
 * It reads `status` and calls the registry's own `refresh` route for sources that are due, one at a time. Those are
 * the routes Settings already uses; it never enrolls, chooses, removes or touches credentials or the network itself.
 * The registry keeps the last snapshot when a refresh fails (state `stale` or `unavailable`), so last-good data and
 * its freshness stay visible. The registry serializes its own calls, so a manual refresh and an automatic one cannot
 * interleave.
 *
 * An unknown outcome (a refresh that threw or answered `unavailable`) is never resent: the cycle ends, the source
 * backs off, and the next cycle begins by reading `status`, which is how the outcome is reconciled.
 */
import type { SourceResult, SourceStatus, SourceTransport } from '@hq/contracts/catalog';

export type SourceKind = SourceStatus['kind'];

export interface SourceAutoRefreshClock {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface SourceAutoRefreshOptions {
  /** Only `status` and `refresh` are ever called. Missing means no native bridge: nothing is scheduled. */
  readonly sources: Pick<SourceTransport, 'call'> | null | undefined;
  readonly clock?: SourceAutoRefreshClock;
  /** Time between cycles, and the age after which a source is due. Default 15 min, clamped to 5 min – 6 h. */
  readonly intervalMs?: number;
  /** Delay before the first cycle. Default 60 s. */
  readonly initialDelayMs?: number;
  /** Enrolled kinds to refresh. Default: all three. */
  readonly kinds?: readonly SourceKind[];
  /** Called once after a cycle that attempted at least one refresh, so status readers can re-read. */
  readonly onChanged?: () => void;
}

export interface SourceAutoRefresh {
  start(): void;
  stop(): void;
  /** Runs one cycle now. While a cycle is already running it returns that cycle and starts no second one. */
  cycle(): Promise<void>;
  readonly running: boolean;
}

export const SOURCE_AUTO_REFRESH = {
  intervalMs: 15 * 60_000, minIntervalMs: 5 * 60_000, maxIntervalMs: 6 * 60 * 60_000, initialDelayMs: 60_000, maxBackoffCycles: 8,
} as const;

const ALL_KINDS: readonly SourceKind[] = ['local', 'gallery', 'jones'];
const systemClock: SourceAutoRefreshClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

/** Cycles to skip after the nth consecutive failure: 1, 2, 4, then 8 (the cap). */
const skipAfter = (failures: number) => Math.min(SOURCE_AUTO_REFRESH.maxBackoffCycles, 2 ** (failures - 1));

interface Tracking { failures: number; skip: number }

export function createSourceAutoRefresh(options: SourceAutoRefreshOptions): SourceAutoRefresh {
  const clock = options.clock ?? systemClock;
  const requested = options.intervalMs;
  const intervalMs = Math.min(SOURCE_AUTO_REFRESH.maxIntervalMs, Math.max(SOURCE_AUTO_REFRESH.minIntervalMs,
    typeof requested === 'number' && Number.isFinite(requested) ? requested : SOURCE_AUTO_REFRESH.intervalMs));
  const initialDelay = typeof options.initialDelayMs === 'number' && Number.isFinite(options.initialDelayMs) && options.initialDelayMs >= 0
    ? options.initialDelayMs : SOURCE_AUTO_REFRESH.initialDelayMs;
  const kinds = new Set(options.kinds ?? ALL_KINDS);
  const tracking = new Map<string, Tracking>();

  let started = false;
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;
  // Changes on stop(); a cycle that began under an older epoch makes no further request.
  let epoch = 0;
  let statusFailures = 0;

  const clearTimer = () => { if (timer !== null) { clock.clearTimeout(timer); timer = null; } };
  const schedule = (delay: number) => {
    clearTimer();
    if (!started) return;
    timer = clock.setTimeout(() => {
      timer = null;
      void runCycle().finally(() => { if (started && timer === null) schedule(nextDelay()); });
    }, delay);
  };
  /** After a failed `status` the loop backs off too: one interval plus 1, 2, 4, then 8 skipped cycles. */
  const nextDelay = () => statusFailures === 0 ? intervalMs : intervalMs * (1 + skipAfter(statusFailures));

  const failed = (id: string) => {
    const entry = tracking.get(id) ?? { failures: 0, skip: 0 };
    entry.failures += 1;
    entry.skip = skipAfter(entry.failures);
    tracking.set(id, entry);
  };

  const isDue = (row: SourceStatus, now: number) => {
    if (row.lastSuccessAt === null) return true;
    const at = Date.parse(row.lastSuccessAt);
    return !Number.isFinite(at) || now - at >= intervalMs;
  };

  async function cycleOnce(mine: number): Promise<void> {
    const sources = options.sources;
    if (!sources) return;
    let rows: readonly SourceStatus[];
    try {
      const status = await sources.call('status', {});
      if (!status.ok || !Array.isArray(status.value)) throw new Error('status unavailable');
      rows = status.value;
    } catch {
      statusFailures += 1;
      return;
    }
    statusFailures = 0;
    if (mine !== epoch) return;
    const present = new Set(rows.map((row) => row.sourceId));
    for (const id of [...tracking.keys()]) if (!present.has(id)) tracking.delete(id);
    const now = clock.now();
    const due: SourceStatus[] = [];
    for (const row of [...rows].sort((a, b) => a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0)) {
      if (!kinds.has(row.kind)) continue;
      const entry = tracking.get(row.sourceId);
      if (entry && entry.skip > 0) { entry.skip -= 1; continue; }
      if (isDue(row, now)) due.push(row);
    }
    let attempted = false;
    try {
      for (const row of due) {
        if (mine !== epoch) return;
        attempted = true;
        let result: SourceResult<readonly SourceStatus[]>;
        try {
          result = await sources.call('refresh', { sourceId: row.sourceId });
        } catch {
          // Unknown effect: back the source off, end the cycle and never resend. The next cycle reads `status`.
          failed(row.sourceId);
          return;
        }
        if (!result.ok) {
          if (result.kind === 'stale') { tracking.delete(row.sourceId); continue; }   // the source no longer exists
          failed(row.sourceId);
          if (result.kind === 'unavailable') return;                                   // outcome unknown
          continue;                                                                    // 'invalid': refused, nothing happened
        }
        const after = result.value.find((item) => item.sourceId === row.sourceId);
        if (!after) { tracking.delete(row.sourceId); continue; }                       // removed meanwhile
        if (after.state === 'ready' || after.state === 'partial') tracking.delete(row.sourceId);
        else failed(row.sourceId);                                                     // the registry kept the last snapshot
      }
    } finally {
      if (attempted && mine === epoch) options.onChanged?.();
    }
  }

  function runCycle(): Promise<void> {
    if (inFlight) return inFlight;
    const mine = epoch;
    const run = cycleOnce(mine).catch(() => { /* a cycle never rejects into the timer */ }).finally(() => { if (inFlight === run) inFlight = null; });
    inFlight = run;
    return run;
  }

  return {
    start() {
      if (started || !options.sources) return;
      started = true;
      schedule(initialDelay);
    },
    stop() {
      started = false;
      epoch += 1;
      clearTimer();
    },
    cycle: runCycle,
    get running() { return started || inFlight !== null; },
  };
}
