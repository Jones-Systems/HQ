import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { buildCorpus } from '../../../modules/wiki/app/test/corpus.ts';
import { openWikiRuntime } from './wiki-runtime.mts';
import { createWikiBridge, wikiIpcHandler } from './wiki-host';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function temporary() { const parent = resolve('.t3/wiki-mount'); await mkdir(parent, { recursive: true }); const root = await mkdtemp(join(parent, 'host-')); roots.push(root); return root; }
it('initializes and upgrades only the supplied Wiki home, indexing committed synthetic Git objects', async () => {
  const root = await temporary(); const corpus = buildCorpus(join(root, 'corpus'));
  const home = join(root, 'userData'); await mkdir(join(home, 'wiki'), { recursive: true });
  const config = join(home, 'wiki/config.json'); await writeFile(config, JSON.stringify({ version: 0, sources: corpus.profiles }));
  const runtime = await openWikiRuntime(home);
  expect(JSON.parse(await readFile(config, 'utf8')).version).toBe(1);
  expect((await readdir(join(home, 'wiki/index-v1'))).length).toBe(2);
  const result = await runtime.call('search', [{ query: 'quokkaharbor' }]);
  expect(result).toMatchObject({ ok: true }); expect(JSON.stringify(result)).toContain('Retry Policy');
  expect(JSON.stringify(await runtime.call('listSources', []))).not.toContain(root);
  expect(JSON.stringify(await runtime.call('listSources', []))).not.toContain('example.invalid');
  for (const [method, args] of [['refresh', []], ['migrate', []], ['listSources', [{}]], ['search', [{ query: 'x', gitDir: root }]], ['getPage', [{ key: { namespace: 'bl', path: '../secret' } }]]] as const) {
    expect(await runtime.call(method, args)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  }
  await runtime.close(); await runtime.close(); expect(await runtime.call('listSources', [])).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  const reopened = await openWikiRuntime(home); expect(await reopened.call('search', [{ query: 'quokkaharbor' }])).toEqual(result); await reopened.close();
});
it('initializes an empty home and refuses future schema without overwriting it', async () => {
  const root = await temporary(); const runtime = await openWikiRuntime(root); await runtime.close();
  expect(JSON.parse(await readFile(join(root, 'wiki/config.json'), 'utf8'))).toEqual({ version: 1, sources: [] });
  const future = JSON.stringify({ version: 99, sources: [] }); await writeFile(join(root, 'wiki/config.json'), future);
  await expect(openWikiRuntime(root)).rejects.toThrow('Unsupported'); expect(await readFile(join(root, 'wiki/config.json'), 'utf8')).toBe(future);
});
it('residue from an interrupted config or index write does not block opening or indexing', async () => {
  const root = await temporary(); const corpus = buildCorpus(join(root, 'corpus'));
  const home = join(root, 'userData'); await mkdir(join(home, 'wiki/index-v1'), { recursive: true });
  const config = join(home, 'wiki/config.json'); await writeFile(config, JSON.stringify({ version: 0, sources: corpus.profiles }));
  await writeFile(config + '.new', '{"partial"');
  for (const profile of corpus.profiles) await writeFile(join(home, 'wiki/index-v1', `${profile.namespace}-${corpus.repos[profile.namespace as 'bl' | 'appdev'].commit}.json.new`), '{');
  const runtime = await openWikiRuntime(home);
  expect(JSON.parse(await readFile(config, 'utf8')).version).toBe(1);
  expect(await runtime.call('search', [{ query: 'quokkaharbor' }])).toMatchObject({ ok: true });
  expect((await readdir(join(home, 'wiki/index-v1'))).filter(name => name.endsWith('.json')).length).toBe(2);
  await runtime.close();
});
it('rejects a non-main-frame sender before opening; same renderer realm is not hard domain isolation', async () => {
  const close = vi.fn(async () => {}); const open = vi.fn(async () => ({ call: vi.fn(async () => ({ ok: true, value: [] })), close }));
  const bridge = createWikiBridge(open); const handler = wikiIpcHandler((event: { mainFrame: boolean }) => event.mainFrame, bridge);
  expect(await handler({ mainFrame: false }, 'listSources', [])).toMatchObject({ ok: false }); expect(open).not.toHaveBeenCalled();
  expect(await handler({ mainFrame: true }, 'listSources', [])).toEqual({ ok: true, value: [] });
  await bridge.close(); await bridge.close(); expect(close).toHaveBeenCalledTimes(1);
});

it('emitted Wiki host opens under plain Node with type stripping disabled', async () => {
  const root = await temporary();
  const entry = pathToFileURL(resolve('apps/desktop/dist-electron/wiki-host/apps/desktop/electron/wiki-runtime.mjs')).href;
  const script = `const {openWikiRuntime}=await import(${JSON.stringify(entry)}); const runtime=await openWikiRuntime(${JSON.stringify(root)}); console.log(JSON.stringify(await runtime.call('listSources',[]))); await runtime.close();`;
  const output = execFileSync(process.execPath, ['--no-experimental-strip-types', '--input-type=module', '-e', script], { encoding: 'utf8' });
  expect(JSON.parse(output)).toMatchObject({ ok: true });
});

it('reopens a rejected runtime explicitly and makes readers wait for recovery', async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const runtime = { call: vi.fn(async () => ({ ok: true, value: [] })), admin: vi.fn(async () => ({ ok: true, value: {} })), close: vi.fn(async () => {}) };
  const open = vi.fn().mockRejectedValueOnce(new Error('private/path')).mockImplementationOnce(async () => { await pending; return runtime; });
  const bridge = createWikiBridge(open);
  expect(await bridge.call('listSources', [])).toMatchObject({ ok: false });
  const recovering = bridge.admin('recheck', {});
  const reading = bridge.call('listSources', []);
  await Promise.resolve(); expect(runtime.call).not.toHaveBeenCalled();
  release(); await recovering; expect(await reading).toEqual({ ok: true, value: [] });
  expect(open).toHaveBeenCalledTimes(2); await bridge.close();
});

it('imports complete native profiles with single-use tokens, CAS and sanitized status', async () => {
  const root = await temporary(); const corpus = buildCorpus(join(root, 'corpus'));
  const home = join(root, 'home'); const runtime = await openWikiRuntime(home);
  const profilePath = join(root, 'profile.json'); await writeFile(profilePath, JSON.stringify(corpus.profiles[0]));
  const initial = await runtime.admin('status', {}) as { ok: true; value: { revision: string } };
  const imported = await runtime.admin('importProfile', {}, profilePath) as { ok: true; value: { token: string } };
  expect(imported.ok).toBe(true); expect(JSON.stringify(imported)).not.toContain(root); expect(JSON.stringify(imported)).not.toContain('example.invalid');
  const saved = await runtime.admin('saveSource', { token: imported.value.token, expectedRevision: initial.value.revision });
  expect(saved).toMatchObject({ ok: true, value: { sources: [{ namespace: 'bl', state: 'ready' }, { namespace: 'appdev', state: 'not-configured' }] } });
  expect(JSON.stringify(saved)).not.toContain(root);
  expect(await runtime.admin('saveSource', { token: imported.value.token, expectedRevision: initial.value.revision })).toEqual({ ok: false, kind: 'invalid' });
  const next = await runtime.admin('importProfile', {}, profilePath) as { ok: true; value: { token: string } };
  expect(await runtime.admin('saveSource', { token: next.value.token, expectedRevision: initial.value.revision })).toEqual({ ok: false, kind: 'conflict' });
  expect(await runtime.admin('saveSource', { token: next.value.token, expectedRevision: initial.value.revision })).toEqual({ ok: false, kind: 'invalid' });
  const persisted = JSON.parse(await readFile(join(home, 'wiki/config.json'), 'utf8'));
  expect(persisted.sources).toEqual([corpus.profiles[0]]);
  expect((await readdir(join(home, 'wiki'))).filter(name => name.endsWith('.new'))).toEqual([]);
  await runtime.close();
});

it('rejects admin renderer path injection before a native picker or runtime opens', async () => {
  const { wikiAdminIpcHandler } = await import('./wiki-admin');
  const bridge = { admin: vi.fn() }; const choose = vi.fn();
  const handler = wikiAdminIpcHandler((event: boolean) => event, bridge, choose);
  for (const [route, params] of [['importProfile', { path: '/private' }], ['chooseRepository', { namespace: 'bl', gitDir: '/private' }], ['removeSource', { namespace: 'bl', expectedRevision: 'a'.repeat(64), confirmed: false }], ['refresh', {}], ['status', { remote: 'secret' }]] as const) {
    expect(await handler(true, route, params)).toEqual({ ok: false, kind: 'invalid' });
  }
  expect(await handler(false, 'importProfile', {})).toEqual({ ok: false, kind: 'unavailable' });
  expect(choose).not.toHaveBeenCalled(); expect(bridge.admin).not.toHaveBeenCalled();
});

it('unique atomic writes ignore legacy .new files and clean failed writes', async () => {
  const { atomicWikiJson } = await import('./wiki-runtime.mts');
  const root = await temporary(); const target = join(root, 'config.json');
  await writeFile(`${target}.new`, 'legacy');
  await atomicWikiJson(target, { version: 1 });
  expect(await readFile(`${target}.new`, 'utf8')).toBe('legacy');
  const directoryTarget = join(root, 'directory'); await mkdir(directoryTarget);
  await expect(atomicWikiJson(directoryTarget, {})).rejects.toThrow();
  expect((await readdir(root)).sort()).toEqual(['config.json', 'config.json.new', 'directory']);
});

it('isolates unavailable source startup and keeps unchanged reader allowlist', async () => {
  const root = await temporary(); const corpus = buildCorpus(join(root, 'corpus'));
  const home = join(root, 'home'); await mkdir(join(home, 'wiki'), { recursive: true });
  await writeFile(join(home, 'wiki/config.json'), JSON.stringify({ version: 1, sources: [corpus.profiles[0], { ...corpus.profiles[1], gitDir: join(root, 'missing') }] }));
  const runtime = await openWikiRuntime(home);
  expect(await runtime.admin('status', {})).toMatchObject({ ok: true, value: { sources: [{ namespace: 'bl', state: 'ready' }, { namespace: 'appdev', state: 'source-unavailable' }] } });
  expect(await runtime.call('search', [{ query: 'quokkaharbor' }])).toMatchObject({ ok: true });
  expect(await runtime.call('refresh', [])).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  await runtime.close();
});

it('external config changes conflict without overwrite and invalid imports stay sanitized', async () => {
  const root = await temporary(); const runtime = await openWikiRuntime(root);
  const status = await runtime.admin('status', {}) as { ok: true; value: { revision: string } };
  const configPath = join(root, 'wiki/config.json'); const external = '{"sources":[],"version":1}';
  await writeFile(configPath, external);
  expect(await runtime.admin('removeSource', { namespace: 'bl', expectedRevision: status.value.revision, confirmed: true })).toEqual({ ok: false, kind: 'conflict' });
  expect(await readFile(configPath, 'utf8')).toBe(external);
  const profile = join(root, 'private.json'); await writeFile(profile, 'private/path malformed JSON');
  expect(await runtime.admin('importProfile', {}, profile)).toEqual({ ok: false, kind: 'unavailable' });
  await writeFile(profile, JSON.stringify({ namespace: 'bl', gitDir: '/private', expectedRemote: 'https://user:secret@example.invalid/x', ref: 'main' }));
  expect(await runtime.admin('importProfile', {}, profile)).toEqual({ ok: false, kind: 'invalid' });
  await runtime.close();
});

it('retains a previously ready index as stale when explicit source recheck fails', async () => {
  const root = await temporary(); const corpus = buildCorpus(join(root, 'corpus'));
  const home = join(root, 'home'); await mkdir(join(home, 'wiki'), { recursive: true });
  await writeFile(join(home, 'wiki/config.json'), JSON.stringify({ version: 1, sources: [corpus.profiles[0]] }));
  const bridge = createWikiBridge(() => openWikiRuntime(home));
  expect(await bridge.admin('status', {})).toMatchObject({ ok: true, value: { sources: [{ namespace: 'bl', state: 'ready' }, { namespace: 'appdev', state: 'not-configured' }] } });
  await rm(corpus.repos.bl.gitDir, { recursive: true, force: true });
  expect(await bridge.admin('recheck', {})).toMatchObject({ ok: true, value: { sources: [{ namespace: 'bl', state: 'stale' }, { namespace: 'appdev', state: 'not-configured' }] } });
  expect(await bridge.call('search', [{ query: 'quokkaharbor' }])).toMatchObject({ ok: true });
  await bridge.close();
});
