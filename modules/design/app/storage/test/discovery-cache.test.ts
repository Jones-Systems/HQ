import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createCachedCatalogReadPort } from '../../compose/catalog-read-port.ts';
import { CATALOG_CACHE_KEY, serializeCatalogCache } from '../../../discovery/src/cache.ts';
import { EMPTY_CATALOG, parseSnapshot, reduceCatalog } from '../../../discovery/src/catalog.ts';
import { isoFromMs, type CacheStoragePort } from '../../../discovery/src/contract.ts';
import { FAKE_HOSTS, fixturePreview, fixtureSnapshot } from '../../../discovery/src/fakes.ts';
import { asReader, bindCache, bindWorkspace, type CacheBacking } from '../backing.ts';
import { createDiscoveryCacheReader, DISCOVERY_CATALOG_CACHE_KEY, DiscoveryCacheScopeError, type DiscoveryCacheReader } from '../discovery-cache.ts';
import { TEXT_FORMAT } from '../text-envelope.ts';
import { makeDir, openAt, proveCleanup, removeDir } from './helpers.ts';

proveCleanup();

// Type level: the local interface and discovery's read-only slice are mutually assignable.
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type DiscoveryReaderAligned = Assert<Mutual<DiscoveryCacheReader, Pick<CacheStoragePort, 'readDocument'>>>;

const NOW = Date.UTC(2026, 9, 20, 12);
const KEY = DISCOVERY_CATALOG_CACHE_KEY;

async function withCache(run: (ctx: { cache: CacheBacking; workspace: Awaited<ReturnType<typeof bindWorkspace>>; store: Awaited<ReturnType<typeof openAt>>['store'] }) => Promise<void>): Promise<void> {
  const dir = makeDir();
  try {
    const opened = await openAt(join(dir, 'store'));
    try {
      await run({ cache: await bindCache(opened.store), workspace: await bindWorkspace(opened.store), store: opened.store });
    } finally {
      await opened.storage.close();
    }
  } finally {
    removeDir(dir);
  }
}

const envelope = (text: string) => ({ format: TEXT_FORMAT, text });

async function syntheticCatalogText(): Promise<string> {
  let catalog = EMPTY_CATALOG;
  for (const host of [FAKE_HOSTS.laptop, FAKE_HOSTS.studio]) {
    const projects = await Promise.all([0, 1].map(async (index) => ({
      path: `p${index}`, name: `Project ${index}`, previews: [(await fixturePreview(`${host}-${index}`)).ref],
    })));
    const parsed = await parseSnapshot(await fixtureSnapshot(host, 1, projects), host);
    assert.ok(parsed.ok);
    if (parsed.ok) catalog = reduceCatalog(catalog, { type: 'snapshot', snapshot: parsed.snapshot, at: isoFromMs(NOW - 3_600_000) }).state;
  }
  return serializeCatalogCache(catalog, isoFromMs(NOW));
}

describe('discovery cache reader', () => {
  it('is pinned to discovery’s catalog cache key and the shared text envelope', () => {
    assert.equal(DISCOVERY_CATALOG_CACHE_KEY, CATALOG_CACHE_KEY);
    assert.equal(TEXT_FORMAT, 'hq.design.storage.text/v1');
  });

  it('returns the stored text byte for byte, including non-ASCII and the empty string', async () => {
    await withCache(async ({ cache }) => {
      const reader = createDiscoveryCacheReader(cache);
      for (const text of ['{"a":1, "b":[1, 2]}\n  — é🎯\r\n', '', ' ', '\u0000 ']) {
        await cache.putDocument(KEY, envelope(text));
        assert.equal(await reader.readDocument(KEY), text);
      }
    });
  });

  it('returns null for an absent document', async () => {
    await withCache(async ({ cache }) => {
      assert.equal(await createDiscoveryCacheReader(cache).readDocument(KEY), null);
    });
  });

  it('throws on anything that is not the exact text envelope', async () => {
    await withCache(async ({ cache }) => {
      const reader = createDiscoveryCacheReader(cache);
      const bad: unknown[] = [
        'just a string', 7, null, [], [envelope('x')], {}, { text: 'x' }, { format: TEXT_FORMAT },
        { format: 'hq.design.storage.text/v2', text: 'x' }, { format: 'other', text: 'x' },
        { format: TEXT_FORMAT, text: 5 }, { format: TEXT_FORMAT, text: null }, { format: TEXT_FORMAT, text: ['x'] },
        { format: TEXT_FORMAT, text: 'x', extra: 'y' },
      ];
      for (const value of bad) {
        await cache.putDocument(KEY, value as never);
        await assert.rejects(reader.readDocument(KEY), DiscoveryCacheScopeError, JSON.stringify(value));
      }
    });
  });

  it('refuses every other key without touching the store', async () => {
    await withCache(async ({ cache }) => {
      await cache.putDocument('other.key', envelope('x'));
      const reader = createDiscoveryCacheReader(cache);
      for (const key of ['other.key', `${KEY}/x`, `${KEY} `, '', 'design/requests/r1/draft', 'DESIGN.DISCOVERY.CATALOG']) {
        await assert.rejects(reader.readDocument(key), DiscoveryCacheScopeError, key);
      }
    });
  });

  it('rejects a workspace view and any non-cache object', async () => {
    await withCache(async ({ workspace }) => {
      assert.throws(() => createDiscoveryCacheReader(workspace as never), DiscoveryCacheScopeError);
      assert.throws(() => createDiscoveryCacheReader(asReader(workspace) as never), DiscoveryCacheScopeError);
      assert.throws(() => createDiscoveryCacheReader({} as never), DiscoveryCacheScopeError);
    });
  });

  it('is a frozen object with exactly one function, readDocument', async () => {
    await withCache(async ({ cache }) => {
      const reader = createDiscoveryCacheReader(cache);
      assert.deepEqual(Reflect.ownKeys(reader), ['readDocument']);
      assert.equal(Object.keys(Object.getPrototypeOf(reader) ?? {}).length, 0);
      assert.ok(Object.isFrozen(reader));
      for (const name of ['writeDocument', 'writeBlob', 'readBlob', 'deleteBlob', 'listBlobs', 'putDocument', 'getDocument', 'listDocuments', 'namespace']) {
        assert.equal(name in reader, false, name);
      }
    });
  });

  it('only ever calls getDocument on the cache view, and a read changes nothing in the store', async () => {
    await withCache(async ({ cache, store }) => {
      await cache.putDocument(KEY, envelope('payload'));
      await cache.putDocument('neighbour', envelope('untouched'));
      const calls: string[] = [];
      const spy = Object.fromEntries(Object.entries(cache).map(([name, value]) => [name, typeof value === 'function'
        ? (...args: unknown[]) => { calls.push(name); return (value as (...a: unknown[]) => unknown)(...args); }
        : value])) as unknown as CacheBacking;
      const reader = createDiscoveryCacheReader(spy);
      const before = { docs: await cache.listDocuments(), key: await cache.getDocument(KEY), other: await cache.getDocument('neighbour'), usage: await store.usage('cache' as never) };
      calls.length = 0;
      for (let i = 0; i < 3; i += 1) assert.equal(await reader.readDocument(KEY), 'payload');
      await assert.rejects(reader.readDocument('neighbour'));
      assert.deepEqual([...new Set(calls)], ['getDocument']);
      assert.deepEqual({ docs: await cache.listDocuments(), key: await cache.getDocument(KEY), other: await cache.getDocument('neighbour'), usage: await store.usage('cache' as never) }, before);
    });
  });
});

describe('discovery cache reader -> compose cached catalog read port (end to end)', () => {
  it('loads a warm catalog from the real store without writing', async () => {
    await withCache(async ({ cache }) => {
      await cache.putDocument(KEY, envelope(await syntheticCatalogText()));
      const revision = (await cache.getDocument(KEY))!.revision;
      const port = createCachedCatalogReadPort({ cache: createDiscoveryCacheReader(cache), hostLabels: { [FAKE_HOSTS.laptop]: 'Laptop' } });
      const status = await port.load();
      assert.deepEqual([status.cache, status.entries, status.hosts], ['warm', 4, 2]);
      assert.equal(port.current().length, 4);
      assert.ok(port.current().every((entry) => entry.freshness.status === 'stale'), 'cached fresh records are shown as stale');
      assert.equal((await cache.getDocument(KEY))!.revision, revision, 'the cache document was not rewritten');
    });
  });

  it('reports cold for an empty store, and corrupt for garbage text in a valid envelope', async () => {
    await withCache(async ({ cache }) => {
      const reader = createDiscoveryCacheReader(cache);
      assert.equal((await createCachedCatalogReadPort({ cache: reader }).load()).cache, 'cold');
      await cache.putDocument(KEY, envelope('this is not a catalog'));
      assert.equal((await createCachedCatalogReadPort({ cache: reader }).load()).cache, 'corrupt');
      assert.equal((await cache.getDocument(KEY))!.revision, 1, 'a corrupt cache is reported, never rebuilt by this reader');
    });
  });

  it('reports unreadable when the stored value is not the envelope', async () => {
    await withCache(async ({ cache }) => {
      await cache.putDocument(KEY, { not: 'an envelope' });
      assert.equal((await createCachedCatalogReadPort({ cache: createDiscoveryCacheReader(cache) }).load()).cache, 'unreadable');
    });
  });
});
