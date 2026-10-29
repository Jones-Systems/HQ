/** Gallery adapter: A/B releases, single pointer hop, digests, containment, blobs, generation change. */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parsePacket } from '../../src/packet.ts';
import { ProducerError } from '../src/errors.ts';
import { runProducer } from '../src/run.ts';
import { buildGallery, exists, galleryConfig, image, json, listTree, pointTo, png, sha, write } from './fixtures.ts';

async function rejects(promise: Promise<unknown>, code: string, where?: RegExp): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ProducerError, String(error));
    assert.equal(error.code, code);
    if (where !== undefined) assert.match(error.where ?? '', where);
    return true;
  });
}

async function storeFiles(out: string): Promise<string[]> { return (await listTree(out)).filter((file) => !file.startsWith('.')); }

describe('reads the current immutable release and writes deterministic, valid packets', () => {
  test('a gallery produces internal and publishable packets that the accepted reader validates', async () => {
    const { config, out } = await galleryConfig();
    const report = await runProducer(config);
    const [source] = report.sources;
    assert.equal(source!.status, 'written');
    assert.equal(source!.counts.captures, 5);
    assert.equal(source!.counts.anchors, 2);
    const dir = path.join(out, 'example-gallery', source!.internalDigest!.slice('sha256:'.length));
    for (const name of ['internal.packet.json', 'publishable.packet.json']) {
      const parsed = await parsePacket(JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')));
      assert.equal(parsed.status, 'ok', name);
    }
    assert.equal((await fs.readdir(path.join(dir, 'blobs'))).length, 4, 'one content-addressed blob per image');
  });

  test('packets depend only on source content: two stores and two runs give the same digests', async () => {
    const a = await galleryConfig();
    const first = await runProducer(a.config);
    const again = await runProducer(a.config);
    assert.equal(again.sources[0]!.status, 'unchanged');
    assert.equal(again.sources[0]!.internalDigest, first.sources[0]!.internalDigest);
    const b = await galleryConfig();
    const other = await runProducer(b.config);
    assert.equal(other.sources[0]!.internalDigest, first.sources[0]!.internalDigest);
    assert.equal(other.sources[0]!.publishableDigest, first.sources[0]!.publishableDigest);
  });

  test('the non-current release is never read', async () => {
    const { config } = await galleryConfig();
    await runProducer(config);
    // B holds invalid JSON in the fixture, so reading it would have aborted the run above.
    const { config: second, root } = await galleryConfig();
    await write(path.join(root, 'B', 'catalog.json'), 'garbage');
    await runProducer(second);
  });

  test('the second release can be the current one', async () => {
    const { config, root } = await galleryConfig();
    await buildGallery(root, { release: 'B' });
    await write(path.join(root, 'A', 'release.json'), 'broken');
    await pointTo(root, 'B');
    const report = await runProducer(config);
    assert.equal(report.sources[0]!.status, 'written');
  });
});

describe('pointer: resolved once, one declared hop only', () => {
  test('a pointer that moves during the run aborts with no output', async () => {
    const { config, root, out } = await galleryConfig();
    await buildGallery(root, { release: 'B' });
    await rejects(runProducer(config, { afterRead: () => pointTo(root, 'B') }), 'generation-changed');
    assert.equal(await exists(out), false, 'no output store was created');
  });

  for (const [name, setup, code] of [
    ['a pointer that is a real directory', async (root: string) => { await fs.rm(path.join(root, 'current')); await fs.cp(path.join(root, 'A'), path.join(root, 'current'), { recursive: true }); }, 'pointer-not-symlink'],
    ['a pointer naming a release that is not allowed', async (root: string) => { await fs.mkdir(path.join(root, 'C')); await pointTo(root, 'C'); }, 'pointer-target-not-allowed'],
    ['a pointer with a path target', async (root: string) => { await pointTo(root, './A'); }, 'pointer-target-not-allowed'],
    ['a pointer escaping the root', async (root: string) => { await pointTo(root, '../gallery/A'); }, 'pointer-target-not-allowed'],
    ['an absolute pointer target', async (root: string) => { await pointTo(root, path.join(root, 'A')); }, 'pointer-target-not-allowed'],
    ['a missing pointer', async (root: string) => { await fs.rm(path.join(root, 'current')); }, 'pointer-missing'],
    ['a pointer to a release that is itself a link', async (root: string) => { await fs.rename(path.join(root, 'A'), path.join(root, 'A-real')); await fs.symlink('A-real', path.join(root, 'A')); }, 'release-not-directory'],
  ] as const) {
    test(`rejects ${name}`, async () => {
      const { config, root, out } = await galleryConfig();
      await setup(root);
      await rejects(runProducer(config), code);
      assert.equal(await exists(out), false);
    });
  }
});

describe('schema, version and digest checks abort with no output', () => {
  const cases: [string, Parameters<typeof buildGallery>[1], string][] = [
    ['an unknown release schema', { mutateManifest: (m) => { m.schema = 'something.else/v1'; } }, 'unknown-schema'],
    ['a future release version', { mutateManifest: (m) => { m.schema = 'hq.producer.gallery-release/v2'; } }, 'future-version'],
    ['a release name that disagrees with the pointer', { mutateManifest: (m) => { m.release = 'B'; } }, 'release-name-mismatch'],
    ['a catalog digest mismatch', { mutateManifest: (m) => { m.catalogDigest = sha('other'); } }, 'catalog-digest-mismatch'],
    ['a catalog path with a separator', { mutateManifest: (m) => { m.catalog = 'sub/catalog.json'; } }, 'unsafe-path'],
  ];
  for (const [name, options, code] of cases) {
    test(`rejects ${name}`, async () => {
      const { config, root, out } = await galleryConfig();
      await fs.rm(path.join(root, 'A'), { recursive: true });
      await buildGallery(root, options);
      await rejects(runProducer(config), code);
      assert.equal(await exists(out), false);
    });
  }

  test('rejects an unknown or future catalog schema', async () => {
    for (const [schema, code] of [['hq.producer.gallery-catalog/v2', 'future-version'], ['nope/v1', 'unknown-schema']] as const) {
      const { config, root, out } = await galleryConfig();
      const bytes = Buffer.from(json({ schema, entries: [] }));
      await write(path.join(root, 'A', 'catalog.json'), bytes);
      await write(path.join(root, 'A', 'release.json'), json({ schema: 'hq.producer.gallery-release/v1', release: 'A', generation: 1, catalog: 'catalog.json', catalogDigest: sha(bytes) }));
      await rejects(runProducer(config), code);
      assert.equal(await exists(out), false);
    }
  });
});

describe('containment: traversal, links, regular files, byte caps', () => {
  const entriesWith = (image: unknown) => () => [{
    kind: 'website', origin: 'https://example.test', title: 'Site', pages: [{ url: 'https://example.test/', title: 'Home', captures: [{ kind: 'screenshot', capturedAt: '2026-01-01T00:00:00.000Z', capturedBy: 'agent-reported', image }] }],
  }];
  const imageAt = (rel: string) => ({ path: rel, sha256: sha('x'), bytes: 1, mediaType: 'image/png' });

  for (const rel of ['../outside.png', 'images/../../outside.png', '/etc/hostname', 'images\\x.png', 'images//x.png', './x.png', '']) {
    test(`rejects the image path ${JSON.stringify(rel)}`, async () => {
      const { config, root, out } = await galleryConfig();
      await fs.rm(path.join(root, 'A'), { recursive: true });
      await buildGallery(root, { entries: entriesWith(imageAt(rel)) });
      await rejects(runProducer(config), 'unsafe-path');
      assert.equal(await exists(out), false);
    });
  }

  test('rejects an image that is a symbolic link, even to a file inside the release', async () => {
    const { config, root, out } = await galleryConfig();
    await fs.rm(path.join(root, 'A'), { recursive: true });
    await buildGallery(root, { entries: (images) => entriesWith({ ...images.home, path: 'images/link.png' })() });
    await fs.symlink('home.png', path.join(root, 'A', 'images', 'link.png'));
    await rejects(runProducer(config), 'symlink-rejected');
    assert.equal(await exists(out), false);
  });

  test('rejects an image reached through a symbolic link directory', async () => {
    const { config, root } = await galleryConfig();
    await fs.rm(path.join(root, 'A'), { recursive: true });
    await buildGallery(root, { entries: (images) => entriesWith({ ...images.home, path: 'alias/home.png' })() });
    await fs.symlink('images', path.join(root, 'A', 'alias'));
    await rejects(runProducer(config), 'symlink-rejected');
  });

  test('rejects an image that is a directory and never reads outside the root', async () => {
    const { config, root, base, out } = await galleryConfig();
    await write(path.join(base, 'secret.png'), png('secret'));
    await fs.rm(path.join(root, 'A'), { recursive: true });
    await buildGallery(root, { entries: () => entriesWith({ path: 'images/dir.png', sha256: sha('x'), bytes: 1, mediaType: 'image/png' })() });
    await fs.mkdir(path.join(root, 'A', 'images', 'dir.png'));
    await rejects(runProducer(config), 'not-regular-file');
    assert.equal(await exists(out), false);
  });

  test('a missing image keeps the capture as blob-missing and is tallied', async () => {
    const { config, root } = await galleryConfig();
    await fs.rm(path.join(root, 'A', 'images', 'pricing.png'));
    const report = await runProducer(config);
    const [source] = report.sources;
    assert.equal(source!.tallies['blobs-missing'], 1);
    assert.equal(source!.counts['availability:blob-missing'], 1);
    assert.equal(source!.counts.captures, 5);
  });

  test('a hash-invalid image is not ingested and the capture is blob-missing', async () => {
    const { config, root, out } = await galleryConfig();
    await write(path.join(root, 'A', 'images', 'pricing.png'), png('tampered'));
    const [source] = (await runProducer(config)).sources;
    assert.equal(source!.tallies['blobs-hash-invalid'], 1);
    assert.equal(source!.counts['availability:blob-missing'], 1);
    const blobs = await fs.readdir(path.join(out, 'example-gallery', source!.internalDigest!.slice(7), 'blobs'));
    assert.equal(blobs.length, 3, 'the tampered bytes are not copied');
  });

  test('a size that disagrees with the catalog is hash-invalid', async () => {
    const { config, root } = await galleryConfig();
    await fs.rm(path.join(root, 'A'), { recursive: true });
    await buildGallery(root, { entries: (images) => entriesWith({ ...images.home, bytes: 9999 })() });
    const [source] = (await runProducer(config)).sources;
    assert.equal(source!.tallies['blobs-hash-invalid'], 1);
  });

  test('per-file, JSON, total and file-count caps', async () => {
    const small = await galleryConfig({ limits: { maxFileBytes: 20, maxJsonBytes: 8 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024, maxFiles: 20000 } });
    const [source] = (await runProducer(small.config)).sources;
    assert.equal(source!.tallies['blobs-too-large'], 4, 'oversized blobs are not read and stay blob-missing');
    const json = await galleryConfig({ limits: { maxFileBytes: 1 << 20, maxJsonBytes: 100, maxTotalBytes: 1 << 30, maxFiles: 20000 } });
    await rejects(runProducer(json.config), 'file-too-large');
    const total = await galleryConfig({ limits: { maxFileBytes: 1 << 20, maxJsonBytes: 1 << 20, maxTotalBytes: 3000, maxFiles: 20000 } });
    await rejects(runProducer(total.config), 'source-too-large');
    const count = await galleryConfig({ limits: { maxFileBytes: 1 << 20, maxJsonBytes: 1 << 20, maxTotalBytes: 1 << 30, maxFiles: 3 } });
    await rejects(runProducer(count.config), 'too-many-files');
    for (const built of [json, total, count]) assert.equal(await exists(built.out), false);
  });

  test('markup, scripts, SVG and disguised content are excluded, not stored', async () => {
    const { config, root, out } = await galleryConfig();
    const dir = path.join(root, 'A');
    await fs.rm(dir, { recursive: true });
    const html = Buffer.from('<!doctype html><script>alert(1)</script>');
    await buildGallery(root, {
      entries: () => [{ kind: 'website', origin: 'https://example.test', title: 'Site', pages: [{ url: 'https://example.test/', title: 'Home', captures: [] }] }],
    });
    // Rewrite the catalog with captures that need files written under the release.
    const capture = async (rel: string, bytes: Buffer, mediaType: string) => ({ kind: 'screenshot', capturedAt: '2026-01-01T00:00:00.000Z', capturedBy: 'agent-reported', image: await image(dir, { path: rel, label: 'x', mediaType }, bytes) });
    const captures = [
      await capture('images/page.html', html, 'text/html'), await capture('images/vector.svg', Buffer.from('<svg/>'), 'image/svg+xml'),
      await capture('images/app.js', Buffer.from('alert(1)'), 'application/javascript'), await capture('images/disguised.png', html, 'image/png'),
      await capture('images/typed.jpg', png('jpeg-named-png'), 'image/png'), await capture('images/ok.png', png('ok'), 'image/png'),
    ];
    const catalog = Buffer.from(json({ schema: 'hq.producer.gallery-catalog/v1', entries: [{ kind: 'website', origin: 'https://example.test', title: 'Site', pages: [{ url: 'https://example.test/', title: 'Home', captures }] }] }));
    await write(path.join(dir, 'catalog.json'), catalog);
    await write(path.join(dir, 'release.json'), json({ schema: 'hq.producer.gallery-release/v1', release: 'A', generation: 1, catalog: 'catalog.json', catalogDigest: sha(catalog) }));
    const [source] = (await runProducer(config)).sources;
    assert.equal(source!.counts.captures, 1);
    assert.equal(source!.tallies['captures-excluded-content-type'], 3);
    assert.equal(source!.tallies['captures-excluded-content-mismatch'], 1);
    assert.equal(source!.tallies['captures-excluded-media-type-mismatch'], 1);
    const stored = await fs.readdir(path.join(out, 'example-gallery', source!.internalDigest!.slice(7), 'blobs'));
    assert.equal(stored.length, 1);
  });
});

describe('generation change aborts with no output', () => {
  test('an image rewritten during the run', async () => {
    const { config, root, out } = await galleryConfig();
    await rejects(runProducer(config, { afterRead: async () => { await write(path.join(root, 'A', 'images', 'home.png'), png('rewritten, longer than before')); } }), 'generation-changed');
    assert.deepEqual(await storeFiles(out), []);
  });

  test('a file replaced with identical bytes (new inode) during the run', async () => {
    const { config, root, out } = await galleryConfig();
    const file = path.join(root, 'A', 'images', 'home.png');
    await rejects(runProducer(config, { afterRead: async () => { const bytes = await fs.readFile(file); await fs.rm(file); await fs.writeFile(file, bytes); } }), 'generation-changed');
    assert.equal(await exists(out), false);
  });

  test('a file removed during the run', async () => {
    const { config, root, out } = await galleryConfig();
    await rejects(runProducer(config, { afterRead: () => fs.rm(path.join(root, 'A', 'catalog.json')) }), 'generation-changed');
    assert.equal(await exists(out), false);
  });

  test('a later source changing means nothing is written for an earlier one either', async () => {
    const first = await galleryConfig();
    const second = await galleryConfig({ id: 'second-gallery' });
    const config = { outputRoot: first.out, sources: [first.source, { ...second.source, id: 'second-gallery' }] };
    await rejects(runProducer(config, { afterRead: () => fs.rm(path.join(second.root, 'A', 'release.json')) }), 'generation-changed');
    assert.equal(await exists(first.out), false);
  });
});
