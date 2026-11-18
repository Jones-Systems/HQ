import { CALL_CLASSES, portErrorOf, type CallClass, type PortError, type PortMethod, type SocialWorkspacePort } from './port';

export interface CallRecord {
  readonly seq: number;
  readonly method: PortMethod;
  readonly class: CallClass;
  /** Arguments as passed; not copied. */
  readonly args: readonly unknown[];
  outcome: 'pending' | 'ok' | 'error';
  /** The PortError of a rejection, or null when it was not a port error. */
  error?: PortError | null;
}

export interface RecordedPort {
  /** Forwards every call to the wrapped port after recording it. */
  readonly port: SocialWorkspacePort;
  calls(): readonly CallRecord[];
  callsOf(callClass: CallClass): readonly CallRecord[];
  clear(): void;
}

/** Wraps a port and tags every call `content`, `read` or `execution`. */
export function recordCalls(target: SocialWorkspacePort): RecordedPort {
  let calls: CallRecord[] = [];
  let seq = 0;

  function wrap<M extends PortMethod>(method: M): SocialWorkspacePort[M] {
    const forward = target[method] as (...args: unknown[]) => Promise<unknown>;
    return (async (...args: unknown[]) => {
      const record: CallRecord = { seq: ++seq, method, class: CALL_CLASSES[method], args, outcome: 'pending' };
      calls.push(record);
      try {
        const value = await forward.apply(target, args);
        record.outcome = 'ok';
        return value;
      } catch (reason) {
        record.outcome = 'error';
        record.error = portErrorOf(reason);
        throw reason;
      }
    }) as SocialWorkspacePort[M];
  }

  const methods = Object.keys(CALL_CLASSES) as PortMethod[];
  const port = Object.fromEntries(methods.map((method) => [method, wrap(method)])) as unknown as SocialWorkspacePort;
  return {
    port,
    calls: () => [...calls],
    callsOf: (callClass) => calls.filter((call) => call.class === callClass),
    clear() {
      calls = [];
    },
  };
}
