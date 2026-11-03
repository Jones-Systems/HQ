/**
 * On-demand preview loading. Requests coalesce by digest; the shared transport aborts only after every
 * subscriber cancels. Global and per-host concurrency, per-item bytes and visible-first priority bound
 * the work. Nothing is fetched until a caller asks, and callers should ask only for visible/prefetch tiles.
 */
import type { ContentDigest, HostId, PreviewRef, SourceAdapter } from './contract.ts';
import type { PreviewCache } from './cache.ts';
import { digestBytes } from './identity.ts';

export type PreviewPriority = 'visible' | 'prefetch';

export interface PreviewLimits {
  readonly globalConcurrency: number;
  readonly perHostConcurrency: number;
  readonly maxItemBytes: number;
}

export const DEFAULT_PREVIEW_LIMITS: PreviewLimits = Object.freeze({ globalConcurrency: 6, perHostConcurrency: 2, maxItemBytes: 8 * 1024 * 1024 });

export class PreviewError extends Error {
  readonly reason: 'too-large' | 'digest-mismatch' | 'no-adapter' | 'aborted' | 'transport';
  constructor(reason: PreviewError['reason'], message: string) {
    super(message);
    this.name = 'PreviewError';
    this.reason = reason;
  }
}

interface Subscriber {
  readonly priority: PreviewPriority;
  readonly resolve: (bytes: Uint8Array) => void;
  readonly reject: (error: unknown) => void;
}

interface Job {
  readonly digest: ContentDigest;
  readonly hostId: HostId;
  readonly ref: PreviewRef;
  readonly controller: AbortController;
  readonly subscribers: Set<Subscriber>;
  readonly seq: number;
  state: 'queued' | 'running' | 'done';
  /** Concurrency slot already returned (abandoned after abort). */
  released: boolean;
}

export interface PreviewStats {
  readonly transportCalls: number;
  readonly active: number;
  readonly queued: number;
  readonly peakActive: number;
  readonly peakPerHost: number;
}

export class PreviewLoader {
  readonly #adapterFor: (host: HostId) => SourceAdapter | undefined;
  readonly #cache: PreviewCache | null;
  readonly #limits: PreviewLimits;
  readonly #jobs = new Map<ContentDigest, Job>();
  readonly #activeByHost = new Map<string, number>();
  #active = 0;
  #seq = 0;
  #transportCalls = 0;
  #peakActive = 0;
  #peakPerHost = 0;

  constructor(options: { adapterFor: (host: HostId) => SourceAdapter | undefined; cache?: PreviewCache; limits?: Partial<PreviewLimits> }) {
    this.#adapterFor = options.adapterFor;
    this.#cache = options.cache ?? null;
    this.#limits = { ...DEFAULT_PREVIEW_LIMITS, ...options.limits };
  }

  get stats(): PreviewStats {
    let queued = 0;
    for (const job of this.#jobs.values()) if (job.state === 'queued') queued += 1;
    return { transportCalls: this.#transportCalls, active: this.#active, queued, peakActive: this.#peakActive, peakPerHost: this.#peakPerHost };
  }

  /** Resolves preview bytes. Aborting `signal` withdraws only this caller's interest. */
  async load(host: HostId, ref: PreviewRef, options: { priority?: PreviewPriority; signal?: AbortSignal } = {}): Promise<Uint8Array> {
    const signal = options.signal;
    if (signal?.aborted) throw new PreviewError('aborted', 'Preview request was cancelled');
    if (ref.bytes > this.#limits.maxItemBytes) throw new PreviewError('too-large', 'Preview exceeds the per-item byte limit');
    if (this.#cache) {
      // get() loads the persisted index first, so previews cached by an earlier session are reused.
      const cached = await this.#cache.get(ref.digest);
      if (cached) return cached;
    }
    if (signal?.aborted) throw new PreviewError('aborted', 'Preview request was cancelled');
    return new Promise<Uint8Array>((resolve, reject) => {
      let job = this.#jobs.get(ref.digest);
      if (!job) {
        if (!this.#adapterFor(host)) {
          reject(new PreviewError('no-adapter', 'No enrolled adapter for this host'));
          return;
        }
        job = { digest: ref.digest, hostId: host, ref, controller: new AbortController(), subscribers: new Set(), seq: this.#seq++, state: 'queued', released: false };
        this.#jobs.set(ref.digest, job);
      }
      const subscriber: Subscriber = { priority: options.priority ?? 'visible', resolve, reject };
      job.subscribers.add(subscriber);
      const current = job;
      signal?.addEventListener('abort', () => this.#withdraw(current, subscriber), { once: true });
      this.#pump();
    });
  }

  #withdraw(job: Job, subscriber: Subscriber): void {
    if (!job.subscribers.delete(subscriber)) return;
    subscriber.reject(new PreviewError('aborted', 'Preview request was cancelled'));
    if (job.subscribers.size > 0 || job.state === 'done') return;
    // Last interested caller left: abort the shared transport (or drop the queued job). A later
    // request for the same digest starts a fresh job rather than joining an aborted one.
    job.controller.abort();
    if (this.#jobs.get(job.digest) === job) this.#jobs.delete(job.digest);
    if (job.state === 'queued') job.state = 'done';
    else this.#release(job);
    this.#pump();
  }

  #release(job: Job): void {
    if (job.released) return;
    job.released = true;
    this.#active -= 1;
    this.#activeByHost.set(job.hostId, (this.#activeByHost.get(job.hostId) ?? 1) - 1);
  }

  #rank(job: Job): number {
    for (const subscriber of job.subscribers) if (subscriber.priority === 'visible') return 0;
    return 1;
  }

  #pump(): void {
    while (this.#active < this.#limits.globalConcurrency) {
      let next: Job | null = null;
      for (const job of this.#jobs.values()) {
        if (job.state !== 'queued' || (this.#activeByHost.get(job.hostId) ?? 0) >= this.#limits.perHostConcurrency) continue;
        if (!next || this.#rank(job) < this.#rank(next) || (this.#rank(job) === this.#rank(next) && job.seq < next.seq)) next = job;
      }
      if (!next) return;
      this.#start(next);
    }
  }

  #start(job: Job): void {
    job.state = 'running';
    this.#active += 1;
    const hostActive = (this.#activeByHost.get(job.hostId) ?? 0) + 1;
    this.#activeByHost.set(job.hostId, hostActive);
    this.#peakActive = Math.max(this.#peakActive, this.#active);
    this.#peakPerHost = Math.max(this.#peakPerHost, hostActive);
    this.#transportCalls += 1;
    const adapter = this.#adapterFor(job.hostId);
    const run = adapter
      ? adapter.readPreview(job.ref, job.controller.signal)
      : Promise.reject(new PreviewError('no-adapter', 'No enrolled adapter for this host'));
    void run.then(async (bytes) => {
      if (bytes.byteLength > this.#limits.maxItemBytes || bytes.byteLength !== job.ref.bytes) {
        throw new PreviewError('too-large', 'Preview size differs from its reference or exceeds the limit');
      }
      if (await digestBytes(bytes) !== job.digest) throw new PreviewError('digest-mismatch', 'Preview bytes do not match their digest');
      if (this.#cache) await this.#cache.put(job.digest, bytes).catch(() => false);
      return bytes;
    }).then((bytes) => this.#finish(job, (subscriber) => subscriber.resolve(bytes)), (error: unknown) => {
      const failure = error instanceof PreviewError ? error
        : job.controller.signal.aborted ? new PreviewError('aborted', 'Preview request was cancelled')
          : new PreviewError('transport', error instanceof Error ? error.message : 'Preview transport failed');
      this.#finish(job, (subscriber) => subscriber.reject(failure));
    });
  }

  #finish(job: Job, settle: (subscriber: Subscriber) => void): void {
    job.state = 'done';
    if (this.#jobs.get(job.digest) === job) this.#jobs.delete(job.digest);
    this.#release(job);
    for (const subscriber of job.subscribers) settle(subscriber);
    job.subscribers.clear();
    this.#pump();
  }
}

/**
 * Lazy window planning for a list/grid of entries: only visible tiles plus a bounded prefetch window
 * are requested. Returns indices in request order (visible first).
 */
export function planPreviewWindow(total: number, firstVisible: number, visibleCount: number, prefetch: number): { visible: number[]; prefetch: number[] } {
  const start = Math.max(0, Math.min(firstVisible, total));
  const end = Math.min(total, start + Math.max(0, visibleCount));
  const visible: number[] = [];
  for (let index = start; index < end; index += 1) visible.push(index);
  const ahead: number[] = [];
  for (let index = end; index < Math.min(total, end + Math.max(0, prefetch)); index += 1) ahead.push(index);
  return { visible, prefetch: ahead };
}
