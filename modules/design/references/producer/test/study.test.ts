/** Study adapter: receipts, partial runs, digests, annotation merge, dropped taste fields. */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { ProducerError } from '../src/errors.ts';
import { runProducer } from '../src/run.ts';
import { exists, json, listTree, sha, studyConfig, write } from './fixtures.ts';

async function rejects(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof ProducerError, String(error));
    assert.equal(error.code, code);
    return true;
  });
}

/** Rewrites one JSON file of a study and re-signs the receipt (and study digest) so only the intended check can fail. */
async function mutate(root: string, rel: string, change: (doc: Record<string, any>) => void): Promise<void> {
  const file = path.join(root, rel);
  const doc = JSON.parse(await fs.readFile(file, 'utf8'));
  change(doc);
  await fs.writeFile(file, json(doc));
  const receiptFile = path.join(root, 'receipt.json');
  const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
  receipt.studyDigest = sha(await fs.readFile(path.join(root, 'study.json')));
  for (const entry of receipt.files) entry.digest = sha(await fs.readFile(path.join(root, entry.path)));
  await fs.writeFile(receiptFile, json(receipt));
}

describe('website and app studies', () => {
  test('a website study folds duplicate frames across runs and merges annotation facts', async () => {
    const { config, out } = await studyConfig('website');
    const [source] = (await runProducer(config)).sources;
    assert.equal(source!.status, 'written');
    assert.equal(source!.counts.captures, 2, 'home appears in both runs with identical bytes: one capture');
    assert.equal(source!.counts.anchors, 2, 'one inline fact plus one from the annotation file');
    assert.equal(source!.tallies['captures-merged-duplicate'], 1);
    assert.equal(source!.tallies['runs-read'], 2);
    assert.equal(source!.counts['rights:unknown'], 2, 'the study default is unknown and nothing loosens it');
    assert.ok(await exists(path.join(out, 'example-study')));
  });

  test('an app study yields the app and a subject per screen', async () => {
    const { config } = await studyConfig('app');
    const [source] = (await runProducer(config)).sources;
    assert.equal(source!.counts.captures, 2);
    assert.equal(source!.counts.subjects, 1 + 2, 'the app and its two screens; flows hold no captures of their own');
  });

  test('two runs of the same study give the same packet digests', async () => {
    const a = await studyConfig('website');
    const b = await studyConfig('website');
    const first = (await runProducer(a.config)).sources[0]!;
    const second = (await runProducer(b.config)).sources[0]!;
    assert.equal(first.internalDigest, second.internalDigest);
    assert.equal((await runProducer(a.config)).sources[0]!.status, 'unchanged');
  });
});

describe('partial receipts only expose complete runs', () => {
  test('a partial receipt skips the incomplete run', async () => {
    const { config } = await studyConfig('website', { partial: ['run-1'] });
    const [source] = (await runProducer(config)).sources;
    assert.equal(source!.tallies['runs-skipped-partial'], 1);
    assert.equal(source!.tallies['runs-read'], 1);
  });

  test('a partial receipt with no complete run produces nothing and creates no store', async () => {
    const { config, out } = await studyConfig('website', { partial: [] });
    const [source] = (await runProducer(config)).sources;
    assert.equal(source!.status, 'empty');
    assert.equal(source!.internalDigest, null);
    assert.equal(await exists(out), false);
  });

  test('an incomplete run is not even opened, so a broken file in it is ignored', async () => {
    const { config, root } = await studyConfig('website', { partial: ['run-1'] });
    await write(path.join(root, 'runs', 'run-2.json'), 'half-written {{');
    const [source] = (await runProducer(config)).sources;
    assert.equal(source!.status, 'written');
  });
});

describe('digests, versions and identity checks abort with no output', () => {
  test('study.json changed after the receipt was cut', async () => {
    const { config, root, out } = await studyConfig('website');
    await fs.appendFile(path.join(root, 'study.json'), ' ');
    await rejects(runProducer(config), 'study-digest-mismatch');
    assert.equal(await exists(out), false);
  });

  test('a run file changed after the receipt was cut', async () => {
    const { config, root, out } = await studyConfig('website');
    await fs.appendFile(path.join(root, 'runs', 'run-1.json'), ' ');
    await rejects(runProducer(config), 'receipt-digest-mismatch');
    assert.equal(await exists(out), false);
  });

  test('an annotation file changed after the receipt was cut', async () => {
    const { config, root } = await studyConfig('website');
    await fs.appendFile(path.join(root, 'annotations', 'run-1.json'), ' ');
    await rejects(runProducer(config), 'receipt-digest-mismatch');
  });

  test('a run file the receipt does not list', async () => {
    const { config, root } = await studyConfig('website');
    const receiptFile = path.join(root, 'receipt.json');
    const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
    receipt.files = receipt.files.filter((entry: { path: string }) => entry.path !== 'runs/run-2.json');
    await fs.writeFile(receiptFile, json(receipt));
    await rejects(runProducer(config), 'receipt-missing-file');
  });

  test('a run whose ID disagrees with study.json', async () => {
    const { config, root } = await studyConfig('website');
    await mutate(root, 'runs/run-1.json', (run) => { run.runId = 'other'; });
    await rejects(runProducer(config), 'run-id-mismatch');
  });

  test('annotations for another run', async () => {
    const { config, root } = await studyConfig('website');
    await mutate(root, 'annotations/run-1.json', (doc) => { doc.runId = 'run-2'; });
    await rejects(runProducer(config), 'run-id-mismatch');
  });

  for (const rel of ['study.json', 'receipt.json', 'runs/run-1.json', 'annotations/run-1.json']) {
    test(`an unknown or future schema in ${rel.split('/')[0]!.replace('.json', '')}`, async () => {
      for (const [mutateSchema, code] of [[(s: string) => s.replace('/v1', '/v2'), 'future-version'], [() => 'something.else/v1', 'unknown-schema']] as const) {
        const { config, root, out } = await studyConfig('website');
        await mutate(root, rel, (doc) => { doc.schema = mutateSchema(doc.schema); });
        await rejects(runProducer(config), code);
        assert.equal(await exists(out), false);
      }
    });
  }

  test('a run file or frame image reached through a link', async () => {
    const { config, root } = await studyConfig('website');
    await fs.rename(path.join(root, 'frames'), path.join(root, 'frames-real'));
    await fs.symlink('frames-real', path.join(root, 'frames'));
    await rejects(runProducer(config), 'symlink-rejected');
  });

  test('a traversing run path', async () => {
    const { config, root } = await studyConfig('website');
    await mutate(root, 'study.json', (study) => { study.runs[0].path = '../runs/run-1.json'; });
    await rejects(runProducer(config), 'unsafe-path');
  });

  test('a frame image path that traverses', async () => {
    const { config, root } = await studyConfig('website');
    await mutate(root, 'runs/run-1.json', (run) => { run.steps[0].frames[0].image.path = '../frames/one-a.png'; });
    await rejects(runProducer(config), 'unsafe-path');
  });

  test('a study file replaced during the run', async () => {
    const { config, root, out } = await studyConfig('website');
    await rejects(runProducer(config, { afterRead: () => fs.appendFile(path.join(root, 'runs', 'run-2.json'), ' ') }), 'generation-changed');
    assert.equal(await exists(out), false);
  });
});

describe('taste and content fields never travel', () => {
  test('ratings, notes and markup in a study are dropped, counted and absent from the packets', async () => {
    const { config, root, out } = await studyConfig('website');
    await mutate(root, 'runs/run-1.json', (run) => {
      run.rating = 5;
      run.steps[0].notes = 'SENTINEL-NOTE-TEXT';
      run.steps[0].frames[0].rating = 4;
      run.steps[0].frames[0].html = '<p>SENTINEL-MARKUP</p>';
      run.steps[0].frames[0].taste = 'SENTINEL-TASTE';
      run.steps[0].frames[0].mystery = 'SENTINEL-UNKNOWN';
    });
    const [source] = (await runProducer(config)).sources;
    assert.equal(source!.tallies['fields-excluded'], 5);
    assert.equal(source!.tallies['fields-ignored'], 1);
    for (const file of await listTree(out)) {
      const full = path.join(out, file);
      if ((await fs.lstat(full)).isFile() && !file.includes('blobs')) assert.doesNotMatch(await fs.readFile(full, 'utf8'), /SENTINEL/u, file);
    }
  });
});
