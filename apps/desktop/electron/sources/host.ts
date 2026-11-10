import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { open, readFile, mkdir } from 'node:fs/promises';
import type { CatalogSnapshot, SourceStatus, SourceResult, SourceCatalogItem } from '@hq/contracts/catalog';
import type { DesignStorageResult } from '@hq/contracts/services';
import { jsonStore, type JsonStore } from '../jones-code/storage.js';
import { boundedResponse, type FetchPort } from '../jones-code/wire.js';
import { hash } from '../jones-code/receiver.js';
import { previewTarget } from '../preview/policy.js';
import { keys, record } from '../services.js';
import type { GenerationConsumer } from './generations/index.js';
interface Source extends SourceStatus { readonly base?: string; readonly snapshot?: CatalogSnapshot; readonly active: boolean }
interface State { readonly schema: 'hq.sources/v2'; readonly sources: readonly Source[] }
export interface RegistryMappers {
  gallery(input: { manifestBytes: Uint8Array; files: Record<string, Uint8Array>; baseUrl: string; complete: boolean }, context: unknown): Promise<CatalogSnapshot>;
  jones(input: unknown, context: unknown, coverage: { complete: boolean }): Promise<CatalogSnapshot>;
}
export async function emittedMappers(): Promise<RegistryMappers> {
  const gallery = await import(new URL('../design-host/modules/design/discovery/src/adapters/gallery-index.js', import.meta.url).href);
  const jones = await import(new URL('../design-host/modules/design/discovery/src/adapters/jones-projects.js', import.meta.url).href);
  return { gallery: gallery.mapGalleryIndex, jones: jones.mapJonesProjects };
}
export async function preserveLegacyCatalog(userData: string) {
  let raw: Buffer;
  try { raw = await readFile(join(userData, 'design-catalog.json')); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  if (raw.length > 16384) throw Error('Legacy catalog oversized');
  const value: unknown = JSON.parse(raw.toString('utf8'));
  if (!record(value) || !Number.isSafeInteger(value.generation) || Number(value.generation) < 0) throw Error('Legacy generation unavailable');
  await mkdir(join(userData, 'sources'), { recursive: true, mode: 0o700 });
  try { const file = await open(join(userData, 'sources', 'catalog-v1-preimage.json'), 'wx', 0o600); try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); } }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const directory = await open(join(userData, 'sources'), 'r'); try { await directory.sync(); } finally { await directory.close(); }
  return value;
}
export function createSourceHost(options: {
  userData: string;
  catalog: { call(route: unknown, params: unknown): Promise<DesignStorageResult<unknown>> };
  jones: { projects(hostId?: string): Promise<unknown>; environment(hostId?: string): Promise<{ hostId: string; fingerprint: string }> };
  store?: JsonStore<State>; mappers?: () => Promise<RegistryMappers>; fetch?: FetchPort;
  generations?: GenerationConsumer;
}) {
  const generations = options.generations;
  const store = options.store ?? jsonStore<State>(join(options.userData, 'sources'), 'registry.json');
  let state: State | undefined, serial = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => { const next = serial.then(fn); serial = next.then(() => {}, () => {}); return next; };
  async function load(): Promise<State> {
    if (state) return state;
    const saved = await store.read();
    if (saved && (saved.schema !== 'hq.sources/v2' || !Array.isArray(saved.sources) || saved.sources.length > 32 || saved.sources.some(s => !Number.isSafeInteger(s.generation) || s.generation < 0))) throw Error('Registry unavailable');
    const legacy = !saved ? await preserveLegacyCatalog(options.userData) : null;
    const migrated: Source[] = legacy && record(legacy.root) && typeof legacy.root.rootId === 'string' ? [{ sourceId: 'local-catalog', kind: 'local', label: 'Local projects', hostId: 'laptop-local', rootId: legacy.root.rootId, state: 'not-configured', generation: Number(legacy.generation), lastSuccessAt: null, active: true }] : [];
    state = saved ?? { schema: 'hq.sources/v2', sources: migrated };
    if (!saved) await store.write(state);
    return state;
  }
  async function persist(next: State) { await store.write(next); state = next; }
  async function replace(source: Source) { const current = await load(); await persist({ ...current, sources: [...current.sources.filter(s => s.sourceId !== source.sourceId), source] }); }
  const statuses = (): SourceStatus[] => (state?.sources ?? []).filter(s => s.active).map(({ sourceId, kind, label, hostId, rootId, state, generation, lastSuccessAt, detail }) => ({ sourceId, kind, label, hostId, rootId, state, generation, lastSuccessAt, ...(detail ? { detail } : {}) }));
  async function bytes(url: URL) {
    const response = await (options.fetch ?? fetch)(url, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { accept: 'application/json' } });
    if (!response.ok) { await response.body?.cancel(); throw Error('Gallery unavailable'); }
    return new TextEncoder().encode(await boundedResponse(response, 2 * 1024 * 1024));
  }
  async function refresh(source: Source) {
    if (source.generation === Number.MAX_SAFE_INTEGER) throw Error('Generation exhausted');
    const next: Source = { ...source, generation: source.kind === 'local' ? source.generation : source.generation + 1, state: source.snapshot ? 'stale' : 'unavailable' };
    await replace(next);
    try {
      let snapshot: CatalogSnapshot; let rootId = source.rootId;
      if (source.kind === 'local') {
        const before = await options.catalog.call('catalog.roots', {});
        if (!before.ok || !Array.isArray(before.value) || before.value.length !== 1) throw Error('Local root unavailable');
        rootId = String((before.value[0] as { rootId: string }).rootId);
        const value = await options.catalog.call('catalog.snapshot', {}); if (!value.ok) throw Error('Local source unavailable'); snapshot = value.value as CatalogSnapshot;
        if (snapshot.generation <= source.generation) throw Error('Generation mismatch');
        const after = await options.catalog.call('catalog.roots', {});
        if (!after.ok || !Array.isArray(after.value) || (after.value[0] as { rootId?: string } | undefined)?.rootId !== rootId) throw Error('Local selection changed');
      } else {
        const context = { hostId: source.hostId, rootId: source.rootId, generation: next.generation, observedAt: new Date().toISOString(), hostFingerprint: `sha256:${hash(source.hostId)}` };
        const mappers = await (options.mappers ?? emittedMappers)();
        if (source.kind === 'gallery') {
          const base = new URL(source.base!); const manifestBytes = await bytes(new URL('registry-export-manifest.json', base));
          const manifest: unknown = JSON.parse(new TextDecoder().decode(manifestBytes));
          if (!record(manifest) || !record(manifest.files) || Object.keys(manifest.files).length > 10000) throw Error('Invalid manifest');
          const selected = Object.keys(manifest.files).filter(path => path === 'data/gallery-index.json' || /^projects\/[a-zA-Z0-9_-]+\/data\/collection\.json$/.test(path));
          if (selected.length > 999) throw Error('Registry metadata oversized');
          const files: Record<string, Uint8Array> = {}; let total = manifestBytes.length;
          for (const path of selected) { const part = await bytes(new URL(path, base)); total += part.length; if (total > 16 * 1024 * 1024) throw Error('Registry oversized'); files[path] = part; }
          snapshot = await mappers.gallery({ manifestBytes, files, baseUrl: base.href, complete: selected.length === Object.keys(manifest.files).length }, context);
        } else {
          const identity = await options.jones.environment(source.hostId); if (identity.hostId !== source.hostId) throw Error('Host identity changed');
          const value = await options.jones.projects(source.hostId);
          snapshot = await mappers.jones(value, { ...context, hostFingerprint: identity.fingerprint }, { complete: record(value) && value.nextCursor === null });
        }
      }
      if (!snapshot.complete && source.snapshot) {
        const merged = new Map(source.snapshot.entries.map(entry => [entry.sourceProjectId, entry]));
        for (const entry of snapshot.entries) merged.set(entry.sourceProjectId, entry);
        snapshot = { ...snapshot, entries: [...merged.values()] };
      }
      await replace({ ...next, rootId, snapshot, generation: snapshot.generation, state: snapshot.complete ? 'ready' : 'partial', lastSuccessAt: snapshot.observedAt, detail: snapshot.complete ? undefined : 'Partial inventory; prior entries retained' });
    } catch {
      await replace({ ...next, state: source.snapshot ? 'stale' : 'unavailable', detail: 'Refresh unavailable; last successful catalog retained' });
    }
  }
  return {
    ...(generations ? { generations: {
      refresh: () => generations.refresh(),
      current: () => generations.current(),
      manifest: () => generations.manifest(),
      readBlob: (path: string) => generations.readFile(path),
    } } : {}),
    async call(route: unknown, raw: unknown): Promise<SourceResult<unknown>> {
      if (!record(raw) || typeof route !== 'string') return { ok: false, kind: 'invalid' };
      const p = raw;
      const valid = ['status', 'list', 'chooseLocal'].includes(route) ? keys(p, [])
        : route === 'enrollGallery' ? keys(p, ['baseUrl', 'label'])
        : route === 'enrollJones' ? keys(p, ['label'])
        : ['refresh', 'remove'].includes(route) && keys(p, ['sourceId']) && typeof p.sourceId === 'string';
      if (!valid) return { ok: false, kind: 'invalid' };
      return exclusive(async () => {
        try {
          await load();
          if (route === 'list') {
            const entries: SourceCatalogItem[] = [];
            for (const source of state!.sources) if (source.active && source.snapshot) for (const entry of source.snapshot.entries) entries.push({ entry, hostLabel: source.label, freshness: source.state });
            return { ok: true, value: entries };
          }
          if (route === 'status') return { ok: true, value: statuses() };
          if (route === 'chooseLocal') {
            const chosen = await options.catalog.call('catalog.chooseRoot', {});
            if (!chosen.ok) return { ok: false, kind: 'unavailable' };
            const roots = chosen.value as { rootId: string; label: string }[];
            if (roots.length) {
              const previous = state!.sources.find(s => s.kind === 'local');
              const source: Source = { sourceId: 'local-catalog', kind: 'local', label: 'Local projects', hostId: 'laptop-local', rootId: roots[0]!.rootId, state: 'not-configured', generation: previous?.generation ?? 0, lastSuccessAt: previous?.lastSuccessAt ?? null, active: true, ...(previous?.snapshot ? { snapshot: previous.snapshot } : {}) };
              await replace(source); await refresh(source);
            }
          } else if (route === 'enrollGallery' || route === 'enrollJones') {
            if (typeof p.label !== 'string' || !p.label.trim() || p.label.length > 160 || state!.sources.filter(s => s.active).length >= 32) return { ok: false, kind: 'invalid' };
            let base: string | undefined; let hostId: string;
            if (route === 'enrollGallery') {
              const target = previewTarget(p.baseUrl); if (!target || !target.pathname.endsWith('/') || target.search || target.hash) return { ok: false, kind: 'invalid' };
              base = target.href; hostId = `gallery:${randomUUID()}`;
            } else hostId = (await options.jones.environment()).hostId;
            const previous = state!.sources.find(s => route === 'enrollGallery' ? s.kind === 'gallery' && s.base === base : s.kind === 'jones' && s.hostId === hostId);
            const source: Source = previous ? { ...previous, label: p.label, active: true } : { sourceId: randomUUID(), kind: route === 'enrollGallery' ? 'gallery' : 'jones', label: p.label, hostId, rootId: randomUUID(), generation: 0, lastSuccessAt: null, state: 'not-configured', active: true, ...(base ? { base } : {}) };
            await replace(source); await refresh(source);
          } else {
            const source = state!.sources.find(s => s.sourceId === p.sourceId && s.active); if (!source) return { ok: false, kind: 'stale' };
            if (route === 'refresh') await refresh(source);
            else { if (source.kind === 'local') { const forgotten = await options.catalog.call('catalog.forget', {}); if (!forgotten.ok) return { ok: false, kind: 'unavailable' }; } await replace({ ...source, active: false }); }
          }
          return { ok: true, value: statuses() };
        } catch { return { ok: false, kind: 'unavailable' }; }
      });
    },
  };
}
