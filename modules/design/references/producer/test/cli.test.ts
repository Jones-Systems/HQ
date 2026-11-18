/** The local command line prints aggregate counts and digests only, and stable codes on failure. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { AT, buildGallery, json, pointTo, png, tmp, write } from './fixtures.ts';
import { CONFIG_SCHEMA } from '../src/config.ts';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts');
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 60_000 });

/** A gallery where every free-text value, file name and directory name carries a sentinel. */
async function sentinelGallery() {
  const base = await tmp('SENTINEL-DIR-');
  const root = path.join(base, 'SENTINEL-ROOT');
  await buildGallery(root, {
    entries: (images) => [{ kind: 'website', origin: 'https://sentinel-origin.example.test', title: 'SENTINEL-TITLE', pages: [
      { url: 'https://sentinel-origin.example.test/SENTINEL-PATH', title: 'SENTINEL-PAGE', captures: [{
        kind: 'screenshot', capturedAt: AT, capturedBy: 'agent-reported', image: images.home, rights: { vocabulary: 'hq.design.references/v1', value: 'permitted', basis: 'SENTINEL-BASIS', attribution: 'SENTINEL-ATTRIBUTION' },
        producer: { id: 'SENTINEL-PRODUCER', label: 'SENTINEL-LABEL' }, anchors: [{ key: 'SENTINEL-KEY', kind: 'section', label: 'SENTINEL-ANCHOR', rect: { x: 0, y: 0, w: 1, h: 1 } }],
      }] },
    ] }],
  });
  await pointTo(root, 'A');
  const config = path.join(base, 'SENTINEL-CONFIG.json');
  const out = path.join(base, 'SENTINEL-OUT');
  await write(config, json({ schema: CONFIG_SCHEMA, outputRoot: out, sources: [{ id: 'sentinel-id', kind: 'gallery', root, pointer: 'current', releases: ['A', 'B'] }] }));
  return { base, root, config, out };
}

describe('command line', () => {
  test('prints aggregates and digests, and nothing from the source or the configuration', async () => {
    const built = await sentinelGallery();
    const result = run(built.config);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.doesNotMatch(result.stdout, /sentinel/iu);
    const report = JSON.parse(result.stdout) as { ok: boolean; sources: Record<string, unknown>[] };
    assert.equal(report.ok, true);
    assert.deepEqual(Object.keys(report.sources[0]!).sort(), ['bytesRead', 'counts', 'filesRead', 'index', 'internalDigest', 'kind', 'publishableDigest', 'status', 'tallies']);
    assert.match(String(report.sources[0]!.internalDigest), /^sha256:[0-9a-f]{64}$/u);
    for (const group of [report.sources[0]!.counts, report.sources[0]!.tallies] as Record<string, unknown>[]) for (const [name, value] of Object.entries(group)) {
      assert.equal(typeof value, 'number', name);
      assert.doesNotMatch(name, /sentinel/iu);
    }
  });

  test('a second run reports unchanged with the same digest', async () => {
    const built = await sentinelGallery();
    const first = JSON.parse(run(built.config).stdout);
    const second = JSON.parse(run(built.config).stdout);
    assert.equal(second.sources[0].status, 'unchanged');
    assert.equal(second.sources[0].internalDigest, first.sources[0].internalDigest);
  });

  test('failures print a stable code and a field path only, with no output store', async () => {
    const built = await sentinelGallery();
    await fs.rm(path.join(built.root, 'A', 'release.json'));
    await write(path.join(built.root, 'A', 'release.json'), json({ schema: 'hq.producer.gallery-release/v9', release: 'A', generation: 1, catalog: 'SENTINEL-catalog.json', catalogDigest: 'SENTINEL' }));
    const result = run(built.config);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.doesNotMatch(result.stderr, /sentinel/iu);
    assert.deepEqual(JSON.parse(result.stderr), { ok: false, code: 'future-version', where: 'release' });
    await assert.rejects(fs.lstat(built.out));
  });

  test('an unreadable or invalid configuration prints a code and no value', async () => {
    const base = await tmp('SENTINEL-DIR-');
    const bad = path.join(base, 'SENTINEL-bad.json');
    await write(bad, '{"schema":"SENTINEL-SCHEMA","outputRoot":"SENTINEL-OUT","sources":[]}');
    for (const args of [[bad], [path.join(base, 'SENTINEL-missing.json')], [], [bad, 'extra']]) {
      const result = run(...args);
      assert.notEqual(result.status, 0);
      assert.equal(result.stdout, '');
      assert.doesNotMatch(result.stderr, /sentinel/iu);
      assert.equal(JSON.parse(result.stderr).ok, false);
    }
  });

  test('a configuration that is a symbolic link is not followed', async () => {
    const built = await sentinelGallery();
    const link = path.join(built.base, 'link.json');
    await fs.symlink(built.config, link);
    const result = run(link);
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stderr).code, 'config-unreadable');
  });

  test('an unexpected failure is reported as a code, not a stack or message', async () => {
    const built = await sentinelGallery();
    await fs.writeFile(path.join(built.root, 'A', 'images', 'home.png'), png('x'));
    await fs.chmod(path.join(built.root, 'A', 'images', 'home.png'), 0);
    const result = run(built.config);
    assert.doesNotMatch(result.stderr, /sentinel/iu);
    assert.doesNotMatch(result.stderr, /\bat\s.*\(.*:\d+:\d+\)/u);
  });
});
