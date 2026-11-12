/**
 * Reusable end-to-end harness for the Design backend (lane B3, W6).
 *
 * It wires the REAL pieces, with no fakes between the renderer composition and the disk:
 *
 *   section adapters  ->  renderer bridge (createBridgeWorkspaceDocuments)
 *     ->  in-process transport (what the preload `hq:svc:design` IPC does: structured clone both ways)
 *     ->  main-process dispatch (the same `catalog.*` / host split as main.ts)
 *     ->  createDesignHost  ->  openDesignStorage (the default store)  ->  the T9 file store in a temp dir.
 *
 * Tests import this file; it is not part of any build (tsconfig.electron.json only covers `electron/`).
 * Everything is synthetic: temp directories under `os.tmpdir()` (set `TMPDIR=/tmp`) are removed on close.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DesignServiceParams, DesignServiceRoute, DesignServiceTransport, DesignServiceValues, DesignStorageResult } from '@hq/contracts/services';
import { catalogPersistence, createCatalogHost, type CatalogBuilder } from '../../electron/catalog-host.ts';
import { createDesignHost, type DesignStore } from '../../electron/design-host.ts';
import { openDesignStorage } from '../../../../modules/design/app/storage/node.ts';
import { createBridgeWorkspaceDocuments } from '../../../../modules/design/app/compose/bridge-documents.ts';
import { createDesignWorkspace, type DesignWorkspace } from '../../../../modules/design/app/compose/workspace.ts';
import type { WorkspaceRecords } from '../../../../modules/design/app/storage/index.ts';

export type DesignHost = ReturnType<typeof createDesignHost>;
type Params = Record<string, unknown>;
type Dispatch = (route: DesignServiceRoute, params: unknown) => Promise<unknown>;
const unavailable = { ok: false, kind: 'unavailable' } as const;

/** A route filter for the transport's fault and gate controls. */
export type RouteMatcher = DesignServiceRoute | ((route: DesignServiceRoute, params: Params) => boolean);
const matches = (matcher: RouteMatcher, route: DesignServiceRoute, params: Params) => typeof matcher === 'function' ? matcher(route, params) : matcher === route;

export interface RecordedCall {
  readonly route: DesignServiceRoute;
  readonly params: Params;
  /** Absent when the request never reached the host or the reply was lost. */
  readonly result?: DesignStorageResult<unknown>;
  readonly outcome: 'replied' | 'request-dropped' | 'reply-lost';
}

export interface InProcessTransport extends DesignServiceTransport {
  readonly calls: readonly RecordedCall[];
  /** The next matching call never reaches the host and rejects, as a dead IPC channel would (no effect). */
  dropRequest(matcher: RouteMatcher): void;
  /** The next matching call reaches the host and is applied, then its reply is lost and the call rejects (the renderer cannot know). */
  loseReply(matcher: RouteMatcher): void;
  /** Holds the next matching call before it reaches the host until `release()`. `reached` resolves once it is held. */
  gate(matcher: RouteMatcher): { readonly reached: Promise<void>; release(): void };
}

/** The durable composition (`bridged: true`): sections, closure (requests, connector, references) and interactive. */
export type BridgedDesignWorkspace = Extract<DesignWorkspace, { readonly bridged: true }>;

export interface E2EWindow {
  readonly transport: InProcessTransport;
  /** The renderer bridge exactly as `createDesignComposition` builds it. */
  readonly records: WorkspaceRecords;
  /** The full production composition over `records`, never the labelled in-memory fake. */
  readonly workspace: BridgedDesignWorkspace;
}

export interface DesignE2E {
  /** Temp directory holding the store and the catalog state. Removed by `close()`. */
  readonly dir: string;
  readonly storeRoot: string;
  readonly host: DesignHost;
  /** The first renderer window. Replaced by `reopen()`. */
  readonly window: E2EWindow;
  /** Another renderer window on the same host (a second Design window). */
  openWindow(): E2EWindow;
  /** Closes the host, then opens a new host, store handle and window over the same directory. */
  reopen(options?: DesignE2EOptions): Promise<E2EWindow>;
  close(): Promise<void>;
}

export interface DesignE2EOptions {
  /** Open the store read-only: it refuses every write with `read-only`. */
  readonly readOnly?: boolean;
}

function createTransport(dispatch: Dispatch): InProcessTransport {
  const calls: RecordedCall[] = [];
  const drops: RouteMatcher[] = [], losses: RouteMatcher[] = [];
  const gates: { matcher: RouteMatcher; held: Promise<void>; reached(): void }[] = [];
  const take = (list: RouteMatcher[], route: DesignServiceRoute, params: Params) => {
    const index = list.findIndex((matcher) => matches(matcher, route, params));
    if (index < 0) return false;
    list.splice(index, 1);
    return true;
  };
  return {
    get calls() { return calls; },
    dropRequest(matcher) { drops.push(matcher); },
    loseReply(matcher) { losses.push(matcher); },
    gate(matcher) {
      let release!: () => void, reached!: () => void;
      const held = new Promise<void>((resolve) => { release = resolve; });
      const arrived = new Promise<void>((resolve) => { reached = resolve; });
      gates.push({ matcher, held, reached });
      return { reached: arrived, release };
    },
    async call<R extends DesignServiceRoute>(route: R, params: DesignServiceParams[R]): Promise<DesignStorageResult<DesignServiceValues[R]>> {
      const record = params as unknown as Params;
      const gateIndex = gates.findIndex((gate) => matches(gate.matcher, route, record));
      if (gateIndex >= 0) { const [gate] = gates.splice(gateIndex, 1); gate!.reached(); await gate!.held; }
      // ipcRenderer.invoke clones its arguments, and the result is cloned back. A non-cloneable argument rejects.
      const sent: unknown = structuredClone(params);
      if (take(drops, route, record)) { calls.push({ route, params: record, outcome: 'request-dropped' }); throw new Error('Design IPC channel closed'); }
      const result = await dispatch(route, sent) as DesignStorageResult<unknown>;
      const received = structuredClone(result);
      if (take(losses, route, record)) { calls.push({ route, params: record, outcome: 'reply-lost' }); throw new Error('Design IPC reply lost'); }
      calls.push({ route, params: record, result: received, outcome: 'replied' });
      return received as DesignStorageResult<DesignServiceValues[R]>;
    },
  };
}

/**
 * Creates the harness, runs `run`, then closes everything and asserts the temp directory is gone.
 * The current window's transport is installed as `window.hqServices.design` for the duration, because
 * the production composition reads discovery's transport from there.
 */
export async function withDesignE2E<T>(run: (e2e: DesignE2E) => Promise<T>, options: DesignE2EOptions = {}): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'hq-design-e2e-'));
  const storeRoot = join(dir, 'design-store');
  const hosts: DesignHost[] = [];
  const globals = globalThis as unknown as { window?: unknown };
  const hadWindow = Object.hasOwn(globals, 'window'), priorWindow = globals.window;
  let closed = false;

  const newWindow = (dispatch: Dispatch): E2EWindow => {
    const transport = createTransport(dispatch);
    const records = createBridgeWorkspaceDocuments(transport);
    const workspace = createDesignWorkspace(records);
    if (!workspace.bridged) throw new Error('The harness requires the durable (bridged) composition');
    return { transport, records, workspace };
  };
  const start = (open: DesignE2EOptions) => {
    // The default store: imports and export stay disabled, exactly as main.ts opens it.
    const host = createDesignHost(() => openDesignStorage({ root: storeRoot, ...(open.readOnly ? { readOnly: true } : {}) }) as unknown as Promise<DesignStore>);
    hosts.push(host);
    const catalog = createCatalogHost(catalogPersistence(join(dir, 'user-data')), async () => null,
      (async () => { throw new Error('No catalog root is selected in this harness'); }) as CatalogBuilder);
    // main.ts: `catalog.*` goes to the catalog host once the design host is ready; everything else to the design host.
    const dispatch: Dispatch = async (route, params) => {
      if (route.startsWith('jonesCode.')) return unavailable;
      if (route.startsWith('catalog.')) return await host.ready() ? catalog.call(route, params) : unavailable;
      return host.call(route, params);
    };
    const window = newWindow(dispatch);
    globals.window = { hqServices: { design: window.transport } };
    return { host, window, dispatch };
  };
  let state = start(options);

  const e2e: DesignE2E = {
    dir, storeRoot,
    get host() { return state.host; },
    get window() { return state.window; },
    openWindow: () => newWindow(state.dispatch),
    async reopen(reopenOptions = {}) {
      await state.host.close();
      state = start(reopenOptions);
      return state.window;
    },
    async close() {
      if (closed) return;
      closed = true;
      const failures: unknown[] = [];
      for (const host of [...hosts].reverse()) { try { await host.close(); } catch (error) { failures.push(error); } }
      try { await rm(dir, { recursive: true, force: true }); } catch (error) { failures.push(error); }
      if (hadWindow) globals.window = priorWindow; else delete globals.window;
      if (failures.length > 0) throw new AggregateError(failures, 'Design E2E cleanup failed');
    },
  };
  try {
    return await run(e2e);
  } finally {
    await e2e.close();
    if (existsSync(dir)) throw new Error(`Design E2E temp directory was not removed: ${dir}`);
  }
}
