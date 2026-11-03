import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createTestContext, LOCK_NAME } from '../admission.mjs';
import { runStorageCommand } from '../commands.mjs';

const fakeCli = `import fs from 'node:fs';
import path from 'node:path';
const tool=path.basename(process.argv[1]).replace('npm-driver.mjs','npm');
const log=process.env.TEST_COMMAND_LOG;
const record=value=>fs.appendFileSync(log,JSON.stringify(value)+'\\n');
record({tool,args:process.argv.slice(2),execPath:process.execPath,driver:process.argv[1],
  e2e:process.env.HQ_CLI_E2E,temp:process.env.TMPDIR,tmp:process.env.TMP,temporary:process.env.TEMP,
  cache:process.env.npm_config_cache,lock:JSON.parse(fs.readFileSync(path.join(process.cwd(),'${LOCK_NAME}'),'utf8'))});
if(process.env.FAKE_FAIL_TOOL===tool)process.exit(7);
if(process.env.FAKE_WAIT_TOOL===tool){
 const timer=setInterval(()=>{},1000);
 process.on('SIGTERM',()=>{record({signal:'SIGTERM'});clearInterval(timer);process.exit(0);});
 record({ready:true});
}
`;
async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const capacity = await fs.statfs(parent, { bigint: true });
  assert.ok(capacity.bsize > 0n && capacity.bavail * capacity.bsize >= 16n * 1024n * 1024n,
    'Refuse tiny fixture without known capacity');
  const root = await fs.mkdtemp(path.join(parent, 'hq-storage-command-'));
  const active = [];
  t.after(async () => {
    try { for (const { controller, running } of active) { controller.abort(); await running.catch(() => {}); } }
    finally {
      await fs.rm(root, { recursive: true, force: true });
      await assert.rejects(fs.lstat(root), { code: 'ENOENT' });
    }
  });
  await fs.chmod(root, 0o700);
  const worktree = path.join(root, 'worktree');
  const bin = path.join(worktree, 'node_modules/.bin');
  await fs.mkdir(bin, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(worktree, 'package.json'), '{"type":"module"}\n');
  for (const tool of ['tsc', 'vite', 'vitest', 'npm-driver.mjs']) await fs.writeFile(path.join(bin, tool), fakeCli, { mode: 0o700 });
  const marker = path.join(worktree, '.t3/cache/command-log.jsonl');
  const state = { available: 16 * 1024 * 1024 };
  const testContext = createTestContext({ policy: { reserveBytes: 1024, peakBytes: 1024 * 1024,
    compiledBytes: 32768, generatedBytes: 65536, lockTimeoutMs: 100 },
    measureFilesystem: async root => ({ id: root.dev, type: 'fixture', blockBytes: 4096, availableBytes: state.available }) });
  const env = { ...process.env, TEST_COMMAND_LOG: marker, npm_execpath: path.join(bin, 'npm-driver.mjs'), HQ_CLI_E2E: '1' };
  const observations = [];
  const run = (key, args = [], extra = {}) => {
    const controller = new AbortController();
    const running = runStorageCommand(key, args, { worktree, env, signal: controller.signal,
      observation: value => observations.push(value), ...extra }, { testContext });
    active.push({ controller, running }); return { controller, running };
  };
  const records = async () => {
    try { return (await fs.readFile(marker, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  };
  const cleaned = async entries => {
    for (const item of entries.filter(r => r.temp)) await assert.rejects(fs.lstat(item.temp), { code: 'ENOENT' });
    await assert.rejects(fs.lstat(path.join(worktree, LOCK_NAME)), { code: 'ENOENT' });
  };
  return { root, worktree, bin, marker, state, env, observations, run, records, cleaned };
}
const electron = [
  ['tsc', '-p', 'apps/desktop/tsconfig.electron.json'],
  ['tsc', '-p', 'apps/desktop/tsconfig.design-host.json'],
  ['tsc', '-p', 'apps/desktop/tsconfig.wiki-host.json'],
  ['vite', 'build', '--config', 'apps/desktop/vite.preview-agent.config.ts'],
];
const expected = {
  build: [['npm', 'run', 'typecheck'], ['vite', 'build', '--config', 'apps/desktop/vite.config.ts'], ...electron],
  'build:electron': electron,
  'build:preview-agent': [electron.at(-1)],
  test: [...electron, ['vitest', 'run']],
};
for (const key of Object.keys(expected)) test(`exact ${key} graph, single live lock and leaf-only forwarding`, async t => {
  const f = await fixture(t);
  const forwarded = key === 'test' ? ['--reporter', 'dot'] : ['--mode', 'synthetic'];
  const result = await f.run(key, forwarded).running;
  assert.equal(result.code, 0); assert.equal(result.signal, null); assert.deepEqual(result.diagnostics, []);
  const rows = await f.records();
  const vector = expected[key].map(row => [...row]); vector.at(-1).push(...forwarded);
  assert.deepEqual(rows.map(row => [row.tool, ...row.args]), vector);
  assert.equal(new Set(rows.map(row => row.lock.nonce)).size, 1, 'nested steps reuse the same live parent envelope');
  for (const row of rows) {
    assert.equal(row.lock.pid, process.pid); assert.equal(row.execPath, process.execPath);
    assert.equal(row.e2e, '1'); assert.equal(row.temp, row.tmp); assert.equal(row.temp, row.temporary);
    assert.equal(row.cache, path.join(f.worktree, '.t3/cache/npm'));
    assert.ok(row.temp.startsWith(path.join(f.worktree, '.t3/storage-command-scratch') + path.sep));
    if (row.tool !== 'npm') assert.equal(row.driver, path.join(f.bin, row.tool));
  }
  if (key === 'build') {
    assert.equal(rows[0].driver, f.env.npm_execpath);
    assert.deepEqual(rows[0].args, ['run', 'typecheck']);
    assert.deepEqual(f.observations[0], { phase: 'npm-driver', driver: f.env.npm_execpath });
  }
  await f.cleaned(rows);
});

test('a trailing-separator worktree preserves tool custody and canonical launch paths', async t => {
  const f = await fixture(t);
  const result = await f.run('test', [], { worktree: f.worktree + path.sep }).running;
  assert.equal(result.code, 0); assert.equal(result.signal, null);
  const rows = await f.records();
  assert.deepEqual(rows.map(row => [row.tool, ...row.args]), expected.test);
  for (const row of rows) {
    assert.equal(row.driver, path.join(f.bin, row.tool));
    assert.equal(row.cache, path.join(f.worktree, '.t3/cache/npm'));
  }
  await f.cleaned(rows);
});

for (const driver of [undefined, 'relative/npm', 'missing', 'directory']) test(`build refuses ${driver ?? 'absent'} npm driver before allocation`, async t => {
  const f = await fixture(t);
  const npm_execpath = driver === 'missing' ? path.join(f.root, 'missing') : driver === 'directory' ? f.bin : driver;
  await assert.rejects(f.run('build', [], { env: { ...f.env, npm_execpath } }).running, /driver|ENOENT/);
  assert.deepEqual(f.observations, []); assert.deepEqual(await f.records(), []);
  await assert.rejects(fs.lstat(path.join(f.worktree, '.t3')), { code: 'ENOENT' });
});

for (const key of ['build:electron', 'build:preview-agent', 'test']) test(`${key} needs no npm driver`, async t => {
  const f = await fixture(t);
  assert.equal((await f.run(key, [], { env: { ...f.env, npm_execpath: 'unproved/driver' } }).running).code, 0);
  assert.equal(f.observations.some(o => o.phase === 'npm-driver'), false);
  await f.cleaned(await f.records());
});

test('undeclared output/config/root and unknown arguments refuse before admission or launch', async t => {
  const f = await fixture(t);
  for (const key of Object.keys(expected)) for (const args of [
    ['--outDir', '/outside'], ['--config=other.ts'], ['--root', '/outside'], ['--coverage'],
    ['--outputFile', '/outside/report'], ['--cacheDir=elsewhere'], ['--watch'], ['../outside'],
  ]) await assert.rejects(f.run(key, args).running, /Argument cannot be admitted/);
  assert.deepEqual(f.observations, []); assert.deepEqual(await f.records(), []);
  await assert.rejects(fs.lstat(path.join(f.worktree, '.t3')), { code: 'ENOENT' });
});

for (const available of [NaN, 1024]) test(`no-start at ${Number.isNaN(available) ? 'unknown' : 'low'} capacity`, async t => {
  const f = await fixture(t); f.state.available = available;
  await assert.rejects(f.run('test').running, /capacity|Storage refused/);
  assert.deepEqual(await f.records(), []);
  await assert.rejects(fs.lstat(path.join(f.worktree, '.t3')), { code: 'ENOENT' });
  if (!Number.isNaN(available)) assert.equal(f.observations[0].filesystems[0].availableBytes, available);
});

test('short-circuits the first failed leaf and cleans only its unique scratch', async t => {
  const f = await fixture(t);
  const result = await f.run('build', [], { env: { ...f.env, FAKE_FAIL_TOOL: 'vite' } }).running;
  assert.equal(result.code, 7); assert.equal(result.signal, null);
  const rows = await f.records(); assert.deepEqual(rows.map(r => r.tool), ['npm', 'vite']);
  await f.cleaned(rows);
});

test('live-leaf cancellation forwards the signal before exact scratch and lock cleanup', async t => {
  const f = await fixture(t);
  const operation = f.run('build:preview-agent', [], { env: { ...f.env, FAKE_WAIT_TOOL: 'vite' } });
  const deadline = Date.now() + 5000;
  while (!(await f.records()).some(r => r.ready)) {
    if (Date.now() > deadline) throw new Error('Fake CLI did not become ready');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  operation.controller.abort(Object.assign(new Error('synthetic cancellation'), { signal: 'SIGTERM' }));
  const result = await operation.running;
  assert.equal(result.signal, 'SIGTERM');
  const rows = await f.records(); assert.ok(rows.some(r => r.signal === 'SIGTERM'));
  await f.cleaned(rows);
});

test('foreign/stale lock refuses without a leaf, eviction or invocation scratch', async t => {
  const f = await fixture(t);
  const lock = path.join(f.worktree, LOCK_NAME);
  await fs.writeFile(lock, 'synthetic retained owner', { mode: 0o600 });
  await assert.rejects(f.run('test').running, /Lock deadline/);
  assert.equal(await fs.readFile(lock, 'utf8'), 'synthetic retained owner');
  assert.deepEqual(await f.records(), []);
  assert.deepEqual(await fs.readdir(path.join(f.worktree, '.t3/storage-command-scratch')), []);
});

test('worktree tool symlinks cannot select an executable outside the admitted worktree', async t => {
  const f = await fixture(t);
  await fs.unlink(path.join(f.bin, 'vite'));
  const external = path.join(f.root, 'outside.mjs'); await fs.writeFile(external, fakeCli);
  await fs.symlink(external, path.join(f.bin, 'vite'));
  await assert.rejects(f.run('test').running, /Unsafe worktree tool/);
  assert.deepEqual(await f.records(), []);
  await assert.rejects(fs.lstat(path.join(f.worktree, '.t3')), { code: 'ENOENT' });
});

// Frozen b737d7be non-wrapped scripts. The package graph deliberately duplicates
// the four authored chains; unrelated script drift must not hide in this slice.
const golden = {
  "dev": "npm run build:electron && concurrently --kill-others --success first \"npm run dev:web\" \"wait-on tcp:127.0.0.1:5173 && cross-env HQ_DEV_SERVER_URL=http://127.0.0.1:5173 electron apps/desktop/dist-electron/main.js\"",
  "dev:web": "vite --config apps/desktop/vite.config.ts",
  "typecheck": "tsc --noEmit && tsc -p apps/desktop/tsconfig.electron.json --noEmit && tsc -p apps/desktop/tsconfig.design-host.json --noEmit && tsc -p apps/desktop/tsconfig.wiki-host.json --noEmit && npm run typecheck --workspace @hq/wiki",
  "start": "electron apps/desktop/dist-electron/main.js",
  "preview": "vite preview --config apps/desktop/vite.config.ts --host 127.0.0.1 --port 4173 --strictPort"
};
test('package command strings and all other script values match the bound base contract', async () => {
  const pkg = JSON.parse(await fs.readFile(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'));
  const wrapped = ['build', 'build:electron', 'build:preview-agent', 'test'];
  assert.deepEqual(Object.fromEntries(Object.entries(pkg.scripts).filter(([key]) => !wrapped.includes(key))), golden);
  for (const key of wrapped) assert.equal(pkg.scripts[key], `node tools/storage/commands.mjs ${key}`);
});
