import type { UpdateResult, UpdateStatus } from '@hq/contracts/updates';

export const UPDATE_COMMAND = 'hq:updates:command';
export const UPDATE_STATUS = 'hq:updates:status';

interface UpdateHost {
  status(): UpdateStatus;
  call(route: unknown, params: unknown): Promise<UpdateResult>;
  subscribe(listener: (status: UpdateStatus) => void): () => void;
}

export function createShellHealthGate(markReady: () => Promise<void>, required: boolean) {
  let disposed = false;
  let acknowledged: Promise<boolean> | undefined;
  let settle: (ready: boolean) => void = () => {};
  const ready = required ? new Promise<boolean>(resolve => { settle = resolve; }) : Promise.resolve(true);
  return {
    wait: () => ready,
    acknowledge() {
      if (disposed) return Promise.resolve(false);
      acknowledged ??= Promise.resolve().then(markReady).then(() => {
        const accepted = !disposed;
        settle(accepted);
        return accepted;
      }, () => { settle(false); return false; });
      return acknowledged;
    },
    dispose() { disposed = true; settle(false); },
  };
}

export function registerUpdateBridge<Event>(options: {
  ipc: {
    handle(channel: string, listener: (event: Event, route: unknown, params: unknown) => unknown): void;
    removeHandler(channel: string): void;
  };
  authorized(event: Event): boolean;
  host: UpdateHost;
  health: ReturnType<typeof createShellHealthGate>;
  send(status: UpdateStatus): void;
}) {
  let disposed = false;
  const rejected = Object.freeze({ ok: false, code: 'unavailable' });
  options.ipc.handle(UPDATE_COMMAND, async (event, route, params) => {
    if (disposed || !options.authorized(event)) return rejected;
    if (route === 'shellReady') {
      if (!params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).length !== 0) return rejected;
      const accepted = await options.health.acknowledge();
      return accepted && !disposed && options.authorized(event) ? { ok: true } : rejected;
    }
    if (route === 'status') {
      if (!params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).length !== 0) return rejected;
      return options.host.status();
    }
    return options.host.call(route, params);
  });
  const unsubscribe = options.host.subscribe(status => { if (!disposed) options.send(status); });
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      options.ipc.removeHandler(UPDATE_COMMAND);
      options.health.dispose();
    },
  };
}
