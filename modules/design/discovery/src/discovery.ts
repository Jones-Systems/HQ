/**
 * Discovery service: cached first paint, bounded background refresh, context fencing and lazy previews.
 * Opening reads only the local cache; refresh runs afterwards and never blocks rendering.
 */
import {
  isoFromMs, SourceUnavailableError,
  type CacheStoragePort, type ClockPort, type HostId, type PreviewRef, type SourceAdapter, type SourceEnrollment,
  type WorkspaceEvidencePort,
} from './contract.ts';
import { EMPTY_CATALOG, parseSnapshot, reduceCatalog, type CatalogEvent, type CatalogState, type ReduceResult } from './catalog.ts';
import { CATALOG_CACHE_KEY, loadCatalogCache, PreviewCache, serializeCatalogCache, type CacheLoadStatus } from './cache.ts';
import { enrollSource, type EnrollmentRequest, type EnrollmentResult } from './enrollment.ts';
import { PreviewLoader, type PreviewLimits, type PreviewPriority } from './previews.ts';

/** The visible catalog scope, e.g. "all enrolled hosts" or one host filter. */
export interface DiscoveryContext {
  readonly id: string;
  readonly hostIds: readonly HostId[];
}

export type HostRefreshOutcome =
  | ReduceResult['outcome']
  | 'timeout' | 'offline' | 'error' | 'invalid-snapshot' | 'cancelled' | 'no-adapter' | 'not-enrolled';

export interface HostRefreshResult {
  readonly hostId: HostId;
  readonly outcome: HostRefreshOutcome;
}

export interface RefreshReport {
  readonly contextId: string;
  /** True when the context changed while this refresh ran; its late results were ignored. */
  readonly superseded: boolean;
  readonly results: readonly HostRefreshResult[];
}

export interface DiscoveryState {
  readonly opened: boolean;
  readonly cacheStatus: CacheLoadStatus | 'not-loaded';
  readonly cacheWritable: boolean;
  readonly cacheWriteFailed: boolean;
  readonly context: DiscoveryContext;
  readonly catalog: CatalogState;
  readonly enrollments: readonly SourceEnrollment[];
  readonly refreshing: readonly HostId[];
}

export interface RefreshPolicy {
  /** Per-host bound for one snapshot request. */
  readonly timeoutMs: number;
  /** Hosts refreshed concurrently. */
  readonly maxConcurrentHosts: number;
}

export interface DiscoveryOptions {
  readonly adapters: Readonly<Record<string, SourceAdapter>>;
  readonly enrollments?: readonly SourceEnrollment[];
  readonly cache: CacheStoragePort;
  readonly clock: ClockPort;
  readonly context?: DiscoveryContext;
  readonly refresh?: Partial<RefreshPolicy>;
  readonly previews?: Partial<PreviewLimits> & { readonly budgetBytes?: number };
  /** Start a background refresh after opening (default true). */
  readonly refreshOnOpen?: boolean;
}

export const DEFAULT_REFRESH_POLICY: RefreshPolicy = Object.freeze({ timeoutMs: 8_000, maxConcurrentHosts: 4 });

class Timeout extends Error {}
class Cancelled extends Error {}

function sameContext(a: DiscoveryContext, b: DiscoveryContext): boolean {
  return a.id === b.id && a.hostIds.length === b.hostIds.length && a.hostIds.every((host, index) => host === b.hostIds[index]);
}

export class DiscoveryService {
  readonly #adapters: Readonly<Record<string, SourceAdapter>>;
  readonly #cachePort: CacheStoragePort;
  readonly #clock: ClockPort;
  readonly #policy: RefreshPolicy;
  readonly #refreshOnOpen: boolean;
  readonly #previewCache: PreviewCache;
  readonly #previews: PreviewLoader;
  readonly #listeners = new Set<() => void>();
  readonly #inFlight = new Map<string, { token: number; promise: Promise<HostRefreshResult> }>();
  #state: DiscoveryState;
  #token = 0;
  #contextController = new AbortController();
  #cacheWrite: Promise<void> = Promise.resolve();
  #background: { stopped: boolean; handle: unknown } | null = null;

  constructor(options: DiscoveryOptions) {
    this.#adapters = options.adapters;
    this.#cachePort = options.cache;
    this.#clock = options.clock;
    this.#policy = { ...DEFAULT_REFRESH_POLICY, ...options.refresh };
    this.#refreshOnOpen = options.refreshOnOpen ?? true;
    const enrollments = options.enrollments ?? [];
    const maxItemBytes = options.previews?.maxItemBytes ?? 8 * 1024 * 1024;
    this.#previewCache = new PreviewCache(options.cache, { budgetBytes: options.previews?.budgetBytes ?? 256 * 1024 * 1024, maxItemBytes });
    this.#previews = new PreviewLoader({
      adapterFor: (host) => this.#adapterFor(host),
      cache: this.#previewCache,
      limits: { ...options.previews, maxItemBytes },
    });
    this.#state = {
      // Not writable until open() has read the stored cache: an unread cache may be warm or from a newer schema.
      opened: false, cacheStatus: 'not-loaded', cacheWritable: false, cacheWriteFailed: false,
      context: options.context ?? { id: 'all', hostIds: enrollments.map((item) => item.hostId) },
      catalog: EMPTY_CATALOG, enrollments, refreshing: [],
    };
  }

  getState(): DiscoveryState { return this.#state; }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  get previewStats() { return this.#previews.stats; }
  get previewCache(): PreviewCache { return this.#previewCache; }

  #set(patch: Partial<DiscoveryState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }

  #now() { return isoFromMs(this.#clock.now()); }

  #adapterFor(host: HostId): SourceAdapter | undefined {
    const enrollment = this.#state.enrollments.find((item) => item.hostId === host);
    return enrollment && Object.hasOwn(this.#adapters, enrollment.adapterKey) ? this.#adapters[enrollment.adapterKey] : undefined;
  }

  #dispatch(event: CatalogEvent): ReduceResult {
    const result = reduceCatalog(this.#state.catalog, event);
    if (result.state !== this.#state.catalog) {
      this.#set({ catalog: result.state });
      this.#persist();
    }
    return result;
  }

  #persist(): void {
    if (!this.#state.cacheWritable) return;
    const text = serializeCatalogCache(this.#state.catalog, this.#now());
    this.#cacheWrite = this.#cacheWrite.then(() => this.#cachePort.writeDocument(CATALOG_CACHE_KEY, text)).then(
      () => { if (this.#state.cacheWriteFailed) this.#set({ cacheWriteFailed: false }); },
      () => { this.#set({ cacheWriteFailed: true }); },
    );
  }

  /** Resolves once queued cache writes settle (tests and orderly shutdown). */
  flushCache(): Promise<void> { return this.#cacheWrite; }

  /**
   * Loads the cached catalog and returns immediately afterwards. Sources are contacted only by the
   * background refresh this starts, so a warm cache renders even when every source hangs.
   */
  async open(): Promise<DiscoveryState> {
    if (this.#state.opened) return this.#state;
    const load = await loadCatalogCache(this.#cachePort, this.#now());
    const catalog = reduceCatalog(load.catalog, { type: 'loaded-from-cache' }).state;
    this.#set({ opened: true, cacheStatus: load.status, cacheWritable: load.writable, catalog });
    if (this.#refreshOnOpen) void this.refresh();
    return this.#state;
  }

  /** Explicit enrollment only; returns the validation result without contacting the source. */
  enroll(request: EnrollmentRequest): EnrollmentResult {
    const result = enrollSource(request, this.#adapters, this.#state.enrollments, this.#now());
    if (result.ok) this.#set({ enrollments: [...this.#state.enrollments, result.enrollment] });
    return result;
  }

  /** Replaces one enrollment (for example after explicit fingerprint re-verification) and clears its held conflict. */
  updateEnrollment(enrollment: SourceEnrollment): void {
    if (!this.#state.enrollments.some((item) => item.hostId === enrollment.hostId)) throw new Error('Host is not enrolled');
    this.#set({ enrollments: this.#state.enrollments.map((item) => item.hostId === enrollment.hostId ? enrollment : item) });
    this.#dispatch({ type: 'conflict-resolved', hostId: enrollment.hostId });
  }

  /**
   * Switches the visible scope. In-flight refreshes and preview requests from the previous context are
   * aborted and any late results are ignored. Starts a refresh of the new context when opened.
   */
  setContext(context: DiscoveryContext): Promise<RefreshReport> | null {
    if (sameContext(context, this.#state.context)) return null;
    this.#token += 1;
    this.#contextController.abort();
    this.#contextController = new AbortController();
    this.#set({ context, refreshing: [] });
    return this.#state.opened ? this.refresh() : null;
  }

  /** Refreshes every enrolled host in the current context with per-host timeout and bounded concurrency. */
  async refresh(): Promise<RefreshReport> {
    const token = this.#token;
    const context = this.#state.context;
    const signal = this.#contextController.signal;
    const hosts = [...context.hostIds];
    const results: HostRefreshResult[] = new Array(hosts.length);
    let next = 0;
    const worker = async () => {
      while (next < hosts.length) {
        const index = next++;
        results[index] = await this.#refreshHost(hosts[index]!, token, signal);
      }
    };
    const workers = Array.from({ length: Math.min(this.#policy.maxConcurrentHosts, hosts.length) }, worker);
    await Promise.all(workers);
    return { contextId: context.id, superseded: token !== this.#token, results };
  }

  #refreshHost(host: HostId, token: number, contextSignal: AbortSignal): Promise<HostRefreshResult> {
    const existing = this.#inFlight.get(host);
    if (existing && existing.token === token) return existing.promise;
    const promise = this.#runHost(host, token, contextSignal).finally(() => {
      if (this.#inFlight.get(host)?.promise === promise) this.#inFlight.delete(host);
      if (token === this.#token) this.#set({ refreshing: this.#state.refreshing.filter((item) => item !== host) });
    });
    this.#inFlight.set(host, { token, promise });
    return promise;
  }

  async #runHost(host: HostId, token: number, contextSignal: AbortSignal): Promise<HostRefreshResult> {
    const enrollment = this.#state.enrollments.find((item) => item.hostId === host);
    if (!enrollment) return { hostId: host, outcome: 'not-enrolled' };
    const adapter = this.#adapterFor(host);
    if (!adapter) return { hostId: host, outcome: 'no-adapter' };
    if (contextSignal.aborted || token !== this.#token) return { hostId: host, outcome: 'cancelled' };
    this.#set({ refreshing: [...this.#state.refreshing, host] });
    this.#dispatch({ type: 'attempt', hostId: host, at: this.#now() });

    const controller = new AbortController();
    const onContextAbort = () => controller.abort();
    contextSignal.addEventListener('abort', onContextAbort, { once: true });
    let timedOut = false;
    const timer = this.#clock.setTimeout(() => { timedOut = true; controller.abort(); }, this.#policy.timeoutMs);
    let raw: unknown;
    let failure: unknown = null;
    try {
      // Race the adapter against our own abort so a source that ignores its signal still settles.
      raw = await Promise.race([
        adapter.listSnapshot(host, controller.signal),
        new Promise<never>((_, reject) => controller.signal.addEventListener('abort', () => reject(timedOut ? new Timeout() : new Cancelled()), { once: true })),
      ]);
    } catch (error) {
      failure = timedOut ? new Timeout() : contextSignal.aborted ? new Cancelled() : error;
    } finally {
      this.#clock.clearTimeout(timer);
      contextSignal.removeEventListener('abort', onContextAbort);
    }
    // Late results from a superseded context never touch the visible catalog.
    if (token !== this.#token || failure instanceof Cancelled) return { hostId: host, outcome: 'cancelled' };
    const at = this.#now();
    if (failure) {
      const kind = failure instanceof Timeout ? 'timeout' : failure instanceof SourceUnavailableError ? 'offline' : 'error';
      const message = kind === 'timeout' ? `No response within ${this.#policy.timeoutMs} ms` : failure instanceof Error ? failure.message : 'Source refresh failed';
      this.#dispatch({ type: 'failure', hostId: host, kind, message, at });
      return { hostId: host, outcome: kind };
    }
    const parsed = await parseSnapshot(raw, host);
    if (token !== this.#token) return { hostId: host, outcome: 'cancelled' };
    if (!parsed.ok) {
      this.#dispatch({ type: 'failure', hostId: host, kind: 'invalid-snapshot', message: parsed.reason, at });
      return { hostId: host, outcome: 'invalid-snapshot' };
    }
    const result = this.#dispatch({
      type: 'snapshot', snapshot: parsed.snapshot, at,
      ...(enrollment.fingerprint !== undefined ? { expectedFingerprint: enrollment.fingerprint } : {}),
    });
    if (result.outcome === 'rejected-collision') {
      this.#dispatch({ type: 'failure', hostId: host, kind: 'invalid-snapshot', message: 'Snapshot claims an identity owned by another host', at });
    }
    return { hostId: host, outcome: result.outcome };
  }

  /** Bounded background refresh: one cycle at a time, rescheduled after each completes. */
  startBackgroundRefresh(intervalMs: number): () => void {
    this.stopBackgroundRefresh();
    const loop = { stopped: false, handle: null as unknown };
    this.#background = loop;
    const schedule = () => {
      if (loop.stopped) return;
      loop.handle = this.#clock.setTimeout(() => { void this.refresh().finally(schedule); }, intervalMs);
    };
    schedule();
    return () => this.stopBackgroundRefresh();
  }

  stopBackgroundRefresh(): void {
    if (!this.#background) return;
    this.#background.stopped = true;
    this.#clock.clearTimeout(this.#background.handle);
    this.#background = null;
  }

  /**
   * On-demand preview bytes. Requests are tied to the current context: a context change withdraws them.
   * Concurrent requests for one digest share a single transport call.
   */
  loadPreview(host: HostId, ref: PreviewRef, options: { priority?: PreviewPriority; signal?: AbortSignal } = {}): Promise<Uint8Array> {
    const signal = options.signal ? AbortSignal.any([options.signal, this.#contextController.signal]) : this.#contextController.signal;
    return this.#previews.load(host, ref, { priority: options.priority ?? 'visible', signal });
  }

  /** Explicit evidence adoption into the authoritative workspace before cache eviction can drop it. */
  adoptPreview(ref: PreviewRef, workspace: WorkspaceEvidencePort): Promise<void> {
    return this.#previewCache.adopt(ref.digest, ref.mediaType, workspace);
  }

  dispose(): void {
    this.stopBackgroundRefresh();
    this.#token += 1;
    this.#contextController.abort();
    this.#listeners.clear();
  }
}
