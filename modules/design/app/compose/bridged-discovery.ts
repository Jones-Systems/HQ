import type { CatalogRoot } from '@hq/contracts/catalog';
import type { DesignServiceTransport, DesignServiceRoute, DesignServiceParams, DesignServiceValues } from '@hq/contracts/services';
import { LocalDirectoryAdapter, LOCAL_HOST_ID } from '../../discovery/src/adapters/local-directory.ts';
import { DiscoveryService } from '../../discovery/src/discovery.ts';
import { CATALOG_CACHE_KEY, serializeCatalogCache } from '../../discovery/src/cache.ts';
import { EMPTY_CATALOG } from '../../discovery/src/catalog.ts';
import { isoFromMs, type CacheStoragePort, type ClockPort } from '../../discovery/src/contract.ts';
import { TEXT_FORMAT } from '../storage/index.ts';
import { CACHED_TAG } from './labels.ts';
import { createCachedCatalogReadPort, type CachedCatalogReadPort } from './catalog-read-port.ts';

export async function createBridgedDiscovery(transport: DesignServiceTransport | undefined = globalThis.window?.hqServices?.design) {
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
  const buildService = () => new DiscoveryService({ cache, clock, adapters: { local: adapter }, refreshOnOpen: false,
    enrollments: [{ hostId: LOCAL_HOST_ID, label: 'This device', adapterKey: 'local', enrolledAt: isoFromMs(clock.now()) }] });
  let service = buildService();
  await service.open();
  const readPort = createCachedCatalogReadPort({ cache, hostLabels: { [LOCAL_HOST_ID]: 'This device' }, provenance: 'Selected local projects folder' });
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
    tag: CACHED_TAG, cache, clock, get service() { return service; }, readPort,
    adapterLabels: { local: { label: 'Local directory', fake: false } },
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
