import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { PrerequisiteError, checkPrerequisites, desktopMain, desktopRenderer, electronBinary, findExecutable, formatProblems, quote } from '../prereq.mjs';

let root;
before(async () => { root = await mkdtemp(join(tmpdir(), 'hq-dev-preview-test-')); });
after(async () => { await rm(root, { recursive: true, force: true }); });

async function fakeRepo(name, parts = {}) {
  const repo = join(root, name);
  await mkdir(repo, { recursive: true });
  const put = async (path, mode = 0o644) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, ''); await chmod(path, mode); };
  if (parts.electronPackage) await put(join(repo, 'node_modules/electron/package.json'));
  if (parts.binary) await put(electronBinary(repo), 0o755);
  if (parts.build) { await put(desktopMain(repo)); await put(desktopRenderer(repo)); }
  return repo;
}
async function fakeTools(name, tools) {
  const bin = join(root, name);
  await mkdir(bin, { recursive: true });
  for (const tool of tools) { await writeFile(join(bin, tool), '#!/bin/sh\n'); await chmod(join(bin, tool), 0o755); }
  return bin;
}
const check = (repo, options) => checkPrerequisites(repo, { platform: 'linux', ...options });
const codes = problems => problems.map(problem => problem.code);

test('a bare checkout is told to install dependencies, with the exact command', async () => {
  const repo = await fakeRepo('bare');
  const bin = await fakeTools('bin-all', ['Xvfb', 'bwrap']);
  const problems = await check(repo, { searchPath: bin });
  assert.deepEqual(codes(problems), ['dependencies', 'build']);
  assert.equal(problems[0].fix, `cd ${repo} && npm ci --ignore-scripts --no-audit --no-fund`);
  assert.equal(problems[1].fix, `cd ${repo} && npm run build`);
});

test('a missing Electron binary prints the install command and the flag', async () => {
  const repo = await fakeRepo('no-binary', { electronPackage: true, build: true });
  const bin = await fakeTools('bin-all', ['Xvfb', 'bwrap']);
  const problems = await check(repo, { searchPath: bin });
  assert.deepEqual(codes(problems), ['electron-binary']);
  assert.match(problems[0].message, /npm ci --ignore-scripts skips Electron's download/);
  assert.match(problems[0].message, new RegExp(electronBinary(repo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(problems[0].fix.includes('node node_modules/electron/install.js'));
  assert.ok(problems[0].fix.includes('--install-electron'));
});

test('a binary that is not executable counts as missing', async () => {
  const repo = await fakeRepo('not-executable', { electronPackage: true, build: true });
  await mkdir(join(repo, 'node_modules/electron/dist'), { recursive: true });
  await writeFile(electronBinary(repo), '');
  await chmod(electronBinary(repo), 0o644);
  const bin = await fakeTools('bin-all', ['Xvfb', 'bwrap']);
  assert.deepEqual(codes(await check(repo, { searchPath: bin })), ['electron-binary']);
});

test('a complete checkout with the host tools has no problems', async () => {
  const repo = await fakeRepo('complete', { electronPackage: true, binary: true, build: true });
  const bin = await fakeTools('bin-all', ['Xvfb', 'bwrap']);
  assert.deepEqual(await check(repo, { searchPath: bin }), []);
});

test('missing host tools are reported without a fix we could run, and live mode also needs python3', async () => {
  const repo = await fakeRepo('complete', { electronPackage: true, binary: true, build: true });
  const none = await fakeTools('bin-none', []);
  const problems = await check(repo, { searchPath: none });
  assert.deepEqual(codes(problems), ['tool-xvfb', 'tool-bwrap']);
  assert.ok(problems.every(problem => problem.fix === null));
  const live = await check(repo, { mode: 'live', searchPath: none });
  assert.deepEqual(codes(live), ['tool-xvfb', 'tool-bwrap', 'tool-python3']);
  const withoutPython = await fakeTools('bin-no-python', ['Xvfb', 'bwrap']);
  assert.deepEqual(codes(await check(repo, { mode: 'example', searchPath: withoutPython })), []);
});

test('other platforms stop immediately with one explanation', async () => {
  const repo = await fakeRepo('complete', { electronPackage: true, binary: true, build: true });
  const problems = await check(repo, { platform: 'darwin' });
  assert.deepEqual(codes(problems), ['platform']);
  assert.match(problems[0].message, /Linux only/);
});

test('fix commands quote paths that need it', async () => {
  assert.equal(quote('/home/a/b-c_d.e'), '/home/a/b-c_d.e');
  assert.equal(quote('/home/a b/c'), "'/home/a b/c'");
  assert.equal(quote("/it's"), "'/it'\\''s'");
  const repo = await fakeRepo('has space');
  const [problem] = await check(repo, { searchPath: await fakeTools('bin-all', ['Xvfb', 'bwrap']) });
  assert.ok(problem.fix.startsWith(`cd '${repo}' && `));
});

test('findExecutable searches the given path only for executable files', async () => {
  const bin = await fakeTools('bin-find', ['tool-a']);
  await writeFile(join(bin, 'plain'), '');
  assert.equal(await findExecutable('tool-a', bin), join(bin, 'tool-a'));
  assert.equal(await findExecutable('plain', bin), null);
  assert.equal(await findExecutable('absent', bin), null);
  assert.equal(await findExecutable('tool-a', ''), null);
});

test('PrerequisiteError lists every problem and its fix', () => {
  const error = new PrerequisiteError([{ code: 'a', message: 'first', fix: 'do this' }, { code: 'b', message: 'second', fix: null }]);
  assert.equal(error.name, 'PrerequisiteError');
  assert.equal(error.message, 'Cannot start a dev-preview session:\n- first\n    fix: do this\n- second');
  assert.equal(formatProblems([]), '');
});
