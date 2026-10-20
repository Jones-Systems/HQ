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
