/** Local structural interface keeps renderer/core imports out of the Electron entry emit. */
export interface WikiRuntime {
  call(method: unknown, args: unknown): Promise<unknown>;
  admin?(route: unknown, params: unknown, selectedPath?: string): Promise<unknown>;
  close(): Promise<void>;
}
const unavailable = () => ({ ok: false, error: { code: 'unavailable', reason: 'index-unavailable', message: 'Wiki is unavailable.' } });
export function createWikiBridge(open: () => Promise<WikiRuntime>) {
  let runtime: Promise<WikiRuntime> | undefined; let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const result = queue.then(run); queue = result.catch(() => undefined); return result;
  };
  return {
    call(method: unknown, args: unknown) {
      if (closed) return Promise.resolve(unavailable());
      return serial(async () => {
        try { runtime ??= open(); return await (await runtime).call(method, args); } catch { return unavailable(); }
      });
    },
    admin(route: unknown, params: unknown, selectedPath?: string) {
      if (closed) return Promise.resolve({ ok: false, kind: 'unavailable' });
      return serial(async () => {
        try {
          if (route === 'recheck' && runtime) {
            await runtime.catch(() => { runtime = undefined; });
          }
          runtime ??= open();
          const value = await runtime;
          return value.admin ? await value.admin(route, params, selectedPath) : { ok: false, kind: 'unavailable' };
        } catch { return { ok: false, kind: 'unavailable' }; }
      });
    },
    close() {
      closed = true;
      return serial(async () => { await runtime?.then(value => value.close(), () => undefined); runtime = undefined; });
    },
  };
}
export async function openEmittedWiki(userData: string): Promise<WikiRuntime> {
  const module = await import(new URL('./wiki-host/apps/desktop/electron/wiki-runtime.mjs', import.meta.url).href) as { openWikiRuntime(root: string): Promise<WikiRuntime> };
  return module.openWikiRuntime(userData);
}

/** The same renderer realm is not hard domain isolation; sender authorization is an IPC boundary. */
export function wikiIpcHandler<E>(authorized: (event: E) => boolean, bridge: Pick<WikiRuntime, 'call'>) {
  return (event: E, method: unknown, args: unknown) => authorized(event) ? bridge.call(method, args) : unavailable();
}
