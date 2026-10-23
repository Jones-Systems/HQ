/**
 * Read-only adapter for discovery's cached catalog document (T15 `CacheStoragePort.readDocument`).
 *
 * It is a frozen object with exactly one method. It cannot write, list, read blobs or delete, and it
 * only ever reads discovery's catalog cache key from the `cache` namespace. The stored value must be
 * the existing `{ format, text }` text envelope (see text-envelope.ts); the text comes back
 * byte-for-byte. Anything else throws, which the compose catalog port reports as 'unreadable'.
 * Discovery's own loader may rebuild a corrupt cache; this reader never touches the store.
 */
import type { CacheBacking } from './backing.ts';
import { TEXT_FORMAT } from './text-envelope.ts';

/** Pinned to discovery's `CATALOG_CACHE_KEY` (discovery/src/cache.ts) by test/discovery-cache.test.ts. */
export const DISCOVERY_CATALOG_CACHE_KEY = 'design.discovery.catalog';

/** Structurally `Pick<CacheStoragePort, 'readDocument'>` from discovery's contract. */
export interface DiscoveryCacheReader {
  readDocument(key: string): Promise<string | null>;
}

export class DiscoveryCacheScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoveryCacheScopeError';
  }
}

export function createDiscoveryCacheReader(cache: CacheBacking): DiscoveryCacheReader {
  if (cache.kind !== 'cache') throw new DiscoveryCacheScopeError('The discovery cache reader needs a cache view');
  const reader: DiscoveryCacheReader = {
    async readDocument(key) {
      if (key !== DISCOVERY_CATALOG_CACHE_KEY) {
        throw new DiscoveryCacheScopeError(`Key ${JSON.stringify(String(key).slice(0, 60))} is not the discovery catalog cache key`);
      }
      const found = await cache.getDocument(key);
      if (!found) return null;
      const value = found.value as { readonly format?: unknown; readonly text?: unknown } | null;
      if (typeof value !== 'object' || value === null || Array.isArray(value)
        || value.format !== TEXT_FORMAT || typeof value.text !== 'string' || Object.keys(value).length !== 2) {
        throw new DiscoveryCacheScopeError(`Stored discovery cache document is not a ${TEXT_FORMAT} envelope`);
      }
      return value.text;
    },
  };
  return Object.freeze(reader);
}

/** Catalog-only capability: deliberately excludes discovery's preview-blob lifecycle. */
export interface DiscoveryCacheStore extends DiscoveryCacheReader {
  readonly namespace: 'cache';
  writeDocument(key: string, text: string): Promise<void>;
}

export function createDiscoveryCacheStore(cache: CacheBacking): DiscoveryCacheStore {
  const reader = createDiscoveryCacheReader(cache);
  return Object.freeze({
    namespace: 'cache' as const,
    readDocument: reader.readDocument,
    async writeDocument(key: string, text: string) {
      if (key !== DISCOVERY_CATALOG_CACHE_KEY || typeof text !== 'string') throw new DiscoveryCacheScopeError('Invalid catalog key or text');
      await cache.putDocument(key, { format: TEXT_FORMAT, text });
    },
  });
}
