import type { CatalogRoot } from '@hq/contracts/catalog';
import type { DesignServiceTransport, DesignServiceRoute, DesignServiceParams, DesignServiceValues } from '@hq/contracts/services';
import { LocalDirectoryAdapter, LOCAL_HOST_ID } from '../../discovery/src/adapters/local-directory.ts';
import { DiscoveryService } from '../../discovery/src/discovery.ts';
import { CATALOG_CACHE_KEY, serializeCatalogCache } from '../../discovery/src/cache.ts';
import { EMPTY_CATALOG } from '../../discovery/src/catalog.ts';
import { hostId, isoFromMs, type CacheStoragePort, type ClockPort, type HostId, type SourceAdapter } from '../../discovery/src/contract.ts';
import { TEXT_FORMAT } from '../storage/index.ts';
import { CACHED_TAG, SYNTHETIC_TAG } from './labels.ts';
import { createCachedCatalogReadPort, type CachedCatalogReadPort } from './catalog-read-port.ts';

export type InjectedDiscoverySource = {
  adapterKey: string;
  hostId: HostId;
  label: string;
  adapter: SourceAdapter;
};

export async function createBridgedDiscovery(transport: DesignServiceTransport | undefined = globalThis.window?.hqServices?.design,
  options: { sources?: readonly InjectedDiscoverySource[] } = {}) {
  const sources = options.sources?.map((source) => ({ ...source })) ?? [];
  if (sources.length > 8) throw new Error('At most eight synthetic discovery sources may be injected.');
  const adapterKeys = new Set(['local']);
  const hostIds = new Set<HostId>([LOCAL_HOST_ID]);
  for (const source of sources) {
    if (source.adapter.qualification !== 'fake') throw new Error('Injected discovery sources must use fake adapters.');
    if (adapterKeys.has(source.adapterKey)) throw new Error('Injected discovery adapter keys must be unique and not local.');
    hostId(source.hostId);
    if (hostIds.has(source.hostId)) throw new Error('Injected discovery host IDs must be unique and not local.');
    adapterKeys.add(source.adapterKey);
    hostIds.add(source.hostId);
  }
  if (!transport) throw new Error('Project folders require the desktop catalog connection.');
  async function call<R extends DesignServiceRoute>(route: R, params: DesignServiceParams[R]): Promise<DesignServiceValues[R]> {
    const result = await transport!.call(route, params);
    if (!result.ok) throw new Error(`Project catalog: ${result.kind}`);
    return result.value;
  }
  const clock: ClockPort = { now: Date.now, setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>) };
  const scope = (key: string) => { if (key !== CATALOG_CACHE_KEY) throw new Error('Unsupported catalog cache key'); };
  let catalogReader: CachedCatalogReadPort | undefined;
  const cache: CacheStoragePort = {
    namespace: 'cache',
    async readDocument(key) {
      scope(key);
      const document = await call('cache.get', { key });
      if (!document) return null;
      const value = document.value;
      if (!value || typeof value !== 'object' || Array.isArray(value)
        || !('format' in value) || !('text' in value) || value.format !== TEXT_FORMAT || typeof value.text !== 'string') {
        throw new Error('Invalid catalog cache envelope');
      }
      return value.text;
    },
    async writeDocument(key, text) {
      scope(key);
      await call('cache.put', { key: CATALOG_CACHE_KEY, value: { format: TEXT_FORMAT, text } });
      await catalogReader?.reload();
    },
    // Preview blobs are not persisted through the document-only cache capability.
    async readBlob() { return null; },
    async writeBlob() { throw new Error('Preview cache storage is unavailable'); },
    async deleteBlob() { throw new Error('Preview cache storage is unavailable'); },
    async listBlobs() { return []; },
  };
  const adapter = new LocalDirectoryAdapter({
    snapshot: async () => call('catalog.snapshot', {}),
    preview: async (ref) => call('catalog.preview', { ref }),
  });
  let roots: readonly CatalogRoot[] = await call('catalog.roots', {});
  const clear = () => cache.writeDocument(CATALOG_CACHE_KEY, serializeCatalogCache(EMPTY_CATALOG, isoFromMs(clock.now())));
  if (roots.length === 0) await clear();
  const adapters: Record<string, SourceAdapter> = { local: adapter, ...Object.fromEntries(sources.map((source) => [source.adapterKey, source.adapter])) };
  const hostLabels = { [LOCAL_HOST_ID]: 'This device', ...Object.fromEntries(sources.map((source) => [source.hostId, source.label])) };
  const adapterLabels: Record<string, { label: string; fake: boolean }> = { local: { label: 'Local directory', fake: false },
    ...Object.fromEntries(sources.map((source) => [source.adapterKey, { label: source.label, fake: true }])) };
  const buildService = () => new DiscoveryService({ cache, clock, adapters, refreshOnOpen: false,
    enrollments: [{ hostId: LOCAL_HOST_ID, label: 'This device', adapterKey: 'local', enrolledAt: isoFromMs(clock.now()) },
      ...sources.map((source) => ({ hostId: source.hostId, label: source.label, adapterKey: source.adapterKey, enrolledAt: isoFromMs(clock.now()) }))] });
  let service = buildService();
  await service.open();
  const readPort = createCachedCatalogReadPort({ cache, hostLabels, ...(sources.length === 0
    ? { provenance: 'Selected local projects folder' }
    : { dataTag: SYNTHETIC_TAG, provenance: `Synthetic injected sources: ${sources.map((source) => source.label).join(', ')}; selected local projects folder` }) });
  catalogReader = readPort;
  await readPort.load();
  let busy = false;
  async function exclusive(run: () => Promise<void>) {
    if (busy) throw new Error('A project folder operation is already in progress');
    busy = true;
    try { await run(); } finally { busy = false; }
  }
  async function refresh() {
    if (roots.length === 0) return;
    const report = await service.refresh();
    await service.flushCache();
    await readPort.reload();
    if (service.getState().cacheWriteFailed) throw new Error('The project catalog could not be saved on this device.');
    if (report.results.some((result) => result.outcome !== 'applied')) throw new Error('Project refresh did not complete. Cached projects remain available.');
  }
  return {
    tag: sources.length === 0 ? CACHED_TAG : SYNTHETIC_TAG, cache, clock, get service() { return service; }, readPort,
    adapterLabels,
    roots: () => roots,
    refresh: () => exclusive(refresh),
    chooseRoot: () => exclusive(async () => {
      const selected = await call('catalog.chooseRoot', {});
      if (selected.map((root) => root.rootId).join() === roots.map((root) => root.rootId).join()) return;
      roots = selected;
      service.dispose();
      await service.flushCache();
      await clear();
      service = buildService();
      await service.open();
      await readPort.reload();
      await refresh();
    }),
    forget: () => exclusive(async () => {
      roots = await call('catalog.forget', {});
      service.dispose();
      await service.flushCache();
      await clear();
      service = buildService();
      await service.open();
      await readPort.reload();
    }),
  };
}
