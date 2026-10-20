/** Emitted separately with the Wiki core. Configuration, index migration and refresh are main-only. */
import { mkdir, readFile, writeFile, rename, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createWikiHost, createNodeGitObjectSource, validateSourceProfile, type IndexStore, type GitObjectSource } from '../../../modules/wiki/core/src/index.ts';
import { WIKI_SERVICE_METHODS, type WikiNamespace, type WikiService } from '../../../modules/wiki/contract/src/index.ts';

const unavailable = () => ({ ok: false as const, error: { code: 'unavailable' as const, reason: 'index-unavailable', message: 'Wiki is unavailable.' } });
const invalid = () => ({ ok: false as const, error: { code: 'invalid-input' as const, reason: 'unknown-property', message: 'Invalid Wiki request.' } });
async function directory(path: string) {
  await mkdir(path, { recursive: true });
  const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid Wiki directory');
}
async function read(path: string): Promise<unknown> {
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Invalid Wiki file'); return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function atomic(path: string, value: unknown) {
  const temporary = path + '.new';
  await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}
/** Only this app's userData/wiki is initialized/upgraded; no legacy-home search or source writes. */
export async function openWikiRuntime(userData: string) {
  const root = join(userData, 'wiki'); await directory(root);
  const configPath = join(root, 'config.json'); const existing = await read(configPath);
  let sources: unknown[] = [];
  if (existing !== null) {
    if (typeof existing !== 'object' || Array.isArray(existing)) throw new Error('Invalid Wiki configuration');
    const config = existing as Record<string, unknown>;
    if ((config.version !== 0 && config.version !== 1) || !Array.isArray(config.sources) || Object.keys(config).some(k => !['version', 'sources'].includes(k))) throw new Error('Unsupported Wiki configuration');
    sources = config.sources;
  }
  const profiles = sources.map(source => { const checked = validateSourceProfile(source); if (!checked.ok) throw new Error('Invalid Wiki source'); return checked.value; });
  if (new Set(profiles.map(p => p.namespace)).size !== profiles.length) throw new Error('Duplicate Wiki source');
  const index = join(root, 'index-v1'); await directory(index);
  if (existing === null || (existing as { version: number }).version === 0) await atomic(configPath, { version: 1, sources: profiles });
  const store: IndexStore = {
    async read(namespace, commit) { if (!/^(bl|appdev)$/.test(namespace) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) return null; return read(join(index, `${namespace}-${commit}.json`)); },
    async write(namespace, commit, snapshot) {
      if (!/^(bl|appdev)$/.test(namespace) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('Invalid index key');
      await atomic(join(index, `${namespace}-${commit}.json`), snapshot);
    },
  };
  const adapters: Partial<Record<WikiNamespace, GitObjectSource>> = {};
  for (const profile of profiles) adapters[profile.namespace] = createNodeGitObjectSource(profile);
  const host = createWikiHost({ profiles, sources: adapters, store, clock: { now: Date.now } });
  await host.refresh();
  let closed = false;
  return {
    async call(method: unknown, args: unknown): Promise<unknown> {
      if (closed) return unavailable();
      if (typeof method !== 'string' || !(WIKI_SERVICE_METHODS as readonly string[]).includes(method) || !Array.isArray(args)) return invalid();
      const noArgs = method === 'listSources' || method === 'indexStatus';
      if (args.length !== (noArgs ? 0 : 1)) return invalid();
      // Core methods apply their exact request validators before any read.
      try { const fn = host.service[method as keyof WikiService] as (...values: unknown[]) => Promise<unknown>; return await fn(...args); }
      catch { return unavailable(); }
    },
    async close() { closed = true; },
  };
}
