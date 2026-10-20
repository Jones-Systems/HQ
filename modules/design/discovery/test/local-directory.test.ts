import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { buildLocalDirectorySnapshot, isLocalSegment, LOCAL_PREVIEW_LIMIT, type LocalDirectoryFs } from '../node/local-directory.ts';
import { isoTime, rootId } from '../src/contract.ts';
import { parseSnapshot } from '../src/catalog.ts';
import { LOCAL_HOST_ID } from '../src/adapters/local-directory.ts';

const options = { rootId: rootId('synthetic-root'), generation: 17, observedAt: isoTime('2026-10-20T00:00:00.000Z') };
const signal = () => new AbortController().signal;
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const jpg = Uint8Array.from([255, 216, 255, 224, 1, 2, 3]);
const webp = Uint8Array.from([82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]);

async function fixture(t: TestContext): Promise<string> {
  const root = await fs.mkdtemp(join(tmpdir(), 'hq-local-catalog-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}

async function preview(root: string, name: string, bytes: Uint8Array, filename = 'preview.png'): Promise<string> {
  const folder = join(root, name, '.hq');
  await fs.mkdir(folder, { recursive: true });
  const path = join(folder, filename);
  await fs.writeFile(path, bytes);
  return path;
}

test('local snapshot includes immediate directories only, fixed host, persisted generation and root-aware JCS identities', async (t) => {
  const root = await fixture(t);
  await fs.mkdir(join(root, 'one', 'nested'), { recursive: true });
  await fs.mkdir(join(root, '.hidden'));
  await fs.writeFile(join(root, 'plain-file'), 'ignored');
  const built = await buildLocalDirectorySnapshot(root, options, signal());
  assert.equal(built.snapshot.complete, true);
  assert.equal(built.snapshot.generation, 17);
  assert.equal(built.snapshot.observedAt, options.observedAt);
  assert.equal(built.snapshot.hostId, LOCAL_HOST_ID);
  assert.deepEqual(built.snapshot.entries.map((e) => e.relativePath), ['one']);
  const entry = built.snapshot.entries[0]!;
  assert.deepEqual(entry.repoIdentity, { localOnly: true });
  assert.deepEqual(entry.metadata, {});
  assert.equal(entry.rootId, options.rootId);
  assert.equal(entry.displayName, 'one');
  assert.equal(entry.sourceProjectId, createHash('sha256')
    .update('{"hostId":"laptop-local","relativePath":"one","rootId":"synthetic-root"}').digest('hex'));
  assert.equal((await parseSnapshot(built.snapshot, LOCAL_HOST_ID)).ok, true);
  assert.equal(JSON.stringify(built.snapshot).includes(root), false);
  const again = await buildLocalDirectorySnapshot(root, options, signal());
  assert.equal(again.snapshot.entries[0]!.sourceProjectId, entry.sourceProjectId);
  const other = await buildLocalDirectorySnapshot(root, { ...options, rootId: rootId('other') }, signal());
  assert.notEqual(other.snapshot.entries[0]!.sourceProjectId, entry.sourceProjectId);
});

test('entry cap returns at most 500 and incomplete when more eligible children exist', async (t) => {
  const root = await fixture(t);
  await Promise.all(Array.from({ length: 501 }, (_, i) => fs.mkdir(join(root, `entry-${i}`))));
  const built = await buildLocalDirectorySnapshot(root, options, signal());
  assert.equal(built.snapshot.entries.length, 500);
  assert.equal(built.snapshot.complete, false);
});

test('segment validation refuses traversal, separators, control characters and oversized names', () => {
  for (const bad of ['', '.', '..', '.hidden', '../escape', 'a/b', 'a\\b', 'a..b', 'a\nb', 'a\u007fb', 'a\u0085b', ' a', 'a ', 'a'.repeat(256)]) {
    assert.equal(isLocalSegment(bad), false, JSON.stringify(bad));
  }
  for (const good of ['app', 'app.name', 'a'.repeat(255), '日本語']) assert.equal(isLocalSegment(good), true);
});

test('invalid child segments are excluded from snapshots', async (t) => {
  const root = await fixture(t);
  for (const name of ['good', 'a..b', 'bad\nname', 'a\\b']) await fs.mkdir(join(root, name));
  assert.deepEqual((await buildLocalDirectorySnapshot(root, options, signal())).snapshot.entries.map((e) => e.relativePath), ['good']);
});

test('symlinked entries, preview directories and preview files are skipped', async (t) => {
  const root = await fixture(t);
  const target = await fixture(t);
  await preview(target, 'real', png);
  await fs.symlink(join(target, 'real'), join(root, 'linked-directory'), 'dir');
  await fs.symlink(join(target, 'real', '.hq', 'preview.png'), join(root, 'linked-file'));
  await fs.mkdir(join(root, 'linked-hq'));
  await fs.symlink(join(target, 'real', '.hq'), join(root, 'linked-hq', '.hq'), 'dir');
  await fs.mkdir(join(root, 'linked-preview', '.hq'), { recursive: true });
  await fs.symlink(join(target, 'real', '.hq', 'preview.png'), join(root, 'linked-preview', '.hq', 'preview.png'));
  const built = await buildLocalDirectorySnapshot(root, options, signal());
  assert.deepEqual(built.snapshot.entries.map((e) => e.relativePath), ['linked-hq', 'linked-preview']);
  assert.ok(built.snapshot.entries.every((e) => e.previews.length === 0));
});

test('realpath escape is refused even when lstat reports a directory', async (t) => {
  const root = await fixture(t);
  const outside = await fixture(t);
  await fs.mkdir(join(root, 'escape'));
  const injected: LocalDirectoryFs = { ...fs, realpath: (async (path: unknown) =>
    path === join(root, 'escape') ? outside : fs.realpath(path as string)) as typeof fs.realpath };
  await assert.rejects(buildLocalDirectorySnapshot(root, options, signal(), injected), /enumeration refused/);
});

test('filesystem instrumentation proves .git and non-preview content are never read', async (t) => {
  const root = await fixture(t);
  await fs.mkdir(join(root, 'app', '.git'), { recursive: true });
  await fs.writeFile(join(root, 'app', '.git', 'config'), 'synthetic-private-marker');
  await fs.writeFile(join(root, 'app', 'content.txt'), 'synthetic-content-marker');
  await preview(root, 'app', png, 'unrelated.png');
  const calls: string[] = [];
  const injected = Object.fromEntries(['lstat', 'opendir', 'open', 'realpath'].map((key) => {
    const method = fs[key as keyof LocalDirectoryFs];
    return [key, new Proxy(method, { apply(target, thisArg, args) {
      const path = String(args[0]);
      assert.equal(path.split(sep).includes('.git'), false);
      if (key === 'open') calls.push(path);
      return Reflect.apply(target, thisArg, args);
    } })];
  })) as unknown as LocalDirectoryFs;
  const built = await buildLocalDirectorySnapshot(root, options, signal(), injected);
  assert.equal(built.snapshot.entries.length, 1);
  assert.deepEqual(built.snapshot.entries[0]!.previews, []);
  assert.deepEqual(calls, []);
});

test('all four preview names require matching magic and publish verifiable sha256 bytes', async (t) => {
  const root = await fixture(t);
  for (const [name, bytes] of [['preview.png', png], ['preview.jpg', jpg], ['preview.jpeg', jpg], ['preview.webp', webp]] as const) {
    await preview(root, 'valid', bytes, name);
  }
  await preview(root, 'invalid', jpg, 'preview.png');
  await preview(root, 'invalid', png, 'preview.jpg');
  await preview(root, 'invalid', new Uint8Array([82, 73, 70, 70]), 'preview.webp');
  const built = await buildLocalDirectorySnapshot(root, options, signal());
  assert.deepEqual(built.snapshot.entries.find((e) => e.relativePath === 'invalid')!.previews, []);
  const refs = built.snapshot.entries.find((e) => e.relativePath === 'valid')!.previews;
  assert.equal(refs.length, 4);
  for (const ref of refs) {
    const bytes = await built.preview(ref, signal());
    assert.equal(bytes.byteLength, ref.bytes);
    assert.equal(ref.digest, `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
  }
});

test('preview cap admits exactly 5 MiB and rejects one byte over', async (t) => {
  const root = await fixture(t);
  const bytes = new Uint8Array(LOCAL_PREVIEW_LIMIT);
  bytes.set(png);
  await preview(root, 'at-limit', bytes);
  const over = new Uint8Array(LOCAL_PREVIEW_LIMIT + 1);
  over.set(png);
  await preview(root, 'over-limit', over);
  const built = await buildLocalDirectorySnapshot(root, options, signal());
  const ref = built.snapshot.entries.find((e) => e.relativePath === 'at-limit')!.previews[0]!;
  assert.equal(ref.bytes, LOCAL_PREVIEW_LIMIT);
  assert.equal((await built.preview(ref, signal())).length, LOCAL_PREVIEW_LIMIT);
  assert.deepEqual(built.snapshot.entries.find((e) => e.relativePath === 'over-limit')!.previews, []);
});

test('preview reread rejects changed digest, unknown refs and symlink replacement', async (t) => {
  const root = await fixture(t);
  const path = await preview(root, 'app', png);
  const built = await buildLocalDirectorySnapshot(root, options, signal());
  const ref = built.snapshot.entries[0]!.previews[0]!;
  await fs.writeFile(path, Uint8Array.from([...png.slice(0, -1), 99]));
  await assert.rejects(built.preview(ref, signal()), /digest mismatch/);
  await assert.rejects(built.preview({ ...ref, bytes: ref.bytes + 1 }, signal()), /Unknown/);
  const outside = await fixture(t);
  const target = await preview(outside, 'app', png);
  await fs.unlink(path);
  await fs.symlink(target, path);
  await assert.rejects(built.preview(ref, signal()), /unavailable or invalid/);
});

test('root options and cancellation are checked without exposing paths', async (t) => {
  const root = await fixture(t);
  await assert.rejects(buildLocalDirectorySnapshot(root, { ...options, generation: -1 }, signal()), /Invalid/);
  await assert.rejects(buildLocalDirectorySnapshot('relative', options, signal()), /Invalid/);
  await assert.rejects(buildLocalDirectorySnapshot(join(root, 'missing'), options, signal()), (error: Error) =>
    error.message === 'Local catalog root is unavailable' && !error.message.includes(root));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(buildLocalDirectorySnapshot(root, options, controller.signal), { name: 'AbortError' });
  const path = await preview(root, 'app', png);
  const built = await buildLocalDirectorySnapshot(root, options, signal());
  await assert.rejects(built.preview(built.snapshot.entries[0]!.previews[0]!, controller.signal), { name: 'AbortError' });
  assert.ok(await fs.stat(path));
});

test('preview reread rechecks containment and rejects a replaced root', async (t) => {
  const container = await fixture(t);
  const root = join(container, 'selected');
  await preview(root, 'app', png);
  const outside = await fixture(t);
  let escape = false;
  const injected: LocalDirectoryFs = { ...fs, realpath: (async (path: unknown) =>
    escape && path === join(root, 'app', '.hq') ? outside : fs.realpath(path as string)) as typeof fs.realpath };
  const built = await buildLocalDirectorySnapshot(root, options, signal(), injected);
  const ref = built.snapshot.entries[0]!.previews[0]!;
  escape = true;
  await assert.rejects(built.preview(ref, signal()), /unavailable or invalid/);
  escape = false;
  await fs.rename(root, join(container, 'previous'));
  await fs.symlink(outside, root, 'dir');
  await assert.rejects(built.preview(ref, signal()), /unavailable or invalid/);
});

test('snapshot cancellation during enumeration stops before publishing partial data', async (t) => {
  const root = await fixture(t);
  await fs.mkdir(join(root, 'app'));
  const controller = new AbortController();
  const injected: LocalDirectoryFs = { ...fs, lstat: (async (path: unknown, ...args: unknown[]) => {
    if (path === join(root, 'app')) controller.abort();
    return Reflect.apply(fs.lstat, fs, [path, ...args]);
  }) as typeof fs.lstat };
  await assert.rejects(buildLocalDirectorySnapshot(root, options, controller.signal, injected), { name: 'AbortError' });
});
