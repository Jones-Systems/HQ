import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSourceHost } from './host';
import type { CatalogSnapshot } from '@hq/contracts/catalog';
import { mapGalleryIndex } from '../../../../modules/design/discovery/src/adapters/gallery-index.ts';
import { sha256Hex, utf8 } from '../../../../modules/design/discovery/src/jcs.ts';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const userData = await mkdtemp(join(tmpdir(), 'hq-sources-')); roots.push(userData);
  const jones = { environment: vi.fn(async () => ({ hostId: 'jones-one', fingerprint: 'fp' })), projects: vi.fn(async () => ({ projects: [], nextCursor: null })) };
  const mapper = vi.fn(async (_input: unknown, context: unknown) => ({ ...(context as object), complete: true, entries: [] }) as CatalogSnapshot);
  const catalog = { call: vi.fn(async () => ({ ok: true as const, value: [] })) };
  const host = createSourceHost({ userData, catalog, jones, mappers: async () => ({ jones: mapper, gallery: mapper }) });
  return { userData, host, jones, mapper, catalog };
}
it('keeps credentials and URLs out of source status and retains last-good after offline refresh', async () => {
  const f = await fixture();
  const enrolled = await f.host.call('enrollJones', { label: 'First environment' }); expect(enrolled.ok).toBe(true);
  const first = (enrolled as { ok: true; value: { sourceId: string; generation: number }[] }).value[0]!;
  expect(first.generation).toBe(1);
  f.jones.projects.mockRejectedValueOnce(Error('offline'));
  const refreshed = await f.host.call('refresh', { sourceId: first.sourceId });
  expect(refreshed).toMatchObject({ ok: true, value: [{ state: 'stale', generation: 2, lastSuccessAt: expect.any(String) }] });
  expect(JSON.stringify(refreshed)).not.toMatch(/accessToken|workspaceRoot|baseUrl/);
  expect(f.jones.projects).toHaveBeenLastCalledWith('jones-one');
});
it('persists generation across restart and keeps failed refresh generations consumed', async () => {
  const f = await fixture(); const enrolled = await f.host.call('enrollJones', { label: 'Environment' }) as { ok: true; value: { sourceId: string }[] };
  const host = createSourceHost({ userData: f.userData, catalog: f.catalog, jones: f.jones, mappers: async () => ({ jones: f.mapper, gallery: f.mapper }) });
  expect(await host.call('refresh', { sourceId: enrolled.value[0]!.sourceId })).toMatchObject({ ok: true, value: [{ generation: 2 }] });
});
it('preserves the v1 catalog preimage before registry initialization', async () => {
  const f = await fixture(), preimage = JSON.stringify({ generation: 91, root: null });
  await writeFile(join(f.userData, 'design-catalog.json'), preimage);
  await f.host.call('status', {});
  expect(await readFile(join(f.userData, 'sources/catalog-v1-preimage.json'), 'utf8')).toBe(preimage);
  expect(await readFile(join(f.userData, 'design-catalog.json'), 'utf8')).toBe(preimage);
});
it('refuses untrusted URLs, route extras, and unknown source handles', async () => {
  const f = await fixture();
  for (const baseUrl of ['http://private.example/', 'https://user:secret@example.com/', 'file:///tmp/']) expect(await f.host.call('enrollGallery', { baseUrl, label: 'Gallery' })).toEqual({ ok: false, kind: 'invalid' });
  expect(await f.host.call('status', { token: 'leak' })).toEqual({ ok: false, kind: 'invalid' });
  expect(await f.host.call('refresh', { sourceId: 'missing' })).toEqual({ ok: false, kind: 'stale' });
});
it('reads a gallery as ready when every metadata file is fetched, whatever asset files its manifest lists', async () => {
  const f = await fixture();
  const index = { schema: 'gallery-index/v1', title: 'Synthetic', summary: '', projects: [{ id: 'sample', name: 'Example', sourceType: 'collection', runtimeRelease: 'r1',
    collectionHref: 'projects/sample/', entries: [{ id: 'direction-a', title: 'Example', presentationType: 'website', launchHref: 'projects/sample/sites/home.html' }] }] };
  const collection = { variations: [{ id: 'direction-a', presentation: { type: 'website', url: 'sites/home.html' } }] };
  const served: Record<string, Uint8Array> = { 'data/gallery-index.json': utf8(JSON.stringify(index)), 'projects/sample/data/collection.json': utf8(JSON.stringify(collection)) };
  const hashes: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(served)) hashes[path] = await sha256Hex(bytes);
  for (const asset of ['projects/sample/sites/home.html', 'previews/direction-a.png', 'assets/app.js']) hashes[asset] = 'a'.repeat(64);
  served['registry-export-manifest.json'] = utf8(JSON.stringify({ schema: 'gallery-registry-export/v1', algorithm: 'sha256', files: hashes }));
  const fetched: string[] = [];
  const fetch = vi.fn(async (url: URL | RequestInfo) => {
    const path = new URL(String(url)).pathname.slice(1); fetched.push(path);
    return served[path] ? new Response(served[path]) : new Response(null, { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  const host = createSourceHost({ userData: f.userData, catalog: f.catalog, jones: f.jones, fetch,
    mappers: async () => ({ jones: f.mapper, gallery: mapGalleryIndex as never }) });
  const enrolled = await host.call('enrollGallery', { baseUrl: 'https://gallery.example.test/', label: 'Gallery' });
  expect(enrolled).toMatchObject({ ok: true, value: [{ kind: 'gallery', state: 'ready' }] });
  expect((enrolled as { ok: true; value: { detail?: string }[] }).value[0]!.detail).toBeUndefined();
  expect(fetched.sort()).toEqual(['data/gallery-index.json', 'projects/sample/data/collection.json', 'registry-export-manifest.json']);
});
