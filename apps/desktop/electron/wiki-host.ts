/** Local structural interface keeps renderer/core imports out of the Electron entry emit. */
export interface WikiRuntime { call(method: unknown, args: unknown): Promise<unknown>; close(): Promise<void> }
const unavailable = () => ({ ok: false, error: { code: 'unavailable', reason: 'index-unavailable', message: 'Wiki is unavailable.' } });
export function createWikiBridge(open: () => Promise<WikiRuntime>) {
  let runtime: Promise<WikiRuntime> | undefined; let closed = false;
  return {
    async call(method: unknown, args: unknown) {
      if (closed) return unavailable();
      try { runtime ??= open(); return await (await runtime).call(method, args); } catch { return unavailable(); }
    },
    async close() { if (closed) return; closed = true; await runtime?.then(value => value.close(), () => undefined); },
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
