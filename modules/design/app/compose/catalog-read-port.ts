/**
 * Discovery (T15) -> Projects (T2) read port.
 *
 * Projects renders the source catalog through `CatalogReadPort` and never waits on a refresh. This port
 * satisfies it from discovery's CACHED catalog document only:
 * - no network: it has no source adapter, no clock and no transport;
 * - no refresh on open: `load()` reads the cache document once, and `reload()` re-reads it on request;
 * - no writes: the cache dependency is typed as read-only, and a corrupt or future cache is reported,
 *   never rebuilt (discovery's own loader may rebuild; this port must not touch the store).
 * Cached `fresh` records are shown as `stale`, as discovery's own open() does, until a refresh succeeds
 * in a session that owns refresh. Identity (`SourceProjectId`, host, path) passes through unchanged.
 */
import type { CacheStoragePort } from '../../discovery/src/contract.ts';
import { reduceCatalog, EMPTY_CATALOG, type CatalogRecord, type CatalogState } from '../../discovery/src/catalog.ts';
import { CATALOG_CACHE_KEY, parseCatalogCache } from '../../discovery/src/cache.ts';
import type { CatalogEntryView, CatalogReadPort, RepoIdentity } from '../../projects/src/contract.ts';
import { hostId, sourceProjectId } from '../../projects/src/ids.ts';
import { CACHED_TAG, labelledProviderTitle, type EvidenceTag } from './labels.ts';

export type CacheReadStatus = 'not-loaded' | 'warm' | 'cold' | 'corrupt' | 'future-schema' | 'unreadable';

export interface CachedCatalogStatus {
  readonly cache: CacheReadStatus;
  readonly entries: number;
  readonly hosts: number;
  /** What the data is. Cached data is never presented as live. */
  readonly tag: EvidenceTag;
  /** Set when the cache was seeded from synthetic fixtures. */
  readonly provenance: string;
}

export interface CachedCatalogReadPort extends CatalogReadPort {
  readonly tag: EvidenceTag;
  load(): Promise<CachedCatalogStatus>;
  reload(): Promise<CachedCatalogStatus>;
  status(): CachedCatalogStatus;
}

export interface CachedCatalogOptions {
  /** Read-only view of discovery's `cache` namespace. Writes are not representable. */
  readonly cache: Pick<CacheStoragePort, 'readDocument'>;
  /** Display labels per host id from enrollments; the cache holds none. Missing hosts show their opaque id. */
  readonly hostLabels?: Readonly<Record<string, string>>;
  /** Tag for the cache's origin: SYNTHETIC_TAG when seeded from fixtures. Defaults to the cached tag. */
  readonly dataTag?: EvidenceTag;
  readonly provenance?: string;
}

function project(record: CatalogRecord, labels: Readonly<Record<string, string>>): CatalogEntryView {
  const { entry, freshness } = record;
  const identity: RepoIdentity = {
    localOnly: entry.repoIdentity.localOnly,
    ...(entry.repoIdentity.normalizedRemote === undefined ? {} : { normalizedRemote: entry.repoIdentity.normalizedRemote }),
    ...(entry.repoIdentity.rootCommit === undefined ? {} : { rootCommit: entry.repoIdentity.rootCommit }),
  };
  return {
    sourceProjectId: sourceProjectId(entry.sourceProjectId),
    hostId: hostId(entry.hostId),
    hostLabel: labels[entry.hostId] ?? `Host ${entry.hostId}`,
    repoIdentity: identity,
    relativePath: entry.relativePath,
    displayName: entry.displayName,
    ...(entry.revision === undefined ? {} : { revision: entry.revision }),
    previews: entry.previews.map((preview) => ({
      digest: preview.digest, mediaType: preview.mediaType, bytes: preview.bytes,
      ...(preview.w === undefined ? {} : { w: preview.w }), ...(preview.h === undefined ? {} : { h: preview.h }),
    })),
    freshness: { status: freshness.status, lastSuccessAt: freshness.lastSuccessAt, generation: freshness.generation ?? 0 },
  };
}

/** Stable order: display name, then SourceProjectId. Records never merge by title or remote. */
function compareEntries(a: CatalogEntryView, b: CatalogEntryView): number {
  return a.displayName.localeCompare(b.displayName) || (a.sourceProjectId < b.sourceProjectId ? -1 : a.sourceProjectId > b.sourceProjectId ? 1 : 0);
}

export function createCachedCatalogReadPort(options: CachedCatalogOptions): CachedCatalogReadPort {
  const tag = options.dataTag ?? CACHED_TAG;
  const labels = options.hostLabels ?? {};
  const listeners = new Set<() => void>();
  let entries: readonly CatalogEntryView[] = [];
  let status: CachedCatalogStatus = { cache: 'not-loaded', entries: 0, hosts: 0, tag, provenance: options.provenance ?? 'discovery cache' };
  let inFlight: Promise<CachedCatalogStatus> | null = null;

  const publish = (cache: CacheReadStatus, catalog: CatalogState): void => {
    entries = Object.values(catalog.records).map((record) => project(record, labels)).sort(compareEntries);
    status = { ...status, cache, entries: entries.length, hosts: Object.keys(catalog.sources).length };
    for (const listener of [...listeners]) listener();
  };

  async function read(): Promise<CachedCatalogStatus> {
    let text: string | null;
    try { text = await options.cache.readDocument(CATALOG_CACHE_KEY); } catch { publish('unreadable', EMPTY_CATALOG); return status; }
    if (text === null) { publish('cold', EMPTY_CATALOG); return status; }
    const parsed = await parseCatalogCache(text);
    if (parsed.kind === 'ok') publish('warm', reduceCatalog(parsed.catalog, { type: 'loaded-from-cache' }).state);
    else publish(parsed.kind === 'future' ? 'future-schema' : 'corrupt', EMPTY_CATALOG);
    return status;
  }

  const reload = (): Promise<CachedCatalogStatus> => {
    inFlight ??= read().finally(() => { inFlight = null; });
    return inFlight;
  };

  return {
    tag,
    current: () => entries,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load: () => (status.cache === 'not-loaded' ? reload() : Promise.resolve(status)),
    reload,
    status: () => status,
  };
}

export const catalogSourceLabel = (status: CachedCatalogStatus): string => labelledProviderTitle('Source catalog', status.tag);
