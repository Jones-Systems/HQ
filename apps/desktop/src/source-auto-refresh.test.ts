import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SourceResult, SourceStatus, SourceTransport } from '@hq/contracts/catalog';
import { createSourceAutoRefresh, SOURCE_AUTO_REFRESH, type SourceAutoRefresh, type SourceAutoRefreshClock } from './source-auto-refresh';

const MINUTE = 60_000;
const START = Date.UTC(2026, 10, 17, 12, 0, 0);

class ManualClock implements SourceAutoRefreshClock {
  time = START;
  #seq = 0;
  readonly #timers = new Map<number, { due: number; callback: () => void }>();
  now() { return this.time; }
  setTimeout(callback: () => void, ms: number) { const id = ++this.#seq; this.#timers.set(id, { due: this.time + ms, callback }); return id; }
  clearTimeout(handle: unknown) { this.#timers.delete(handle as number); }
  get pending() { return this.#timers.size; }
  get nextDelay(): number | null { const dues = [...this.#timers.values()].map((timer) => timer.due - this.time); return dues.length ? Math.min(...dues) : null; }
  /** Moves time forward, firing due timers in order. */
  advance(ms: number) {
    const target = this.time + ms;
    for (;;) {
      const next = [...this.#timers].filter(([, timer]) => timer.due <= target).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      this.#timers.delete(next[0]);
      this.time = Math.max(this.time, next[1].due);
      next[1].callback();
    }
    this.time = target;
  }
}
const settle = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };

type Row = SourceStatus;
const row = (sourceId: string, patch: Partial<Row> = {}): Row => ({
  sourceId, kind: 'local', label: sourceId, hostId: `host-${sourceId}`, rootId: `root-${sourceId}`, state: 'ready', generation: 1, lastSuccessAt: null, ...patch,
});
const iso = (ms: number) => new Date(ms).toISOString();

type Scripted = SourceResult<readonly SourceStatus[]> | 'throw' | (() => Promise<SourceResult<readonly SourceStatus[]>>);
/** A scripted `sources.call`: `status` returns the current rows; each refresh pops the next scripted outcome for its source. */
function createSources(initial: readonly Row[]) {
  let rows = [...initial];
  const routes: string[] = [];
  const refreshes: string[] = [];
  const script = new Map<string, Scripted[]>();
  const sources = {
    statusResult: 'ok' as 'ok' | 'unavailable' | 'throw',
    async call(route: string, input: unknown): Promise<SourceResult<readonly SourceStatus[]>> {
      routes.push(route);
      if (route === 'status') {
        if (sources.statusResult === 'throw') throw new Error('bridge gone');
        return sources.statusResult === 'ok' ? { ok: true, value: rows } : { ok: false, kind: 'unavailable' };
      }
      const sourceId = (input as { sourceId: string }).sourceId;
      refreshes.push(sourceId);
      const queue = script.get(sourceId) ?? [];
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      if (next === undefined) {
        // Default: the source refreshed and is now ready, with a fresh timestamp.
        rows = rows.map((item) => item.sourceId === sourceId ? { ...item, state: 'ready', lastSuccessAt: iso(clockRef.time) } : item);
        return { ok: true, value: rows };
      }
      if (next === 'throw') throw new Error('bridge gone');
      return typeof next === 'function' ? next() : next;
    },
  };
  return {
    sources, routes, refreshes,
    setRows(next: readonly Row[]) { rows = [...next]; },
    on(sourceId: string, ...outcomes: Scripted[]) { script.set(sourceId, outcomes); },
    get rows() { return rows; },
  };
}
// The scripted double stamps successful refreshes with the manual clock's time.
let clockRef: ManualClock;

let active: SourceAutoRefresh | undefined;
afterEach(() => { active?.stop(); active = undefined; });

function setup(initial: readonly Row[], extra: { kinds?: Parameters<typeof createSourceAutoRefresh>[0]['kinds']; onChanged?: () => void; intervalMs?: number } = {}) {
  const clock = new ManualClock();
  clockRef = clock;
  const double = createSources(initial);
  const refresh = createSourceAutoRefresh({ sources: double.sources as unknown as SourceTransport, clock, ...extra });
  active = refresh;
  return { clock, double, refresh };
}
const stale = (sourceId: string): Row => row(sourceId, { state: 'stale', lastSuccessAt: iso(START - 60 * MINUTE) });

describe('source auto refresh', () => {
  it('does nothing without a bridge', async () => {
    const clock = new ManualClock();
    const refresh = createSourceAutoRefresh({ sources: undefined, clock });
    refresh.start();
    expect(clock.pending).toBe(0);
    expect(refresh.running).toBe(false);
    await refresh.cycle();
    refresh.stop();
    expect(createSourceAutoRefresh({ sources: null, clock }).running).toBe(false);
  });

  it('waits for the initial delay, then runs one cycle per interval, and disposes its timer', async () => {
    const { clock, double, refresh } = setup([row('a')]);
    refresh.start();
    refresh.start();
    expect(clock.pending).toBe(1);
    clock.advance(SOURCE_AUTO_REFRESH.initialDelayMs - 1);
    await settle();
    expect(double.routes).toEqual([]);
    clock.advance(1);
    await settle();
    expect(double.routes).toEqual(['status', 'refresh']);
    expect(clock.nextDelay).toBe(SOURCE_AUTO_REFRESH.intervalMs);
    clock.advance(SOURCE_AUTO_REFRESH.intervalMs - 1);
    await settle();
    expect(double.refreshes).toEqual(['a']);
    clock.advance(1);
    await settle();
    expect(double.routes.filter((name) => name === 'status')).toHaveLength(2);
    expect(double.refreshes).toEqual(['a', 'a']);
    refresh.stop();
    expect(clock.pending).toBe(0);
    expect(refresh.running).toBe(false);
  });

  it('refreshes sources with no success or an old one, and leaves a fresh source alone', async () => {
    const { clock, double, refresh } = setup([
      row('never'), row('old', { lastSuccessAt: iso(START - 15 * MINUTE) }), row('fresh', { lastSuccessAt: iso(START - 14 * MINUTE) }), row('garbled', { lastSuccessAt: 'not a time' }),
    ]);
    await refresh.cycle();
    expect(double.refreshes).toEqual(['garbled', 'never', 'old']);
    expect(clock.pending).toBe(0);
  });

  it('refreshes one source at a time, in sourceId order, and drops an overlapping cycle', async () => {
    const { double, refresh } = setup([row('b'), row('a'), row('c')]);
    const gate: { release: () => void } = { release: () => {} };
    const held = new Promise<void>((resolve) => { gate.release = resolve; });
    let concurrent = 0, peak = 0;
    const slow = (id: string): Scripted => async () => {
      concurrent += 1; peak = Math.max(peak, concurrent);
      await held;
      concurrent -= 1;
      return { ok: true, value: double.rows.map((item) => item.sourceId === id ? { ...item, state: 'ready' as const, lastSuccessAt: iso(START) } : item) };
    };
    double.on('a', slow('a'));
    double.on('b', slow('b'));
    double.on('c', slow('c'));
    const first = refresh.cycle();
    await settle();
    expect(double.refreshes).toEqual(['a']);
    const second = refresh.cycle();
    expect(second).toBe(first);
    await settle();
    expect(double.routes.filter((name) => name === 'status')).toHaveLength(1);
    gate.release();
    await first;
    expect(double.refreshes).toEqual(['a', 'b', 'c']);
    expect(peak).toBe(1);
  });

  it('backs a source off for 1, 2, 4 then 8 cycles while it stays stale, and resets on success', async () => {
    const { double, refresh } = setup([stale('a')]);
    double.on('a', { ok: true, value: [stale('a')] });
    const attempts: number[] = [];
    for (let cycle = 1; cycle <= 40; cycle += 1) {
      const before = double.refreshes.length;
      await refresh.cycle();
      if (double.refreshes.length > before) attempts.push(cycle);
    }
    // Attempts at cycle 1, then 1 skipped (3), 2 skipped (6), 4 skipped (11), 8 skipped (20), 8 skipped (29), 8 skipped (38).
    expect(attempts).toEqual([1, 3, 6, 11, 20, 29, 38]);

    double.on('a', { ok: true, value: [row('a', { lastSuccessAt: iso(START) })] });
    double.setRows([stale('a')]);
    let reset = 0;
    for (let cycle = 0; cycle < 12 && reset === 0; cycle += 1) {
      const before = double.refreshes.length;
      await refresh.cycle();
      if (double.refreshes.length > before) reset = cycle + 1;
    }
    expect(reset).toBeGreaterThan(0);
    // After a success the back-off is cleared: the very next due cycle refreshes again with no skipped cycles.
    double.setRows([stale('a')]);
    const before = double.refreshes.length;
    await refresh.cycle();
    expect(double.refreshes.length).toBe(before + 1);
  });

  it("forgets a source whose refresh answers 'stale' (it no longer exists) and carries on with the rest", async () => {
    const { double, refresh } = setup([stale('a'), stale('b')]);
    double.on('a', { ok: false, kind: 'stale' });
    await refresh.cycle();
    expect(double.refreshes).toEqual(['a', 'b']);
    await refresh.cycle();
    // 'a' was not backed off: it is requested again on the next due cycle.
    expect(double.refreshes.filter((id) => id === 'a')).toHaveLength(2);
  });

  it.each([
    ['an unavailable answer', { ok: false, kind: 'unavailable' } as Scripted],
    ['a thrown call', 'throw' as Scripted],
  ])('ends the cycle on %s without resending, and reconciles through status next time', async (_name, outcome) => {
    const onChanged = vi.fn();
    const { double, refresh } = setup([stale('a'), stale('b'), stale('c')], { onChanged });
    double.on('a', outcome);
    await refresh.cycle();
    expect(double.refreshes).toEqual(['a']);
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(double.routes).toEqual(['status', 'refresh']);
    await refresh.cycle();
    // The unknown source is backed off for a cycle, so the later sources are now reached; 'a' is not resent blindly.
    expect(double.routes.slice(2)[0]).toBe('status');
    expect(double.refreshes).toEqual(['a', 'b', 'c']);
  });

  it('an unavailable status ends the cycle with no refresh call and backs the loop off', async () => {
    const { clock, double, refresh } = setup([stale('a')]);
    refresh.start();
    double.sources.statusResult = 'unavailable';
    clock.advance(SOURCE_AUTO_REFRESH.initialDelayMs);
    await settle();
    expect(double.routes).toEqual(['status']);
    expect(clock.nextDelay).toBe(SOURCE_AUTO_REFRESH.intervalMs * 2);
    clock.advance(SOURCE_AUTO_REFRESH.intervalMs * 2);
    await settle();
    double.sources.statusResult = 'throw';
    expect(clock.nextDelay).toBe(SOURCE_AUTO_REFRESH.intervalMs * 3);
    clock.advance(SOURCE_AUTO_REFRESH.intervalMs * 3);
    await settle();
    expect(double.routes).toEqual(['status', 'status', 'status']);
    expect(double.refreshes).toEqual([]);
    double.sources.statusResult = 'ok';
    clock.advance(SOURCE_AUTO_REFRESH.intervalMs * 5);
    await settle();
    expect(double.refreshes).toEqual(['a']);
    expect(clock.nextDelay).toBe(SOURCE_AUTO_REFRESH.intervalMs);
  });

  it('refreshes every enrolled kind by default and only the allowed kinds when restricted', async () => {
    const rows = [row('l', { kind: 'local' }), row('g', { kind: 'gallery' }), row('j', { kind: 'jones' })];
    const all = setup(rows);
    await all.refresh.cycle();
    expect(all.double.refreshes).toEqual(['g', 'j', 'l']);
    const only = setup(rows, { kinds: ['local'] });
    await only.refresh.cycle();
    expect(only.double.refreshes).toEqual(['l']);
  });

  it('stop() during a cycle prevents further requests', async () => {
    const { double, refresh } = setup([row('a'), row('b')]);
    const gate: { release: () => void } = { release: () => {} };
    const held = new Promise<void>((resolve) => { gate.release = resolve; });
    double.on('a', async () => { await held; return { ok: true, value: double.rows }; });
    const running = refresh.cycle();
    await settle();
    expect(double.refreshes).toEqual(['a']);
    refresh.stop();
    gate.release();
    await running;
    expect(double.refreshes).toEqual(['a']);
  });

  it('a restart during a cycle starts a fresh cycle on schedule, and the stopped cycle makes no further request', async () => {
    const { clock, double, refresh } = setup([row('a'), row('b')]);
    const gate: { release: () => void } = { release: () => {} };
    const held = new Promise<void>((resolve) => { gate.release = resolve; });
    let first = true;
    double.on('a', async () => {
      if (first) { first = false; await held; }
      double.setRows(double.rows.map((item) => item.sourceId === 'a' ? { ...item, lastSuccessAt: iso(clock.time) } : item));
      return { ok: true, value: double.rows };
    });
    refresh.start();
    clock.advance(SOURCE_AUTO_REFRESH.initialDelayMs);
    await settle();
    expect(double.routes).toEqual(['status', 'refresh']);
    refresh.stop();
    refresh.start();
    clock.advance(SOURCE_AUTO_REFRESH.initialDelayMs);
    await settle();
    // The restarted run read status itself instead of reusing the stopped run's cycle.
    expect(double.routes).toEqual(['status', 'refresh', 'status', 'refresh', 'refresh']);
    expect(double.refreshes).toEqual(['a', 'a', 'b']);
    expect(clock.nextDelay).toBe(SOURCE_AUTO_REFRESH.intervalMs);
    gate.release();
    await settle();
    // The stopped cycle does not go on to 'b', and its completion arms no second timer.
    expect(double.refreshes).toEqual(['a', 'a', 'b']);
    expect(clock.pending).toBe(1);
    expect(clock.nextDelay).toBe(SOURCE_AUTO_REFRESH.intervalMs);
  });

  it('ends a back-off when status shows a manual success after the failed attempt, but not an older one', async () => {
    const { clock, double, refresh } = setup([stale('a'), row('b', { lastSuccessAt: iso(START - 60 * MINUTE) })]);
    double.on('a', { ok: true, value: [stale('a')] });   // the registry kept the last snapshot: backed off
    double.on('b', { ok: false, kind: 'invalid' });       // refused while ready: backed off
    await refresh.cycle();
    expect(double.refreshes).toEqual(['a', 'b']);
    // A minute later Settings refreshes 'a' successfully; 'b' keeps its success from before the refused attempt.
    clock.advance(MINUTE);
    double.setRows(double.rows.map((item) => item.sourceId === 'a' ? row('a', { lastSuccessAt: iso(clock.time) }) : item));
    clock.advance(SOURCE_AUTO_REFRESH.intervalMs);
    await refresh.cycle();
    // 'a' is no longer backed off and is due again; 'b' still sits out its skipped cycle.
    expect(double.refreshes).toEqual(['a', 'b', 'a']);
  });

  it('treats an unknown refresh that landed as a success, so the next failure does not escalate', async () => {
    const { clock, double, refresh } = setup([stale('a')]);
    double.on('a',
      async (): Promise<SourceResult<readonly SourceStatus[]>> => {
        // The refresh lands, but its answer is lost.
        double.setRows([row('a', { lastSuccessAt: iso(clock.time) })]);
        throw new Error('bridge gone');
      },
      { ok: true, value: [stale('a')] });
    await refresh.cycle();
    await refresh.cycle();                                // status shows the landed success: the back-off ends
    expect(double.refreshes).toEqual(['a']);              // fresh, so not due yet
    clock.advance(SOURCE_AUTO_REFRESH.intervalMs);
    await refresh.cycle();                                // fails: the first failure again, one skipped cycle
    await refresh.cycle();
    expect(double.refreshes).toEqual(['a', 'a']);
    await refresh.cycle();
    expect(double.refreshes).toEqual(['a', 'a', 'a']);
  });

  it('reports a change once per cycle that attempted a refresh, and not otherwise', async () => {
    const onChanged = vi.fn();
    const { double, refresh } = setup([row('a'), row('b')], { onChanged });
    await refresh.cycle();
    expect(onChanged).toHaveBeenCalledTimes(1);
    double.setRows([row('a', { lastSuccessAt: iso(START) }), row('b', { lastSuccessAt: iso(START) })]);
    await refresh.cycle();
    expect(onChanged).toHaveBeenCalledTimes(1);
    double.sources.statusResult = 'unavailable';
    await refresh.cycle();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('clamps the interval to 5 minutes – 6 hours', async () => {
    const low = setup([row('a')], { intervalMs: 1 });
    low.refresh.start();
    low.clock.advance(SOURCE_AUTO_REFRESH.initialDelayMs);
    await settle();
    expect(low.clock.nextDelay).toBe(5 * MINUTE);
    const high = setup([row('a')], { intervalMs: 1e12 });
    high.refresh.start();
    high.clock.advance(SOURCE_AUTO_REFRESH.initialDelayMs);
    await settle();
    expect(high.clock.nextDelay).toBe(6 * 60 * MINUTE);
    const bad = setup([row('a')], { intervalMs: Number.NaN });
    bad.refresh.start();
    bad.clock.advance(SOURCE_AUTO_REFRESH.initialDelayMs);
    await settle();
    expect(bad.clock.nextDelay).toBe(15 * MINUTE);
  });

  it('only ever calls the status and refresh routes', async () => {
    const { clock, double, refresh } = setup([row('l'), row('g', { kind: 'gallery' }), row('j', { kind: 'jones' })]);
    double.on('g', { ok: false, kind: 'invalid' });
    refresh.start();
    for (let i = 0; i < 6; i += 1) { clock.advance(SOURCE_AUTO_REFRESH.intervalMs * 8); await settle(); }
    expect(new Set(double.routes)).toEqual(new Set(['status', 'refresh']));
  });
});
