import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSourceHost } from './host';
import type { CatalogSnapshot } from '@hq/contracts/catalog';
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
