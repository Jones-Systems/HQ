/**
 * Named checks for spec.hq-expansion#test.reference-packets.001: strict closed-shape validation, digest checks,
 * idempotent adoption, export, and the ReferenceBundle projection. Labelled fake ports; synthetic content only.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { BlobDigest } from '../src/contract.ts';
import { sha256Hex } from '../src/jcs.ts';
import type { CaptureId, GraphCaptureCandidate } from '../src/graph-contract.ts';
import { deriveSubjectId } from '../src/graph-identity.ts';
import { capturesOfSubject } from '../src/graph-ops.ts';
import type { ReferenceGraph } from '../src/graph-service.ts';
import { GRAPH_DOCUMENT_KEY } from '../src/graph-contract.ts';
import type { ReferencePacket } from '../src/packet.ts';
import { buildBundle, bundleMatchesPacket, parsePacket } from '../src/packet.ts';
import { HQ_RIGHTS_VOCABULARY, STUDY_RIGHTS_VOCABULARY } from '../src/rights.ts';
import { bytes } from './fixtures.ts';
import { appTree, openGraph, pageCapture, PERMITTED, websiteTree, writes } from './graph-fixtures.ts';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const study = (value: string, basis?: string) => ({ vocabulary: STUDY_RIGHTS_VOCABULARY, value, ...(basis === undefined ? {} : { basis }) });
const withRights = (capture: GraphCaptureCandidate, rights: GraphCaptureCandidate['rights']): GraphCaptureCandidate => ({ ...capture, rights });

/** Home permitted, pricing restricted, about unstated; editor licensed, list private, settings unstated. */
async function seed(graph: ReferenceGraph) {
  const site = websiteTree();
  const web = {
    ...site,
    pages: site.pages.map((page) => ({
      ...page,
      captures: page.captures?.map((capture) => (
        page.title === 'Home' ? withRights(capture, PERMITTED)
          : page.title === 'Pricing' ? withRights(capture, { vocabulary: HQ_RIGHTS_VOCABULARY, value: 'restricted' })
            : capture)),
    })),
  };
  const app = appTree();
  const native = {
    ...app,
    screens: app.screens.map((screen) => ({
      ...screen,
      captures: screen.captures?.map((capture) => (
        screen.key === 'editor' ? withRights(capture, study('licensed', 'synthetic licence'))
          : screen.key === 'list' ? withRights(capture, study('private'))
            : capture)),
    })),
  };
  assert.equal((await graph.importTree(web)).ok, true);
  assert.equal((await graph.importTree(native)).ok, true);
}

const pageCaptureId = async (graph: ReferenceGraph, path: string) =>
  capturesOfSubject(graph.state, await deriveSubjectId({ kind: 'page', url: `https://example.com/${path}` }))[0]!.id;

async function exported(graph: ReferenceGraph, mode: 'publishable' | 'internal', captureIds?: readonly CaptureId[]) {
  const result = await graph.exportPacket(captureIds === undefined ? { mode } : { mode, captureIds });
  assert.equal(result.ok, true, JSON.stringify(result));
  return (result as { ok: true; value: { packet: ReferencePacket; bundle: ReturnType<typeof buildBundle> } }).value;
}

describe('export', () => {
  test('an internal packet carries every live capture and round-trips through strict validation', async () => {
    const { graph } = await openGraph();
    await seed(graph);
    const { packet, bundle } = await exported(graph, 'internal');
    assert.equal(packet.captures.length, 6);
    assert.equal(packet.mode, 'internal');
    assert.deepEqual(packet.excluded, []);
    const parsed = await parsePacket(clone(packet));
    assert.equal(parsed.status, 'ok');
    assert.equal(bundle.captureIds.length, 6);
    assert.match(packet.packetDigest, /^sha256:[0-9a-f]{64}$/u);
  });

  test('a publishable packet holds only explicit non-private grants and lists every exclusion with its reason', async () => {
    const { graph } = await openGraph();
    await seed(graph);
    const { packet } = await exported(graph, 'publishable');
    const keep = packet.captures.map((capture) => capture.rights.declared.value).sort();
    assert.deepEqual(keep, ['licensed', 'permitted']);
    const reasons = Object.fromEntries(packet.excluded.map((entry) => [entry.id, entry.reason]));
    assert.equal(Object.keys(reasons).length, 4);
    assert.deepEqual(Object.values(reasons).sort(), ['private', 'rights-restricted', 'rights-unknown', 'rights-unknown']);
    assert.equal(reasons[await pageCaptureId(graph, 'pricing')], 'rights-restricted');
    for (const capture of packet.captures) assert.equal(capture.rights.private, false);
    const text = JSON.stringify(packet);
    assert.ok(!text.includes('metadata-only'), 'an excluded capture leaves no trace beyond its id and reason');
  });

  test('tombstoned and blob-missing captures are excluded from a publishable packet; internal keeps blob-missing', async () => {
    const { graph } = await openGraph();
    const missing = `sha256:${'a'.repeat(64)}` as BlobDigest;
    await graph.importTree(websiteTree({
      pages: [
        { url: 'https://example.com/a', title: 'A', captures: [withRights(pageCapture('a'), PERMITTED)] },
        { url: 'https://example.com/gone', title: 'G', captures: [withRights({ kind: 'screenshot', capturedAt: '2026-02-01T10:00:00.000Z', capturedBy: 'observed', asset: { digest: missing, byteLength: 9, mediaType: 'image/png' } }, PERMITTED)] },
        { url: 'https://example.com/deleted', title: 'D', captures: [withRights(pageCapture('deleted'), PERMITTED)] },
      ],
    }));
    await graph.deleteCapture(await pageCaptureId(graph, 'deleted'));
    const publishable = (await exported(graph, 'publishable')).packet;
    assert.equal(publishable.captures.length, 1);
    assert.deepEqual(publishable.excluded.map((entry) => entry.reason).sort(), ['blob-missing', 'tombstoned']);
    const internal = (await exported(graph, 'internal')).packet;
    assert.equal(internal.captures.length, 2, 'blob-missing is kept in an internal packet');
    assert.deepEqual(internal.excluded.map((entry) => entry.reason), ['tombstoned']);
  });

  test('the same selection yields the same packet and digest; omissions are listed and ratings, pins and local links are absent', async () => {
    const { graph } = await openGraph();
    await seed(graph);
    const home = await pageCaptureId(graph, '');
    await graph.pin(home, 'proj_a', { purpose: 'private purpose text' });
    await graph.setRating(await deriveSubjectId({ kind: 'page', url: 'https://example.com/' }), 5);
    const a = (await exported(graph, 'internal')).packet;
    const b = (await exported(graph, 'internal')).packet;
    assert.deepEqual(a, b);
    assert.notEqual((await exported(graph, 'publishable')).packet.packetDigest, a.packetDigest);
    assert.deepEqual(a.omitted, ['content-availability', 'local-reference-links', 'pins', 'ratings', 'tombstoned-records']);
    const text = JSON.stringify({ ...a, omitted: [] });
    for (const leak of ['private purpose text', 'proj_a', '"rating"', '"pins"', 'tombstonedAt', 'referenceId', 'importCount']) {
      assert.ok(!text.includes(leak), leak);
    }
  });

  test('a project export selects exactly the captures it pins', async () => {
    const { graph } = await openGraph();
    await seed(graph);
    const home = await pageCaptureId(graph, '');
    const pricing = await pageCaptureId(graph, 'pricing');
    await graph.pin(home, 'proj_a');
    await graph.pin(pricing, 'proj_a');
    await graph.pin(await pageCaptureId(graph, 'about'), 'proj_b');
    const result = await graph.exportPacket({ mode: 'internal', projectId: 'proj_a' });
    assert.equal(result.ok, true);
    const { packet, bundle } = (result as { value: { packet: ReferencePacket; bundle: ReturnType<typeof buildBundle> } }).value;
    assert.deepEqual(packet.captures.map((capture) => capture.id), [home, pricing].sort());
    assert.deepEqual(bundle.captureIds, [home, pricing].sort());
    assert.deepEqual(await graph.exportPacket({ mode: 'internal', projectId: 'proj_a', captureIds: [home] }), { ok: false, code: 'ambiguous-selection' });
    assert.deepEqual(await graph.exportPacket({ mode: 'internal', captureIds: [`cap_${'0'.repeat(64)}` as CaptureId] }), { ok: false, code: 'capture-not-found' });
  });

  test('lineage in a packet points at the nearest earlier capture that is also in the packet', async () => {
    const { graph } = await openGraph();
    const page = (label: string, capturedAt: string) => websiteTree({ pages: [{ url: 'https://example.com/p', title: 'P', captures: [pageCapture(label, { capturedAt })] }] });
    for (const [label, at] of [['v1', '2026-01-01T00:00:00.000Z'], ['v2', '2026-02-01T00:00:00.000Z'], ['v3', '2026-03-01T00:00:00.000Z']] as const) await graph.importTree(page(label, at));
    const chain = capturesOfSubject(graph.state, await deriveSubjectId({ kind: 'page', url: 'https://example.com/p' }));
    const { packet } = await exported(graph, 'internal', [chain[0]!.id, chain[2]!.id]);
    const third = packet.captures.find((capture) => capture.id === chain[2]!.id)!;
    assert.equal(third.supersedes, chain[0]!.id, 'v2 is not in the packet, so the link skips to v1');
    assert.equal(packet.captures.find((capture) => capture.id === chain[0]!.id)!.supersedes, null);
  });
});

describe('strict closed-shape validation and digest checks', () => {
  async function packet() {
    const { graph } = await openGraph();
    await seed(graph);
    return clone((await exported(graph, 'internal')).packet);
  }

  const mutations: [string, (packet: Record<string, any>) => void, RegExp][] = [
    ['a top-level extra field', (p) => { p.extra = 1; }, /^\$\.extra$/u],
    ['a subject extra field', (p) => { p.subjects[0].extra = 1; }, /\$\.subjects\[0\]\.extra$/u],
    ['a capture extra field', (p) => { p.captures[0].script = '<script>1</script>'; }, /\$\.captures\[0\]\.script$/u],
    ['an anchor extra field', (p) => { p.anchors[0].href = 'https://example.org'; }, /\$\.anchors\[0\]\.href$/u],
    ['a blob extra field', (p) => { p.blobs[0].url = 'https://example.org/x'; }, /\$\.blobs\[0\]\.url$/u],
    ['a rights extra field', (p) => { p.captures[0].rights.declared.extra = 1; }, /declared\.extra$/u],
    ['a __proto__ key', (p) => { Object.defineProperty(p, '__proto__', { value: { x: 1 }, enumerable: true, configurable: true, writable: true }); }, /^\$\.__proto__$/u],
    ['a missing field', (p) => { delete p.mode; }, /^\$\.mode$/u],
    ['an unknown mode', (p) => { p.mode = 'draft'; }, /^\$\.mode$/u],
    ['a wrong schema name', (p) => { p.schema = 'hq.design.reference-graph/v1'; }, /^\$\.schema$/u],
    ['out-of-order captures', (p) => { p.captures.reverse(); }, /^\$\.captures$/u],
    ['a duplicated anchor', (p) => { p.anchors.push(p.anchors[p.anchors.length - 1]); }, /^\$\.anchors$/u],
    ['a changed omission list', (p) => { p.omitted = []; }, /^\$\.omitted$/u],
    ['a blob list that does not match the captures', (p) => { p.blobs.pop(); }, /^\$\.blobs$/u],
    ['a mismatched blob size', (p) => { p.blobs[0].bytes += 1; }, /^\$\.blobs$/u],
    ['an executable blob media type', (p) => { p.blobs[0].mediaType = 'text/html'; }, /^\$\.blobs\[0\]$/u],
    ['an executable capture media type', (p) => { p.captures.find((c: any) => c.asset).asset.mediaType = 'image/svg+xml'; }, /\.asset\.mediaType$/u],
    ['an anchor bound to another digest', (p) => { p.anchors[0].assetDigest = `sha256:${'f'.repeat(64)}`; }, /\.assetDigest$/u],
    ['a capture on a missing subject', (p) => { p.captures[0].subjectId = `sub_${'1'.repeat(64)}`; }, /\.subjectId$/u],
    ['a supersedes pointer outside the packet', (p) => { p.captures[0].supersedes = `cap_${'2'.repeat(64)}`; }, /\.supersedes$/u],
    ['an excluded id that is also included', (p) => { p.excluded.push({ id: p.captures[0].id, reason: 'tombstoned' }); }, /\$\.excluded\[0\]\.id$/u],
    ['a rights-based exclusion in an internal packet', (p) => { p.excluded.push({ id: `cap_${'3'.repeat(64)}`, reason: 'private' }); }, /\$\.excluded\[0\]\.reason$/u],
    ['a hand-edited effective grant', (p) => { p.captures.find((c: any) => c.rights.effective === 'unknown').rights.effective = 'permitted'; }, /\.rights\.effective$/u],
    ['a changed packet digest', (p) => { p.packetDigest = `sha256:${'0'.repeat(64)}`; }, /^\$\.packetDigest$/u],
    ['a re-titled subject (digest no longer matches)', (p) => { p.subjects[0].title = 'Changed'; }, /^\$\.packetDigest$/u],
    ['a subject whose id is not its identity hash', (p) => { p.subjects.find((s: any) => s.identity.kind === 'page').identity.url = 'https://example.com/other'; }, /^\$\.subjects\.sub_[0-9a-f]{64}\.id$/u],
  ];
  for (const [name, mutate, expected] of mutations) {
    test(`rejects ${name}`, async () => {
      const value = await packet();
      mutate(value);
      const parsed = await parsePacket(value);
      assert.equal(parsed.status, 'invalid', JSON.stringify(parsed).slice(0, 160));
      assert.match((parsed as { path: string }).path, expected);
    });
  }

  test('rejects every non-object shape without throwing', async () => {
    for (const value of [null, undefined, 1, 'x', [], [{}], true]) assert.equal((await parsePacket(value)).status, 'invalid');
  });

  test('a publishable packet that holds a non-grant is invalid even if re-digested', async () => {
    const { graph } = await openGraph();
    await seed(graph);
    const value = clone((await exported(graph, 'publishable')).packet) as Record<string, any>;
    const pricing = clone((await exported(graph, 'internal')).packet).captures.find((capture) => capture.rights.declared.value === 'restricted')!;
    value.captures.push(pricing);
    value.captures.sort((a: any, b: any) => (a.id < b.id ? -1 : 1));
    const parsed = await parsePacket(value);
    assert.equal(parsed.status, 'invalid');
  });

  test('a newer packet schema is recognised and never treated as v1', async () => {
    const value = { ...(await packet()), schema: 'hq.design.reference-packet/v2', futureField: true };
    assert.deepEqual(await parsePacket(value), { status: 'future-schema', schema: 'hq.design.reference-packet/v2' });
  });
});

describe('idempotent adoption', () => {
  async function exportedPacket() {
    const source = await openGraph();
    await seed(source.graph);
    const { packet } = await exported(source.graph, 'internal');
    const blobs = new Map<BlobDigest, Uint8Array>();
    for (const [digest, blob] of source.ports.storage.blobs) blobs.set(digest, blob.bytes);
    return { source, packet, blobs };
  }

  test('adoption into an empty workspace creates the subjects, captures and anchors once', async () => {
    const { packet, blobs } = await exportedPacket();
    const target = await openGraph();
    const first = await target.graph.adoptPacket(packet, { blobs });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.ok && first.status, 'created');
    assert.equal(first.ok && first.blobs.stored, blobs.size);
    assert.deepEqual(first.ok && first.blobs.missing, []);
    assert.equal(Object.keys(target.graph.state.captures).length, 6);
    assert.equal(Object.keys(target.graph.state.anchors).length, 3);
    for (const capture of Object.values(target.graph.state.captures)) {
      assert.equal(capture.provenance.origin, 'packet');
      assert.equal(capture.provenance.packetDigest, packet.packetDigest);
      if (capture.asset !== null) assert.equal(capture.availability.content, 'present');
    }
    const written = writes(target.ports);
    const second = await target.graph.adoptPacket(clone(packet), { blobs });
    assert.equal(second.ok && second.status, 'unchanged');
    assert.equal(writes(target.ports), written, 'a repeat writes nothing');
    assert.equal((await target.graph.exportPacket({ mode: 'internal' })).ok, true);
  });

  test('without blob bytes the captures are blob-missing and the packet reports which digests are missing', async () => {
    const { packet, blobs } = await exportedPacket();
    const target = await openGraph();
    const first = await target.graph.adoptPacket(packet);
    assert.equal(first.ok && first.blobs.missing.length, blobs.size);
    assert.equal(target.ports.storage.blobs.size, 0, 'bytes are never invented');
    const states = new Set(Object.values(target.graph.state.captures).map((capture) => capture.availability.content));
    assert.deepEqual([...states].sort(), ['blob-missing', 'no-image']);
    const later = await target.graph.adoptPacket(packet, { blobs });
    assert.equal(later.ok && later.status, 'observed-again');
    assert.ok(later.ok && later.captures.some((capture) => capture.differences.includes('availability.content')));
    assert.ok(Object.values(target.graph.state.captures).every((capture) => capture.availability.content !== 'blob-missing'));
  });

  test('bytes that do not match the packet digests are rejected before anything is written', async () => {
    const { packet, blobs } = await exportedPacket();
    const target = await openGraph();
    const [digest] = [...blobs.keys()];
    const tampered = new Map(blobs).set(digest!, bytes('swapped'));
    const outcome = await target.graph.adoptPacket(packet, { blobs: tampered });
    assert.deepEqual(outcome, { ok: false, status: 'rejected', code: 'blob-bytes-mismatch' });
    assert.equal(writes(target.ports), 0);
    assert.equal(target.ports.storage.blobs.size, 0);
  });

  test('bytes the packet does not name are ignored', async () => {
    const { packet } = await exportedPacket();
    const target = await openGraph();
    const stray = new Map<BlobDigest, Uint8Array>([[`sha256:${await sha256Hex(bytes('stray'))}` as BlobDigest, bytes('stray')]]);
    const outcome = await target.graph.adoptPacket(packet, { blobs: stray });
    assert.equal(outcome.ok, true);
    assert.equal(target.ports.storage.blobs.size, 0);
  });

  test('an invalid, tampered or future packet changes nothing', async () => {
    const { packet } = await exportedPacket();
    const target = await openGraph();
    const tampered = clone(packet) as Record<string, any>;
    tampered.subjects[0].title = 'Evil';
    assert.deepEqual(await target.graph.adoptPacket(tampered), { ok: false, status: 'invalid', path: '$.packetDigest' });
    assert.deepEqual(await target.graph.adoptPacket({ ...clone(packet), schema: 'hq.design.reference-packet/v2' }), { ok: false, status: 'future-schema', schema: 'hq.design.reference-packet/v2' });
    assert.equal((await target.graph.adoptPacket('not a packet')).ok, false);
    assert.equal(writes(target.ports), 0);
    assert.deepEqual(target.graph.state.captures, {});
  });

  test('a read-only graph refuses adoption without writing', async () => {
    const { packet } = await exportedPacket();
    const target = await openGraph();
    target.ports.storage.seedDocument('workspace', GRAPH_DOCUMENT_KEY, { schema: 'hq.design.reference-graph/v2' });
    await target.graph.reload();
    const outcome = await target.graph.adoptPacket(packet);
    assert.deepEqual(outcome, { ok: false, status: 'rejected', code: 'read-only' });
  });

  test('adopting never promotes rights: a packet grant over local unknown stays unknown, and a packet non-grant tightens a local agent grant', async () => {
    const { packet } = await exportedPacket();
    const target = await openGraph();
    // Local copy of the home page and pricing page, with the opposite rights from the packet.
    const local = websiteTree();
    await target.graph.importTree({
      ...local,
      pages: local.pages.map((page) => ({
        ...page,
        captures: page.captures?.map((capture) => (page.title === 'Pricing' ? withRights(capture, PERMITTED) : capture)),
      })),
    });
    const outcome = await target.graph.adoptPacket(packet);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    const rightsOf = async (path: string) => capturesOfSubject(target.graph.state, await deriveSubjectId({ kind: 'page', url: `https://example.com/${path}` }))[0]!.rights;
    assert.equal((await rightsOf('')).effective, 'unknown', 'the packet grants home, but local knowledge stays unknown');
    assert.equal((await rightsOf('pricing')).effective, 'restricted', 'the packet restricts pricing, so a local agent grant is tightened');
  });

  test('an adopted grant is an agent-reported claim, never an owner judgement', async () => {
    const { packet } = await exportedPacket();
    const target = await openGraph();
    await target.graph.adoptPacket(packet);
    const granted = Object.values(target.graph.state.captures).filter((capture) => capture.rights.effective === 'permitted');
    assert.equal(granted.length, 2);
    for (const capture of granted) assert.equal(capture.rights.setBy, 'agent-reported');
  });

  test('local pins, ratings and lineage survive an adoption of an older packet', async () => {
    const { packet } = await exportedPacket();
    const target = await openGraph();
    await target.graph.adoptPacket(packet);
    const homeSubject = await deriveSubjectId({ kind: 'page', url: 'https://example.com/' });
    const [adopted] = capturesOfSubject(target.graph.state, homeSubject);
    await target.graph.pin(adopted!.id, 'proj_a');
    await target.graph.setRating(homeSubject, 3);
    target.ports.clock.advance(1000);
    await target.graph.importTree(websiteTree({ pages: [{ url: 'https://example.com/', title: 'Home', captures: [pageCapture('home-v2', { capturedAt: '2026-04-01T00:00:00.000Z' })] }] }));
    await target.graph.adoptPacket(packet);
    const captures = capturesOfSubject(target.graph.state, homeSubject);
    assert.equal(captures.length, 2);
    assert.equal(captures[1]!.lineage.supersedes, adopted!.id);
    assert.equal(target.graph.state.subjects[homeSubject]!.rating, 3);
    assert.equal(Object.values(target.graph.state.pins).filter((pin) => pin.tombstonedAt === null).length, 1);
  });

  test('anchors survive the round trip bound to the same capture and digest', async () => {
    const { source, packet, blobs } = await exportedPacket();
    const target = await openGraph();
    await target.graph.adoptPacket(packet, { blobs });
    assert.deepEqual(Object.keys(target.graph.state.anchors).sort(), Object.keys(source.graph.state.anchors).sort());
    for (const anchor of Object.values(target.graph.state.anchors)) {
      assert.equal(target.graph.state.captures[anchor.captureId]!.asset!.digest, anchor.assetDigest);
    }
    const again = await target.graph.exportPacket({ mode: 'internal' });
    assert.deepEqual((again as unknown as { value: { bundle: { captureIds: string[] } } }).value.bundle.captureIds, packet.captures.map((capture) => capture.id));
  });
});

describe('ReferenceBundle', () => {
  test('exposes capture IDs, the packet digest and a rights summary', async () => {
    const { graph } = await openGraph();
    await seed(graph);
    const { packet, bundle } = await exported(graph, 'internal');
    assert.equal(bundle.schema, 'hq.design.reference-bundle/v1');
    assert.equal(bundle.packetDigest, packet.packetDigest);
    assert.deepEqual(bundle.captureIds, packet.captures.map((capture) => capture.id));
    assert.deepEqual(bundle.rights, { total: 6, permitted: 2, restricted: 2, unknown: 2, private: 1, agentReportedGrants: 2, publishable: false });
    assert.equal(bundleMatchesPacket(bundle, packet), true);
    assert.equal(bundleMatchesPacket({ ...bundle, rights: { ...bundle.rights, publishable: true } }, packet), false);
    assert.equal(bundleMatchesPacket({ ...bundle, captureIds: [] }, packet), false);
    assert.equal(bundleMatchesPacket(null, packet), false);
  });

  test('a publishable bundle is publishable only when every capture is a grant, and an empty one never is', async () => {
    const { graph } = await openGraph();
    await seed(graph);
    const publishable = (await exported(graph, 'publishable')).bundle;
    assert.equal(publishable.rights.publishable, true);
    assert.equal(publishable.excluded.length, 4, 'exclusions travel with the bundle');
    const none = (await exported(graph, 'publishable', [await pageCaptureId(graph, 'pricing')])).bundle;
    assert.equal(none.rights.total, 0);
    assert.equal(none.rights.publishable, false);
    assert.deepEqual(none.excluded.map((entry) => entry.reason), ['rights-restricted']);
  });

  test('the bundle holds identifiers and counts, never content', async () => {
    const { graph } = await openGraph();
    await seed(graph);
    const text = JSON.stringify((await exported(graph, 'internal')).bundle);
    for (const content of ['https://', 'example.com', 'Example Co', 'image/png', 'sha256:']) {
      assert.ok(!text.replace(/"packetDigest":"sha256:[0-9a-f]{64}"/u, '').includes(content), content);
    }
  });
});
