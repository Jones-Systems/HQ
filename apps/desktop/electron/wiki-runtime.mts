/** Emitted separately with the Wiki core. Configuration, index migration and refresh are main-only. */
import { mkdir, readFile, rename, lstat, unlink, open, readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createWikiHost, createNodeGitObjectSource, validateSourceProfile, type IndexStore, type NodeGitOptions, type SourceProfile, type WikiHost } from '../../../modules/wiki/core/src/index.ts';
import { WIKI_SERVICE_METHODS, type WikiNamespace, type WikiService } from '../../../modules/wiki/contract/src/index.ts';
import type { WikiAdminStatus, WikiSelection } from '@hq/contracts/wiki-admin';
import { validWikiAdminRequest } from './wiki-admin.ts';

const unavailable = () => ({ ok: false as const, error: { code: 'unavailable' as const, reason: 'index-unavailable', message: 'Wiki is unavailable.' } });
const invalid = () => ({ ok: false as const, error: { code: 'invalid-input' as const, reason: 'unknown-property', message: 'Invalid Wiki request.' } });
const failure = (kind: 'invalid' | 'conflict' | 'unavailable' | 'source-unavailable') => ({ ok: false as const, kind });
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const OBJECT_ID = '(?:[0-9a-f]{40}|[0-9a-f]{64})';
const validKey = (namespace: string, commit: string) => /^(bl|appdev)$/.test(namespace) && new RegExp(`^${OBJECT_ID}$`).test(commit);
/** `<name>.<uuid>.new`, exactly what atomicWikiJson names its temporary file. */
const TEMPORARY = '\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.new$';
const ORPHAN_CONFIG = new RegExp(`^config\\.json${TEMPORARY}`);
const ORPHAN_SNAPSHOT = new RegExp(`^(?:bl|appdev)-${OBJECT_ID}\\.json${TEMPORARY}`);
const snapshotFile = (namespace: WikiNamespace) => new RegExp(`^${namespace}-${OBJECT_ID}\\.json$`);
async function directory(path: string) {
  await mkdir(path, { recursive: true });
  const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Invalid Wiki directory');
}
async function read(path: string): Promise<unknown> {
  try { if ((await lstat(path)).isSymbolicLink()) throw new Error('Invalid Wiki file'); return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
/** Delete the regular files of `dir` whose names match `pattern`, except `keep`. Links, directories and other names stay; best effort. */
async function removeMatching(dir: string, pattern: RegExp, keep?: string) {
  let names: string[];
  try { names = await readdir(dir); } catch { return; }
  for (const name of names) {
    if (name === keep || !pattern.test(name)) continue;
    const path = join(dir, name);
    try { if ((await lstat(path)).isFile()) await unlink(path); } catch { /* a file that vanished or cannot be removed is not an error */ }
  }
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
export interface WikiRuntimeOptions {
  /** Test seam: options for every Git object source this runtime creates (executable, exec and spawn seams, timeouts). */
  readonly git?: NodeGitOptions;
}
/**
 * One host and its Git sources, replaced whenever the configuration changes. A retired generation never starts
 * another read, build or snapshot write.
 */
interface Generation {
  readonly host: WikiHost;
  /** Namespaces whose refresh is queued but not started. */
  readonly waiting: Set<WikiNamespace>;
  /** The namespace being refreshed right now. */
  active: WikiNamespace | null;
  live(): boolean;
  retire(): Promise<void>;
}
/**
 * Only this app's userData/wiki is initialized/upgraded; no legacy-home search or source writes. Opening validates the
 * configuration and returns: indexes are built (or loaded from their snapshots) in the background, one namespace at a
 * time, while reads and admin calls are answered from whatever the host has.
 */
export async function openWikiRuntime(userData: string, options: WikiRuntimeOptions = {}) {
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
  // Nothing of this process is writing yet, so any temporary file of the exact atomicWikiJson form is left over from an interrupted write.
  await removeMatching(root, ORPHAN_CONFIG); await removeMatching(index, ORPHAN_SNAPSHOT);
  let configValue = existing;
  if (existing === null || (existing as { version: number }).version === 0) {
    configValue = { version: 1, sources: profiles }; await atomicWikiJson(configPath, configValue);
  }
  let revision = digest(configValue);
  let closed = false;
  const selections = new Map<string, { profile: SourceProfile; expires: number }>();

  /** Keep only the snapshot of `commit` for this namespace, and only when that snapshot exists as a regular file. */
  const keepOnly = async (namespace: WikiNamespace, commit: string) => {
    if (!validKey(namespace, commit)) return;
    const keep = `${namespace}-${commit}.json`;
    try { if (!(await lstat(join(index, keep))).isFile()) return; } catch { return; }
    await removeMatching(index, snapshotFile(namespace), keep);
  };
  const storeFor = (live: () => boolean): IndexStore => ({
    async read(namespace, commit) { if (!validKey(namespace, commit)) return null; return read(join(index, `${namespace}-${commit}.json`)); },
    async write(namespace, commit, snapshot) {
      if (!validKey(namespace, commit)) throw new Error('Invalid index key');
      if (closed || !live()) throw new Error('Wiki index writes are closed');
      await atomicWikiJson(join(index, `${namespace}-${commit}.json`), snapshot);
      await keepOnly(namespace, commit);
    },
  });
  const makeGeneration = (): Generation => {
    let retired = false;
    const sources: Partial<Record<WikiNamespace, ReturnType<typeof createNodeGitObjectSource>>> = {};
    for (const profile of profiles) sources[profile.namespace] = createNodeGitObjectSource(profile, options.git);
    const adapters = Object.values(sources);
    const host = createWikiHost({ profiles, sources, store: storeFor(() => !retired), clock: { now: Date.now } });
    return {
      host, waiting: new Set(), active: null, live: () => !retired,
      retire: async () => { retired = true; await Promise.all(adapters.map(adapter => adapter.close())); },
    };
  };
  let generation = makeGeneration();

  // Background work runs strictly one job at a time. A job never rejects: failures end up in the host's status.
  let tail: Promise<void> = Promise.resolve();
  const background = (job: () => Promise<void>) => { tail = tail.then(job).catch(() => undefined); };
  const whenIdle = async () => { for (let seen = tail; ; seen = tail) { await seen; if (seen === tail) return; } };
  /** Queue a refresh unless one for the same namespace is already waiting; one running now does not count, so a later request is not lost. */
  const refresh = (target: Generation, namespace: WikiNamespace) => {
    if (closed || target.waiting.has(namespace)) return;
    target.waiting.add(namespace);
    background(async () => {
      target.waiting.delete(namespace);
      if (closed || !target.live()) return;
      target.active = namespace;
      try {
        const result = await target.host.refresh(namespace);
        // The snapshot now in service is the only one worth keeping, whether it was just built or loaded.
        const entry = result.ok ? result.value.namespaces.find(value => value.namespace === namespace) : undefined;
        const graph = entry?.source?.freshness.graph;
        if (!closed && target.live() && entry?.state === 'ready' && graph?.state === 'current' && graph.indexedCommit !== null) await keepOnly(namespace, graph.indexedCommit);
      } finally { target.active = null; }
    });
  };
  /** Adopt new profiles: retire the old host (its reads and builds fail at once), refresh everything on a new one, delete snapshots of namespaces that are gone. */
  const adopt = (next: SourceProfile[], removed: readonly WikiNamespace[]) => {
    const dropped = new Set([...profiles.map(profile => profile.namespace).filter(namespace => !next.some(profile => profile.namespace === namespace)), ...removed]);
    const previous = generation;
    profiles = next; selections.clear(); generation = makeGeneration();
    void previous.retire();
    for (const profile of profiles) refresh(generation, profile.namespace);
    for (const namespace of dropped) background(() => removeMatching(index, snapshotFile(namespace)));
  };
  for (const profile of profiles) refresh(generation, profile.namespace);

  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T,>(run: () => Promise<T>): Promise<T> => { const result = queue.then(run); queue = result.catch(() => undefined); return result; };
  const status = async (): Promise<WikiAdminStatus> => {
    const result = await generation.host.service.indexStatus();
    const queued = (namespace: WikiNamespace) => generation.waiting.has(namespace) || generation.active === namespace;
    return { revision, sources: (['bl', 'appdev'] as const).map(namespace => {
      const configured = profiles.some(profile => profile.namespace === namespace);
      const state = result.ok ? result.value.namespaces.find(value => value.namespace === namespace)?.state : undefined;
      // A refresh that is queued or running reports as indexing before the host has begun to build.
      return { namespace, state: !configured ? 'not-configured' : queued(namespace) || state === 'building' ? 'indexing' : state === 'ready' || state === 'stale' ? state : state === 'unavailable' ? 'source-unavailable' : 'index-unavailable' };
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
        try { const fn = generation.host.service[method as keyof WikiService] as (...values: unknown[]) => Promise<unknown>; return await fn(...args); }
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
            if (selected) {
              const probe = createNodeGitObjectSource(selected, options.git);
              const pinned = await probe.resolvePin(); await probe.close();
              if (!pinned.ok) return failure('source-unavailable');
            }
            const next = profiles.filter(profile => profile.namespace !== (selected?.namespace ?? p.namespace));
            if (selected) next.push(selected);
            if (digest(await read(configPath)) !== revision) return failure('conflict');
            const config = { version: 1, sources: next };
            await atomicWikiJson(configPath, config);
            revision = digest(config); adopt(next, route === 'removeSource' ? [p.namespace as WikiNamespace] : []);
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
                revision = digest(current); adopt(next, []);
              }
            }
            if (route === 'reindex' && !profiles.some(profile => profile.namespace === p.namespace)) return failure('invalid');
            for (const profile of profiles) if (route === 'recheck' || profile.namespace === p.namespace) refresh(generation, profile.namespace);
            return { ok: true, value: await status() };
          }
          return failure('invalid');
        } catch { return failure('unavailable'); }
      });
    },
    /** Resolves once every refresh and cleanup queued so far has finished (diagnostics and tests; not an IPC route). */
    whenIdle,
    /** Stops scheduling, aborts the build in flight (its Git processes are killed) and resolves once nothing can write a snapshot any more. */
    close() { closed = true; return serial(async () => { selections.clear(); await generation.retire(); await whenIdle(); }); },
  };
}
