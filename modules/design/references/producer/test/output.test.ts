/** The output store: owned, external, never inside a Git working tree, written only after every check. */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { ProducerError } from '../src/errors.ts';
import { runProducer } from '../src/run.ts';
import { STORE_MARKER } from '../src/store.ts';
import { exists, galleryConfig, listTree, tmp, write } from './fixtures.ts';

async function rejects(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ProducerError, String(error));
    assert.equal(error.code, code);
    return true;
  });
}

describe('no Git ancestor of any kind', () => {
  test('a .git directory in a parent', async () => {
    const built = await galleryConfig();
    const repo = path.join(built.base, 'repo');
    await fs.mkdir(path.join(repo, '.git'), { recursive: true });
    const config = { ...built.config, outputRoot: path.join(repo, 'deeper', 'out') };
    await rejects(runProducer(config), 'output-git-ancestor');
    assert.equal(await exists(path.join(repo, 'deeper')), false, 'nothing was created');
  });

  test('a .git file in a parent (a linked worktree)', async () => {
    const built = await galleryConfig();
    const linked = path.join(built.base, 'linked');
    await write(path.join(linked, '.git'), 'gitdir: /nonexistent/worktrees/x\n');
    const config = { ...built.config, outputRoot: path.join(linked, 'out') };
    await rejects(runProducer(config), 'output-git-ancestor');
    assert.equal(await exists(path.join(linked, 'out')), false);
  });

  test('the output directory itself holding a .git entry', async () => {
    const built = await galleryConfig();
    await fs.mkdir(path.join(built.out, '.git'), { recursive: true });
    await rejects(runProducer(built.config), 'output-git-ancestor');
  });

  test('a dangling .git link still counts', async () => {
    const built = await galleryConfig();
    const odd = path.join(built.base, 'odd');
    await fs.mkdir(odd);
    await fs.symlink('nowhere', path.join(odd, '.git'));
    await rejects(runProducer({ ...built.config, outputRoot: path.join(odd, 'out') }), 'output-git-ancestor');
  });

  test('an output path that is a symbolic link into a repository', async () => {
    const built = await galleryConfig();
    const repo = path.join(built.base, 'repo');
    await fs.mkdir(path.join(repo, '.git'), { recursive: true });
    await fs.mkdir(path.join(repo, 'inside'));
    const alias = path.join(built.base, 'alias');
    await fs.symlink(path.join(repo, 'inside'), alias);
    await rejects(runProducer({ ...built.config, outputRoot: path.join(alias, 'out') }), 'output-git-ancestor');
    assert.deepEqual(await fs.readdir(path.join(repo, 'inside')), []);
  });

  test('a relative output root is refused', async () => {
    const built = await galleryConfig();
    await rejects(runProducer({ ...built.config, outputRoot: 'relative/out' }), 'output-not-absolute');
  });
});

describe('ownership', () => {
  test('a non-empty directory the producer did not create is refused and left alone', async () => {
    const built = await galleryConfig();
    await write(path.join(built.out, 'precious.txt'), 'keep');
    await rejects(runProducer(built.config), 'output-not-owned');
    assert.deepEqual(await fs.readdir(built.out), ['precious.txt']);
    assert.equal(await fs.readFile(path.join(built.out, 'precious.txt'), 'utf8'), 'keep');
  });

  test('an existing empty directory is adopted and marked', async () => {
    const built = await galleryConfig();
    await fs.mkdir(built.out);
    await runProducer(built.config);
    assert.ok((await fs.readdir(built.out)).includes(STORE_MARKER));
  });

  test('a marked store is reused and a second source joins it', async () => {
    const first = await galleryConfig();
    const second = await galleryConfig({ id: 'second-gallery' });
    await runProducer(first.config);
    const config = { outputRoot: first.out, sources: [second.source] };
    const [report] = (await runProducer(config)).sources;
    assert.equal(report!.status, 'written');
    assert.deepEqual((await fs.readdir(first.out)).filter((name) => name !== STORE_MARKER).sort(), ['example-gallery', 'second-gallery']);
  });

  test('a marker that is a directory is not a store', async () => {
    const built = await galleryConfig();
    await fs.mkdir(path.join(built.out, STORE_MARKER), { recursive: true });
    await rejects(runProducer(built.config), 'output-not-owned');
  });

  test('a changed packet already stored under the same digest is a conflict, never overwritten', async () => {
    const built = await galleryConfig();
    const [report] = (await runProducer(built.config)).sources;
    const target = path.join(built.out, 'example-gallery', report!.internalDigest!.slice(7), 'internal.packet.json');
    await fs.writeFile(target, 'tampered');
    await rejects(runProducer(built.config), 'output-conflict');
    assert.equal(await fs.readFile(target, 'utf8'), 'tampered');
  });
});

describe('overlap with the source', () => {
  test('output inside a source root', async () => {
    const built = await galleryConfig();
    await rejects(runProducer({ ...built.config, outputRoot: path.join(built.root, 'out') }), 'output-overlaps-source');
  });

  test('a source root inside the output', async () => {
    const built = await galleryConfig();
    await rejects(runProducer({ ...built.config, outputRoot: built.base }), 'output-overlaps-source');
  });
});

describe('what is written', () => {
  test('a closed set of files, private modes, no staging leftovers', async () => {
    const built = await galleryConfig();
    const [report] = (await runProducer(built.config)).sources;
    const hex = report!.internalDigest!.slice(7);
    const tree = await listTree(built.out);
    const base = path.join('example-gallery', hex);
    assert.deepEqual(tree.filter((name) => !name.startsWith(path.join(base, 'blobs') + path.sep)), [
      STORE_MARKER, 'example-gallery', base, path.join(base, 'blobs'), path.join(base, 'internal.packet.json'), path.join(base, 'publishable.packet.json'), path.join(base, 'receipt.json'),
    ].sort());
    for (const name of tree) {
      const stat = await fs.lstat(path.join(built.out, name));
      assert.equal(stat.isSymbolicLink(), false);
      assert.equal(stat.mode & 0o077, 0, `${stat.isDirectory() ? 'directory' : 'file'} is private to the owner`);
    }
  });

  test('the receipt holds aggregates only', async () => {
    const built = await galleryConfig();
    const [report] = (await runProducer(built.config)).sources;
    const receipt = JSON.parse(await fs.readFile(path.join(built.out, 'example-gallery', report!.internalDigest!.slice(7), 'receipt.json'), 'utf8')) as Record<string, unknown>;
    assert.deepEqual(Object.keys(receipt).sort(), ['counts', 'internalDigest', 'publishableDigest', 'schema', 'tallies']);
    for (const group of [receipt.counts, receipt.tallies] as Record<string, unknown>[]) for (const value of Object.values(group)) assert.equal(typeof value, 'number');
  });

  test('a failure in a later source leaves no output at all', async () => {
    const good = await galleryConfig();
    const broken = await galleryConfig({ id: 'broken-gallery' });
    await fs.rm(path.join(broken.root, 'current'));
    await rejects(runProducer({ outputRoot: good.out, sources: [good.source, broken.source] }), 'pointer-missing');
    assert.equal(await exists(good.out), false);
  });

  test('missing parent directories of the output are created', async () => {
    const base = await tmp();
    const built = await galleryConfig();
    const out = path.join(base, 'deep', 'er', 'out');
    await runProducer({ ...built.config, outputRoot: out });
    assert.ok(await exists(path.join(out, STORE_MARKER)));
  });
});
