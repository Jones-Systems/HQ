// The Node Git adapter against real synthetic bare repositories. Every repository lives in task-owned
// scratch outside /tmp and is removed exactly, on success and on failure.

import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { MAX_PAGE_BLOB_BYTES } from '../../contract/src/index.ts';
import { createMemoryIndexStore, createNodeGitObjectSource, createWikiHost, parseLsTree, type GitExec, type GitExecOptions } from '../src/index.ts';
import { createScratch, type Scratch } from './scratch.ts';
import { REMOTE, clock, createBareRepo, fingerprintTree, isolatedGitEnv, must, profileFor, writeExecutable } from './support.ts';

let scratch: Scratch;
before(() => {
  scratch = createScratch('git-adapter');
});
after(() => scratch.cleanup());

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
  test('every process is a fixed Git plumbing command with the mandatory prefix and a bare minimal environment', async () => {
    const r = repo([{ path: 'a.md', content: '# A' }]);
    const real = realpathSync(r.gitDir);
    const { exec, calls } = recorder();
    const source = createNodeGitObjectSource(profile(r.gitDir), { exec });
    const pin = await source.resolvePin();
    assert.ok(pin.ok);
    if (!pin.ok) return;
    const listing = await source.listTree(pin.value.commit);
    assert.ok(listing.ok);
    if (!listing.ok) return;
    await source.readBlob(listing.value.entries[0]?.oid as string, 1024);

    const prefix = [`--git-dir=${real}`, '--no-replace-objects', '--literal-pathspecs', '-c', 'core.fsmonitor=false'];
    const allowed = [
      /^rev-parse --is-bare-repository$/,
      /^config --get remote\.origin\.url$/,
      /^rev-parse --verify --end-of-options refs\/heads\/main\^\{commit\}$/,
      new RegExp(`^show -s --no-show-signature --format=%ct --end-of-options ${HEX}$`),
      new RegExp(`^ls-tree -r -z -l --full-tree ${HEX}$`),
      new RegExp(`^cat-file blob ${HEX}$`),
    ];
    assert.equal(calls.length, 6);
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
      assert.deepEqual(
        Object.keys(call.options.env).sort(),
        ['GIT_ATTR_NOSYSTEM', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_SYSTEM', 'GIT_NO_LAZY_FETCH', 'GIT_NO_REPLACE_OBJECTS', 'GIT_OPTIONAL_LOCKS', 'GIT_TERMINAL_PROMPT', 'LC_ALL', 'PATH'].sort(),
      );
      assert.equal(call.options.env['GIT_TERMINAL_PROMPT'], '0');
      assert.equal(call.options.env['GIT_OPTIONAL_LOCKS'], '0');
      assert.equal(call.options.env['GIT_CONFIG_GLOBAL'], '/dev/null');
      assert.equal(call.options.env['GIT_CONFIG_NOSYSTEM'], '1');
    }
    const subcommands = new Set(calls.map((c) => c.args[prefix.length]));
    assert.deepEqual([...subcommands].sort(), ['cat-file', 'config', 'ls-tree', 'rev-parse', 'show']);
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

  test('concurrency is bounded', async () => {
    const r = repo([{ path: 'a.md', content: 'x' }]);
    const { exec, inFlight } = recorder();
    const source = createNodeGitObjectSource(profile(r.gitDir), { exec, concurrency: 2 });
    const pin = await source.resolvePin();
    assert.ok(pin.ok);
    if (!pin.ok) return;
    const listing = await source.listTree(pin.value.commit);
    assert.ok(listing.ok);
    if (!listing.ok) return;
    const oid = listing.value.entries[0]?.oid as string;
    inFlight.max = 0;
    const results = await Promise.all(Array.from({ length: 12 }, () => source.readBlob(oid, 10)));
    assert.ok(results.every((result) => result.ok));
    assert.ok(inFlight.max <= 2, `max in flight ${inFlight.max}`);
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
