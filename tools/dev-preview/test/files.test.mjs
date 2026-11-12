import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import { UsageError } from '../config.mjs';
import {
  MANIFEST_SCHEMA, OWNER_FILE, SESSION_SCHEMA, defaultShotsDir, isProcessAlive, prepareOutputDir, readSessionFile, reapStaleRuns,
  removeSessionFile, resolveInside, safeFileName, scratchDir, sessionPaths, stateDir, utcStamp, validateSessionName, validateSessionRecord, writeOwnerFile, writeSessionFile,
} from '../files.mjs';

let root;
before(async () => { root = await mkdtemp(join(tmpdir(), 'hq-dev-preview-test-')); });
after(async () => { await rm(root, { recursive: true, force: true }); });
const exists = async path => { try { await access(path); return true; } catch { return false; } };

const record = (overrides = {}) => ({
  schema: SESSION_SCHEMA, name: 'mine', pid: 4242, startedAt: '2026-11-03T00:00:00.000Z',
  control: { host: '127.0.0.1', port: 40000, token: 'a'.repeat(48) }, evidenceDir: '/tmp/evidence', ...overrides,
});

test('state lives under .t3/dev-preview of the repo', () => {
  assert.equal(stateDir('/r'), '/r/.t3/dev-preview');
  assert.equal(scratchDir('/r'), '/r/.t3/dev-preview/scratch');
  assert.equal(sessionPaths('/r', 'mine').file, '/r/.t3/dev-preview/sessions/mine/session.json');
});

test('session names are short, plain and cannot traverse', () => {
  assert.equal(validateSessionName('lane-f3_a'), 'lane-f3_a');
  for (const bad of ['', '.', '..', '../x', 'a/b', 'a b', '-x', 'x'.repeat(41), undefined, 5]) assert.throws(() => validateSessionName(bad), UsageError, String(bad));
  assert.throws(() => sessionPaths('/r', '../escape'), UsageError);
});

test('file stems accept letters, digits and ._- and strip a png suffix', () => {
  assert.equal(safeFileName('01-design-light-1440x900'), '01-design-light-1440x900');
  assert.equal(safeFileName('shot.PNG'), 'shot');
  for (const bad of ['', '../x', 'a/b', 'a\\b', '.hidden', '-x', 'a..b', 'a b', 'x'.repeat(81), 'nul\0', undefined]) assert.throws(() => safeFileName(bad), UsageError, String(bad));
});

test('resolveInside refuses names that leave the base directory', () => {
  assert.equal(resolveInside('/base/dir', 'a.png'), '/base/dir/a.png');
  for (const bad of ['../a.png', '/etc/passwd', 'x/../../a', '', '.']) assert.throws(() => resolveInside('/base/dir', bad), UsageError, bad);
});

test('UTC stamps are sortable and default shot directories are per-repo', () => {
  assert.equal(utcStamp(new Date('2026-11-03T14:50:02.123Z')), '20261103T145002Z');
  assert.equal(defaultShotsDir('/r', new Date('2026-11-03T14:50:02Z')), '/r/.t3/dev-preview/shots/20261103T145002Z');
});

test('output directories: new and empty are fine, foreign content is refused, our own manifest is reusable', async () => {
  const fresh = join(root, 'out', 'nested', 'fresh');
  assert.equal(await prepareOutputDir(fresh), fresh);
  assert.ok((await stat(fresh)).isDirectory());
  assert.equal(await prepareOutputDir(fresh), fresh, 'empty directory is accepted');

  const foreign = join(root, 'out', 'foreign');
  await mkdir(foreign, { recursive: true });
  await writeFile(join(foreign, 'notes.txt'), 'keep me');
  await assert.rejects(prepareOutputDir(foreign), /Refusing to write into non-empty directory/);
  assert.equal(await readFile(join(foreign, 'notes.txt'), 'utf8'), 'keep me');

  const impostor = join(root, 'out', 'impostor');
  await mkdir(impostor, { recursive: true });
  await writeFile(join(impostor, 'manifest.json'), JSON.stringify({ schema: 'something-else' }));
  await assert.rejects(prepareOutputDir(impostor), UsageError);
  await writeFile(join(impostor, 'broken.json'), '{');
  await writeFile(join(impostor, 'manifest.json'), '{ not json');
  await assert.rejects(prepareOutputDir(impostor), UsageError);

  const previous = join(root, 'out', 'previous');
  await mkdir(previous, { recursive: true });
  await writeFile(join(previous, 'manifest.json'), JSON.stringify({ schema: MANIFEST_SCHEMA }));
  await writeFile(join(previous, '01-a.png'), 'x');
  assert.equal(await prepareOutputDir(previous), previous);

  const file = join(root, 'out', 'a-file');
  await writeFile(file, 'x');
  await assert.rejects(prepareOutputDir(file), /not a directory/);
  assert.equal(await prepareOutputDir(resolve(root, 'out', 'nested', '..', 'nested', 'fresh')), fresh, 'relative segments resolve');
});

test('session records validate their shape', () => {
  assert.equal(validateSessionRecord(record()).pid, 4242);
  for (const bad of [null, {}, record({ schema: 'x' }), record({ pid: 0 }), record({ pid: 'abc' }), record({ control: { port: 0, token: 'a'.repeat(48) } }),
    record({ control: { port: 70000, token: 'a'.repeat(48) } }), record({ control: { port: 1, token: 'short' } }), record({ evidenceDir: undefined })]) {
    assert.throws(() => validateSessionRecord(bad), /malformed/);
  }
});

test('session files round-trip, are private, and a missing one reads as null', async () => {
  const { dir, file } = sessionPaths(root, 'roundtrip');
  assert.equal(await readSessionFile(file), null);
  await writeSessionFile(file, record());
  assert.deepEqual(await readSessionFile(file), record());
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(dir)).mode & 0o777, 0o700);
  assert.deepEqual((await (await import('node:fs/promises')).readdir(dir)), ['session.json'], 'no temporary file is left behind');
  await assert.rejects(writeSessionFile(file, record({ pid: -1 })), /malformed/);
});

test('a corrupt session file is reported with its path rather than treated as absent', async () => {
  const { file } = sessionPaths(root, 'corrupt');
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, '{ nope');
  await assert.rejects(readSessionFile(file), /session\.json/);
  await writeFile(file, JSON.stringify({ schema: SESSION_SCHEMA }));
  await assert.rejects(readSessionFile(file), /malformed/);
});

test('removing a session file only succeeds for its owner', async () => {
  const { dir, file } = sessionPaths(root, 'owned');
  await writeSessionFile(file, record({ pid: 777 }));
  assert.equal(await removeSessionFile(file, 888), false, 'another process keeps its session');
  assert.ok(await exists(file));
  assert.equal(await removeSessionFile(file, 777), true);
  assert.equal(await exists(dir), false, 'the session directory goes with it');
  assert.equal(await removeSessionFile(file, 777), true, 'already gone is fine');
});

test('process liveness treats EPERM as alive and ESRCH as gone', () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(isProcessAlive(1, () => { throw Object.assign(new Error('x'), { code: 'EPERM' }); }), true);
  assert.equal(isProcessAlive(1, () => { throw Object.assign(new Error('x'), { code: 'ESRCH' }); }), false);
});

test('stale scratch is reaped only when its owner is gone', async () => {
  const scratch = join(root, 'scratch');
  const make = async (name, owner) => {
    await mkdir(join(scratch, name), { recursive: true });
    await writeFile(join(scratch, name, 'profile.dat'), 'x');
    if (owner !== undefined) await writeFile(join(scratch, name, OWNER_FILE), JSON.stringify({ pid: owner }));
  };
  await make('run-dead01', 111);
  await make('run-live02', 222);
  await make('run-fresh03');
  await make('run-old004');
  await make('unrelated');
  const old = new Date(Date.now() - 2 * 3_600_000);
  await utimes(join(scratch, 'run-old004'), old, old);
  const reaped = await reapStaleRuns(scratch, { isAlive: pid => pid === 222 });
  assert.deepEqual(reaped.sort(), ['run-dead01', 'run-old004']);
  assert.equal(await exists(join(scratch, 'run-dead01')), false);
  assert.equal(await exists(join(scratch, 'run-old004')), false);
  for (const kept of ['run-live02', 'run-fresh03', 'unrelated']) assert.ok(await exists(join(scratch, kept)), kept);
  assert.deepEqual(await reapStaleRuns(join(root, 'no-such-scratch')), []);
});

test('the owner file records the owning pid', async () => {
  const dir = join(root, 'owner');
  await mkdir(dir);
  await writeOwnerFile(dir, 99);
  assert.equal(JSON.parse(await readFile(join(dir, OWNER_FILE), 'utf8')).pid, 99);
});
