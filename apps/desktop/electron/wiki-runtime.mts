/** Emitted separately with the Wiki core. Configuration, index migration and refresh are main-only. */
import { mkdir, readFile, rename, lstat, unlink, open } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createWikiHost, createNodeGitObjectSource, validateSourceProfile, type IndexStore, type GitObjectSource, type SourceProfile } from '../../../modules/wiki/core/src/index.ts';
import { WIKI_SERVICE_METHODS, type WikiNamespace, type WikiService } from '../../../modules/wiki/contract/src/index.ts';
import type { WikiAdminStatus, WikiSelection } from '@hq/contracts/wiki-admin';
import { validWikiAdminRequest } from './wiki-admin.ts';

const unavailable = () => ({ ok: false as const, error: { code: 'unavailable' as const, reason: 'index-unavailable', message: 'Wiki is unavailable.' } });
const invalid = () => ({ ok: false as const, error: { code: 'invalid-input' as const, reason: 'unknown-property', message: 'Invalid Wiki request.' } });
const failure = (kind: 'invalid' | 'conflict' | 'unavailable' | 'source-unavailable') => ({ ok: false as const, kind });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function directory(path: string) {
  await mkdir(path, { recursive: true });
  const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid Wiki directory');
}
async function read(path: string): Promise<unknown> {
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Invalid Wiki file'); return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function importedProfile(path: string): Promise<unknown> {
  if ((await lstat(path)).isSymbolicLink()) throw new Error('Invalid profile');
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > 65536) throw new Error('Invalid profile');
    const buffer = Buffer.alloc(65537);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 65536) throw new Error('Invalid profile');
    return JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
  } finally { await file.close(); }
}
export async function atomicWikiJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.new`;
  let owned = false;
  try {
    const file = await open(temporary, 'wx', 0o600); owned = true;
    try { await file.writeFile(JSON.stringify(value)); } finally { await file.close(); }
    await rename(temporary, path);
  } finally { if (owned) await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }
}
/** Only this app's userData/wiki is initialized/upgraded; no legacy-home search or source writes. */
export async function openWikiRuntime(userData: string) {
  const root = join(userData, 'wiki'); await directory(root);
  const configPath = join(root, 'config.json'); const existing = await read(configPath);
  let sources: unknown[] = [];
  if (existing !== null) {
    if (typeof existing !== 'object' || Array.isArray(existing)) throw new Error('Invalid Wiki configuration');
    const config = existing as Record<string, unknown>;
    if ((config.version !== 0 && config.version !== 1) || !Array.isArray(config.sources) || config.sources.length > 2 || Object.keys(config).some(k => !['version', 'sources'].includes(k))) throw new Error('Unsupported Wiki configuration');
    sources = config.sources;
  }
  let profiles = sources.map(source => { const checked = validateSourceProfile(source); if (!checked.ok) throw new Error('Invalid Wiki source'); return checked.value; });
  if (new Set(profiles.map(p => p.namespace)).size !== profiles.length) throw new Error('Duplicate Wiki source');
  const index = join(root, 'index-v1'); await directory(index);
  let configValue = existing;
  if (existing === null || (existing as { version: number }).version === 0) {
    configValue = { version: 1, sources: profiles }; await atomicWikiJson(configPath, configValue);
  }
  let revision = digest(configValue);
  const store: IndexStore = {
    async read(namespace, commit) { if (!/^(bl|appdev)$/.test(namespace) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) return null; return read(join(index, `${namespace}-${commit}.json`)); },
    async write(namespace, commit, snapshot) {
      if (!/^(bl|appdev)$/.test(namespace) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) throw new Error('Invalid index key');
      await atomicWikiJson(join(index, `${namespace}-${commit}.json`), snapshot);
    },
  };
  const makeHost = () => {
    const adapters: Partial<Record<WikiNamespace, GitObjectSource>> = {};
    for (const profile of profiles) adapters[profile.namespace] = createNodeGitObjectSource(profile);
    return createWikiHost({ profiles, sources: adapters, store, clock: { now: Date.now } });
  };
  let host = makeHost();
  for (const profile of profiles) await host.refresh(profile.namespace).catch(() => undefined);
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const selections = new Map<string, { profile: SourceProfile; expires: number }>();
  const serial = <T,>(run: () => Promise<T>): Promise<T> => { const result = queue.then(run); queue = result.catch(() => undefined); return result; };
  const status = async (): Promise<WikiAdminStatus> => {
    const result = await host.service.indexStatus();
    return { revision, sources: (['bl', 'appdev'] as const).map(namespace => {
      const configured = profiles.some(profile => profile.namespace === namespace);
      const state = result.ok ? result.value.namespaces.find(value => value.namespace === namespace)?.state : undefined;
      return { namespace, state: !configured ? 'not-configured' : state === 'ready' || state === 'stale' ? state : state === 'building' ? 'indexing' : state === 'unavailable' ? 'source-unavailable' : 'index-unavailable' };
    }) };
  };
  const select = (profile: SourceProfile): WikiSelection => {
    for (const [key, value] of selections) if (value.expires <= Date.now()) selections.delete(key);
    if (selections.size >= 8) selections.delete(selections.keys().next().value!);
    const token = randomUUID(); selections.set(token, { profile, expires: Date.now() + 300000 });
    return { token, namespace: profile.namespace, label: basename(profile.gitDir).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, 128) };
  };
  const consume = (token: unknown) => {
    if (typeof token !== 'string') return undefined;
    const selection = selections.get(token); selections.delete(token);
    return selection && selection.expires > Date.now() ? selection.profile : undefined;
  };
  return {
    call(method: unknown, args: unknown): Promise<unknown> {
      if (closed) return Promise.resolve(unavailable());
      return serial(async () => {
        if (typeof method !== 'string' || !(WIKI_SERVICE_METHODS as readonly string[]).includes(method) || !Array.isArray(args)) return invalid();
        const noArgs = method === 'listSources' || method === 'indexStatus';
        if (args.length !== (noArgs ? 0 : 1)) return invalid();
        // Core methods apply their exact request validators before any read.
        try { const fn = host.service[method as keyof WikiService] as (...values: unknown[]) => Promise<unknown>; return await fn(...args); }
        catch { return unavailable(); }
      });
    },
    admin(route: unknown, params: unknown, selectedPath?: string): Promise<unknown> {
      if (closed) return Promise.resolve(failure('unavailable'));
      return serial(async () => {
        if (!validWikiAdminRequest(route, params)) return failure('invalid');
        const p = params as Record<string, unknown>;
        try {
          if (route === 'status') return { ok: true, value: await status() };
          if (route === 'importProfile') {
            if (!selectedPath) return failure('invalid');
            const raw = await importedProfile(selectedPath);
            // Import requires the complete mapping so corpus-specific choices are never invented by the manager.
            if (typeof raw !== 'object' || raw === null || !['namespace', 'gitDir', 'expectedRemote', 'ref', 'rootPrefix', 'pageExtensions', 'fieldMappings', 'topicMode'].every(key => key in raw)) return failure('invalid');
            const mappings = (raw as Record<string, unknown>).fieldMappings;
            if (!mappings || typeof mappings !== 'object' || !['title', 'aliases', 'topics', 'relationships'].every(key => key in mappings)) return failure('invalid');
            const checked = validateSourceProfile(raw); if (!checked.ok) return failure('invalid');
            return { ok: true, value: select(checked.value) };
          }
          if (route === 'chooseRepository') {
            const previous = p.token === undefined ? profiles.find(profile => profile.namespace === p.namespace) : consume(p.token);
            if (!previous || previous.namespace !== p.namespace || !selectedPath) return failure('invalid');
            const checked = validateSourceProfile({ ...previous, gitDir: selectedPath });
            if (!checked.ok) return failure('invalid');
            return { ok: true, value: select(checked.value) };
          }
          if (route === 'saveSource' || route === 'removeSource') {
            const selected = route === 'saveSource' ? consume(p.token) : undefined;
            if (route === 'saveSource' && !selected) return failure('invalid');
            if (p.expectedRevision !== revision || digest(await read(configPath)) !== revision) return failure('conflict');
            if (selected && !(await createNodeGitObjectSource(selected).resolvePin()).ok) return failure('source-unavailable');
            const next = profiles.filter(profile => profile.namespace !== (selected?.namespace ?? p.namespace));
            if (selected) next.push(selected);
            if (digest(await read(configPath)) !== revision) return failure('conflict');
            const config = { version: 1, sources: next };
            await atomicWikiJson(configPath, config);
            profiles = next; revision = digest(config); selections.clear(); host = makeHost();
            for (const profile of profiles) await host.refresh(profile.namespace).catch(() => undefined);
            return { ok: true, value: await status() };
          }
          if (route === 'reindex' || route === 'recheck') {
            if (route === 'recheck') {
              const current = await read(configPath);
              if (digest(current) !== revision) {
                if (!current || typeof current !== 'object' || Array.isArray(current)) return failure('unavailable');
                const config = current as Record<string, unknown>;
                if (config.version !== 1 || !Array.isArray(config.sources) || config.sources.length > 2 || Object.keys(config).some(key => !['version', 'sources'].includes(key))) return failure('unavailable');
                const checked = config.sources.map(validateSourceProfile);
                if (checked.some(value => !value.ok)) return failure('unavailable');
                const next = checked.flatMap(value => value.ok ? [value.value] : []);
                if (new Set(next.map(profile => profile.namespace)).size !== next.length) return failure('unavailable');
                profiles = next; revision = digest(current); selections.clear(); host = makeHost();
              }
            }
            if (route === 'reindex' && !profiles.some(profile => profile.namespace === p.namespace)) return failure('invalid');
            await host.refresh(route === 'reindex' ? p.namespace as WikiNamespace : undefined);
            return { ok: true, value: await status() };
          }
          return failure('invalid');
        } catch { return failure('unavailable'); }
      });
    },
    close() { closed = true; return serial(async () => { selections.clear(); }); },
  };
}
