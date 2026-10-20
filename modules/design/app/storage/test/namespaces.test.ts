import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { isStoreError } from '../../../../../packages/design-store/src/errors.ts';
import { asReader, bindCache, bindWorkspace, NamespaceClassError } from '../backing.ts';
import { createCanvasStorage } from '../canvas.ts';
import { createDiscoveryCacheReader } from '../discovery-cache.ts';
import { createRequestsExport } from '../export.ts';
import { createOutboxAdapter } from '../outbox.ts';
import { createRequestsStoragePort } from '../requests.ts';
import { makeDir, openAt, proveCleanup, removeDir } from './helpers.ts';

proveCleanup();

const FORBIDDEN = ['deleteBlob', 'deleteDocument', 'adoptBlob', 'commit', 'repairTornTail', 'close', 'usage', 'project'];

function surface(value: object): string[] {
  const names = new Set<string>();
  for (let current: object | null = value; current && current !== Object.prototype; current = Object.getPrototypeOf(current)) {
    for (const name of Reflect.ownKeys(current)) if (typeof name === 'string') names.add(name);
  }
  return [...names];
}

async function withStorage(run: (storage: Awaited<ReturnType<typeof openAt>>) => Promise<void>): Promise<void> {
  const dir = makeDir();
  try {
    const opened = await openAt(join(dir, 'store'));
    try {
      await run(opened);
    } finally {
      await opened.storage.close();
    }
  } finally {
    removeDir(dir);
  }
}

describe('namespace separation', () => {
  it('binds the workspace only to an authoritative namespace and the cache only to an evictable one', async () => {
    await withStorage(async ({ store }) => {
      await assert.rejects(bindWorkspace(store, 'cache'), NamespaceClassError);
      await assert.rejects(bindCache(store, 'workspace'), NamespaceClassError);
      await assert.rejects(bindWorkspace(store, 'nowhere'), (error) => isStoreError(error));
    });
  });

  it('keeps deleteBlob (and every other removal) out of the workspace view and every workspace adapter', async () => {
    await withStorage(async ({ store, storage }) => {
      const workspace = await bindWorkspace(store);
      const adapters: Record<string, object> = {
        'workspace view': workspace,
        'workspace reader': asReader(workspace),
        'requests adapter': createRequestsStoragePort({ workspace }),
        'requests adapter with cache': createRequestsStoragePort({ workspace, cache: await bindCache(store) }),
        'outbox adapter': createOutboxAdapter(workspace),
        'canvas adapter': createCanvasStorage(workspace),
        'export port': createRequestsExport(asReader(workspace)),
        'discovery cache reader': createDiscoveryCacheReader(await bindCache(store)),
        'node wiring workspace': storage.workspace,
        'node wiring requests': storage.requests,
        'node wiring canvas': storage.canvas,
        'node wiring outbox': storage.outbox(),
        'node wiring export': storage.requestsExport,
      };
      for (const [label, adapter] of Object.entries(adapters)) {
        const names = surface(adapter);
        for (const forbidden of FORBIDDEN) {
          assert.equal(names.includes(forbidden), false, `${label} must not expose ${forbidden}`);
          assert.equal(forbidden in adapter, false, `${label} must not expose ${forbidden}`);
        }
        assert.ok(Object.isFrozen(adapter), `${label} is frozen so nothing can be added to it`);
      }
      assert.equal(surface(storage).includes('deleteBlob'), false);
    });
  });

  it('exposes deleteBlob only on the cache view, where it cannot touch workspace data', async () => {
    await withStorage(async ({ store }) => {
      const workspace = await bindWorkspace(store);
      const cache = await bindCache(store);
      assert.ok(surface(cache).includes('deleteBlob'));
      const bytes = new TextEncoder().encode('same bytes in both namespaces');
      const inWorkspace = await workspace.putBlob(bytes);
      const inCache = await cache.putBlob(bytes);
      assert.equal(inWorkspace.digest, inCache.digest);
      assert.equal(await cache.deleteBlob(inCache.digest), true);
      assert.equal(await cache.hasBlob(inCache.digest), false);
      assert.equal(await workspace.hasBlob(inWorkspace.digest), true, 'workspace blob untouched by a cache delete');
      assert.deepEqual(await workspace.getBlob(inWorkspace.digest), bytes);
    });
  });

  it('shows the store itself still refuses deleteBlob in the workspace namespace', async () => {
    await withStorage(async ({ store }) => {
      const workspace = await bindWorkspace(store);
      const { digest } = await workspace.putBlob(new Uint8Array([1, 2, 3]));
      await assert.rejects(store.deleteBlob('workspace' as never, digest as never), (error) => isStoreError(error));
      assert.equal(await workspace.hasBlob(digest), true);
    });
  });

  it('keeps documents separate per namespace and refuses a cache view where a workspace view is required', async () => {
    await withStorage(async ({ store }) => {
      const workspace = await bindWorkspace(store);
      const cache = await bindCache(store);
      await workspace.putDocument('k', { from: 'workspace' });
      await cache.putDocument('k', { from: 'cache' });
      assert.deepEqual((await workspace.getDocument('k'))?.value, { from: 'workspace' });
      assert.deepEqual((await cache.getDocument('k'))?.value, { from: 'cache' });
      for (const make of [
        () => createOutboxAdapter(cache as never),
        () => createCanvasStorage(cache as never),
        () => asReader(cache as never),
        () => createRequestsStoragePort({ workspace: cache as never }),
        () => createRequestsExport(cache as never),
      ]) assert.throws(make);
    });
  });
});
