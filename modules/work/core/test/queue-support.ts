import type { WorkPersistence } from '../durability';
import { createFixturePlanner } from '../fixtures/adapter';
import { withFaults } from '../fixtures/faults';
import {
  PLANNER_PORT_KEYS, PlannerPortError,
  type PlannerError, type PlannerPort, type PlannerRecovery, type RecoveryIntent, type UnavailableReason,
} from '../port';
import { createWorkStore, type WorkStoreOptions } from '../store';

// Test support for the offline queue and durable state: a fixture Planner behind a network that can be taken down with
// a reason, held or interrupted per call; a recovery that records intents like the live adapter; and an in-memory
// persistence with gates. Everything is synthetic and in memory.

export function clock(start = '2026-10-21T16:00:00.000Z') {
  let t = Date.parse(start);
  return () => new Date((t += 1000));
}

export function counter(prefix: string, width = 12) {
  let n = 0;
  return () => `${prefix}${String((n += 1)).padStart(width, '0')}`;
}

export function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open };
}

export const WRITE_METHODS = new Set<string>(['create', 'patch', 'move', 'setArchived', 'markReviewed', 'updateSettings']);

export interface Call { method: string; args: unknown[] }

/** The Planner as the store reaches it. */
export function network(inner: PlannerPort) {
  const calls: Call[] = [];
  const hooks = new Map<string, (args: unknown[]) => Promise<void> | void>();
  let outage: { reason?: UnavailableReason } | null = null;
  let onWrite: ((requestId: string) => void) | null = null;
  const port = Object.fromEntries(PLANNER_PORT_KEYS.map((key) => [key, async (...args: unknown[]) => {
    calls.push({ method: key, args: structuredClone(args) });
    if (outage) throw new PlannerPortError(outage.reason ? { kind: 'unavailable', reason: outage.reason } : { kind: 'unavailable' });
    if (WRITE_METHODS.has(key)) onWrite?.(String(args[args.length - 1]));
    const hook = hooks.get(key);
    if (hook) {
      hooks.delete(key);
      await hook(args);
    }
    return (inner[key] as (...a: unknown[]) => Promise<unknown>)(...args);
  }])) as unknown as PlannerPort;
  return {
    port,
    calls,
    writes: () => calls.filter((c) => WRITE_METHODS.has(c.method)),
    /** Every call rejects `unavailable` (with `reason`, when given) until `up()`. */
    down(reason?: UnavailableReason) { outage = reason ? { reason } : {}; },
    up() { outage = null; },
    /** Runs once, before the next call to `method` reaches the Planner. It may throw or change the Planner. */
    before(method: keyof PlannerPort, hook: (args: unknown[]) => Promise<void> | void) { hooks.set(method, hook); },
    /** The next call to `method` rejects with this Planner error. */
    failNext(method: keyof PlannerPort, error: PlannerError) { hooks.set(method, () => { throw new PlannerPortError(error); }); },
    /** Holds the next call to `method` until `release()`; `reached` resolves when it is waiting. */
    hold(method: keyof PlannerPort) {
      const release = gate();
      const reached = gate();
      hooks.set(method, async () => {
        reached.open();
        await release.opened;
      });
      return { release: release.open, reached: reached.opened };
    },
    /** Called with the request ID of every write that reaches the Planner, before it is applied. */
    recordWrites(listener: (requestId: string) => void) { onWrite = listener; },
  };
}

/** A recovery that records an intent for every write sent, as the live adapter does, and can adopt one after a restart. */
export function stubRecovery() {
  const held = new Map<string, RecoveryIntent>();
  const adopted: unknown[] = [];
  const recovery: PlannerRecovery = {
    async check(requestId) {
      if (!held.has(requestId)) throw new PlannerPortError({ kind: 'replay_indeterminate', requestId, reason: 'no_intent' });
      return { outcome: 'not_applied' };
    },
    async apply(requestId) {
      throw new PlannerPortError({ kind: 'unknown', requestId });
    },
    release: (requestId) => void held.delete(requestId),
    exportIntent: (requestId) => held.get(requestId) ?? null,
    adoptIntent(intent) {
      adopted.push(intent);
      const candidate = intent as Partial<RecoveryIntent> | null;
      if (!candidate || typeof candidate.requestId !== 'string') return false;
      held.set(candidate.requestId, intent as RecoveryIntent);
      return true;
    },
  };
  const record = (requestId: string, sentAfterVersion = 0) => void held.set(requestId, { v: 1, requestId, sentAfterVersion, call: { route: 'patch' } });
  return { recovery, held, adopted, record };
}

/** An in-memory persistence. `loadGate` and `saveGate` hold the next load or save until opened. */
export function memoryPersistence(initial?: unknown) {
  let stored = initial;
  const saves: Record<string, unknown>[] = [];
  const control = {
    loads: 0, started: 0, inFlight: 0, maxInFlight: 0,
    failLoad: false, failSave: false,
    loadGate: null as Promise<void> | null, saveGate: null as Promise<void> | null,
  };
  const persistence: WorkPersistence = {
    async load() {
      control.loads += 1;
      if (control.loadGate) await control.loadGate;
      if (control.failLoad) throw new Error('unreadable');
      return structuredClone(stored);
    },
    async save(value) {
      control.started += 1;
      control.inFlight += 1;
      control.maxInFlight = Math.max(control.maxInFlight, control.inFlight);
      try {
        if (control.saveGate) await control.saveGate;
        if (control.failSave) throw new Error('disk full');
        stored = structuredClone(value);
        saves.push(structuredClone(value) as Record<string, unknown>);
      } finally {
        control.inFlight -= 1;
      }
    },
  };
  return { persistence, saves, control, document: () => stored, set: (value: unknown) => void (stored = value), last: () => saves[saves.length - 1] };
}

/** Lets pending promise callbacks and timers run, for background flushes and saves. */
export const settled = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export interface SetupOptions {
  store?: Partial<WorkStoreOptions>;
  features?: string[];
  titles?: string[];
  /** Pass a recovery that records intents, as the live adapter would. */
  recovery?: boolean;
  /** Leave the first `load()` to the test. */
  load?: boolean;
  /** Wraps the port the store reads, for example to hide an item from snapshots. */
  wrap?: (port: PlannerPort) => PlannerPort;
}

/** The store over a network over faults over the fixture Planner, with three items in Next: A, B, C. */
export async function setup(options: SetupOptions = {}) {
  const now = clock();
  const fixture = createFixturePlanner({ now, newId: counter('item'), features: options.features ?? [] });
  const device = fixture.port; // another device writing to the same Planner
  const otherRid = counter('other-', 8);
  for (const title of options.titles ?? ['C', 'B', 'A']) await device.create({ title, status: 'next' }, otherRid());
  const net = network(fixture.port);
  const faulty = withFaults(net.port);
  const stub = stubRecovery();
  if (options.recovery) net.recordWrites((requestId) => stub.record(requestId, fixture.control.stateVersion()));
  const store = createWorkStore(options.wrap ? options.wrap(faulty.port) : faulty.port, {
    now, newRequestId: counter('req-', 8), offlineQueue: true, ...(options.recovery ? { recovery: stub.recovery } : {}), ...options.store,
  });
  if (options.load !== false) await store.load();
  const byTitle = (title: string) => store.getState().confirmed!.items.find((i) => i.title === title)!;
  const shown = (title: string) => store.getState().items.find((i) => i.title === title)!;
  const stored = (title: string) => fixture.control.stored().find((i) => i.title === title)!;
  /** Takes the Planner down and lets the store notice. */
  const goOffline = async (reason?: UnavailableReason) => {
    net.down(reason);
    await store.poll();
  };
  /** Brings the Planner back; the poll that sees it also flushes the queue. */
  const reconnect = async () => {
    net.up();
    await store.poll();
  };
  return { now, fixture, device, otherRid, net, faults: faulty.faults, stub, store, byTitle, shown, stored, goOffline, reconnect, control: fixture.control };
}

export type Harness = Awaited<ReturnType<typeof setup>>;
