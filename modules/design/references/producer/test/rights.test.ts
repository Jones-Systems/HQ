/** Rights only tighten; private never reaches the publishable packet; claims never exceed agent-reported. */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { parsePacket } from '../../src/packet.ts';
import { runProducer } from '../src/run.ts';
import { AT, buildGallery, exists, galleryConfig, PERMITTED, PRIVATE, RESTRICTED, UNKNOWN } from './fixtures.ts';

type Rights = Record<string, unknown> | undefined;

/** A gallery with one captured page per rights statement: [source default, capture's own]. */
async function withRights(sourceRights: Rights | null, captureRights: Rights) {
  const built = await galleryConfig();
  await fs.rm(path.join(built.root, 'A'), { recursive: true });
  await buildGallery(built.root, {
    entries: (images) => [{ kind: 'website', origin: 'https://example.test', title: 'Site', pages: [
      { url: 'https://example.test/', title: 'Home', captures: [{ kind: 'screenshot', capturedAt: AT, capturedBy: 'agent-reported', image: images.home, ...(captureRights === undefined ? {} : { rights: captureRights }) }] },
    ] }],
  });
  const source = { ...built.source, rights: sourceRights } as typeof built.source;
  return { ...built, config: { outputRoot: built.out, sources: [source] } };
}

async function read(out: string, digest: string, name: string) {
  const parsed = await parsePacket(JSON.parse(await fs.readFile(path.join(out, 'example-gallery', digest.slice(7), `${name}.packet.json`), 'utf8')));
  assert.equal(parsed.status, 'ok');
  if (parsed.status !== 'ok') throw new Error('unreachable');
  return parsed.packet;
}

describe('rights only tighten', () => {
  const NO_BASIS = { vocabulary: 'hq.design.references/v1', value: 'permitted' };
  const cases: [string, Rights | null, Rights, string][] = [
    ['an unknown default is not loosened by a capture grant', UNKNOWN, PERMITTED, 'unknown'],
    ['no configured default is not loosened by a capture grant', null, PERMITTED, 'permitted'],
    ['a capture can tighten a permitted default to restricted', PERMITTED, RESTRICTED, 'restricted'],
    ['a capture with no statement keeps a permitted default', PERMITTED, undefined, 'permitted'],
    ['a restricted default is not loosened', RESTRICTED, PERMITTED, 'restricted'],
    ['a permitted grant without a basis is unknown', NO_BASIS, undefined, 'unknown'],
    ['a capture grant without a basis is unknown', null, NO_BASIS, 'unknown'],
    ['an unregistered vocabulary never grants', { vocabulary: 'made.up/v1', value: 'permitted', basis: 'x' }, undefined, 'unknown'],
    ['an unregistered value never grants', { vocabulary: 'hq.design.references/v1', value: 'open-season', basis: 'x' }, undefined, 'unknown'],
  ];
  for (const [name, sourceRights, captureRights, expected] of cases) {
    test(name, async () => {
      const built = await withRights(sourceRights, captureRights);
      const [source] = (await runProducer(built.config)).sources;
      const internal = await read(built.out, source!.internalDigest!, 'internal');
      assert.equal(internal.captures.length, 1);
      const rights = internal.captures[0]!.rights;
      assert.equal(rights.private ? 'private' : rights.effective, expected);
      if (expected !== 'permitted') assert.notEqual(rights.effective, 'permitted');
    });
  }

  test('a private statement is private and cannot be relaxed by the source default', async () => {
    const built = await withRights(PERMITTED, PRIVATE);
    const [source] = (await runProducer(built.config)).sources;
    const internal = await read(built.out, source!.internalDigest!, 'internal');
    assert.equal(internal.captures[0]!.rights.private, true);
    assert.equal(source!.counts['rights:private'], 1);
  });
});

describe('the publishable packet leaves private and unpermitted captures out and says so', () => {
  test('excluded lists them, and no private capture ID appears in the publishable packet', async () => {
    const { config, out } = await galleryConfig();
    const [source] = (await runProducer(config)).sources;
    const internal = await read(out, source!.internalDigest!, 'internal');
    const publishable = await read(out, source!.internalDigest!, 'publishable');
    const withheld = internal.captures.filter((capture) => capture.rights.private || capture.rights.effective !== 'permitted').map((capture) => capture.id);
    assert.ok(withheld.length >= 2, 'the fixture has a private and a restricted capture');
    const published = new Set(publishable.captures.map((capture) => capture.id));
    for (const id of withheld) assert.equal(published.has(id), false);
    assert.ok(publishable.excluded.length >= withheld.length);
    assert.equal(source!.counts.publishableCaptures, publishable.captures.length);
    const listed = JSON.stringify(publishable.blobs);
    for (const capture of internal.captures) if (withheld.includes(capture.id) && capture.asset !== null && 'digest' in capture.asset) assert.equal(listed.includes(capture.asset.digest), false);
  });
});

describe('claims never exceed agent-reported', () => {
  const appWith = (capture: Record<string, unknown>) => () => [{
    kind: 'app', platform: 'ios', appId: 'com.example.notes', title: 'Example Notes', screens: [{ key: 'list', title: 'List', captures: [capture] }], flows: [],
  }];

  test('capturedBy and native evidence claims in a source are clamped', async () => {
    const built = await galleryConfig();
    await fs.rm(path.join(built.root, 'A'), { recursive: true });
    await buildGallery(built.root, {
      entries: (images) => appWith({ kind: 'native', capturedAt: AT, capturedBy: 'owner-judged', image: images.list, rights: PERMITTED,
        nativeEvidence: { platform: 'ios', runtime: 'simulator', buildRef: 'build-1', claim: 'owner-judged' } })(),
    });
    const [source] = (await runProducer(built.config)).sources;
    const [capture] = (await read(built.out, source!.internalDigest!, 'internal')).captures;
    assert.equal(capture!.capturedBy, 'agent-reported');
    assert.equal(capture!.nativeEvidence?.claim, 'agent-reported');
  });

  test('native evidence on a screenshot is refused by the graph, tallied, and produces nothing', async () => {
    const built = await galleryConfig();
    await fs.rm(path.join(built.root, 'A'), { recursive: true });
    await buildGallery(built.root, {
      entries: (images) => appWith({ kind: 'screenshot', capturedAt: AT, capturedBy: 'agent-reported', image: images.list,
        nativeEvidence: { platform: 'ios', runtime: 'simulator', buildRef: 'build-1', claim: 'agent-reported' } })(),
    });
    const [source] = (await runProducer(built.config)).sources;
    assert.equal(source!.status, 'empty');
    assert.equal(source!.tallies['entries-rejected'], 1);
    assert.equal(await exists(built.out), false);
  });

  test('an unrecognised claim level is rejected rather than guessed', async () => {
    const built = await galleryConfig();
    await fs.rm(path.join(built.root, 'A'), { recursive: true });
    await buildGallery(built.root, {
      entries: (images) => [{ kind: 'website', origin: 'https://example.test', title: 'Site', pages: [
        { url: 'https://example.test/', title: 'Home', captures: [{ kind: 'screenshot', capturedAt: AT, capturedBy: 'verified-by-god', image: images.home }] },
      ] }],
    });
    await assert.rejects(runProducer(built.config), { code: 'invalid-field' });
  });
});
