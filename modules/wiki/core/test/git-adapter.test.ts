// The Node Git adapter against real synthetic bare repositories. Every repository lives in task-owned
// scratch outside /tmp and is removed exactly, on success and on failure.

import assert from 'node:assert/strict';
import { execFile, execFileSync, spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { MAX_PAGE_BLOB_BYTES } from '../../contract/src/index.ts';
import { createMemoryIndexStore, createNodeGitObjectSource as createSource, createWikiHost, parseLsTree, type GitExec, type GitExecOptions, type NodeGitOptions, type SourceResult } from '../src/index.ts';
import type { GitBatchChild, GitSpawn, GitSpawnOptions, NodeGitObjectSource } from '../src/node-git-source.ts';
import { createScratch, type Scratch } from './scratch.ts';
import { REMOTE, clock, createBareRepo, fingerprintTree, isolatedGitEnv, must, profileFor, writeExecutable } from './support.ts';

let scratch: Scratch;
const opened: NodeGitObjectSource[] = [];
/** Every source this file creates is closed afterwards, so no batch child outlives the tests. */
const createNodeGitObjectSource = (profileInput: unknown, options?: NodeGitOptions): NodeGitObjectSource => {
  const source = createSource(profileInput, options);
  opened.push(source);
  return source;
};
before(() => {
  scratch = createScratch('git-adapter');
});
after(async () => {
  for (const source of opened.splice(0)) await source.close();
  scratch.cleanup();
});

let counter = 0;
function repo(files: Parameters<typeof createBareRepo>[2]['files'], extra: Partial<Parameters<typeof createBareRepo>[2]> = {}) {
  return createBareRepo(scratch.root, `r${counter++}`, { files, ...extra });
}

function profile(gitDir: string, overrides: Record<string, unknown> = {}) {
  return profileFor('bl', { gitDir, ...overrides });
}

interface Call {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: GitExecOptions;
}

function recorder(): { exec: GitExec; calls: Call[]; inFlight: { max: number } } {
  const calls: Call[] = [];
  const inFlight = { max: 0 };
  let running = 0;
  const exec: GitExec = (file, args, options, callback) => {
    calls.push({ file, args: [...args], options });
    running++;
    inFlight.max = Math.max(inFlight.max, running);
    return (execFile as unknown as (...a: unknown[]) => { stdin?: { end(): void } })(file, args, options, (...rest: unknown[]) => {
      running--;
      (callback as unknown as (...a: unknown[]) => void)(...rest);
    });
  };
  return { exec, calls, inFlight };
}

interface SpawnCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly options: GitSpawnOptions;
  /** Every string written to the child's stdin, in order. */
  readonly writes: string[];
  readonly child: ChildProcess;
  ended: boolean;
  exited: boolean;
  /** Resolves when the child's stdio closed. */
  readonly closed: Promise<void>;
}

/** The spawn seam wrapped around the real `spawn`, recording each batch child and what is written to it. */
function spawnRecorder(): { spawn: GitSpawn; spawns: SpawnCall[] } {
  const spawns: SpawnCall[] = [];
  const spawn: GitSpawn = (file, args, options) => {
    const child = nodeSpawn(file, args, options);
    const call: SpawnCall = { file, args: [...args], options, writes: [], child, ended: false, exited: false, closed: new Promise((resolve) => child.once('close', () => resolve())) };
    child.once('close', () => (call.exited = true));
    const write = child.stdin.write.bind(child.stdin) as (chunk: string, ...rest: unknown[]) => boolean;
    child.stdin.write = ((chunk: string, ...rest: unknown[]) => {
      call.writes.push(String(chunk));
      return write(chunk, ...rest);
    }) as typeof child.stdin.write;
    const end = child.stdin.end.bind(child.stdin) as () => typeof child.stdin;
    child.stdin.end = (() => {
      call.ended = true;
      return end();
    }) as typeof child.stdin.end;
    spawns.push(call);
    return child;
  };
  return { spawn, spawns };
}

/** Wait for a promise, failing the test instead of hanging when it does not settle. */
async function within<T>(ms: number, promise: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(`timed out: ${label}`)), ms)))]);
  } finally {
    clearTimeout(timer);
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function gone(pid: number): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    if (!alive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/** A reproducible byte string that is not text: it contains NULs and every byte value. */
function noise(length: number, seed: number): Buffer {
  const out = Buffer.alloc(length);
  let state = seed >>> 0;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

/**
 * A stand-in git for the batch child. Its first `cat-file --batch` launch runs `firstLaunch` (shell; the
 * requested object id is `$oid` after the script reads it); every other invocation, including later batch
 * launches, is the real git. The pid of the first launch is written to `pidFile`.
 */
function scriptedGit(firstLaunch: string): { executable: string; pidFile: string } {
  const dir = join(scratch.root, `fake${counter++}`);
  mkdirSync(dir);
  const state = join(dir, 'state');
  const pidFile = join(dir, 'pid');
  const executable = join(dir, 'fake-git');
  writeExecutable(
    executable,
    `#!/bin/sh
case "$*" in
  *cat-file*--batch*)
    if [ ! -e '${state}' ]; then
      : > '${state}'
      echo $$ > '${pidFile}'
      ${firstLaunch}
    fi
    ;;
esac
exec git "$@"
`,
  );
  return { executable, pidFile };
}

const HEX = '(?:[0-9a-f]{40}|[0-9a-f]{64})';

describe('plumbing results', () => {
  const content = {
    readme: '# Home\n\nSee [guide](guide/intro.md).\n',
    intro: '---\ntitle: Intro\n---\n# Intro\n',
  };
  const fixture = () =>
    repo([
      { path: 'README.md', content: content.readme },
      { path: 'guide/intro.md', content: content.intro },
      { path: 'guide/run.sh', content: '#!/bin/sh\n', mode: '100755' },
      { path: 'link.md', content: 'README.md', mode: '120000' },
      { path: 'empty.md', content: '' },
    ], { gitlinks: ['vendor/sub'] });

  test('resolvePin returns ref, commit and UTC commit time after binding checks', async () => {
    const r = fixture();
    const source = createNodeGitObjectSource(profile(r.gitDir));
    assert.deepEqual(await source.resolvePin(), { ok: true, value: { ref: 'main', commit: r.commit, commitTime: '2026-01-02T03:04:05Z' } });
  });

  test('listTree returns path/mode/oid/size and skips and counts symlinks and submodules', async () => {
    const r = fixture();
    const source = createNodeGitObjectSource(profile(r.gitDir));
    const listing = await source.listTree(r.commit);
    assert.equal(listing.ok, true);
    if (!listing.ok) return;
    const byPath = Object.fromEntries(listing.value.entries.map((e) => [e.path, e]));
    assert.deepEqual(Object.keys(byPath).sort(), ['README.md', 'empty.md', 'guide/intro.md', 'guide/run.sh']);
    assert.equal(byPath['README.md']?.size, Buffer.byteLength(content.readme));
    assert.equal(byPath['guide/run.sh']?.mode, '100755');
    assert.equal(byPath['empty.md']?.size, 0);
    assert.match(byPath['README.md']?.oid ?? '', /^[0-9a-f]{40}$/);
    assert.deepEqual(listing.value.skipped, { symlinks: 1, submodules: 1, other: 0, invalidPaths: 0 });
  });

  test('readBlob returns exact bytes, enforces maxBytes inclusively and never truncates', async () => {
    const r = fixture();
    const source = createNodeGitObjectSource(profile(r.gitDir));
    const listed = await source.listTree(r.commit);
    assert.ok(listed.ok);
    if (!listed.ok) return;
    const listing = listed.value;
    const readme = listing.entries.find((e) => e.path === 'README.md');
    assert.ok(readme);
    const whole = await source.readBlob(readme.oid, MAX_PAGE_BLOB_BYTES);
    assert.equal(whole.ok && Buffer.from(whole.value).toString('utf8'), content.readme);
    const exact = await source.readBlob(readme.oid, readme.size as number);
    assert.equal(exact.ok, true);
    assert.deepEqual(await source.readBlob(readme.oid, (readme.size as number) - 1), { ok: false, reason: 'too-large' });
    assert.deepEqual(await source.readBlob(readme.oid, 0), { ok: false, reason: 'too-large' });
    const empty = listing.entries.find((e) => e.path === 'empty.md');
    const emptyBlob = await source.readBlob(empty?.oid as string, 0);
    assert.equal(emptyBlob.ok && emptyBlob.value.length, 0);
  });

  test('a missing object is not-found; malformed ids and sizes never reach Git', async () => {
    const r = fixture();
    const { exec, calls } = recorder();
    const source = createNodeGitObjectSource(profile(r.gitDir), { exec });
    assert.deepEqual(await source.readBlob('0'.repeat(40), 1000), { ok: false, reason: 'not-found' });
    const before = calls.length;
    for (const oid of ['', 'abc', 'G'.repeat(40), '-p', '--help', 'A'.repeat(40), 'a'.repeat(41)]) {
      assert.deepEqual(await source.readBlob(oid, 1000), { ok: false, reason: 'unavailable' }, oid);
      assert.equal((await source.listTree(oid)).ok, false);
    }
    assert.deepEqual(await source.readBlob('a'.repeat(40), -1), { ok: false, reason: 'unavailable' });
    assert.equal(calls.length, before, 'invalid ids were rejected without starting a process');
  });

  test('a large blob over the cap is refused, not truncated', async () => {
    const big = Buffer.alloc(MAX_PAGE_BLOB_BYTES + 1, 0x61);
    const r = repo([{ path: 'big.md', content: big }, { path: 'ok.md', content: Buffer.alloc(MAX_PAGE_BLOB_BYTES, 0x62) }]);
    const source = createNodeGitObjectSource(profile(r.gitDir));
    const listing = await source.listTree(r.commit);
    assert.ok(listing.ok);
    if (!listing.ok) return;
    const find = (name: string) => listing.value.entries.find((e) => e.path === name);
    assert.equal(find('big.md')?.size, MAX_PAGE_BLOB_BYTES + 1);
    assert.deepEqual(await source.readBlob(find('big.md')?.oid as string, MAX_PAGE_BLOB_BYTES), { ok: false, reason: 'too-large' });
    assert.deepEqual(await source.readBlob(find('big.md')?.oid as string, 10 * MAX_PAGE_BLOB_BYTES), { ok: false, reason: 'too-large' }, 'a caller cannot raise the cap');
    const ok = await source.readBlob(find('ok.md')?.oid as string, MAX_PAGE_BLOB_BYTES);
    assert.equal(ok.ok && ok.value.length, MAX_PAGE_BLOB_BYTES);
  });

  test('ls-tree output parsing skips invalid UTF-8 paths and odd records, and counts them', () => {
    const oid = 'a'.repeat(40);
    const record = (meta: string, path: Buffer) => Buffer.concat([Buffer.from(`${meta}\t`), path, Buffer.from([0])]);
    const output = Buffer.concat([
      record(`100644 blob ${oid}      12`, Buffer.from('ok.md')),
      record(`100644 blob ${oid}      12`, Buffer.from([0x62, 0xff, 0x2e, 0x6d, 0x64])),
      record(`120000 blob ${oid}       3`, Buffer.from('link.md')),
      record(`160000 commit ${oid}       -`, Buffer.from('sub')),
      record('040000 tree xyz       -', Buffer.from('dir')),
      Buffer.from('garbage-without-tab\0'),
      record(`100644 blob ${oid}      -1`, Buffer.from('neg.md')),
    ]);
    const listing = parseLsTree(output);
    assert.deepEqual(listing.entries.map((e) => e.path), ['ok.md']);
    assert.deepEqual(listing.skipped, { symlinks: 1, submodules: 1, other: 3, invalidPaths: 1 });
  });

  test('a tree listing larger than the output bound is reported, not truncated', async () => {
    const r = fixture();
    const source = createNodeGitObjectSource(profile(r.gitDir), { maxTreeBytes: 40 });
    assert.deepEqual(await source.listTree(r.commit), { ok: false, reason: 'too-large' });
  });
});

describe('fixed argv, minimal environment, no shell', () => {
  const ENV_KEYS = ['GIT_ATTR_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_SYSTEM', 'GIT_NO_LAZY_FETCH', 'GIT_NO_REPLACE_OBJECTS', 'GIT_OPTIONAL_LOCKS', 'GIT_TERMINAL_PROMPT', 'LC_ALL', 'PATH'];

  test('every process is a fixed Git plumbing command with the mandatory prefix and a bare minimal environment', async () => {
    const r = repo([{ path: 'a.md', content: '# A' }]);
    const real = realpathSync(r.gitDir);
    const { exec, calls } = recorder();
    const { spawn, spawns } = spawnRecorder();
    const source = createNodeGitObjectSource(profile(r.gitDir), { exec, spawn });
    const pin = await source.resolvePin();
    assert.ok(pin.ok);
    if (!pin.ok) return;
    const listing = await source.listTree(pin.value.commit);
    assert.ok(listing.ok);
    if (!listing.ok) return;
    const oid = listing.value.entries[0]?.oid as string;
    assert.equal((await source.readBlob(oid, 1024)).ok, true);

    const prefix = [`--git-dir=${real}`, '--no-replace-objects', '--literal-pathspecs', '-c', 'core.fsmonitor=false'];
    const allowed = [
      /^rev-parse --is-bare-repository$/,
      /^config --get remote\.origin\.url$/,
      /^rev-parse --verify --end-of-options refs\/heads\/main\^\{commit\}$/,
      new RegExp(`^show -s --no-show-signature --format=%ct --end-of-options ${HEX}$`),
      new RegExp(`^ls-tree -r -z -l --full-tree ${HEX}$`),
    ];
    assert.equal(calls.length, 5, 'four pin commands and one tree listing; a blob read starts no one-shot process');
    for (const call of calls) {
      assert.equal(call.file, 'git');
      assert.deepEqual(call.args.slice(0, prefix.length), prefix);
      const rest = call.args.slice(prefix.length).join(' ');
      assert.ok(
        allowed.some((pattern) => pattern.test(rest)),
        `unexpected command: ${rest}`,
      );
      assert.equal(call.options.shell, false);
      assert.equal(call.options.encoding, 'buffer');
      assert.equal(call.options.killSignal, 'SIGKILL');
      assert.ok(call.options.timeout > 0 && call.options.timeout <= 60_000);
      assert.ok(call.options.maxBuffer > 0 && call.options.maxBuffer <= 64 * 1024 * 1024);
      assert.equal(call.options.cwd, real);
      assert.deepEqual(Object.keys(call.options.env).sort(), [...ENV_KEYS].sort());
      assert.equal(call.options.env['GIT_TERMINAL_PROMPT'], '0');
      assert.equal(call.options.env['GIT_OPTIONAL_LOCKS'], '0');
      assert.equal(call.options.env['GIT_CONFIG_GLOBAL'], '/dev/null');
      assert.equal(call.options.env['GIT_CONFIG_NOSYSTEM'], '1');
    }
    const subcommands = new Set(calls.map((c) => c.args[prefix.length]));
    assert.deepEqual([...subcommands].sort(), ['config', 'ls-tree', 'rev-parse', 'show']);

    // Blobs are served by exactly one persistent child with the same prefix, environment and no shell.
    assert.equal(spawns.length, 1);
    const batch = spawns[0] as SpawnCall;
    assert.equal(batch.file, 'git');
    assert.deepEqual(batch.args, [...prefix, 'cat-file', '--batch']);
    assert.equal(batch.options.shell, false);
    assert.equal(batch.options.windowsHide, true);
    assert.deepEqual(batch.options.stdio, ['pipe', 'pipe', 'ignore']);
    assert.equal(batch.options.cwd, real);
    assert.deepEqual(Object.keys(batch.options.env).sort(), [...ENV_KEYS].sort());
    assert.equal(batch.options.env['GIT_TERMINAL_PROMPT'], '0');
    assert.equal(batch.options.env['GIT_OPTIONAL_LOCKS'], '0');
    assert.equal(batch.options.env['GIT_CONFIG_GLOBAL'], '/dev/null');
    assert.equal(batch.options.env['GIT_CONFIG_NOSYSTEM'], '1');
    assert.deepEqual(batch.writes, [`${oid}\n`], 'stdin only ever receives a validated object id and a line feed');
  });

  test('inherited GIT_* variables and hostile repository configuration have no effect', async () => {
    const r = repo([{ path: 'a.md', content: 'original' }]);
    const marker = join(scratch.root, 'fsmonitor-ran');
    const hook = join(scratch.root, 'hook.sh');
    writeExecutable(hook, `#!/bin/sh\necho ran >> '${marker}'\nexit 0\n`);
    execFileSync('git', [`--git-dir=${r.gitDir}`, 'config', 'core.fsmonitor', hook], { env: isolatedGitEnv() });
    execFileSync('git', [`--git-dir=${r.gitDir}`, 'config', 'core.pager', hook], { env: isolatedGitEnv() });
    execFileSync('git', [`--git-dir=${r.gitDir}`, 'config', 'alias.cat-file', `!${hook}`], { env: isolatedGitEnv() });

    const saved = { ...process.env };
    Object.assign(process.env, {
      GIT_DIR: '/nonexistent/other.git',
      GIT_WORK_TREE: scratch.root,
      GIT_INDEX_FILE: join(scratch.root, 'index-poison'),
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.fsmonitor',
      GIT_CONFIG_VALUE_0: hook,
      GIT_EXTERNAL_DIFF: hook,
      GIT_PAGER: hook,
      GIT_ALLOW_PROTOCOL: 'ext',
      GIT_SSH_COMMAND: hook,
    });
    try {
      const source = createNodeGitObjectSource(profile(r.gitDir));
      const pin = await source.resolvePin();
      assert.ok(pin.ok);
      if (!pin.ok) return;
      const listing = await source.listTree(pin.value.commit);
      assert.ok(listing.ok);
      if (!listing.ok) return;
      const blob = await source.readBlob(listing.value.entries[0]?.oid as string, 100);
      assert.equal(blob.ok && Buffer.from(blob.value).toString(), 'original');
    } finally {
      for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
      Object.assign(process.env, saved);
    }
    assert.equal(existsSync(marker), false, 'no repository hook, monitor or alias was executed');
    assert.equal(existsSync(join(scratch.root, 'index-poison')), false);
  });

  test('a signed tip with repository log.showSignature never starts its gpg.program', async () => {
    const r = repo([{ path: 'a.md', content: 'signed' }]);
    const marker = join(scratch.root, 'gpg-ran');
    const program = join(scratch.root, 'gpg.sh');
    writeExecutable(program, `#!/bin/sh\necho ran >> '${marker}'\nexit 1\n`);
    const tree = execFileSync('git', [`--git-dir=${r.gitDir}`, 'rev-parse', `${r.commit}^{tree}`], { env: isolatedGitEnv(), encoding: 'utf8' }).trim();
    const object = [
      `tree ${tree}`,
      'author a <a@example.invalid> 1700000000 +0000',
      'committer a <a@example.invalid> 1700000000 +0000',
      'gpgsig -----BEGIN PGP SIGNATURE-----',
      ' ',
      ' c2lnbmF0dXJl',
      ' -----END PGP SIGNATURE-----',
      '',
      'signed',
      '',
    ].join('\n');
    const signed = execFileSync('git', [`--git-dir=${r.gitDir}`, 'hash-object', '-w', '-t', 'commit', '--stdin'], { env: isolatedGitEnv(), input: object, encoding: 'utf8' }).trim();
    execFileSync('git', [`--git-dir=${r.gitDir}`, 'update-ref', 'refs/heads/main', signed], { env: isolatedGitEnv() });
    execFileSync('git', [`--git-dir=${r.gitDir}`, 'config', 'log.showSignature', 'true'], { env: isolatedGitEnv() });
    execFileSync('git', [`--git-dir=${r.gitDir}`, 'config', 'gpg.program', program], { env: isolatedGitEnv() });

    const pin = await createNodeGitObjectSource(profile(r.gitDir)).resolvePin();
    assert.ok(pin.ok);
    assert.equal(pin.ok && pin.value.commit, signed);
    assert.equal(pin.ok && pin.value.commitTime, '2023-11-14T22:13:20Z');
    assert.equal(existsSync(marker), false, 'the repository gpg.program was not executed');
  });

  test('replacement refs cannot substitute page content (--no-replace-objects)', async () => {
    const r = repo([{ path: 'a.md', content: 'original content' }]);
    const env = isolatedGitEnv();
    const replacement = execFileSync('git', [`--git-dir=${r.gitDir}`, 'hash-object', '-w', '--stdin'], { env, input: 'REPLACED content!' }).toString().trim();
    const original = execFileSync('git', [`--git-dir=${r.gitDir}`, 'rev-parse', `${r.commit}:a.md`], { env }).toString().trim();
    execFileSync('git', [`--git-dir=${r.gitDir}`, 'replace', original, replacement], { env });
    assert.equal(execFileSync('git', [`--git-dir=${r.gitDir}`, 'cat-file', 'blob', original], { env }).toString(), 'REPLACED content!', 'the replacement is active for plain git');
    const source = createNodeGitObjectSource(profile(r.gitDir));
    const blob = await source.readBlob(original, 1000);
    assert.equal(blob.ok && Buffer.from(blob.value).toString(), 'original content');
  });

  test('one-shot concurrency is bounded and blob reads never start one-shot processes', async () => {
    const r = repo([{ path: 'a.md', content: 'x' }]);
    const { exec, calls, inFlight } = recorder();
    const { spawn, spawns } = spawnRecorder();
    const source = createNodeGitObjectSource(profile(r.gitDir), { exec, spawn, concurrency: 2 });
    const pin = await source.resolvePin();
    assert.ok(pin.ok);
    if (!pin.ok) return;
    const listing = await source.listTree(pin.value.commit);
    assert.ok(listing.ok);
    if (!listing.ok) return;
    const oid = listing.value.entries[0]?.oid as string;

    // The blob read used to be one one-shot process per page; it now shares one child outside the semaphore.
    const before = calls.length;
    inFlight.max = 0;
    const results = await Promise.all(Array.from({ length: 12 }, () => source.readBlob(oid, 10)));
    assert.ok(results.every((result) => result.ok));
    assert.equal(calls.length, before, 'no one-shot process for any of the 12 blob reads');
    assert.equal(spawns.length, 1, 'one batch child served them all');

    // The remaining commands still obey the semaphore.
    inFlight.max = 0;
    const pins = await Promise.all(Array.from({ length: 12 }, () => source.resolvePin()));
    assert.ok(pins.every((result) => result.ok));
    assert.ok(inFlight.max >= 1 && inFlight.max <= 2, `max in flight ${inFlight.max}`);
  });
});

describe('binding checks', () => {
  const files = [{ path: 'a.md', content: '# A' }];

  test('wrong, missing or look-alike remotes are unavailable', async () => {
    const ok = repo(files);
    assert.equal((await createNodeGitObjectSource(profile(ok.gitDir)).resolvePin()).ok, true);
    assert.equal((await createNodeGitObjectSource(profile(ok.gitDir, { expectedRemote: 'https://example.invalid/other.git' })).resolvePin()).ok, false);
    assert.equal((await createNodeGitObjectSource(profile(ok.gitDir, { expectedRemote: `${REMOTE}/` })).resolvePin()).ok, false, 'exact match only');
    assert.equal((await createNodeGitObjectSource(profile(ok.gitDir, { expectedRemote: REMOTE.toUpperCase() })).resolvePin()).ok, false);
    const noRemote = repo(files, { remote: null });
    assert.deepEqual(await createNodeGitObjectSource(profile(noRemote.gitDir)).resolvePin(), { ok: false, reason: 'unavailable' });
  });

  test('a non-bare repository is unavailable even with the right remote and ref', async () => {
    const work = join(scratch.root, `work${counter++}`);
    mkdirSync(work);
    const env = isolatedGitEnv();
    execFileSync('git', ['init', '--quiet', '--initial-branch=main', work], { env });
    execFileSync('git', ['-C', work, 'config', 'remote.origin.url', REMOTE], { env });
    writeFileSync(join(work, 'a.md'), '# A');
    execFileSync('git', ['-C', work, 'add', '.'], { env });
    execFileSync('git', ['-C', work, 'commit', '--quiet', '-m', 'x'], { env });
    assert.deepEqual(await createNodeGitObjectSource(profile(join(work, '.git'))).resolvePin(), { ok: false, reason: 'unavailable' });
    assert.deepEqual(await createNodeGitObjectSource(profile(work)).resolvePin(), { ok: false, reason: 'unavailable' });
  });

  test('a missing ref, a tag-only name and an unrelated branch are unavailable', async () => {
    const r = repo(files, { branch: 'trunk' });
    execFileSync('git', [`--git-dir=${r.gitDir}`, 'tag', 'v1', r.commit], { env: isolatedGitEnv() });
    assert.equal((await createNodeGitObjectSource(profile(r.gitDir, { ref: 'main' })).resolvePin()).ok, false);
    assert.equal((await createNodeGitObjectSource(profile(r.gitDir, { ref: 'v1' })).resolvePin()).ok, false, 'only refs/heads is consulted');
    assert.equal((await createNodeGitObjectSource(profile(r.gitDir, { ref: 'trunk' })).resolvePin()).ok, true);
    assert.equal((await createNodeGitObjectSource(profile(r.gitDir, { ref: 'trunk' })).listTree('b'.repeat(40))).ok, false, 'an unknown commit is unavailable');
  });

  test('a missing, non-directory or unreadable git directory is unavailable', async () => {
    const r = repo(files);
    const file = join(scratch.root, `file${counter++}`);
    writeFileSync(file, 'not a repo');
    for (const gitDir of [join(scratch.root, 'does-not-exist.git'), file, scratch.root]) {
      assert.deepEqual(await createNodeGitObjectSource(profile(gitDir)).resolvePin(), { ok: false, reason: 'unavailable' });
    }
    assert.equal(r.commit.length, 40);
  });

  test('the configured directory is resolved to its real path before use', async () => {
    const r = repo(files);
    const alias = join(scratch.root, `alias${counter++}.git`);
    symlinkSync(r.gitDir, alias);
    const { exec, calls } = recorder();
    const source = createNodeGitObjectSource(profile(alias), { exec });
    assert.equal((await source.resolvePin()).ok, true);
    assert.equal(calls[0]?.args[0], `--git-dir=${realpathSync(r.gitDir)}`);
  });

  test('a missing git executable and an invalid profile are handled', async () => {
    const r = repo(files);
    assert.deepEqual(await createNodeGitObjectSource(profile(r.gitDir), { gitExecutable: join(scratch.root, 'no-such-git') }).resolvePin(), { ok: false, reason: 'unavailable' });
    assert.throws(() => createNodeGitObjectSource(profile(r.gitDir, { ref: '--upload-pack=x' })), /invalid source profile/);
    assert.throws(() => createNodeGitObjectSource(null), /invalid source profile/);
  });

  test('a command that exceeds its timeout is killed and reported unavailable', async () => {
    const r = repo(files);
    const pidFile = join(scratch.root, `pid${counter++}`);
    const fake = join(scratch.root, `slow-git${counter++}`);
    writeExecutable(fake, `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 30\n`);
    const started = Date.now();
    const source = createNodeGitObjectSource(profile(r.gitDir), { gitExecutable: fake, commandTimeoutMs: 300 });
    assert.deepEqual(await source.resolvePin(), { ok: false, reason: 'unavailable' });
    assert.ok(Date.now() - started < 5000);
    const pid = Number(readFileSync(pidFile, 'utf8').trim());
    let alive = true;
    for (let i = 0; i < 50 && alive; i++) {
      try {
        process.kill(pid, 0);
        await new Promise((resolve) => setTimeout(resolve, 50));
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false, 'the timed-out process was killed');
  });
});

describe('batched blob reads against real Git', () => {
  const oracle = (gitDir: string, oid: string): Buffer => execFileSync('git', [`--git-dir=${gitDir}`, 'cat-file', 'blob', oid], { env: isolatedGitEnv(), maxBuffer: 16 * 1024 * 1024 });
  const sizes = [0, 1, 2, 255, 4096, 65_535, 65_536, 65_537, 200_000, 1_048_576, MAX_PAGE_BLOB_BYTES];

  test('every blob is byte-identical to cat-file blob: sizes, empty, binary with NULs, header look-alikes', async () => {
    const files = sizes.map((size, index) => ({ path: `size-${size}.md`, content: noise(size, index + 1) }));
    files.push({ path: 'text-lf.md', content: Buffer.from('line one\nline two\n\n') });
    files.push({ path: 'looks-like-header.md', content: Buffer.from(`${'a'.repeat(40)} blob 5\nabcde\n`) });
    files.push({ path: 'nul.md', content: Buffer.from([0, 0, 0, 10, 0, 10, 10]) });
    const r = repo(files);
    const { exec, calls } = recorder();
    const { spawn, spawns } = spawnRecorder();
    const source = createNodeGitObjectSource(profile(r.gitDir), { exec, spawn });
    const listing = await source.listTree(r.commit);
    assert.ok(listing.ok);
    if (!listing.ok) return;
    assert.equal(listing.value.entries.length, files.length);
    const check = (path: string, oid: string, result: Awaited<ReturnType<typeof source.readBlob>>) => {
      assert.ok(result.ok, `${path} was read`);
      if (!result.ok) return;
      assert.ok(Buffer.from(result.value).equals(oracle(r.gitDir, oid)), `${path} is byte-identical`);
    };
    for (const entry of listing.value.entries) check(entry.path, entry.oid, await source.readBlob(entry.oid, MAX_PAGE_BLOB_BYTES));
    const burst = await Promise.all(listing.value.entries.map((entry) => source.readBlob(entry.oid, MAX_PAGE_BLOB_BYTES)));
    burst.forEach((result, index) => check((listing.value.entries[index] as { path: string }).path, (listing.value.entries[index] as { oid: string }).oid, result));
    assert.equal(spawns.length, 1, 'one child served every read');
    assert.equal(calls.filter((call) => call.args.includes('cat-file')).length, 0, 'no per-blob process');
  });

  test('a missing object is not-found and keeps the child; a non-blob is not-found and replaces it', async () => {
    const r = repo([{ path: 'a.md', content: '# A' }]);
    const { spawn, spawns } = spawnRecorder();
    const source = createNodeGitObjectSource(profile(r.gitDir), { spawn });
    const listing = await source.listTree(r.commit);
    assert.ok(listing.ok);
    if (!listing.ok) return;
    const oid = listing.value.entries[0]?.oid as string;
    assert.deepEqual(await source.readBlob('0'.repeat(40), 1000), { ok: false, reason: 'not-found' });
    assert.deepEqual(await source.readBlob('0'.repeat(64), 1000), { ok: false, reason: 'not-found' }, 'a SHA-256 length id is simply missing in a SHA-1 repository');
    assert.equal((await source.readBlob(oid, 1000)).ok, true);
    assert.equal(spawns.length, 1, 'a missing object is a complete answer and the child stays');
    assert.deepEqual(await source.readBlob(r.tree, 1000), { ok: false, reason: 'not-found' }, 'a tree is not a page blob');
    await within(5000, (spawns[0] as SpawnCall).closed, 'the child that met a tree was killed');
    assert.equal((await source.readBlob(oid, 1000)).ok, true);
    assert.equal(spawns.length, 2, 'the next read started a fresh child');
  });

  test('an oversize header is refused before its body is read; the child is replaced and the next read works', async () => {
    const big = Buffer.alloc(MAX_PAGE_BLOB_BYTES + 1, 0x61);
    const r = repo([{ path: 'big.md', content: big }, { path: 'ok.md', content: '# ok' }]);
    const { spawn, spawns } = spawnRecorder();
    const source = createNodeGitObjectSource(profile(r.gitDir), { spawn });
    const listing = await source.listTree(r.commit);
    assert.ok(listing.ok);
    if (!listing.ok) return;
    const oidOf = (name: string) => listing.value.entries.find((entry) => entry.path === name)?.oid as string;
    assert.equal((await source.readBlob(oidOf('ok.md'), MAX_PAGE_BLOB_BYTES)).ok, true);
    assert.deepEqual(await source.readBlob(oidOf('big.md'), MAX_PAGE_BLOB_BYTES), { ok: false, reason: 'too-large' });
    await within(5000, (spawns[0] as SpawnCall).closed, 'the oversize child was killed');
    assert.equal((await source.readBlob(oidOf('ok.md'), MAX_PAGE_BLOB_BYTES)).ok, true);
    assert.equal(spawns.length, 2);
    assert.deepEqual(await source.readBlob(oidOf('ok.md'), 1), { ok: false, reason: 'too-large' }, 'the caller limit is enforced from the header too');
    assert.equal((await source.readBlob(oidOf('ok.md'), 4)).ok, true);
    assert.equal(spawns.length, 3, 'each refusal discards its child: first, second and the third that answered');
  });

  test('a child that floods after an oversize header is killed and its body is never buffered', async () => {
    const r = repo([{ path: 'ok.md', content: '# ok' }]);
    const fake = scriptedGit(`read oid; printf '%s blob 9999999999\\n' "$oid"; exec yes AAAAAAAA`);
    const { spawn, spawns } = spawnRecorder();
    const source = createNodeGitObjectSource(profile(r.gitDir), { gitExecutable: fake.executable, spawn });
    const listing = await source.listTree(r.commit);
    assert.ok(listing.ok);
    if (!listing.ok) return;
    const oid = listing.value.entries[0]?.oid as string;
    const started = Date.now();
    assert.deepEqual(await source.readBlob(oid, MAX_PAGE_BLOB_BYTES), { ok: false, reason: 'too-large' });
    assert.ok(Date.now() - started < 5000);
    assert.equal(await gone(Number(readFileSync(fake.pidFile, 'utf8').trim())), true, 'the flooding child was killed');
    assert.equal((await source.readBlob(oid, MAX_PAGE_BLOB_BYTES)).ok, true, 'the second launch is the real git');
    assert.equal(spawns.length, 2);
  });

  test('a child that stays silent is killed at the per-read timeout and the next read gets a fresh child', async () => {
    const r = repo([{ path: 'ok.md', content: '# ok' }]);
    const fake = scriptedGit('read oid; exec sleep 30');
    const { spawn, spawns } = spawnRecorder();
    const source = createNodeGitObjectSource(profile(r.gitDir), { gitExecutable: fake.executable, spawn, blobTimeoutMs: 300 });
    const listing = await source.listTree(r.commit);
    assert.ok(listing.ok);
    if (!listing.ok) return;
    const oid = listing.value.entries[0]?.oid as string;
    const started = Date.now();
    assert.deepEqual(await source.readBlob(oid, MAX_PAGE_BLOB_BYTES), { ok: false, reason: 'unavailable' });
    assert.ok(Date.now() - started < 5000);
    assert.equal(await gone(Number(readFileSync(fake.pidFile, 'utf8').trim())), true, 'the stalled child was killed');
    assert.equal((await source.readBlob(oid, MAX_PAGE_BLOB_BYTES)).ok, true);
    assert.equal(spawns.length, 2);
  });

  test('a child that exits in the middle of an object fails that read only', async () => {
    const r = repo([{ path: 'ok.md', content: '# ok' }]);
    const fake = scriptedGit(`read oid; printf '%s blob 10\\nabc' "$oid"; exit 3`);
    const { spawn, spawns } = spawnRecorder();
    const source = createNodeGitObjectSource(profile(r.gitDir), { gitExecutable: fake.executable, spawn });
    const listing = await source.listTree(r.commit);
    assert.ok(listing.ok);
    if (!listing.ok) return;
    const oid = listing.value.entries[0]?.oid as string;
    assert.deepEqual(await source.readBlob(oid, MAX_PAGE_BLOB_BYTES), { ok: false, reason: 'unavailable' });
    assert.equal((await source.readBlob(oid, MAX_PAGE_BLOB_BYTES)).ok, true);
    assert.equal(spawns.length, 2);
  });

  test('concurrent reads are written and answered strictly in order, one at a time, by one child', async () => {
    const files = Array.from({ length: 30 }, (_, index) => ({ path: `p${String(index).padStart(2, '0')}.md`, content: noise(100 + index * 37, index + 100) }));
    const r = repo(files);
    const { spawn, spawns } = spawnRecorder();
    const source = createNodeGitObjectSource(profile(r.gitDir), { spawn });
    const listing = await source.listTree(r.commit);
    assert.ok(listing.ok);
    if (!listing.ok) return;
    const order = [...listing.value.entries].reverse();
    const results = await Promise.all(order.map((entry) => source.readBlob(entry.oid, MAX_PAGE_BLOB_BYTES)));
    results.forEach((result, index) => {
      const entry = order[index] as { path: string };
      const expected = files.find((file) => file.path === entry.path)?.content as Buffer;
      assert.ok(result.ok && Buffer.from(result.value).equals(expected), `${entry.path} got its own bytes`);
    });
    assert.equal(spawns.length, 1);
    assert.deepEqual((spawns[0] as SpawnCall).writes, order.map((entry) => `${entry.oid}\n`), 'object ids reached the child in call order');
  });

  test('a mixed burst keeps its order across a refusal; later requests are served by the replacement child', async () => {
    const big = Buffer.alloc(MAX_PAGE_BLOB_BYTES + 1, 0x62);
    const r = repo([{ path: 'a.md', content: 'alpha' }, { path: 'b.md', content: 'bravo' }, { path: 'big.md', content: big }]);
    const { spawn, spawns } = spawnRecorder();
    const source = createNodeGitObjectSource(profile(r.gitDir), { spawn });
    const listing = await source.listTree(r.commit);
    assert.ok(listing.ok);
    if (!listing.ok) return;
    const oidOf = (name: string) => listing.value.entries.find((entry) => entry.path === name)?.oid as string;
    const missing = 'f'.repeat(40);
    const results = await Promise.all([
      source.readBlob(oidOf('a.md'), 100),
      source.readBlob(missing, 100),
      source.readBlob(oidOf('big.md'), MAX_PAGE_BLOB_BYTES),
      source.readBlob(oidOf('b.md'), 100),
      source.readBlob(oidOf('a.md'), 100),
    ]);
    assert.deepEqual(
      results.map((result) => (result.ok ? Buffer.from(result.value).toString() : result.reason)),
      ['alpha', 'not-found', 'too-large', 'bravo', 'alpha'],
    );
    assert.equal(spawns.length, 2, 'the refusal replaced the child once');
    assert.deepEqual((spawns[0] as SpawnCall).writes, [`${oidOf('a.md')}\n`, `${missing}\n`, `${oidOf('big.md')}\n`]);
    assert.deepEqual((spawns[1] as SpawnCall).writes, [`${oidOf('b.md')}\n`, `${oidOf('a.md')}\n`]);
  });

  test('the child is closed after the idle period and a later read starts a new one', async () => {
    const r = repo([{ path: 'a.md', content: 'x' }]);
    const { spawn, spawns } = spawnRecorder();
    const source = createNodeGitObjectSource(profile(r.gitDir), { spawn, batchIdleMs: 100 });
    const listing = await source.listTree(r.commit);
    assert.ok(listing.ok);
    if (!listing.ok) return;
    const oid = listing.value.entries[0]?.oid as string;
    assert.equal((await source.readBlob(oid, 10)).ok, true);
    const first = spawns[0] as SpawnCall;
    assert.equal(first.exited, false, 'the child stays for a moment so a burst of reads shares it');
    await within(5000, first.closed, 'the idle child closed');
    assert.equal(first.ended, true, 'it was closed by end of input');
    assert.equal(alive(first.child.pid as number), false);
    assert.equal((await source.readBlob(oid, 10)).ok, true);
    assert.equal(spawns.length, 2);
    await source.close();
    await within(5000, (spawns[1] as SpawnCall).closed, 'close() ended the second child');
  });

  test('close() kills the child and any pending read, and afterwards nothing is spawned or answered', async () => {
    const r = repo([{ path: 'a.md', content: 'x' }]);
    const { exec, calls } = recorder();
    const { spawn, spawns } = spawnRecorder();
    const source = createNodeGitObjectSource(profile(r.gitDir), { exec, spawn });
    const listing = await source.listTree(r.commit);
    assert.ok(listing.ok);
    if (!listing.ok) return;
    const oid = listing.value.entries[0]?.oid as string;
    assert.equal((await source.readBlob(oid, 10)).ok, true);
    const child = spawns[0] as SpawnCall;
    const pending = source.readBlob(oid, 10);
    await source.close();
    assert.equal(child.exited, true, 'the child was gone by the time close() resolved');
    assert.equal(alive(child.child.pid as number), false);
    assert.deepEqual(await pending, { ok: false, reason: 'unavailable' }, 'a read pending at close time fails');
    const processes = spawns.length + calls.length;
    assert.deepEqual(await source.readBlob(oid, 10), { ok: false, reason: 'unavailable' });
    assert.deepEqual(await source.resolvePin(), { ok: false, reason: 'unavailable' });
    assert.deepEqual(await source.listTree(r.commit), { ok: false, reason: 'unavailable' });
    assert.equal(spawns.length + calls.length, processes, 'nothing started after close()');
    await source.close();
  });

  test('a changed real path never reuses the old child: the next read starts one on the new directory', async () => {
    const a = repo([{ path: 'a.md', content: 'in repository a' }]);
    const b = repo([{ path: 'b.md', content: 'in repository b' }]);
    const alias = join(scratch.root, `link${counter++}.git`);
    symlinkSync(a.gitDir, alias);
    const { spawn, spawns } = spawnRecorder();
    const source = createNodeGitObjectSource(profile(alias), { spawn });
    const listA = await source.listTree(a.commit);
    assert.ok(listA.ok);
    if (!listA.ok) return;
    const oidA = listA.value.entries[0]?.oid as string;
    assert.equal((await source.readBlob(oidA, 100)).ok, true);
    const oidB = execFileSync('git', [`--git-dir=${b.gitDir}`, 'rev-parse', `${b.commit}:b.md`], { env: isolatedGitEnv(), encoding: 'utf8' }).trim();
    assert.deepEqual(await source.readBlob(oidB, 100), { ok: false, reason: 'not-found' }, 'repository a does not have the blob of b');

    rmSync(alias);
    symlinkSync(b.gitDir, alias);
    const swapped = await source.readBlob(oidB, 100);
    assert.equal(swapped.ok && Buffer.from(swapped.value).toString(), 'in repository b');
    assert.deepEqual(await source.readBlob(oidA, 100), { ok: false, reason: 'not-found' });
    assert.equal(spawns.length, 2);
    assert.equal((spawns[0] as SpawnCall).args[0], `--git-dir=${realpathSync(a.gitDir)}`);
    assert.equal((spawns[1] as SpawnCall).args[0], `--git-dir=${realpathSync(b.gitDir)}`);
    assert.equal((spawns[1] as SpawnCall).options.cwd, realpathSync(b.gitDir));
    await within(5000, (spawns[0] as SpawnCall).closed, 'the child of the old path was killed');
  });

  test('a git directory that disappears fails the read without starting a process', async () => {
    const r = repo([{ path: 'a.md', content: 'x' }]);
    const { spawn, spawns } = spawnRecorder();
    const source = createNodeGitObjectSource(profile(r.gitDir), { spawn });
    const listing = await source.listTree(r.commit);
    assert.ok(listing.ok);
    if (!listing.ok) return;
    const oid = listing.value.entries[0]?.oid as string;
    assert.equal((await source.readBlob(oid, 10)).ok, true);
    rmSync(r.gitDir, { recursive: true, force: true });
    assert.deepEqual(await source.readBlob(oid, 10), { ok: false, reason: 'unavailable' });
    assert.equal(spawns.length, 1);
    await source.close();
  });

  test('a missing git executable fails every read without an unhandled error', async () => {
    const r = repo([{ path: 'a.md', content: 'x' }]);
    const source = createNodeGitObjectSource(profile(r.gitDir), { gitExecutable: join(scratch.root, 'no-such-git') });
    for (let i = 0; i < 3; i++) assert.deepEqual(await source.readBlob('a'.repeat(40), 10), { ok: false, reason: 'unavailable' });
    assert.deepEqual(await Promise.all([source.readBlob('b'.repeat(40), 10), source.readBlob('c'.repeat(40), 10)]), [
      { ok: false, reason: 'unavailable' },
      { ok: false, reason: 'unavailable' },
    ]);
  });

  test('a full host refresh starts five one-shot processes and one batch child, however many pages', async () => {
    const files = Array.from({ length: 12 }, (_, index) => ({ path: `p${index}.md`, content: `# Page ${index}\n\nBody ${index}.\n` }));
    const r = repo(files);
    const { exec, calls } = recorder();
    const { spawn, spawns } = spawnRecorder();
    const p = profile(r.gitDir);
    const host = createWikiHost({ profiles: [p], sources: { bl: createNodeGitObjectSource(p, { exec, spawn }) }, store: createMemoryIndexStore(), clock });
    const status = must(await host.refresh());
    assert.equal(status.namespaces[0]?.pageCount, 12);
    // Before this change every page was its own `git cat-file blob` process: 5 + 12 = 17 starts for this refresh.
    assert.equal(calls.length, 5);
    assert.equal(spawns.length, 1);
    assert.equal(spawns[0]?.writes.length, 12);
  });
});

interface FakeChild {
  readonly args: readonly string[];
  readonly writes: string[];
  killed: number;
  ended: boolean;
  /** Deliver output to the adapter. */
  data(chunk: Buffer | string): void;
  /** The process is gone. */
  close(): void;
  /** An error event on one of the child's streams or on the child itself. */
  fail(stream: 'stdout' | 'stdin' | 'process'): void;
}

/**
 * Children the test fully controls: output chunks, exits and stream errors are delivered on demand, so framing
 * edge cases do not depend on how a real pipe splits its reads. Killing a child closes it on the next tick.
 */
function fakeSpawner(behaviour: { closeOnEnd?: boolean; closeOnKill?: boolean } = {}): { spawn: GitSpawn; made: FakeChild[] } {
  const made: FakeChild[] = [];
  const spawn: GitSpawn = (_file, args) => {
    const stdout = new EventEmitter();
    const stdinEvents = new EventEmitter();
    const proc = new EventEmitter();
    let open = true;
    const close = () => {
      if (!open) return;
      open = false;
      proc.emit('close');
    };
    const fake: FakeChild = {
      args: [...args],
      writes: [],
      killed: 0,
      ended: false,
      data: (chunk) => stdout.emit('data', typeof chunk === 'string' ? Buffer.from(chunk, 'latin1') : chunk),
      close,
      fail: (stream) => (stream === 'stdout' ? stdout : stream === 'stdin' ? stdinEvents : proc).emit('error', new Error('synthetic stream failure')),
    };
    const stdin = Object.assign(stdinEvents, {
      write(chunk: string) {
        fake.writes.push(chunk);
        return true;
      },
      end() {
        fake.ended = true;
        if (behaviour.closeOnEnd !== false) setImmediate(close);
      },
    });
    const child = Object.assign(proc, {
      stdin,
      stdout,
      kill() {
        fake.killed++;
        if (behaviour.closeOnKill !== false) setImmediate(close);
      },
    });
    made.push(fake);
    return child as unknown as GitBatchChild;
  };
  return { spawn, made };
}

const OID = 'a'.repeat(40);
const OID2 = 'b'.repeat(40);
const frame = (oid: string, body: string): Buffer => Buffer.concat([Buffer.from(`${oid} blob ${Buffer.byteLength(body)}\n`), Buffer.from(body), Buffer.from('\n')]);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const bodyOf = (result: SourceResult<Uint8Array>) => (result.ok ? Buffer.from(result.value).toString() : result.reason);

/** Poll until `condition` holds; the adapter resolves each real path on the thread pool, so steps are not instantaneous. */
async function until(condition: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (condition()) return;
    await sleep(5);
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe('batch protocol with controlled children', () => {
  let plain: string;
  before(() => {
    plain = join(scratch.root, 'plain-directory');
    mkdirSync(plain);
  });
  const sourceOver = (spawn: GitSpawn, extra: NodeGitOptions = {}) => createNodeGitObjectSource(profile(plain), { spawn, batchIdleMs: 60_000, ...extra });
  /** Wait until child `index` exists and has been sent `count` ids. */
  const written = (made: FakeChild[], index: number, count: number) => until(() => (made[index]?.writes.length ?? 0) >= count, `child ${index} to receive ${count} id(s)`);

  test('an answer split at every byte boundary, header included, is reassembled', async () => {
    const { spawn, made } = fakeSpawner();
    const source = sourceOver(spawn);
    const body = 'héllo\nwörld\0end';
    const read = source.readBlob(OID, 1000);
    await written(made, 0, 1);
    for (const byte of frame(OID, body)) made[0]?.data(Buffer.from([byte]));
    assert.equal(bodyOf(await read), body);
    assert.deepEqual(made[0]?.writes, [`${OID}\n`]);
  });

  test('the next id is written only after the previous answer is complete', async () => {
    const { spawn, made } = fakeSpawner();
    const source = sourceOver(spawn);
    const reads = [source.readBlob(OID, 1000), source.readBlob(OID2, 1000), source.readBlob(OID, 1000)];
    await written(made, 0, 1);
    await sleep(50);
    assert.deepEqual(made[0]?.writes, [`${OID}\n`], 'depth one: later ids wait for their turn');
    made[0]?.data(frame(OID, 'first'));
    await written(made, 0, 2);
    assert.deepEqual(made[0]?.writes, [`${OID}\n`, `${OID2}\n`]);
    made[0]?.data(`${OID2} missing\n`);
    await written(made, 0, 3);
    made[0]?.data(frame(OID, 'third'));
    assert.deepEqual((await Promise.all(reads)).map(bodyOf), ['first', 'not-found', 'third']);
    assert.equal(made.length, 1);
  });

  test('a header over the limit is refused before any body arrives and the child is killed', async () => {
    const { spawn, made } = fakeSpawner();
    const source = sourceOver(spawn);
    const read = source.readBlob(OID, 50);
    await written(made, 0, 1);
    made[0]?.data(`${OID} blob 51\n`);
    assert.deepEqual(await read, { ok: false, reason: 'too-large' });
    assert.equal(made[0]?.killed, 1);
    made[0]?.data('x'.repeat(100_000)); // late output of the dead child is ignored
    const next = source.readBlob(OID2, 50);
    await written(made, 1, 1);
    assert.equal(made.length, 2, 'the next read is served by a new child');
    made[1]?.data(frame(OID2, 'fine'));
    assert.equal(bodyOf(await next), 'fine');
  });

  for (const [label, output, reason] of [
    ['something that is not a header', 'this is not a header\n', 'unavailable'],
    ['a header with a different object id', `${OID2} blob 3\nabc\n`, 'unavailable'],
    ['a header longer than any header can be', 'A'.repeat(300), 'unavailable'],
    ['an object without the closing line feed', `${OID} blob 3\nabcX`, 'unavailable'],
    ['more bytes than the announced object', `${OID} blob 3\nabc\nEXTRA`, 'unavailable'],
    ['a missing answer with trailing bytes', `${OID} missing\nEXTRA`, 'unavailable'],
    ['an ambiguous answer', `${OID} ambiguous\n`, 'unavailable'],
    ['a negative size', `${OID} blob -3\n`, 'unavailable'],
    ['a non-blob object', `${OID} tree 12\n`, 'not-found'],
  ] as const) {
    test(`${label}: ${reason} for that read, child discarded, queued read served by a fresh child`, async () => {
      const { spawn, made } = fakeSpawner();
      const source = sourceOver(spawn);
      const first = source.readBlob(OID, 1000);
      const queued = source.readBlob(OID2, 1000);
      await written(made, 0, 1);
      made[0]?.data(output);
      assert.deepEqual(await first, { ok: false, reason });
      assert.equal(made[0]?.killed, 1);
      await written(made, 1, 1);
      assert.equal(made.length, 2);
      assert.deepEqual(made[1]?.writes, [`${OID2}\n`], 'the request behind it was not lost');
      made[1]?.data(frame(OID2, 'ok'));
      assert.equal(bodyOf(await queued), 'ok');
    });
  }

  test('output nobody asked for discards the child; the next read starts a fresh one', async () => {
    const { spawn, made } = fakeSpawner();
    const source = sourceOver(spawn);
    const read = source.readBlob(OID, 1000);
    await written(made, 0, 1);
    made[0]?.data(frame(OID, 'one'));
    assert.equal(bodyOf(await read), 'one');
    made[0]?.data('unsolicited\n');
    assert.equal(made[0]?.killed, 1);
    const next = source.readBlob(OID, 1000);
    await written(made, 1, 1);
    assert.equal(made.length, 2);
    made[1]?.data(frame(OID, 'two'));
    assert.equal(bodyOf(await next), 'two');
  });

  for (const stream of ['stdout', 'stdin', 'process'] as const) {
    test(`an error event on the child's ${stream} fails the read and replaces the child`, async () => {
      const { spawn, made } = fakeSpawner();
      const source = sourceOver(spawn);
      const read = source.readBlob(OID, 1000);
      await written(made, 0, 1);
      made[0]?.fail(stream);
      assert.deepEqual(await read, { ok: false, reason: 'unavailable' });
      assert.equal(made[0]?.killed, stream === 'process' ? 0 : 1, 'a child that failed to run is not killed again');
      const next = source.readBlob(OID, 1000);
      await written(made, 1, 1);
      assert.equal(made.length, 2);
      made[1]?.data(frame(OID, 'recovered'));
      assert.equal(bodyOf(await next), 'recovered');
    });
  }

  test('an exit with a read in flight fails that read; an exit while idle fails nothing', async () => {
    const { spawn, made } = fakeSpawner();
    const source = sourceOver(spawn);
    const mid = source.readBlob(OID, 1000);
    await written(made, 0, 1);
    made[0]?.data(`${OID} blob 10\nabc`);
    made[0]?.close();
    assert.deepEqual(await mid, { ok: false, reason: 'unavailable' });

    const next = source.readBlob(OID, 1000);
    await written(made, 1, 1);
    made[1]?.data(frame(OID, 'ok'));
    assert.equal(bodyOf(await next), 'ok');
    made[1]?.close(); // dies between reads
    const after = source.readBlob(OID, 1000);
    await written(made, 2, 1);
    assert.equal(made.length, 3, 'the next read found no child and started one');
    made[2]?.data(frame(OID, 'again'));
    assert.equal(bodyOf(await after), 'again');
  });

  test('the per-read timeout runs from the write of that request, not from the time spent waiting in line', async () => {
    const { spawn, made } = fakeSpawner();
    const source = sourceOver(spawn, { blobTimeoutMs: 300 });
    const first = source.readBlob(OID, 1000);
    const second = source.readBlob(OID2, 1000);
    await written(made, 0, 1);
    await sleep(150);
    made[0]?.data(frame(OID, 'quick'));
    assert.equal(bodyOf(await first), 'quick');
    await written(made, 0, 2);
    await sleep(150); // 300 ms since the first write, 150 since the second
    made[0]?.data(frame(OID2, 'slow but in time'));
    assert.equal(bodyOf(await second), 'slow but in time');

    const stalled = source.readBlob(OID, 1000);
    await written(made, 0, 3);
    assert.deepEqual(await stalled, { ok: false, reason: 'unavailable' });
    assert.equal(made[0]?.killed, 1);
  });

  test('a spawn that throws is an unavailable read, not an exception', async () => {
    const throwing: GitSpawn = () => {
      throw new Error('spawn failed');
    };
    const source = sourceOver(throwing);
    assert.deepEqual(await source.readBlob(OID, 10), { ok: false, reason: 'unavailable' });
    assert.deepEqual(await Promise.all([source.readBlob(OID, 10), source.readBlob(OID2, 10)]), [
      { ok: false, reason: 'unavailable' },
      { ok: false, reason: 'unavailable' },
    ]);
  });

  test('the idle child is closed by end of input; a read during that wind-down starts a new child', async () => {
    const { spawn, made } = fakeSpawner({ closeOnEnd: false });
    const source = createNodeGitObjectSource(profile(plain), { spawn, batchIdleMs: 20 });
    const read = source.readBlob(OID, 1000);
    await written(made, 0, 1);
    made[0]?.data(frame(OID, 'x'));
    assert.equal(bodyOf(await read), 'x');
    await until(() => made[0]?.ended === true, 'the idle child to be closed');
    assert.equal(made[0]?.killed, 0, 'it is given a grace period to exit before it is killed');
    const next = source.readBlob(OID, 1000);
    await written(made, 1, 1);
    assert.equal(made.length, 2, 'the closing child is not reused');
    made[1]?.data(frame(OID, 'y'));
    assert.equal(bodyOf(await next), 'y');
    made[0]?.close();
    await source.close();
  });

  test('close() answers the read in flight and the queue as unavailable and kills the child', async () => {
    const { spawn, made } = fakeSpawner();
    const source = sourceOver(spawn);
    const inFlight = source.readBlob(OID, 1000);
    const queued = source.readBlob(OID2, 1000);
    await written(made, 0, 1);
    await source.close();
    assert.deepEqual(await Promise.all([inFlight, queued]), [
      { ok: false, reason: 'unavailable' },
      { ok: false, reason: 'unavailable' },
    ]);
    assert.equal(made[0]?.killed, 1);
    assert.equal(made.length, 1);
    assert.deepEqual(await source.readBlob(OID, 1000), { ok: false, reason: 'unavailable' });
    assert.equal(made.length, 1);
  });
});

describe('the host over a real synthetic repository', () => {
  test('indexes, searches, reads and re-indexes a moved ref while the source stays byte-identical', async () => {
    const r = repo([
      { path: 'docs/home.md', content: '---\ntitle: Home\ntags: [start]\n---\n# Home\n\nWelcome to the orchid garden. See [guide](guide.md) and [[Missing Page]].\n' },
      { path: 'docs/guide.md', content: '# Guide\n\nBack to [home](home.md).\n' },
      { path: 'docs/link.md', content: 'home.md', mode: '120000' },
      { path: 'docs/notes.txt', content: 'not a page' },
      { path: 'outside.md', content: '# Outside the root' },
    ]);
    const before = fingerprintTree(r.gitDir);
    const source = createNodeGitObjectSource(profile(r.gitDir, { rootPrefix: 'docs' }));
    const host = createWikiHost({ profiles: [profile(r.gitDir, { rootPrefix: 'docs' })], sources: { bl: source }, store: createMemoryIndexStore(), clock });

    const status = must(await host.refresh());
    assert.equal(status.namespaces[0]?.state, 'ready');
    assert.equal(status.namespaces[0]?.pageCount, 2);
    assert.equal(status.namespaces[0]?.source?.commit, r.commit);

    const hits = must(await host.service.search({ query: 'orchid' }));
    assert.deepEqual(hits.hits.map((h) => h.key.path), ['home.md']);
    const home = must(await host.service.getPage({ key: { namespace: 'bl', path: 'home.md' } }));
    assert.equal(home.title, 'Home');
    assert.deepEqual(home.outLinks.map((l) => l.target.kind), ['page', 'missing']);
    const back = must(await host.service.getBacklinks({ key: { namespace: 'bl', path: 'home.md' } }));
    assert.deepEqual(back.entries.map((e) => e.source.path), ['guide.md']);
    assert.equal((await host.service.getPage({ key: { namespace: 'bl', path: 'link.md' } })).ok, false, 'symlinks are never pages');

    // A later commit moves the ref; refresh picks it up.
    const env = isolatedGitEnv();
    const blob = execFileSync('git', [`--git-dir=${r.gitDir}`, 'hash-object', '-w', '--stdin'], { env, input: '# Extra\n\nnew page' }).toString().trim();
    const tree = execFileSync('git', [`--git-dir=${r.gitDir}`, 'mktree'], {
      env,
      input: `100644 blob ${blob}\textra.md\n`,
    }).toString().trim();
    const root = execFileSync('git', [`--git-dir=${r.gitDir}`, 'mktree'], { env, input: `040000 tree ${tree}\tdocs\n` }).toString().trim();
    const next = execFileSync('git', [`--git-dir=${r.gitDir}`, 'commit-tree', root, '-p', r.commit, '-m', 'second'], { env }).toString().trim();
    execFileSync('git', [`--git-dir=${r.gitDir}`, 'update-ref', 'refs/heads/main', next], { env });
    const second = must(await host.refresh());
    assert.equal(second.namespaces[0]?.source?.commit, next);
    assert.equal(second.namespaces[0]?.pageCount, 1);

    execFileSync('git', [`--git-dir=${r.gitDir}`, 'update-ref', 'refs/heads/main', r.commit], { env });
    const restoredPins = must(await host.refresh());
    assert.equal(restoredPins.namespaces[0]?.source?.commit, r.commit);
    const refAfter = fingerprintTree(r.gitDir);
    assert.notEqual(refAfter, before, 'the test itself moved the ref and wrote objects');

    // Pure reads (no test writes in between) leave every byte of the repository untouched.
    const quiet = fingerprintTree(r.gitDir);
    must(await host.refresh());
    await host.service.search({ query: 'orchid' });
    await host.service.getPage({ key: { namespace: 'bl', path: 'home.md' } });
    await host.service.getBacklinks({ key: { namespace: 'bl', path: 'home.md' } });
    const source2 = createNodeGitObjectSource(profile(r.gitDir, { rootPrefix: 'docs' }));
    const pin = await source2.resolvePin();
    assert.ok(pin.ok);
    if (pin.ok) await source2.listTree(pin.value.commit);
    assert.equal(fingerprintTree(r.gitDir), quiet, 'source tree unchanged by reading');
  });

  test('a wrong remote leaves the namespace unavailable and reads nothing', async () => {
    const r = repo([{ path: 'a.md', content: '# A' }]);
    const { exec, calls } = recorder();
    const wrong = profile(r.gitDir, { expectedRemote: 'https://example.invalid/not-it.git' });
    const host = createWikiHost({ profiles: [wrong], sources: { bl: createNodeGitObjectSource(wrong, { exec }) }, store: createMemoryIndexStore(), clock });
    const status = must(await host.refresh());
    assert.equal(status.namespaces[0]?.state, 'unavailable');
    assert.ok(calls.every((c) => !c.args.includes('ls-tree') && !c.args.includes('cat-file')), 'no tree or blob was read after a binding mismatch');
  });
});
