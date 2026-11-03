// Arguments, the owner's input files and exit codes. These run the CLI in this process: every failure is
// detected before any repository is touched, so no Git or corpus is needed.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { EXIT_INVALID, EXIT_OK, runCli } from '../cli.ts';
import { InputFailure, MAX_INPUT_BYTES, parseConfig, parseQueries, readBoundedJson, selectProfiles } from '../config-file.ts';
import { createScratch, type Scratch } from '../../test/scratch.ts';
import { profileFor } from '../../test/support.ts';

const SENTINEL_KEY = 'sentinel-key-4d2f';
const SENTINEL_DIR = '/sentinel/dir-4d2f.git';
const SENTINEL_QUERY = 'sentinel-query-4d2f';

let scratch: Scratch;
let dir: string;

before(() => {
  scratch = createScratch('wiki-validate-input');
  dir = join(scratch.root, 'inputs-4d2f');
  mkdirSync(dir);
});
after(() => scratch.cleanup());

const file = (name: string, content: string | Buffer): string => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};
const json = (name: string, value: unknown): string => file(name, JSON.stringify(value));

async function expectFailure(work: () => Promise<unknown> | unknown, code: string, position: number | null = null, reason: string | null = null): Promise<void> {
  try {
    await work();
  } catch (error) {
    assert.ok(error instanceof InputFailure, 'a fixed input failure');
    assert.equal(error.code, code);
    assert.equal(error.position, position);
    assert.equal(error.reason, reason);
    assert.equal(error.message, code, 'the message is the fixed code');
    return;
  }
  assert.fail(`expected ${code}`);
}

const bl = (overrides: Record<string, unknown> = {}) => profileFor('bl', { gitDir: '/synthetic/one.git', ...overrides });
const appdev = (overrides: Record<string, unknown> = {}) => profileFor('appdev', { gitDir: '/synthetic/two.git', ...overrides });

describe('readBoundedJson', () => {
  test('reads a regular JSON file', async () => {
    assert.deepEqual(await readBoundedJson(json('ok.json', { version: 1, sources: [] })), { version: 1, sources: [] });
  });

  test('a missing file, a NUL in the path and a directory are refused', async () => {
    await expectFailure(() => readBoundedJson(join(dir, 'nope.json')), 'unreadable');
    await expectFailure(() => readBoundedJson(`${dir}/bad\u0000name`), 'unreadable');
    await expectFailure(() => readBoundedJson(dir), 'not-regular-file');
  });

  test('a symlink is refused, whether it points at a file or a directory, and a dangling one', async () => {
    const target = json('target.json', {});
    symlinkSync(target, join(dir, 'link.json'));
    symlinkSync(dir, join(dir, 'dirlink'));
    symlinkSync(join(dir, 'gone'), join(dir, 'dangling'));
    for (const name of ['link.json', 'dirlink', 'dangling']) await expectFailure(() => readBoundedJson(join(dir, name)), 'symlink');
  });

  test('a FIFO is refused without blocking', async () => {
    const fifo = join(dir, 'pipe');
    execFileSync('mkfifo', [fifo]);
    await expectFailure(() => readBoundedJson(fifo), 'not-regular-file');
  });

  test('the cap is exact: the cap itself is read, one byte more is refused', async () => {
    const padded = (size: number) => `{"a":1}${' '.repeat(size - 7)}`;
    assert.deepEqual(await readBoundedJson(file('at-cap.json', padded(64)), 64), { a: 1 });
    await expectFailure(() => readBoundedJson(file('over-cap.json', padded(65)), 64), 'too-large');
    assert.deepEqual(await readBoundedJson(file('at-default.json', padded(MAX_INPUT_BYTES))), { a: 1 });
    await expectFailure(() => readBoundedJson(file('over-default.json', padded(MAX_INPUT_BYTES + 1))), 'too-large');
    assert.equal(MAX_INPUT_BYTES, 256 * 1024);
  });

  test('empty, truncated and non-UTF-8 content is not JSON', async () => {
    await expectFailure(() => readBoundedJson(file('empty.json', '')), 'not-json');
    await expectFailure(() => readBoundedJson(file('cut.json', '{"version": 1, ')), 'not-json');
    await expectFailure(() => readBoundedJson(file('latin1.json', Buffer.from([0x22, 0xe9, 0x22]))), 'not-json');
  });
});

describe('parseConfig', () => {
  test('accepts the app configuration shape and returns validated profiles in the given order', () => {
    const profiles = parseConfig({ version: 1, sources: [appdev(), bl()] });
    assert.deepEqual(profiles.map((p) => p.namespace), ['appdev', 'bl']);
    assert.ok(Object.isFrozen(profiles[0]));
    assert.equal(parseConfig({ version: 1, sources: [bl()] }).length, 1);
  });

  test('rejects any other shape', async () => {
    for (const value of [null, [], 'text', 3, { sources: [] }, { version: 1 }, { version: 0, sources: [bl()] }, { version: 2, sources: [bl()] }, { version: '1', sources: [bl()] }, { version: 1, sources: {} }, { version: 1, sources: [bl()], extra: 1 }]) {
      await expectFailure(() => parseConfig(value), 'bad-shape');
    }
  });

  test('rejects no sources, a duplicate namespace and more sources than namespaces', async () => {
    await expectFailure(() => parseConfig({ version: 1, sources: [] }), 'no-sources');
    await expectFailure(() => parseConfig({ version: 1, sources: [bl(), bl({ gitDir: '/synthetic/three.git' })] }), 'duplicate-namespace', 1);
    await expectFailure(() => parseConfig({ version: 1, sources: [bl(), appdev(), bl()] }), 'duplicate-namespace');
  });

  test('an invalid profile reports its position and the contract reason code only', async () => {
    await expectFailure(() => parseConfig({ version: 1, sources: [bl(), appdev({ [SENTINEL_KEY]: 1 })] }), 'invalid-profile', 1, 'unknown-property');
    await expectFailure(() => parseConfig({ version: 1, sources: [bl({ gitDir: 'relative/path' })] }), 'invalid-profile', 0, 'invalid-format');
    await expectFailure(() => parseConfig({ version: 1, sources: [{ namespace: 'bl' }] }), 'invalid-profile', 0, 'missing-property');
    await expectFailure(() => parseConfig({ version: 1, sources: ['text'] }), 'invalid-profile', 0, 'wrong-type');
  });

  test('a reason outside the contract enumeration is never kept', () => {
    assert.equal(new InputFailure('invalid-profile', 0, SENTINEL_KEY).reason, null);
  });
});

describe('parseQueries and selectProfiles', () => {
  test('queries are validated with the contract rules', async () => {
    assert.deepEqual(parseQueries({ version: 1, queries: ['one', 'two words'] }), ['one', 'two words']);
    assert.deepEqual(parseQueries({ version: 1, queries: [] }), []);
    assert.equal(parseQueries({ version: 1, queries: Array.from({ length: 100 }, () => 'q') }).length, 100);
    await expectFailure(() => parseQueries({ version: 1, queries: Array.from({ length: 101 }, () => 'q') }), 'bad-shape');
    await expectFailure(() => parseQueries({ version: 1 }), 'bad-shape');
    await expectFailure(() => parseQueries({ version: 1, queries: 'q' }), 'bad-shape');
    await expectFailure(() => parseQueries({ version: 1, queries: ['q'], extra: true }), 'bad-shape');
    await expectFailure(() => parseQueries(['q']), 'bad-shape');
    await expectFailure(() => parseQueries({ version: 1, queries: ['ok', 7] }), 'invalid-query', 1);
    await expectFailure(() => parseQueries({ version: 1, queries: ['ok', '   '] }), 'invalid-query', 1);
    await expectFailure(() => parseQueries({ version: 1, queries: [`${SENTINEL_QUERY}\u0001`] }), 'invalid-query', 0);
    await expectFailure(() => parseQueries({ version: 1, queries: ['x'.repeat(257)] }), 'invalid-query', 0);
    assert.deepEqual(parseQueries({ version: 1, queries: ['x'.repeat(256)] }), ['x'.repeat(256)]);
  });

  test('selectProfiles keeps namespace order and filters', async () => {
    const profiles = parseConfig({ version: 1, sources: [appdev(), bl()] });
    assert.deepEqual(selectProfiles(profiles, null).map((p) => p.namespace), ['bl', 'appdev']);
    assert.deepEqual(selectProfiles(profiles, 'appdev').map((p) => p.namespace), ['appdev']);
    await expectFailure(() => selectProfiles(parseConfig({ version: 1, sources: [bl()] }), 'appdev'), 'no-matching-source');
  });
});

interface Outcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function cli(...args: string[]): Promise<Outcome> {
  let stdout = '';
  let stderr = '';
  const code = await runCli(args, { stdout: (text) => void (stdout += text), stderr: (text) => void (stderr += text) });
  return { code, stdout, stderr };
}

describe('command line', () => {
  const good = () => json('good-config.json', { version: 1, sources: [bl()] });
  const linked = (): string => {
    const link = join(dir, 'linked-config.json');
    symlinkSync(good(), link);
    return link;
  };

  test('--help prints the fixed usage and exits 0', async () => {
    const out = await cli('--help');
    assert.equal(out.code, EXIT_OK);
    assert.match(out.stdout, /^usage: node validate-sources\.ts --config <file>/);
    assert.equal(out.stderr, '');
  });

  const badArguments: [string, () => string[]][] = [
    ['no arguments', () => []],
    ['--json alone', () => ['--json']],
    ['an unknown option', () => ['--config', good(), '--bogus']],
    ['a positional argument', () => ['--config', good(), 'extra']],
    ['--config without a value', () => ['--config']],
    ['a repeated --config', () => ['--config', good(), '--config', good()]],
    ['a repeated --json', () => ['--config', good(), '--json', '--json']],
    ['an unknown namespace', () => ['--config', good(), '--namespace', 'other']],
    ['an empty namespace', () => ['--config', good(), '--namespace', '']],
    ['a short option', () => ['-c', good()]],
    ['--queries without a value', () => ['--config', good(), '--queries']],
  ];
  for (const [name, args] of badArguments) {
    test(`${name} is invalid arguments: exit 2, nothing on stdout, a fixed message`, async () => {
      const argv = args();
      const out = await cli(...argv);
      assert.equal(out.code, EXIT_INVALID);
      assert.equal(out.stdout, '');
      assert.match(out.stderr, /^wiki-validate: invalid arguments\nusage: /);
      for (const value of argv) if (value.length > 4 && !value.startsWith('--')) assert.ok(!out.stderr.includes(value), 'arguments are not echoed');
    });
  }

  const badInputs: [string, () => string[], RegExp][] = [
    ['a missing config file', () => ['--config', join(dir, 'absent-config.json')], /^wiki-validate: invalid config file: unreadable\n$/],
    ['a directory as config', () => ['--config', dir], /^wiki-validate: invalid config file: not-regular-file\n$/],
    ['a symlinked config', () => ['--config', linked()], /^wiki-validate: invalid config file: symlink\n$/],
    ['an oversized config', () => ['--config', file('big-config.json', ' '.repeat(MAX_INPUT_BYTES + 1))], /^wiki-validate: invalid config file: too-large\n$/],
    ['a config that is not JSON', () => ['--config', file('text-config.json', `not json ${SENTINEL_KEY}`)], /^wiki-validate: invalid config file: not-json\n$/],
    ['a config of the wrong shape', () => ['--config', json('shape-config.json', { version: 1, sources: [], [SENTINEL_KEY]: 1 })], /^wiki-validate: invalid config file: bad-shape\n$/],
    ['a config without sources', () => ['--config', json('none-config.json', { version: 1, sources: [] })], /^wiki-validate: invalid config file: no-sources\n$/],
    ['a duplicate namespace', () => ['--config', json('dup-config.json', { version: 1, sources: [bl(), bl()] })], /^wiki-validate: invalid config file: duplicate-namespace at position 1\n$/],
    ['an invalid profile', () => ['--config', json('profile-config.json', { version: 1, sources: [bl({ [SENTINEL_KEY]: SENTINEL_DIR })] })], /^wiki-validate: invalid config file: invalid-profile at position 0 \(unknown-property\)\n$/],
    ['a namespace that is not configured', () => ['--config', good(), '--namespace', 'appdev'], /^wiki-validate: invalid config file: no-matching-source\n$/],
    ['a missing queries file', () => ['--config', good(), '--queries', join(dir, 'absent-queries.json')], /^wiki-validate: invalid queries file: unreadable\n$/],
    ['invalid queries', () => ['--config', good(), '--queries', json('bad-queries.json', { version: 1, queries: ['fine', SENTINEL_QUERY + '\u0001'] })], /^wiki-validate: invalid queries file: invalid-query at position 1\n$/],
  ];
  for (const [name, args, message] of badInputs) {
    test(`${name}: exit 2, nothing on stdout, one fixed line without any value from the files`, async () => {
      const out = await cli(...args());
      assert.equal(out.code, EXIT_INVALID);
      assert.equal(out.stdout, '');
      assert.match(out.stderr, message);
      for (const secret of [SENTINEL_KEY, SENTINEL_DIR, SENTINEL_QUERY, dir]) assert.ok(!out.stderr.includes(secret), secret);
    });
  }
});
