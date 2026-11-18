// Session response cache over the read-only service: instant Back, link and backlink previews, and keeping what
// loaded when a later request fails. A plain data structure with promise bookkeeping; no timers and no DOM.

import type { WikiError, WikiResult } from '../../contract/src/index.ts';
import { invalidResponse } from './format.ts';

export type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: WikiError };

export interface CacheEntry<T> {
  readonly value: T;
  /** When the value was stored (cache clock, ms). */
  readonly at: number;
}

export interface WikiCache {
  /** The last good value for `key`, if any. Reading marks the entry as recently used. */
  peek<T>(key: string): CacheEntry<T> | undefined;
  /**
   * Runs `load` unless a request for `key` is already in flight, checks the response against the contract and
   * stores a good value. Never rejects: a throw, a rejection or a malformed response settles as an error.
   */
  request<T>(key: string, load: () => Promise<WikiResult<T>>, check: (value: T) => WikiError | null): Promise<Settled<T>>;
  /** `request` for warming (link hover, likely next page): skipped when a value is already stored. */
  prefetch<T>(key: string, load: () => Promise<WikiResult<T>>, check: (value: T) => WikiError | null): void;
  /** True while a request for `key` is in flight. */
  pending(key: string): boolean;
  /** Milliseconds since `key` was stored, or Infinity when it is not. */
  age(key: string): number;
  /** Drops every entry whose key starts with `prefix` (all entries when omitted). */
  invalidate(prefix?: string): void;
  readonly size: number;
}

export const CACHE_LIMIT = 300;

function isResult(value: unknown): value is WikiResult<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return record['ok'] === true ? 'value' in record : record['ok'] === false && typeof record['error'] === 'object' && record['error'] !== null;
}

/** Turns an untrusted response into a settled value: shape first, then the contract check. */
export function settleResponse<T>(raw: unknown, check: (value: T) => WikiError | null): Settled<T> {
  if (!isResult(raw)) return { ok: false, error: invalidResponse('The Wiki returned a malformed response.') };
  if (!raw.ok) return { ok: false, error: raw.error };
  const problem = check(raw.value as T);
  return problem === null ? { ok: true, value: raw.value as T } : { ok: false, error: problem };
}

export function createWikiCache(options: { readonly limit?: number; readonly now?: () => number } = {}): WikiCache {
  const limit = Math.max(1, options.limit ?? CACHE_LIMIT);
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, CacheEntry<unknown>>();
  const inFlight = new Map<string, Promise<Settled<unknown>>>();

  function store(key: string, value: unknown): void {
    entries.delete(key);
    entries.set(key, { value, at: now() });
    while (entries.size > limit) {
      const oldest = entries.keys().next();
      if (oldest.done === true) break;
      entries.delete(oldest.value);
    }
  }

  const cache: WikiCache = {
    peek<T>(key: string): CacheEntry<T> | undefined {
      const entry = entries.get(key);
      if (entry === undefined) return undefined;
      entries.delete(key);
      entries.set(key, entry);
      return entry as CacheEntry<T>;
    },
    request<T>(key: string, load: () => Promise<WikiResult<T>>, check: (value: T) => WikiError | null): Promise<Settled<T>> {
      const running = inFlight.get(key);
      if (running !== undefined) return running as Promise<Settled<T>>;
      let pending: Promise<unknown>;
      try {
        pending = load();
      } catch (cause) {
        pending = Promise.reject(cause);
      }
      const settled = pending
        .then(
          (raw) => settleResponse<T>(raw, check),
          (): Settled<T> => ({ ok: false, error: invalidResponse('The Wiki request failed unexpectedly.') }),
        )
        .then((result) => {
          if (inFlight.get(key) === settled) inFlight.delete(key);
          if (result.ok) store(key, result.value);
          return result;
        });
      inFlight.set(key, settled as Promise<Settled<unknown>>);
      return settled;
    },
    prefetch<T>(key: string, load: () => Promise<WikiResult<T>>, check: (value: T) => WikiError | null): void {
      if (entries.has(key) || inFlight.has(key)) return;
      void cache.request(key, load, check);
    },
    pending: (key) => inFlight.has(key),
    age(key: string): number {
      const entry = entries.get(key);
      return entry === undefined ? Infinity : Math.max(0, now() - entry.at);
    },
    invalidate(prefix?: string): void {
      for (const key of [...entries.keys()]) if (prefix === undefined || key.startsWith(prefix)) entries.delete(key);
    },
    get size() {
      return entries.size;
    },
  };
  return cache;
}
