/**
 * Bounded, coalescing, cancellable lazy loader used for gallery thumbnails and
 * project summaries.
 *
 * - One transport call per key while it is wanted (coalesced by key/digest).
 * - Visible requests run before prefetch requests; concurrency is bounded.
 * - Cancelling aborts transport only after every subscriber has cancelled.
 * - Ready values are kept in a small in-memory retention set; this is render
 *   memory, not the store's `cache` namespace.
 */
import type { PreviewBytes, PreviewRef, ThumbnailPort } from './contract.ts';

export type Priority = 'visible' | 'prefetch';
export type LoadState<V> =
  | { readonly status: 'pending' }
  | { readonly status: 'ready'; readonly value: V }
  | { readonly status: 'error'; readonly reason: string };

export interface LoaderStats {
  readonly started: number;
  readonly completed: number;
  readonly failed: number;
  readonly aborted: number;
  readonly running: number;
  readonly queued: number;
  readonly retained: number;
}

interface Subscriber<V> { readonly priority: Priority; readonly listener: (state: LoadState<V>) => void }

interface Entry<V> {
  readonly key: string;
  readonly load: (signal: AbortSignal) => Promise<V>;
  readonly subscribers: Map<number, Subscriber<V>>;
  state: LoadState<V>;
  phase: 'queued' | 'running' | 'settled';
  controller: AbortController | null;
  order: number;
}

export class LazyLoader<V> {
  readonly #concurrency: number;
  readonly #retain: number;
  readonly #entries = new Map<string, Entry<V>>();
  /** Settled ready entries without subscribers, oldest first. */
  readonly #retained = new Set<string>();
  #nextId = 0;
  #order = 0;
  #running = 0;
  #started = 0;
  #completed = 0;
  #failed = 0;
  #aborted = 0;

  constructor(options: { readonly concurrency: number; readonly retain: number }) {
    if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1) throw new RangeError('concurrency must be >= 1');
    this.#concurrency = options.concurrency;
    this.#retain = Math.max(0, Math.floor(options.retain));
  }

  peek(key: string): LoadState<V> | undefined {
    return this.#entries.get(key)?.state;
  }

  stats(): LoaderStats {
    let queued = 0;
    for (const entry of this.#entries.values()) if (entry.phase === 'queued') queued += 1;
    return {
      started: this.#started, completed: this.#completed, failed: this.#failed, aborted: this.#aborted,
      running: this.#running, queued, retained: this.#retained.size,
    };
  }

  /**
   * Subscribes to one key. `load` is used only if no live entry exists. A
   * failure known before transport can be supplied as `reject` (no call made).
   */
  subscribe(request: { readonly key: string; readonly priority: Priority; readonly load: (signal: AbortSignal) => Promise<V>; readonly reject?: string },
    listener: (state: LoadState<V>) => void): () => void {
    let entry = this.#entries.get(request.key);
    if (!entry) {
      entry = {
        key: request.key, load: request.load, subscribers: new Map(), controller: null, order: this.#order++,
        state: request.reject ? { status: 'error', reason: request.reject } : { status: 'pending' },
        phase: request.reject ? 'settled' : 'queued',
      };
      this.#entries.set(request.key, entry);
    }
    this.#retained.delete(request.key);
    const id = this.#nextId++;
    entry.subscribers.set(id, { priority: request.priority, listener });
    if (entry.state.status !== 'pending') listener(entry.state);
    this.#pump();
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#release(request.key, entry, id);
    };
  }

  #release(key: string, entry: Entry<V>, id: number): void {
    entry.subscribers.delete(id);
    if (entry.subscribers.size > 0 || this.#entries.get(key) !== entry) return;
    if (entry.phase === 'running') {
      entry.controller?.abort();
      this.#aborted += 1;
      this.#running -= 1;
      this.#entries.delete(key);
      this.#pump();
    } else if (entry.phase === 'queued' || entry.state.status === 'error') {
      this.#entries.delete(key);
    } else {
      this.#retained.add(key);
      while (this.#retained.size > this.#retain) {
        const oldest = this.#retained.values().next().value as string;
        this.#retained.delete(oldest);
        this.#entries.delete(oldest);
      }
    }
  }

  #next(): Entry<V> | undefined {
    let best: Entry<V> | undefined;
    let bestVisible = false;
    for (const entry of this.#entries.values()) {
      if (entry.phase !== 'queued') continue;
      const visible = [...entry.subscribers.values()].some((subscriber) => subscriber.priority === 'visible');
      if (!best || (visible && !bestVisible) || (visible === bestVisible && entry.order < best.order)) {
        best = entry;
        bestVisible = visible;
      }
    }
    return best;
  }

  #pump(): void {
    while (this.#running < this.#concurrency) {
      const entry = this.#next();
      if (!entry) return;
      entry.phase = 'running';
      entry.controller = new AbortController();
      this.#running += 1;
      this.#started += 1;
      const signal = entry.controller.signal;
      let promise: Promise<V>;
      try { promise = entry.load(signal); } catch (error) { promise = Promise.reject(error); }
      promise.then(
        (value) => this.#settle(entry, signal, { status: 'ready', value }),
        (error: unknown) => this.#settle(entry, signal, { status: 'error', reason: error instanceof Error ? error.message : String(error) }),
      );
    }
  }

  #settle(entry: Entry<V>, signal: AbortSignal, state: LoadState<V>): void {
    // An aborted or superseded entry was already released; its late result is discarded.
    if (signal.aborted || this.#entries.get(entry.key) !== entry) return;
    entry.phase = 'settled';
    entry.state = state;
    entry.controller = null;
    this.#running -= 1;
    if (state.status === 'ready') this.#completed += 1; else this.#failed += 1;
    for (const subscriber of [...entry.subscribers.values()]) subscriber.listener(state);
    this.#pump();
  }
}

// --------------------------------------------------------------- thumbnails

export const THUMBNAIL_MEDIA_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

/** Validates fetched bytes against their PreviewRef before they reach an <img>. */
export async function verifiedDataUrl(ref: PreviewRef, fetched: PreviewBytes, maxBytes: number): Promise<string> {
  if (fetched.mediaType !== ref.mediaType) throw new Error('Thumbnail media type differs from its reference');
  if (fetched.bytes.byteLength !== ref.bytes || fetched.bytes.byteLength > maxBytes) throw new Error('Thumbnail size differs from its reference or exceeds the bound');
  if (`sha256:${await sha256Hex(fetched.bytes)}` !== ref.digest) throw new Error('Thumbnail digest mismatch');
  return `data:${ref.mediaType};base64,${base64(fetched.bytes)}`;
}

export interface ThumbnailLoader {
  subscribe(ref: PreviewRef, priority: Priority, listener: (state: LoadState<string>) => void): () => void;
  stats(): LoaderStats;
}

/** Thumbnails resolve to verified `data:` URLs, which the renderer CSP already allows. */
export function createThumbnailLoader(port: ThumbnailPort, options: {
  readonly concurrency: number; readonly retain: number; readonly maxBytesPerItem: number;
}): ThumbnailLoader {
  const loader = new LazyLoader<string>({ concurrency: options.concurrency, retain: options.retain });
  return {
    stats: () => loader.stats(),
    subscribe(ref, priority, listener) {
      const reject = !THUMBNAIL_MEDIA_TYPES.includes(ref.mediaType) ? 'Unsupported thumbnail media type'
        : ref.bytes > options.maxBytesPerItem ? 'Thumbnail exceeds the per-item byte bound' : undefined;
      return loader.subscribe({
        key: ref.digest, priority, ...(reject ? { reject } : {}),
        load: async (signal) => verifiedDataUrl(ref, await port.readThumbnail(ref, signal), options.maxBytesPerItem),
      }, listener);
    },
  };
}
