import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { CatalogRoot, CatalogSnapshot, IsoTime, PreviewRef, RootId } from '@hq/contracts/catalog';
import type { DesignStorageResult } from '@hq/contracts/services';
import { keys, record } from './services.js';
import { ReadersWriterGate } from './readers-writer-gate.js';

export interface CatalogConfig { readonly generation: number; readonly root: (CatalogRoot & { readonly path: string; readonly canonical: string }) | null }
export interface CatalogPersistence { read(): Promise<CatalogConfig>; write(config: CatalogConfig): Promise<void> }
export interface BuiltCatalog { readonly snapshot: CatalogSnapshot; preview(ref: PreviewRef, signal: AbortSignal): Promise<Uint8Array> }
export type CatalogBuilder = (path: string, options: { rootId: RootId; generation: number; observedAt: IsoTime }, signal: AbortSignal) => Promise<BuiltCatalog>;
export type ChooseRoot = (replacing: boolean) => Promise<string | null>;
const unavailable = (): DesignStorageResult<never> => ({ ok: false, kind: 'unavailable' });
const validGeneration = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;

/** One main-only file preserves the generation even when the selected root is forgotten. */
export function catalogPersistence(userData: string): CatalogPersistence {
  const path = join(userData, 'design-catalog.json');
  return {
    async read() {
      let raw: string;
      try { raw = await readFile(path, 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { generation: 0, root: null }; throw error; }
      if (Buffer.byteLength(raw) > 16 * 1024) throw Error('Catalog state unavailable');
      const value: unknown = JSON.parse(raw);
      if (!record(value) || !keys(value, ['generation', 'root']) || !validGeneration(value.generation)) throw Error('Catalog state unavailable');
      if (value.root !== null && (!record(value.root) || !keys(value.root, ['rootId', 'label', 'path', 'canonical']) || !['rootId', 'label', 'path', 'canonical'].every(k => typeof (value.root as Record<string, unknown>)[k] === 'string' && ((value.root as Record<string, string>)[k]!).length > 0))) throw Error('Catalog state unavailable');
      if (value.root !== null) {
        const root = value.root as Record<string, string>;
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(root.rootId!) || root.label !== 'Selected local directory' || !isAbsolute(root.path!) || !isAbsolute(root.canonical!)) throw Error('Catalog state unavailable');
      }
      return value as unknown as CatalogConfig;
    },
    async write(config) {
      await mkdir(userData, { recursive: true });
      const temporary = join(userData, `.catalog-${randomUUID()}`);
      let created = false, renamed = false;
      try {
        const file = await open(temporary, 'wx', 0o600); created = true;
        try { await file.writeFile(JSON.stringify(config)); await file.sync(); } finally { await file.close(); }
        await rename(temporary, path); created = false; renamed = true;
        const directory = await open(userData, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      } catch (error) {
        if (renamed) throw Object.assign(new Error('Catalog persistence outcome unknown'), { uncertain: true });
        throw error;
      } finally { if (created) await unlink(temporary); }
    },
  };
}
export async function buildEmittedCatalog(...args: Parameters<CatalogBuilder>): Promise<BuiltCatalog> {
  const module = await import(new URL('./design-host/modules/design/discovery/node/local-directory.js', import.meta.url).href) as { buildLocalDirectorySnapshot: CatalogBuilder };
  return module.buildLocalDirectorySnapshot(...args);
}
export function createCatalogHost(persistence: CatalogPersistence, choose: ChooseRoot, build: CatalogBuilder = buildEmittedCatalog) {
  const gate = new ReadersWriterGate();
  let config: CatalogConfig | undefined;
  let poisoned = false, epoch = 0, scan = 0;
  let reader: { built: BuiltCatalog; epoch: number; root: NonNullable<CatalogConfig['root']> } | undefined;
  async function load() {
    if (poisoned) throw Error('Catalog state unavailable');
    config ??= await persistence.read();
    if (!validGeneration(config.generation)) throw Error('Catalog state unavailable');
    return config;
  }
  async function persist(next: CatalogConfig) {
    try { await persistence.write(next); } catch (error) {
      if (next.generation !== config?.generation || (error as { uncertain?: boolean }).uncertain) { poisoned = true; reader = undefined; }
      throw error;
    }
    config = next;
  }
  const roots = (value: CatalogConfig): readonly CatalogRoot[] => value.root ? [{ rootId: value.root.rootId, label: value.root.label }] : [];
  async function checkRoot(root: NonNullable<CatalogConfig['root']>) {
    if (await realpath(root.path) !== root.canonical || !(await stat(root.canonical)).isDirectory()) throw Error('Selected root unavailable');
  }
  return {
    async call(route: unknown, params: unknown): Promise<DesignStorageResult<unknown>> {
      if (!record(params) || !['catalog.roots', 'catalog.chooseRoot', 'catalog.forget', 'catalog.snapshot', 'catalog.preview'].includes(String(route))) return { ok: false, kind: 'invalid' };
      if (route === 'catalog.preview') {
        if (!keys(params, ['ref']) || !record(params.ref) || !keys(params.ref, ['digest', 'mediaType', 'bytes'], ['w', 'h']) || typeof params.ref.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(params.ref.digest) || !['image/png', 'image/jpeg', 'image/webp'].includes(String(params.ref.mediaType)) || !Number.isSafeInteger(params.ref.bytes) || (params.ref.bytes as number) < 0 || (params.ref.bytes as number) > 5 * 1024 * 1024 || ['w', 'h'].some(k => k in (params.ref as object) && (!Number.isSafeInteger((params.ref as Record<string, unknown>)[k]) || ((params.ref as Record<string, number>)[k]!) <= 0))) return { ok: false, kind: 'invalid' };
      } else if (!keys(params, [])) return { ok: false, kind: 'invalid' };
      try {
        if (route === 'catalog.chooseRoot') {
          const replacing = await gate.exclusive(async () => Boolean((await load()).root));
          const selected = await choose(replacing);
          return await gate.exclusive(async () => {
            const current = await load();
            if (selected === null) return { ok: true, value: roots(current) };
            if (!isAbsolute(selected)) return unavailable();
            const canonical = await realpath(selected);
            if (!(await stat(canonical)).isDirectory()) return unavailable();
            const rootId = current.root?.canonical === canonical ? current.root.rootId : randomUUID() as RootId;
            // A generic label avoids disclosing path components in the renderer.
            const next = { ...current, root: { rootId, label: 'Selected local directory', path: selected, canonical } };
            await persist(next); epoch++; scan++; reader = undefined;
            return { ok: true, value: roots(next) };
          });
        }
        if (route === 'catalog.snapshot') {
          const captured = await gate.exclusive(async () => {
            const current = await load();
            if (!current.root || current.generation === Number.MAX_SAFE_INTEGER) throw Error('Catalog unavailable');
            await checkRoot(current.root);
            const next = { ...current, generation: current.generation + 1 };
            await persist(next);
            reader = undefined;
            return { root: current.root, generation: next.generation, epoch, scan: ++scan };
          });
          const built = await build(captured.root.path, { rootId: captured.root.rootId, generation: captured.generation, observedAt: new Date().toISOString() as IsoTime }, new AbortController().signal);
          return await gate.exclusive(async () => {
            await load();
            if (captured.epoch !== epoch || captured.scan !== scan) return unavailable();
            await checkRoot(captured.root);
            if (built.snapshot.hostId !== 'laptop-local' || built.snapshot.generation !== captured.generation) return unavailable();
            reader = { built, epoch, root: captured.root };
            return { ok: true, value: built.snapshot };
          });
        }
        if (route === 'catalog.preview') {
          const captured = await gate.exclusive(async () => { await load(); if (!reader) throw Error('Preview unavailable'); await checkRoot(reader.root); return reader; });
          const bytes = await captured.built.preview(params.ref as unknown as PreviewRef, new AbortController().signal);
          return await gate.exclusive(async () => {
            await load();
            if (reader !== captured || captured.epoch !== epoch) return unavailable();
            await checkRoot(captured.root);
            return { ok: true, value: bytes };
          });
        }
        return await gate.exclusive(async () => {
          const current = await load();
          if (route === 'catalog.forget') { await persist({ ...current, root: null }); epoch++; scan++; reader = undefined; }
          return { ok: true, value: roots(config!) };
        });
      } catch { return unavailable(); }
    },
  };
}
