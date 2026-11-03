import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { catalogPersistence, createCatalogHost, type CatalogBuilder } from './catalog-host';
import { buildLocalDirectorySnapshot } from '../../../modules/design/discovery/node/local-directory.ts';
import { EMPTY_CATALOG, reduceCatalog } from '../../../modules/design/discovery/src/catalog.ts';
import type { CatalogSnapshot, RootId, PreviewRef } from '@hq/contracts/catalog';
import type { DesignStorageResult } from '@hq/contracts/services';
const owned: string[] = [];
afterEach(async () => { for (const root of owned.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  await mkdir('.t3/shared-r3', { recursive: true });
  const home = await mkdtemp(join(process.cwd(), '.t3/shared-r3/catalog-')); owned.push(home);
  const a = join(home, 'a'), b = join(home, 'b'); await mkdir(a); await mkdir(b);
  const persistence = catalogPersistence(join(home, 'config'));
  let selected: string | null = a;
  const choose = vi.fn(async () => selected);
  const host = createCatalogHost(persistence, choose, buildLocalDirectorySnapshot);
  return { home, a, b, host, persistence, choose, select(path: string | null) { selected = path; } };
}
function value<T>(result: DesignStorageResult<unknown>): T { expect(result.ok).toBe(true); if (!result.ok) throw Error('Unavailable fixture'); return result.value as T; }
const roots = (host: ReturnType<typeof createCatalogHost>) => host.call('catalog.roots', {});
const snapshot = async (host: ReturnType<typeof createCatalogHost>) => value<CatalogSnapshot>(await host.call('catalog.snapshot', {}));
it('singleton native selection: cancel/validation failure preserve it, same canonical root retains ID, replacement changes ID', async () => {
  const f = await fixture(); expect(value(await roots(f.host))).toEqual([]);
  expect(await f.host.call('catalog.snapshot', {})).toEqual({ ok: false, kind: 'unavailable' });
  const first = value<{ rootId: RootId; label: string }[]>(await f.host.call('catalog.chooseRoot', {}));
  expect(first).toHaveLength(1); expect(JSON.stringify(first)).not.toContain(f.home);
  f.select(null); expect(value(await f.host.call('catalog.chooseRoot', {}))).toEqual(first);
  f.select(f.a); expect(value(await f.host.call('catalog.chooseRoot', {}))).toEqual(first);
  f.select(join(f.home, 'missing')); expect(await f.host.call('catalog.chooseRoot', {})).toEqual({ ok: false, kind: 'unavailable' }); expect(value(await roots(f.host))).toEqual(first);
  f.select(f.b); const second = value<{ rootId: string }[]>(await f.host.call('catalog.chooseRoot', {}));
  expect(second[0]!.rootId).not.toBe(first[0]!.rootId); expect(f.choose).toHaveBeenLastCalledWith(true);
  expect(await f.host.call('catalog.chooseRoot', { path: f.a })).toEqual({ ok: false, kind: 'invalid' });
});
it('generations persist across replacement, forget and restart; forget deletes no files or high-water mark', async () => {
  const f = await fixture(); await f.host.call('catalog.chooseRoot', {});
  const a = await snapshot(f.host); expect(a.complete).toBe(true); expect(a.entries).toEqual([]);
  f.select(f.b); await f.host.call('catalog.chooseRoot', {}); const b = await snapshot(f.host);
  await f.host.call('catalog.forget', {}); expect(value(await roots(f.host))).toEqual([]);
  const state = await f.persistence.read(); expect(state.generation).toBe(b.generation); expect(state.root).toBeNull();
  const restarted = createCatalogHost(f.persistence, async () => f.a, buildLocalDirectorySnapshot);
  await restarted.call('catalog.chooseRoot', {}); const c = await snapshot(restarted);
  expect(a.generation).toBeLessThan(b.generation); expect(b.generation).toBeLessThan(c.generation);
  await mkdir(join(f.a, 'still-present')); await mkdir(join(f.b, 'still-present'));
});
it('replacement complete scan marks old scope missing without deleting cached records or workspace links; failures publish no snapshot', async () => {
  const f = await fixture(); await mkdir(join(f.a, 'project-a')); await mkdir(join(f.b, 'project-b'));
  await f.host.call('catalog.chooseRoot', {}); const first = await snapshot(f.host);
  const links = [{ sourceProjectId: first.entries[0]!.sourceProjectId }];
  const initial = reduceCatalog(EMPTY_CATALOG, { type: 'snapshot', snapshot: first, at: first.observedAt }).state;
  await rename(f.a, join(f.home, 'moved-a'));
  expect(await f.host.call('catalog.snapshot', {})).toEqual({ ok: false, kind: 'unavailable' });
  expect(initial.records[first.entries[0]!.sourceProjectId]!.freshness.status).toBe('fresh');
  f.select(f.b); await f.host.call('catalog.chooseRoot', {}); const second = await snapshot(f.host);
  const next = reduceCatalog(initial, { type: 'snapshot', snapshot: second, at: second.observedAt }).state;
  expect(Object.keys(next.records)).toHaveLength(2); expect(next.records[first.entries[0]!.sourceProjectId]!.freshness.status).toBe('missing-at-source');
  expect(links).toEqual([{ sourceProjectId: first.entries[0]!.sourceProjectId }]);
});
it('preserves K3 partial completeness at 500 entries', async () => {
  const f = await fixture(); for (let i = 0; i < 501; i++) await mkdir(join(f.a, `project-${i}`));
  await f.host.call('catalog.chooseRoot', {}); const result = await snapshot(f.host);
  expect(result.entries).toHaveLength(500); expect(result.complete).toBe(false);
});
it('canonical retargeting is refused until an explicit reselection', async () => {
  const f = await fixture(), link = join(f.home, 'selected'); await symlink(f.a, link); f.select(link);
  await f.host.call('catalog.chooseRoot', {}); const old = value<{ rootId: string }[]>(await roots(f.host));
  await rm(link); await symlink(f.b, link);
  expect(await f.host.call('catalog.snapshot', {})).toEqual({ ok: false, kind: 'unavailable' });
  await f.host.call('catalog.chooseRoot', {}); expect(value<{ rootId: string }[]>(await roots(f.host))[0]!.rootId).not.toBe(old[0]!.rootId);
});
it('stale scans and preview readers are refused after replacement or forget', async () => {
  const f = await fixture(); let finish!: () => void, started!: () => void;
  const entered = new Promise<void>(r => { started = r; }); const release = new Promise<void>(r => { finish = r; });
  const build: CatalogBuilder = async (...args) => { const result = await buildLocalDirectorySnapshot(...args); started(); await release; return result; };
  const host = createCatalogHost(f.persistence, async () => f.a, build);
  await host.call('catalog.chooseRoot', {}); const pending = host.call('catalog.snapshot', {}); await entered;
  await host.call('catalog.forget', {}); finish(); expect(await pending).toEqual({ ok: false, kind: 'unavailable' });
  const ref = { digest: 'sha256:' + 'a'.repeat(64), mediaType: 'image/png', bytes: 8 } as PreviewRef;
  const fakeBuild: CatalogBuilder = async (_path, options) => ({ snapshot: { ...options, hostId: 'laptop-local', complete: true, entries: [] } as unknown as CatalogSnapshot, preview: async () => new Uint8Array(8) });
  const readerHost = createCatalogHost(f.persistence, async () => f.a, fakeBuild);
  await readerHost.call('catalog.chooseRoot', {}); await snapshot(readerHost);
  expect((await readerHost.call('catalog.preview', { ref })).ok).toBe(true);
  await readerHost.call('catalog.forget', {}); expect(await readerHost.call('catalog.preview', { ref })).toEqual({ ok: false, kind: 'unavailable' });
});
it('corrupt, exhausted and failed generation persistence fail closed; known failed selection writes retain the current root', async () => {
  const f = await fixture(); await f.host.call('catalog.chooseRoot', {}); const original = await f.persistence.read();
  const fail = createCatalogHost({ read: async () => original, write: async () => { throw Error('write failed'); } }, async () => f.b, buildLocalDirectorySnapshot);
  expect(await fail.call('catalog.chooseRoot', {})).toEqual({ ok: false, kind: 'unavailable' }); expect(value(await roots(fail))).toEqual(value(await roots(f.host)));
  expect(await fail.call('catalog.snapshot', {})).toEqual({ ok: false, kind: 'unavailable' });
  for (const generation of [NaN, -1, Number.MAX_SAFE_INTEGER]) {
    const write = vi.fn(); const host = createCatalogHost({ read: async () => ({ ...original, generation }), write }, async () => null, buildLocalDirectorySnapshot);
    expect(await host.call('catalog.snapshot', {})).toEqual({ ok: false, kind: 'unavailable' }); expect(write).not.toHaveBeenCalled();
  }
  expect(await readFile(join(f.home, 'config/design-catalog.json'), 'utf8')).not.toContain('NaN');
});
