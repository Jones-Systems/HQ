/**
 * Named checks for spec.hq-expansion#test.reference-graph.001, run against
 * labelled fake ports (fake:memory-reference-storage), not a real store.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { BlobDigest } from '../src/contract.ts';
import type { CaptureId, TreeImportOutcome } from '../src/graph-contract.ts';
import { deriveCaptureId, deriveSubjectId } from '../src/graph-identity.ts';
import { availabilityLabel, browseGraph, capturesOfSubject, headCapture, lineageOf, pinsForProject } from '../src/graph-ops.ts';
import { bytes } from './fixtures.ts';
import { appTree, issuesOf, openGraph, pageCapture, websiteTree, writes } from './graph-fixtures.ts';

function reportOf(outcome: TreeImportOutcome) {
  assert.equal(outcome.ok, true, JSON.stringify(outcome));
  return outcome as Extract<TreeImportOutcome, { ok: true }>;
}

const pageId = (url: string) => deriveSubjectId({ kind: 'page', url });

describe('a synthetic website tree and app-flow-screen tree import idempotently and can be browsed', () => {
  test('a website tree imports once and a repeat writes nothing', async () => {
    const { ports, graph } = await openGraph();
    const first = reportOf(await graph.importTree(websiteTree()));
    assert.equal(first.status, 'created');
    assert.equal(first.subjects.length, 4, 'site plus three pages');
    assert.equal(first.captures.length, 3);
    assert.deepEqual(first.anchors, { created: 3, existing: 0 });
    const before = writes(ports);
    const again = reportOf(await graph.importTree(websiteTree()));
    assert.equal(again.status, 'unchanged');
    assert.deepEqual(again.anchors, { created: 0, existing: 3 });
    assert.equal(writes(ports), before, 'an identical repeat writes nothing');
    assert.equal(Object.keys(graph.state.subjects).length, 4);
    assert.equal(Object.keys(graph.state.captures).length, 3);
  });

  test('an app tree keeps flow steps ordered and browses flows above loose screens', async () => {
    const { graph } = await openGraph();
    reportOf(await graph.importTree(appTree()));
    const [app] = graph.browse();
    assert.equal(app!.subject.kind, 'app');
    const names = app!.children.map((child) => `${child.subject.kind}:${child.subject.title}`);
    assert.deepEqual(names, ['flow:Create a note', 'screen:Settings']);
    const flow = app!.children[0]!;
    assert.deepEqual(flow.children.map((step) => step.subject.title), ['Note list', 'Editor']);
    assert.equal(flow.children[0]!.availability, 'present');
  });

  test('browse lists sites with pages and reports each head capture availability', async () => {
    const { graph } = await openGraph();
    reportOf(await graph.importTree(websiteTree()));
    const [site] = browseGraph(graph.state);
    assert.equal(site!.subject.kind, 'site');
    assert.deepEqual(site!.children.map((child) => child.subject.title), ['About', 'Home', 'Pricing']);
    assert.equal(site!.children.find((child) => child.subject.title === 'About')!.availability, 'no-image');
  });

  test('a repeat that adds a flow step appends it and reports the update', async () => {
    const { graph } = await openGraph();
    reportOf(await graph.importTree(appTree()));
    const more = reportOf(await graph.importTree(appTree({ flows: [{ key: 'new-note', title: 'Create a note', steps: ['list', 'editor', 'settings'] }] })));
    assert.equal(more.status, 'observed-again');
    assert.ok(more.subjects.some((subject) => subject.status === 'updated'));
    const flow = browseGraph(graph.state)[0]!.children[0]!;
    assert.deepEqual(flow.children.map((step) => step.subject.title), ['Note list', 'Editor', 'Settings']);
  });

  test('an invalid tree is rejected whole and writes nothing', async () => {
    const { ports, graph } = await openGraph();
    const outcome = await graph.importTree(websiteTree({
      pages: [
        { url: 'https://example.com/ok', title: 'Fine', captures: [pageCapture('fine')] },
        { url: 'https://other.example.org/x', title: 'Elsewhere' },
      ],
    }));
    assert.equal(outcome.ok, false);
    assert.deepEqual(issuesOf(outcome), [{ field: 'pages[1].url', code: 'origin-mismatch' }]);
    assert.equal(writes(ports), 0);
    assert.equal(ports.storage.blobs.size, 0, 'no bytes are stored for a rejected tree');
    assert.equal(Object.keys(graph.state.subjects).length, 0);
  });
});

describe('titles never define identity; node IDs derive from canonical identity', () => {
  test('retitling, URL spelling and capture time do not change any ID', async () => {
    const { graph } = await openGraph();
    reportOf(await graph.importTree(websiteTree()));
    const ids = Object.keys(graph.state.subjects).sort();
    const captureIds = Object.keys(graph.state.captures).sort();
    const variant = websiteTree({
      title: 'Totally different name',
      pages: websiteTree().pages.map((page) => ({
        ...page, title: `Renamed ${page.title}`, url: page.url.replace('https://example.com', 'HTTPS://Example.COM:443'),
        captures: page.captures?.map((capture) => ({ ...capture, capturedAt: '2026-05-05T05:05:05.000Z' })),
      })),
    });
    reportOf(await graph.importTree(variant));
    assert.deepEqual(Object.keys(graph.state.subjects).sort(), ids);
    assert.deepEqual(Object.keys(graph.state.captures).sort(), captureIds);
    const home = graph.state.subjects[await pageId('https://example.com/')]!;
    assert.equal(home.title, 'Home', 'import never overwrites a title');
  });

  test('IDs are prefixed SHA-256 hex and distinct per kind and identity', async () => {
    const { graph } = await openGraph();
    reportOf(await graph.importTree(websiteTree()));
    reportOf(await graph.importTree(appTree()));
    for (const id of Object.keys(graph.state.subjects)) assert.match(id, /^sub_[0-9a-f]{64}$/u);
    for (const id of Object.keys(graph.state.captures)) assert.match(id, /^cap_[0-9a-f]{64}$/u);
    for (const id of Object.keys(graph.state.anchors)) assert.match(id, /^anc_[0-9a-f]{64}$/u);
    assert.equal(new Set(Object.keys(graph.state.subjects)).size, Object.keys(graph.state.subjects).length);
  });

  test('golden vectors pin the identity derivation (each hashed independently with sha256sum over the JCS text)', async () => {
    const page = await deriveSubjectId({ kind: 'page', url: 'https://example.com/' });
    assert.equal(page, 'sub_43eb7f47648722391a730d9b80326ae99b05eddc413b45b8a75c7da9a11c32ba');
    assert.equal(
      await deriveCaptureId(page, 'screenshot', `sha256:${'0'.repeat(64)}` as BlobDigest, null),
      'cap_3f6f0ec2c14243f5f6085641ce555a92a91b58a9dbffce71dc5b37088f9f9879',
    );
    assert.equal(await deriveSubjectId({ kind: 'screen', app: page, key: 'editor' }), 'sub_50bfc4946cc357eb5289b7ca58896a0d7445ab2c4b5d8c772a5a48edd33f0bed');
  });

  test('the same content on another page is a different capture', async () => {
    const { graph } = await openGraph();
    reportOf(await graph.importTree(websiteTree({
      pages: [
        { url: 'https://example.com/a', title: 'A', captures: [pageCapture('same')] },
        { url: 'https://example.com/b', title: 'B', captures: [pageCapture('same')] },
      ],
    })));
    assert.equal(Object.keys(graph.state.captures).length, 2);
    assert.equal(Object.keys(graph.state.captures).length, new Set(Object.keys(graph.state.captures)).size);
  });
});

describe('re-capture preserves old pins and ratings; lineage links captures', () => {
  async function setup() {
    const { ports, graph } = await openGraph();
    reportOf(await graph.importTree(websiteTree()));
    const subjectId = await pageId('https://example.com/pricing');
    const [old] = capturesOfSubject(graph.state, subjectId);
    const pinned = await graph.pin(old!.id, 'proj_alpha', { viewId: 'view-1', purpose: 'pricing layout' });
    assert.equal(pinned.ok, true);
    assert.equal((await graph.setRating(subjectId, 4)).ok, true);
    return { ports, graph, subjectId, old: old! };
  }

  test('a new capture of the same page keeps the subject ID, pin, rating and old capture', async () => {
    const { ports, graph, subjectId, old } = await setup();
    ports.clock.advance(86_400_000);
    const recaptured = reportOf(await graph.importTree(websiteTree({
      pages: [{ url: 'https://example.com/pricing', title: 'Pricing', captures: [pageCapture('pricing-v2', { capturedAt: '2026-03-01T10:00:00.000Z' })] }],
    })));
    assert.equal(recaptured.captures[0]!.status, 'created');
    const captures = capturesOfSubject(graph.state, subjectId);
    assert.equal(captures.length, 2);
    const head = headCapture(graph.state, subjectId)!;
    assert.notEqual(head.id, old.id);
    assert.equal(head.lineage.supersedes, old.id, 'lineage points at the previous capture');
    assert.deepEqual(lineageOf(graph.state, head.id).map((capture) => capture.id), [head.id, old.id]);
    assert.equal(graph.state.subjects[subjectId]!.rating, 4, 'rating survives re-capture');
    const [pin] = pinsForProject(graph.state, 'proj_alpha');
    assert.equal(pin!.captureId, old.id, 'the pin still names the exact old capture');
    assert.equal(pin!.assetDigest, old.asset!.digest);
    assert.equal(graph.state.captures[old.id]!.availability.content, 'present');
  });

  test('a late-arriving older capture links to the capture before it', async () => {
    const { graph, subjectId, old } = await setup();
    reportOf(await graph.importTree(websiteTree({
      pages: [{ url: 'https://example.com/pricing', title: 'Pricing', captures: [pageCapture('pricing-older', { capturedAt: '2026-01-01T00:00:00.000Z' })] }],
    })));
    const ordered = capturesOfSubject(graph.state, subjectId);
    assert.equal(ordered.length, 2);
    assert.equal(ordered[0]!.lineage.supersedes, null, 'nothing precedes the earliest capture');
    assert.equal(headCapture(graph.state, subjectId)!.id, old.id);
  });

  test('re-importing the old bytes after a new capture is a no-op on identity', async () => {
    const { graph, subjectId } = await setup();
    reportOf(await graph.importTree(websiteTree({
      pages: [{ url: 'https://example.com/pricing', title: 'Pricing', captures: [pageCapture('pricing-v2', { capturedAt: '2026-03-01T10:00:00.000Z' })] }],
    })));
    const again = reportOf(await graph.importTree(websiteTree({ pages: [{ url: 'https://example.com/pricing', title: 'Pricing', captures: [pageCapture('pricing')] }] })));
    assert.equal(again.captures[0]!.status, 'unchanged');
    assert.equal(capturesOfSubject(graph.state, subjectId).length, 2);
  });

  test('a rating must be an integer 1..5 or null and only the owner path sets it', async () => {
    const { graph, subjectId } = await setup();
    assert.equal((await graph.setRating(subjectId, 6)).ok, false);
    assert.equal((await graph.setRating(subjectId, 2.5)).ok, false);
    assert.equal((await graph.setRating(subjectId, null)).ok, true);
    assert.equal(graph.state.subjects[subjectId]!.rating, null);
  });
});

describe('section and element anchors bind exact capture digests', () => {
  test('anchors store the capture ID and its exact asset digest', async () => {
    const { graph } = await openGraph();
    reportOf(await graph.importTree(websiteTree()));
    const home = capturesOfSubject(graph.state, await pageId('https://example.com/'))[0]!;
    const anchors = Object.values(graph.state.anchors);
    assert.equal(anchors.length, 3);
    for (const anchor of anchors) {
      assert.equal(anchor.captureId, home.id);
      assert.equal(anchor.assetDigest, home.asset!.digest);
    }
    const cta = anchors.find((anchor) => anchor.key === 'hero-cta')!;
    assert.equal(graph.state.anchors[cta.parentId!]!.key, 'hero');
  });

  test('the same anchor key on different bytes is a different anchor of a different capture', async () => {
    const { graph } = await openGraph();
    const tree = (label: string) => websiteTree({
      pages: [{ url: 'https://example.com/', title: 'Home', captures: [pageCapture(label, { anchors: [{ key: 'hero', kind: 'section', label: 'Hero' }] })] }],
    });
    reportOf(await graph.importTree(tree('home-v1')));
    reportOf(await graph.importTree(tree('home-v2')));
    const anchors = Object.values(graph.state.anchors);
    assert.equal(anchors.length, 2);
    assert.notEqual(anchors[0]!.id, anchors[1]!.id);
    assert.notEqual(anchors[0]!.assetDigest, anchors[1]!.assetDigest);
  });

  test('a pin to an anchor must name the anchor of the same capture', async () => {
    const { graph } = await openGraph();
    reportOf(await graph.importTree(websiteTree()));
    const home = capturesOfSubject(graph.state, await pageId('https://example.com/'))[0]!;
    const pricing = capturesOfSubject(graph.state, await pageId('https://example.com/pricing'))[0]!;
    const hero = Object.values(graph.state.anchors).find((anchor) => anchor.key === 'hero')!;
    assert.equal((await graph.pin(home.id, 'proj_a', { anchorId: hero.id })).ok, true);
    const wrong = await graph.pin(pricing.id, 'proj_a', { anchorId: hero.id });
    assert.deepEqual(wrong, { ok: false, code: 'anchor-capture-mismatch' });
  });

  test('anchors need pixels, valid parents and valid rectangles', async () => {
    const { graph } = await openGraph();
    const attempt = async (capture: Parameters<typeof websiteTree>[0]) => graph.importTree(websiteTree(capture));
    const page = (capture: ReturnType<typeof pageCapture>) => ({ pages: [{ url: 'https://example.com/', title: 'Home', captures: [capture] }] });
    const noImage = await attempt(page({ kind: 'screenshot', capturedAt: '2026-02-01T10:00:00.000Z', capturedBy: 'observed', captureKey: 'k', anchors: [{ key: 'a', kind: 'section', label: 'A' }] }));
    assert.deepEqual(issuesOf(noImage), [{ field: 'pages[0].captures[0].anchors', code: 'anchor-requires-asset' }]);
    const orphan = await attempt(page(pageCapture('x', { anchors: [{ key: 'a', kind: 'element', label: 'A', parentKey: 'nope' }] })));
    assert.deepEqual(issuesOf(orphan), [{ field: 'pages[0].captures[0].anchors[0].parentKey', code: 'unknown-parent' }]);
    const outside = await attempt(page(pageCapture('x', { anchors: [{ key: 'a', kind: 'section', label: 'A', rect: { x: 0.8, y: 0, w: 0.5, h: 0.1 } }] })));
    assert.deepEqual(issuesOf(outside), [{ field: 'pages[0].captures[0].anchors[0].rect', code: 'invalid' }]);
    const sectionUnderElement = await attempt(page(pageCapture('x', {
      anchors: [{ key: 'a', kind: 'element', label: 'A' }, { key: 'b', kind: 'section', label: 'B', parentKey: 'a' }],
    })));
    assert.deepEqual(issuesOf(sectionUnderElement), [{ field: 'pages[0].captures[0].anchors[1].parentKey', code: 'section-parent-must-be-section' }]);
  });
});

describe('present, no-image, blob-missing, source-unavailable and missing-at-source remain distinct', () => {
  test('each state is reachable and projects to its own label', async () => {
    const { ports, graph } = await openGraph();
    const missingDigest = `sha256:${'a'.repeat(64)}` as BlobDigest;
    reportOf(await graph.importTree(websiteTree({
      pages: [
        { url: 'https://example.com/present', title: 'P', captures: [pageCapture('present')] },
        { url: 'https://example.com/none', title: 'N', captures: [{ kind: 'screenshot', capturedAt: '2026-02-01T10:00:00.000Z', capturedBy: 'observed', captureKey: 'meta' }] },
        { url: 'https://example.com/blob', title: 'B', captures: [{ kind: 'screenshot', capturedAt: '2026-02-01T10:00:00.000Z', capturedBy: 'observed', asset: { digest: missingDigest, byteLength: 10, mediaType: 'image/png' } }] },
        { url: 'https://example.com/unreachable', title: 'U', captures: [pageCapture('unreachable', { sourceStatus: 'source-unavailable' })] },
        { url: 'https://example.com/gone', title: 'G', captures: [pageCapture('gone', { sourceStatus: 'missing-at-source' })] },
      ],
    })));
    const labelOf = async (path: string) => availabilityLabel(headCapture(graph.state, await pageId(`https://example.com/${path}`))!.availability);
    assert.equal(await labelOf('present'), 'present');
    assert.equal(await labelOf('none'), 'no-image');
    assert.equal(await labelOf('blob'), 'blob-missing');
    assert.equal(await labelOf('unreachable'), 'source-unavailable');
    assert.equal(await labelOf('gone'), 'missing-at-source');
    assert.equal(ports.storage.blobs.has(missingDigest), false, 'a digest-only asset is never fabricated');
  });

  test('both axes are kept: gone at source but still stored is missing-at-source with content present', async () => {
    const { graph } = await openGraph();
    reportOf(await graph.importTree(websiteTree()));
    const capture = capturesOfSubject(graph.state, await pageId('https://example.com/pricing'))[0]!;
    assert.equal((await graph.reportSourceStatus(capture.id, 'missing-at-source', 'observed')).ok, true);
    const after = graph.state.captures[capture.id]!;
    assert.equal(after.availability.content, 'present');
    assert.equal(after.availability.source, 'missing-at-source');
    assert.equal(after.availability.sourceObservedBy, 'observed');
    assert.deepEqual(await graph.reportSourceStatus(capture.id, 'unchecked', 'observed'), { ok: false, code: 'invalid-status' });
  });

  test('late-arriving bytes clear blob-missing on refresh and are never invented', async () => {
    const { ports, graph } = await openGraph();
    const late = bytes('late');
    const digest = await ports.storage.putBlob(late, 'image/png');
    ports.storage.blobs.delete(digest.digest);
    reportOf(await graph.importTree(websiteTree({
      pages: [{ url: 'https://example.com/late', title: 'Late', captures: [{ kind: 'screenshot', capturedAt: '2026-02-01T10:00:00.000Z', capturedBy: 'observed', asset: { digest: digest.digest, byteLength: late.byteLength, mediaType: 'image/png' } }] }],
    })));
    const id = Object.keys(graph.state.captures)[0] as CaptureId;
    assert.equal(graph.state.captures[id]!.availability.content, 'blob-missing');
    assert.equal((await graph.refreshAvailability()).ok, true);
    assert.equal(graph.state.captures[id]!.availability.content, 'blob-missing');
    await ports.storage.putBlob(late, 'image/png');
    assert.equal((await graph.refreshAvailability()).ok, true);
    assert.equal(graph.state.captures[id]!.availability.content, 'present');
  });
});

describe('storage and executable content', () => {
  test('graph and captures only ever touch the workspace document and blob store', async () => {
    const { ports, graph } = await openGraph();
    reportOf(await graph.importTree(websiteTree()));
    reportOf(await graph.importTree(appTree()));
    await graph.pin(Object.keys(graph.state.captures)[0] as CaptureId, 'proj_a');
    const documents = ports.storage.operations.filter((operation) => operation.op === 'readDocument' || operation.op === 'writeDocument');
    assert.ok(documents.length > 0);
    for (const operation of documents) {
      assert.deepEqual({ namespace: (operation as { namespace: string }).namespace, key: (operation as { key: string }).key }, { namespace: 'workspace', key: 'design/references/graph' });
    }
  });

  test('markup, scripts, SVG and archives are never accepted as capture content', async () => {
    const { ports, graph } = await openGraph();
    for (const mediaType of ['text/html', 'image/svg+xml', 'application/zip', 'application/javascript', 'application/x-hq-html-bundle']) {
      const outcome = await graph.importTree(websiteTree({
        pages: [{ url: 'https://example.com/x', title: 'X', captures: [pageCapture('x', { kind: mediaType.startsWith('image/') ? 'screenshot' : 'web-prototype', asset: { bytes: bytes('x'), mediaType } })] }],
      }));
      assert.equal(outcome.ok, false, mediaType);
      assert.equal(issuesOf(outcome)[0]!.code, 'executable-or-unsupported-media-type', mediaType);
    }
    assert.equal(ports.storage.blobs.size, 0);
  });

  test('native captures need app-family subjects and validated native evidence', async () => {
    const { graph } = await openGraph();
    const native = pageCapture('n', { kind: 'native', nativeEvidence: { platform: 'ios', runtime: 'device', buildRef: 'synthetic-42', claim: 'observed' } });
    const onWebsite = await graph.importTree(websiteTree({ pages: [{ url: 'https://example.com/n', title: 'N', captures: [native] }] }));
    assert.equal(onWebsite.ok, false);
    const screenshotWithEvidence = await graph.importTree(appTree({
      screens: [{ key: 'list', title: 'List', captures: [pageCapture('s', { nativeEvidence: native.nativeEvidence! })] }], flows: [],
    }));
    assert.equal(issuesOf(screenshotWithEvidence)[0]!.code, 'screenshot-cannot-claim-native-execution');
    const ok = await graph.importTree(appTree({ screens: [{ key: 'list', title: 'List', captures: [native] }], flows: [] }));
    assert.equal(ok.ok, true, JSON.stringify(ok));
  });
});
