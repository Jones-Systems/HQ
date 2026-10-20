import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDesignHost, DESIGN_VALUE_CAP, DOCUMENT_ROOTS, type DesignStore } from './design-host';
import { DESIGN_SERVICE_ROUTES } from '@hq/contracts/services';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
function fake() {
  return { workspace: { getDocument: vi.fn().mockResolvedValue(null), putDocument: vi.fn().mockResolvedValue({}), listDocuments: vi.fn().mockResolvedValue([]) }, cache: { getDocument: vi.fn().mockResolvedValue(null) }, close: vi.fn().mockResolvedValue(undefined) } satisfies DesignStore;
}
it('allowlists only mounted roots; requests, connector, reserved storage, delete and cache writes are held', async () => {
  const store = fake(), open = vi.fn().mockResolvedValue(store), host = createDesignHost(open);
  expect([...DESIGN_SERVICE_ROUTES]).toEqual(['doc.get', 'doc.put', 'doc.list', 'cache.get']);
  for (const key of ['design/requests/x', 'design/connector/x', 'design/storage/x', 'other/x', 'design/projects/../x', 'design/projects/\u0000', 'design/projects/' + 'x'.repeat(256)]) expect(await host.call('doc.get', { key })).toEqual({ ok: false, kind: 'invalid' });
  expect(await host.call('doc.delete', { key: 'design/projects/x' })).toEqual({ ok: false, kind: 'invalid' });
  expect(await host.call('cache.get', { key: 'other' })).toEqual({ ok: false, kind: 'invalid' }); expect(open).not.toHaveBeenCalled();
  for (const root of DOCUMENT_ROOTS) { expect(await host.call('doc.get', { key: root + 'x' })).toEqual({ ok: true, value: null }); expect(await host.call('doc.list', { prefix: root })).toEqual({ ok: true, value: [] }); }
  expect(await host.call('cache.get', { key: 'design.discovery.catalog' })).toEqual({ ok: true, value: null });
  await host.close(); await host.close(); expect(store.close).toHaveBeenCalledTimes(1);
  expect(await host.call('doc.get', { key: 'design/projects/x' })).toEqual({ ok: false, kind: 'unavailable' });
});
it('JSON and exact UTF-8 cap validation happens before opening', async () => {
  const store = fake(), open = vi.fn().mockResolvedValue(store), host = createDesignHost(open);
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  for (const value of [undefined, NaN, new Date(), cyclic, 'x'.repeat(DESIGN_VALUE_CAP - 1)]) expect(await host.call('doc.put', { key: 'design/projects/x', value })).toEqual({ ok: false, kind: 'invalid' });
  expect(open).not.toHaveBeenCalled();
  expect((await host.call('doc.put', { key: 'design/projects/x', value: 'x'.repeat(DESIGN_VALUE_CAP - 2) })).ok).toBe(true); await host.close();
});
it('unconditional, create-only, and numeric revision are forwarded distinctly', async () => {
  const store = fake(), host = createDesignHost(async () => store);
  await host.call('doc.put', { key: 'design/projects/x', value: {} });
  expect(store.workspace.putDocument).toHaveBeenLastCalledWith('design/projects/x', {}, {});
  for (const expectedRevision of [null, 1]) {
    await host.call('doc.put', { key: 'design/projects/x', value: {}, expectedRevision });
    expect(store.workspace.putDocument).toHaveBeenLastCalledWith('design/projects/x', {}, { expectedRevision });
    store.workspace.putDocument.mockRejectedValueOnce(Object.assign(new Error(), { code: 'conflict' }));
    expect(await host.call('doc.put', { key: 'design/projects/x', value: {}, expectedRevision })).toEqual({ ok: false, kind: 'conflict' });
  }
  await host.close();
});
it('maps read-only, closed, invalid, open/get/list failure and lost put outcomes without retries', async () => {
  const store = fake(), host = createDesignHost(async () => store);
  for (const [code, kind] of [['read-only', 'read-only'], ['closed', 'unavailable'], ['invalid-argument', 'invalid'], ['integrity', 'unknown']]) {
    store.workspace.putDocument.mockRejectedValueOnce(Object.assign(new Error(), { code }));
    expect(await host.call('doc.put', { key: 'design/projects/x', value: {} })).toEqual({ ok: false, kind });
  }
  expect(store.workspace.putDocument).toHaveBeenCalledTimes(4);
  store.workspace.getDocument.mockRejectedValueOnce(new Error()); store.workspace.listDocuments.mockRejectedValueOnce(new Error());
  expect(await host.call('doc.get', { key: 'design/projects/x' })).toEqual({ ok: false, kind: 'unavailable' });
  expect(await host.call('doc.list', { prefix: 'design/projects/' })).toEqual({ ok: false, kind: 'unavailable' });
  await host.close();
  const failed = createDesignHost(async () => { throw Error(); }); expect(await failed.call('doc.get', { key: 'design/projects/x' })).toEqual({ ok: false, kind: 'unavailable' }); await failed.close();
});
it('close waits for an admitted write and is idempotent during an in-flight open', async () => {
  const store = fake(); let resolve!: (s: DesignStore) => void;
  const host = createDesignHost(() => new Promise(r => { resolve = r; }));
  const put = host.call('doc.put', { key: 'design/projects/x', value: {} });
  const closing = host.close(); expect(host.close()).toBe(closing); expect(store.close).not.toHaveBeenCalled();
  resolve(store); await put; await closing; expect(store.close).toHaveBeenCalledTimes(1);
});
it('real emitted T9 store: unconditional overwrites, null-existing conflict, stale numeric conflict, persistence', async () => {
  await mkdir('.t3/shared-host', { recursive: true });
  const root = await mkdtemp(join(process.cwd(), '.t3/shared-host/real-store-')); dirs.push(root);
  const module = await import(/* @vite-ignore */ pathToFileURL(join(process.cwd(), 'apps/desktop/dist-electron/design-host/modules/design/app/storage/node.js')).href) as { openDesignStorage(options: { root: string; readOnly?: boolean }): Promise<DesignStore> };
  const host = createDesignHost(() => module.openDesignStorage({ root }));
  const key = 'design/components/example';
  expect((await host.call('doc.put', { key, value: { x: 1 } })).ok).toBe(true);
  expect((await host.call('doc.put', { key, value: { x: 2 } })).ok).toBe(true);
  expect(await host.call('doc.put', { key, value: {}, expectedRevision: null })).toEqual({ ok: false, kind: 'conflict' });
  expect(await host.call('doc.put', { key, value: {}, expectedRevision: 1 })).toEqual({ ok: false, kind: 'conflict' });
  expect((await host.call('doc.put', { key, value: { x: 3 }, expectedRevision: 2 })).ok).toBe(true);
  await host.close();
  const readonly = createDesignHost(() => module.openDesignStorage({ root, readOnly: true }));
  expect(await readonly.call('doc.get', { key })).toMatchObject({ ok: true, value: { value: { x: 3 }, revision: 3 } });
  expect(await readonly.call('doc.put', { key, value: {} })).toEqual({ ok: false, kind: 'read-only' }); await readonly.close();
});
