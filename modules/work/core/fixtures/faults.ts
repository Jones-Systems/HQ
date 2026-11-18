import { PLANNER_PORT_KEYS, PlannerPortError, type PlannerPort } from '../port';

// Transport faults around any PlannerPort, for tests and previews. Every write
// fault surfaces as `unknown` (the client cannot tell them apart) except
// `unavailable`, which is known not delivered.

export type WriteFault =
  /** Delivered and applied; the response is lost. */
  | 'lose-response'
  /** Never delivered. */
  | 'drop'
  /** Delivered later, when the returned `deliver` is called. */
  | 'defer'
  /** Refused before sending. */
  | 'unavailable';

export interface FaultControl {
  /** Applies `fault` to the next write call. */
  next(fault: WriteFault): void;
  /** While true, reads reject as `unavailable`. */
  readsUnavailable(on: boolean): void;
  /** Delivers every deferred write in order; resolves to each outcome. */
  deliverDeferred(): Promise<PromiseSettledResult<unknown>[]>;
}

const WRITES = new Set<string>(['create', 'patch', 'move', 'setArchived', 'markReviewed', 'updateSettings']);

export function withFaults(inner: PlannerPort): { port: PlannerPort; faults: FaultControl } {
  const queued: WriteFault[] = [];
  const deferred: (() => Promise<unknown>)[] = [];
  let readsDown = false;

  const wrap = (key: keyof PlannerPort) => async (...args: unknown[]) => {
    const call = () => (inner[key] as (...a: unknown[]) => Promise<unknown>)(...args);
    if (!WRITES.has(key)) {
      if (readsDown) throw new PlannerPortError({ kind: 'unavailable' });
      return call();
    }
    const requestId = String(args[args.length - 1]);
    const fault = queued.shift();
    if (fault === 'unavailable') throw new PlannerPortError({ kind: 'unavailable' });
    if (fault === 'drop') throw new PlannerPortError({ kind: 'unknown', requestId });
    if (fault === 'defer') {
      deferred.push(call);
      throw new PlannerPortError({ kind: 'unknown', requestId });
    }
    if (fault === 'lose-response') {
      await call().catch(() => undefined);
      throw new PlannerPortError({ kind: 'unknown', requestId });
    }
    return call();
  };

  const port = Object.fromEntries(PLANNER_PORT_KEYS.map((key) => [key, wrap(key)])) as unknown as PlannerPort;
  const faults: FaultControl = {
    next: (fault) => void queued.push(fault),
    readsUnavailable: (on) => void (readsDown = on),
    deliverDeferred: () => Promise.allSettled(deferred.splice(0).map((call) => call())),
  };
  return { port, faults };
}
