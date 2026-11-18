import { afterEach, expect, it } from 'vitest';
import { execFile, spawn as nodeSpawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { advanceMain, buildCorpus, mainOf } from '../../../modules/wiki/app/test/corpus.ts';
import type { GitExec, GitExecCallback } from '../../../modules/wiki/core/src/index.ts';
import type { GitSpawn } from '../../../modules/wiki/core/src/node-git-source.ts';
import { openWikiRuntime } from './wiki-runtime.mts';

type Runtime = Awaited<ReturnType<typeof openWikiRuntime>>;
const roots: string[] = [];
const runtimes: Runtime[] = [];
const children: { pid: number; exited: boolean; closed: Promise<void> }[] = [];
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
process.on('unhandledRejection', onUnhandled);
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.close();
  // No batch child may outlive the runtime that started it.
  await Promise.race([Promise.all(children.map(child => child.closed)), sleep(5000)]);
  expect(children.filter(child => !child.exited)).toEqual([]);
  children.length = 0;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  expect(unhandled).toEqual([]);
});

const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
async function until(condition: () => boolean | Promise<boolean>, label: string) {
  for (let attempt = 0; attempt < 2000; attempt++) { if (await condition()) return; await sleep(5); }
  throw new Error(`timed out waiting for ${label}`);
}
async function temporary() { const parent = resolve('.t3/wiki-mount'); await mkdir(parent, { recursive: true }); const root = await mkdtemp(join(parent, 'runtime-')); roots.push(root); return root; }
async function configure(home: string, profiles: readonly unknown[]) { await mkdir(join(home, 'wiki'), { recursive: true }); await writeFile(join(home, 'wiki/config.json'), JSON.stringify({ version: 1, sources: profiles })); }

/**
 * Git seams around the real thing: `ls-tree` results are held back while the gate is closed (a slow source), and
 * every process start is counted. Batch children are recorded so no test can leave one running.
 */
function instrumented() {
  let held = false;
  const waiting: (() => void)[] = [];
  const counts = { lsTree: 0, pins: 0, activeTrees: 0, maxTrees: 0, oneShots: 0, batches: 0 };
  const exec: GitExec = (file, args, options, callback) => {
    const tree = args.includes('ls-tree');
    counts.oneShots++;
    if (args.includes('--verify')) counts.pins++;
    if (tree) { counts.lsTree++; counts.activeTrees++; counts.maxTrees = Math.max(counts.maxTrees, counts.activeTrees); }
    return (execFile as unknown as (...a: unknown[]) => ReturnType<GitExec>)(file, args, options, (error: Parameters<GitExecCallback>[0], stdout: Buffer, stderr: Buffer) => {
      const deliver = () => { if (tree) counts.activeTrees--; callback(error, stdout, stderr); };
      if (tree && held) waiting.push(deliver); else deliver();
    });
  };
  const spawn: GitSpawn = (file, args, options) => {
    counts.batches++;
    const child = nodeSpawn(file, args, options);
    const record = { pid: child.pid as number, exited: false, closed: new Promise<void>(done => child.once('close', () => { record.exited = true; done(); })) };
    children.push(record);
    return child;
  };
  return {
    git: { exec, spawn },
    counts,
    hold() { held = true; },
    release() { held = false; for (const deliver of waiting.splice(0)) deliver(); },
    /** Resolves once a tree listing beyond the first `seen` ones has been requested. */
    nextTree(seen: number) { return until(() => counts.lsTree > seen, 'a tree listing to start'); },
  };
}

const open = async (home: string, git?: ReturnType<typeof instrumented>['git']): Promise<Runtime> => {
  const runtime = await openWikiRuntime(home, git === undefined ? {} : { git });
  runtimes.push(runtime);
  return runtime;
};
const states = (value: unknown) => (value as { ok: true; value: { sources: { namespace: string; state: string }[] } }).value.sources.map(source => `${source.namespace}:${source.state}`);
const indexDir = (home: string) => join(home, 'wiki/index-v1');
const snapshots = async (home: string) => (await readdir(indexDir(home))).sort();
const commit40 = (digit: string) => digit.repeat(40);

it('opens at once while a slow source indexes; status and reads answer meanwhile, then it becomes ready', async () => {
  const root = await temporary(); const corpus = buildCorpus(join(root, 'corpus')); const home = join(root, 'home');
  await configure(home, [corpus.profiles[0]]);
  const seams = instrumented(); seams.hold();
  const runtime = await open(home, seams.git);

  // openWikiRuntime returned although no tree listing can complete yet.
  expect(states(await runtime.admin('status', {}))).toEqual(['bl:indexing', 'appdev:not-configured']);
  await seams.nextTree(0);
  expect(await runtime.call('indexStatus', [])).toMatchObject({ ok: true, value: { namespaces: [{ namespace: 'bl', state: 'building', pageCount: 0 }] } });
  expect(await runtime.call('listSources', [])).toMatchObject({ ok: true, value: [{ namespace: 'bl', freshness: { graph: { state: 'indexing' } } }] });
  expect(await runtime.call('search', [{ query: 'quokkaharbor' }])).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(states(await runtime.admin('status', {}))).toEqual(['bl:indexing', 'appdev:not-configured']);

  seams.release(); await runtime.whenIdle();
  expect(states(await runtime.admin('status', {}))).toEqual(['bl:ready', 'appdev:not-configured']);
  expect(await runtime.call('search', [{ query: 'quokkaharbor' }])).toMatchObject({ ok: true });
  expect(seams.counts.batches).toBe(1);
  expect(seams.counts.oneShots).toBe(5);
});

it('a warm open finds its snapshot and starts no tree listing; stale snapshots left from earlier commits are removed', async () => {
  const root = await temporary(); const corpus = buildCorpus(join(root, 'corpus')); const home = join(root, 'home');
  await configure(home, corpus.profiles);
  const first = await open(home); await first.whenIdle(); await first.close();
  expect(await snapshots(home)).toEqual([`appdev-${corpus.repos.appdev.commit}.json`, `bl-${corpus.repos.bl.commit}.json`]);
  // Residue of the unbounded growth before retention existed.
  const stale = [`bl-${commit40('1')}.json`, `bl-${'2'.repeat(64)}.json`, `appdev-${commit40('3')}.json`];
  for (const name of stale) await writeFile(join(indexDir(home), name), '{}');

  const seams = instrumented();
  const runtime = await open(home, seams.git);
  expect(states(await runtime.admin('status', {}))).toEqual(['bl:indexing', 'appdev:indexing']);
  await runtime.whenIdle();
  expect(states(await runtime.admin('status', {}))).toEqual(['bl:ready', 'appdev:ready']);
  expect(seams.counts.lsTree).toBe(0);
  expect(await snapshots(home)).toEqual([`appdev-${corpus.repos.appdev.commit}.json`, `bl-${corpus.repos.bl.commit}.json`]);
});

it('save, reindex and recheck return at once with indexing; repeated requests coalesce into one queued refresh', async () => {
  const root = await temporary(); const corpus = buildCorpus(join(root, 'corpus')); const home = join(root, 'home');
  const seams = instrumented(); seams.hold();
  const runtime = await open(home, seams.git);
  const profilePath = join(root, 'profile.json'); await writeFile(profilePath, JSON.stringify(corpus.profiles[0]));
  const initial = await runtime.admin('status', {}) as { value: { revision: string } };
  const imported = await runtime.admin('importProfile', {}, profilePath) as { value: { token: string } };

  const saved = await runtime.admin('saveSource', { token: imported.value.token, expectedRevision: initial.value.revision });
  expect(states(saved)).toEqual(['bl:indexing', 'appdev:not-configured']);
  await seams.nextTree(0);
  // The first build is held; everything below arrives while it runs.
  for (let attempt = 0; attempt < 3; attempt++) expect(states(await runtime.admin('reindex', { namespace: 'bl' }))).toEqual(['bl:indexing', 'appdev:not-configured']);
  expect(states(await runtime.admin('recheck', {}))).toEqual(['bl:indexing', 'appdev:not-configured']);
  expect(await runtime.admin('reindex', { namespace: 'appdev' })).toEqual({ ok: false, kind: 'invalid' });

  seams.release(); await runtime.whenIdle();
  expect(states(await runtime.admin('status', {}))).toEqual(['bl:ready', 'appdev:not-configured']);
  expect(seams.counts.lsTree).toBe(1);
  expect(seams.counts.maxTrees).toBe(1);
  // Pin resolutions: the probe that save makes, the build that was running, and exactly one queued refresh (which found
  // the commit unchanged) shared by the four requests that arrived meanwhile.
  expect(seams.counts.pins).toBe(3);
});

it('a configuration change during a build is not lost: the final state reflects the new configuration, one build at a time', async () => {
  const root = await temporary(); const corpus = buildCorpus(join(root, 'corpus')); const home = join(root, 'home');
  await configure(home, [corpus.profiles[0]]);
  const seams = instrumented(); seams.hold();
  const runtime = await open(home, seams.git);
  await seams.nextTree(0);

  const profilePath = join(root, 'profile.json'); await writeFile(profilePath, JSON.stringify(corpus.profiles[1]));
  const status = await runtime.admin('status', {}) as { value: { revision: string } };
  const imported = await runtime.admin('importProfile', {}, profilePath) as { value: { token: string } };
  expect(states(await runtime.admin('saveSource', { token: imported.value.token, expectedRevision: status.value.revision }))).toEqual(['bl:indexing', 'appdev:indexing']);

  seams.release(); await runtime.whenIdle();
  expect(states(await runtime.admin('status', {}))).toEqual(['bl:ready', 'appdev:ready']);
  expect(seams.counts.maxTrees).toBe(1); // the aborted build finished before the next one started
  expect(await runtime.call('search', [{ query: 'quokkaharbor' }])).toMatchObject({ ok: true });
  expect(await snapshots(home)).toEqual([`appdev-${corpus.repos.appdev.commit}.json`, `bl-${corpus.repos.bl.commit}.json`]);
  expect(JSON.parse(await readFile(join(home, 'wiki/config.json'), 'utf8')).sources).toHaveLength(2);
});

it('keeps serving the previous index while a new commit is indexed, then keeps exactly one snapshot per namespace', async () => {
  const root = await temporary(); const corpus = buildCorpus(join(root, 'corpus')); const home = join(root, 'home');
  await configure(home, corpus.profiles);
  const seams = instrumented();
  const runtime = await open(home, seams.git); await runtime.whenIdle();
  const previous = corpus.repos.bl.commit;
  // Files that merely look like snapshots must survive retention untouched.
  const keep = [`bl-${commit40('4')}.json.bak`, `bl-${commit40('5')}.JSON`, 'bl-notes.json', `other-${commit40('6')}.json`, `bl-${commit40('7')}.json.new`, 'README.txt'];
  for (const name of keep) await writeFile(join(indexDir(home), name), 'keep');
  await mkdir(join(indexDir(home), `bl-${commit40('8')}.json`));
  const outside = join(root, 'outside.json'); await writeFile(outside, 'precious');
  await symlink(outside, join(indexDir(home), `bl-${commit40('9')}.json`));

  const next = advanceMain(corpus.repos.bl.gitDir, 'second'); expect(mainOf(corpus.repos.bl.gitDir)).toBe(next);
  const listed = seams.counts.lsTree; const before = await runtime.call('indexStatus', []) as { value: { namespaces: { pageCount: number }[] } };
  seams.hold();
  expect(states(await runtime.admin('reindex', { namespace: 'bl' }))).toEqual(['bl:indexing', 'appdev:ready']);
  await seams.nextTree(listed);
  expect(await runtime.call('indexStatus', [])).toMatchObject({ ok: true, value: { namespaces: [{ namespace: 'bl', state: 'building', pageCount: before.value.namespaces[0]!.pageCount }, { namespace: 'appdev', state: 'ready' }] } });
  expect(before.value.namespaces[0]!.pageCount).toBeGreaterThan(0);
  expect(await runtime.call('search', [{ query: 'quokkaharbor' }])).toMatchObject({ ok: true }); // the previous index
  expect(await snapshots(home)).toContain(`bl-${previous}.json`);

  seams.release(); await runtime.whenIdle();
  expect(states(await runtime.admin('status', {}))).toEqual(['bl:ready', 'appdev:ready']);
  const files = await snapshots(home);
  const linkAndDirectory = [`bl-${commit40('8')}.json`, `bl-${commit40('9')}.json`]; // a directory and a link that carry snapshot names
  expect(files.filter(name => /^bl-[0-9a-f]{40}\.json$/.test(name) && !linkAndDirectory.includes(name))).toEqual([`bl-${next}.json`]);
  expect(files).toContain(`appdev-${corpus.repos.appdev.commit}.json`);
  for (const name of [...keep, ...linkAndDirectory]) expect(files).toContain(name);
  expect(await readFile(outside, 'utf8')).toBe('precious');
});

it('removing a source deletes that namespace snapshots and nothing else', async () => {
  const root = await temporary(); const corpus = buildCorpus(join(root, 'corpus')); const home = join(root, 'home');
  await configure(home, corpus.profiles);
  const runtime = await open(home); await runtime.whenIdle();
  const extra = [`appdev-${commit40('a')}.json`, `appdev-${'b'.repeat(64)}.json`];
  const decoys = [`appdev-${commit40('c')}.json.bak`, 'appdev-index.json', `bl-${commit40('d')}.json.new`];
  for (const name of [...extra, ...decoys]) await writeFile(join(indexDir(home), name), 'x');
  const status = await runtime.admin('status', {}) as { value: { revision: string } };

  const removed = await runtime.admin('removeSource', { namespace: 'appdev', expectedRevision: status.value.revision, confirmed: true });
  expect(states(removed)).toEqual(['bl:indexing', 'appdev:not-configured']);
  await runtime.whenIdle();
  expect(states(await runtime.admin('status', {}))).toEqual(['bl:ready', 'appdev:not-configured']);
  expect(await snapshots(home)).toEqual([`bl-${corpus.repos.bl.commit}.json`, ...decoys].sort());
  expect(JSON.parse(await readFile(join(home, 'wiki/config.json'), 'utf8')).sources.map((source: { namespace: string }) => source.namespace)).toEqual(['bl']);
});

it('opening deletes only temporary files of the exact interrupted-write form, never links or other names', async () => {
  const root = await temporary(); const home = join(root, 'home');
  await configure(home, []); await mkdir(indexDir(home), { recursive: true });
  const uuid = () => randomUUID();
  const gone = [`config.json.${uuid()}.new`];
  const goneIndex = [`bl-${commit40('1')}.json.${uuid()}.new`, `appdev-${'2'.repeat(64)}.json.${uuid()}.new`];
  const stays = ['config.json.new', 'config.json.not-a-uuid.new', `notes.${uuid()}.new`, `config.json.${uuid()}.new.bak`, `config.json.${uuid().toUpperCase()}.new`];
  const staysIndex = [`bl-${commit40('3')}.json.new`, `other-${commit40('4')}.json.${uuid()}.new`, `bl-abc.json.${uuid()}.new`, `bl-${commit40('5')}.json.${uuid()}.tmp`];
  for (const name of [...gone, ...stays]) await writeFile(join(home, 'wiki', name), 'x');
  for (const name of [...goneIndex, ...staysIndex]) await writeFile(join(indexDir(home), name), 'x');
  const precious = join(root, 'precious.txt'); await writeFile(precious, 'precious');
  const linked = `config.json.${uuid()}.new`; await symlink(precious, join(home, 'wiki', linked));
  const linkedIndex = `bl-${commit40('6')}.json.${uuid()}.new`; await symlink(precious, join(indexDir(home), linkedIndex));
  const directoryName = `config.json.${uuid()}.new`; await mkdir(join(home, 'wiki', directoryName));

  const runtime = await open(home); await runtime.whenIdle();
  const wiki = await readdir(join(home, 'wiki')); const index = await readdir(indexDir(home));
  for (const name of gone) expect(wiki).not.toContain(name);
  for (const name of goneIndex) expect(index).not.toContain(name);
  for (const name of [...stays, linked, directoryName]) expect(wiki).toContain(name);
  for (const name of [...staysIndex, linkedIndex]) expect(index).toContain(name);
  expect(await readFile(precious, 'utf8')).toBe('precious');
});

it('a failed background refresh is swallowed into status, never an unhandled rejection', async () => {
  const root = await temporary(); const corpus = buildCorpus(join(root, 'corpus')); const home = join(root, 'home');
  await configure(home, [{ ...corpus.profiles[0], gitDir: join(root, 'missing.git') }, { ...corpus.profiles[1], expectedRemote: 'https://example.invalid/other.git' }]);
  const runtime = await open(home); await runtime.whenIdle(); await sleep(50);
  expect(states(await runtime.admin('status', {}))).toEqual(['bl:source-unavailable', 'appdev:source-unavailable']);
  expect(await runtime.call('indexStatus', [])).toMatchObject({ ok: true });
  expect(unhandled).toEqual([]);
});

it('close during a build leaves no snapshot or temporary file, however late the source answers', async () => {
  const root = await temporary(); const corpus = buildCorpus(join(root, 'corpus')); const home = join(root, 'home');
  await configure(home, corpus.profiles);
  const seams = instrumented(); seams.hold();
  const runtime = await open(home, seams.git);
  await seams.nextTree(0);
  const closing = runtime.close();
  seams.release();
  await closing;
  expect(await snapshots(home)).toEqual([]);
  expect(await runtime.call('listSources', [])).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  expect(await runtime.admin('status', {})).toEqual({ ok: false, kind: 'unavailable' });
  await sleep(250);
  expect(await snapshots(home)).toEqual([]);
  await runtime.close(); // idempotent
});

it('close at any moment of a build is final: the index directory never changes after close resolves', async () => {
  const root = await temporary(); const corpus = buildCorpus(join(root, 'corpus'));
  for (const delay of [0, 2, 8, 20, 45, 80, 140]) {
    const home = join(root, `home-${delay}`);
    await configure(home, corpus.profiles);
    const runtime = await open(home, instrumented().git);
    await sleep(delay);
    await runtime.close();
    const settledFiles = await readdir(indexDir(home));
    expect(settledFiles.filter(name => name.endsWith('.new')), `delay ${delay}`).toEqual([]);
    await sleep(150);
    expect(await readdir(indexDir(home)), `delay ${delay}`).toEqual(settledFiles);
  }
});
