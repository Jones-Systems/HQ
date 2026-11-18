/** Persistence, fencing, tombstones and strict document validation for the reference graph. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { GraphState } from '../src/graph-contract.ts';
import { GRAPH_DOCUMENT_KEY } from '../src/graph-contract.ts';
import { deriveSubjectId } from '../src/graph-identity.ts';
import { capturesOfSubject, pinsForProject } from '../src/graph-ops.ts';
import { parseGraphDocument } from '../src/graph-persist.ts';
import { ReferenceGraph } from '../src/graph-service.ts';
import { appTree, openGraph, websiteTree, writes } from './graph-fixtures.ts';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

async function populated() {
  const opened = await openGraph();
  assert.equal((await opened.graph.importTree(websiteTree())).ok, true);
  assert.equal((await opened.graph.importTree(appTree())).ok, true);
  const home = capturesOfSubject(opened.graph.state, await deriveSubjectId({ kind: 'page', url: 'https://example.com/' }))[0]!;
  const hero = Object.values(opened.graph.state.anchors).find((anchor) => anchor.key === 'hero')!;
  assert.equal((await opened.graph.pin(home.id, 'proj_a', { anchorId: hero.id, purpose: 'hero study' })).ok, true);
  return { ...opened, home, hero };
}

describe('persistence', () => {
  test('state round-trips through storage and verifies every derived ID', async () => {
    const { ports, graph } = await populated();
    const reopened = await ReferenceGraph.open({ storage: ports.storage, clock: ports.clock });
    assert.equal(reopened.access.mode, 'writable');
    assert.deepEqual(reopened.state, graph.state);
  });

  test('pinning is idempotent and unpinning keeps the record', async () => {
    const { graph, home, hero } = await populated();
    const again = await graph.pin(home.id, 'proj_a', { anchorId: hero.id, purpose: 'other words' });
    assert.equal(again.ok, true);
    assert.equal(pinsForProject(graph.state, 'proj_a').length, 1);
    assert.equal(pinsForProject(graph.state, 'proj_a')[0]!.purpose, 'hero study');
    const [pin] = pinsForProject(graph.state, 'proj_a');
    assert.equal((await graph.unpin(pin!.id)).ok, true);
    assert.equal(pinsForProject(graph.state, 'proj_a').length, 0);
    assert.equal(Object.keys(graph.state.pins).length, 1);
  });

  test('deleting a capture or subject tombstones it and keeps blobs, anchors and pins', async () => {
    const { ports, graph, home } = await populated();
    const blobs = ports.storage.blobs.size;
    assert.equal((await graph.deleteCapture(home.id)).ok, true);
    assert.equal(graph.state.captures[home.id]!.tombstonedAt !== null, true);
    assert.equal(ports.storage.blobs.size, blobs);
    assert.equal(pinsForProject(graph.state, 'proj_a').length, 1, 'the pin still names its capture');
    const again = await graph.importTree(websiteTree());
    assert.equal(again.ok && again.captures.find((capture) => capture.id === home.id)!.status, 'tombstoned');
    assert.equal(graph.state.captures[home.id]!.tombstonedAt !== null, true, 'a re-import does not resurrect it');
    assert.equal((await graph.restoreCapture(home.id)).ok, true);
    assert.equal(graph.state.captures[home.id]!.tombstonedAt, null);
    assert.equal((await graph.pin(home.id, 'proj_b')).ok, true, 'a restored capture can be pinned again');
  });

  test('a tombstoned capture cannot be pinned', async () => {
    const { graph, home } = await populated();
    await graph.deleteCapture(home.id);
    assert.deepEqual(await graph.pin(home.id, 'proj_c'), { ok: false, code: 'capture-tombstoned' });
  });
});

describe('write effects', () => {
  test('a thrown write fences the graph until reload reads authoritative state', async () => {
    const { ports, graph } = await openGraph();
    ports.storage.failNextWrite = 'after-apply';
    const outcome = await graph.importTree(websiteTree());
    assert.deepEqual(outcome, { ok: false, issues: [{ field: '', code: 'unknown-write-effect' }] });
    assert.deepEqual(graph.access, { mode: 'fenced', reason: 'unknown-write-effect' });
    const writesBefore = writes(ports);
    assert.equal((await graph.importTree(appTree())).ok, false, 'a fenced graph does not retry blindly');
    assert.equal(writes(ports), writesBefore);
    assert.equal((await graph.reload()).mode, 'writable');
    assert.equal(Object.keys(graph.state.subjects).length, 4, 'the landed write is visible after reload');
    const again = await graph.importTree(websiteTree());
    assert.equal(again.ok && again.status, 'unchanged');
  });

  test('a compare-and-swap conflict is reapplied once on reloaded state', async () => {
    const { ports, graph } = await openGraph();
    const other = await ReferenceGraph.open({ storage: ports.storage, clock: ports.clock });
    assert.equal((await other.importTree(appTree())).ok, true);
    const outcome = await graph.importTree(websiteTree());
    assert.equal(outcome.ok, true);
    assert.equal(Object.keys(graph.state.subjects).length, 4 + 5, 'both writers are merged');
  });

  test('read-only storage is a known no-effect', async () => {
    const { ports, graph } = await openGraph();
    ports.storage.readOnly = true;
    const outcome = await graph.importTree(websiteTree());
    assert.deepEqual(outcome, { ok: false, issues: [{ field: '', code: 'read-only' }] });
    assert.equal(graph.access.mode, 'read-only');
  });
});

describe('future and invalid documents open without writes', () => {
  test('a newer graph schema is read-only and never rewritten', async () => {
    const { ports, graph } = await populated();
    const future = { ...clone(graph.state), schema: 'hq.design.reference-graph/v2', addedLater: { anything: true } };
    ports.storage.seedDocument('workspace', GRAPH_DOCUMENT_KEY, future);
    const reopened = await ReferenceGraph.open({ storage: ports.storage, clock: ports.clock });
    assert.deepEqual(reopened.access, { mode: 'read-only', reason: 'future-schema', detail: 'hq.design.reference-graph/v2' });
    const before = writes(ports);
    assert.equal((await reopened.importTree(websiteTree())).ok, false);
    assert.equal((await reopened.pin('cap_x' as never, 'proj_a')).ok, false);
    assert.equal(writes(ports), before);
    const stored = await ports.storage.readDocument('workspace', GRAPH_DOCUMENT_KEY);
    assert.deepEqual(stored!.value, future, 'the future document is untouched');
  });

  test('an invalid document is read-only and names the offending path', async () => {
    const { ports, graph } = await populated();
    const broken = clone(graph.state);
    const [first] = Object.values(broken.captures);
    (first as { importCount: number }).importCount = 0;
    ports.storage.seedDocument('workspace', GRAPH_DOCUMENT_KEY, broken);
    const reopened = await ReferenceGraph.open({ storage: ports.storage, clock: ports.clock });
    assert.equal(reopened.access.mode, 'read-only');
    assert.equal((reopened.access as { reason: string }).reason, 'invalid-document');
    assert.match((reopened.access as { detail: string }).detail, /^\$\.captures\.cap_[0-9a-f]{64}\.importCount$/u);
  });

  const tampers: [string, (state: GraphState) => void, RegExp][] = [
    ['an extra unknown field', (state) => { (Object.values(state.subjects)[0] as unknown as Record<string, unknown>).extra = 1; }, /extra$/u],
    ['a subject ID that is not its identity hash', (state) => {
      const [id, node] = Object.entries(state.subjects).find(([, candidate]) => candidate.kind === 'page')!;
      const other = `sub_${'b'.repeat(64)}`;
      delete (state.subjects as Record<string, unknown>)[id];
      (state.subjects as Record<string, unknown>)[other] = { ...node, id: other };
      for (const record of Object.values(state.captures)) if (record.subjectId === id) (record as { subjectId: string }).subjectId = other;
    }, /^\$\.subjects\.sub_b+\.id$/u],
    ['a hand-edited effective grant', (state) => {
      const target = Object.values(state.captures).find((capture) => capture.rights.effective === 'unknown')!;
      (target.rights as { effective: string }).effective = 'permitted';
    }, /\.rights\.effective$/u],
    ['a permitted status with no basis', (state) => {
      const target = Object.values(state.captures)[0]!;
      (target.rights as { declared: unknown; effective: string }).declared = { vocabulary: 'hq.design.references/v1', value: 'permitted' };
      (target.rights as { effective: string }).effective = 'permitted';
    }, /\.rights\.effective$/u],
    ['an anchor bound to a different digest', (state) => {
      (Object.values(state.anchors)[0] as { assetDigest: string }).assetDigest = `sha256:${'c'.repeat(64)}`;
    }, /\.assetDigest$/u],
    ['a pin whose digest disagrees with its capture', (state) => {
      (Object.values(state.pins)[0] as { assetDigest: string }).assetDigest = `sha256:${'d'.repeat(64)}`;
    }, /\.assetDigest$/u],
    ['a lineage pointer to another subject', (state) => {
      const [a, b] = Object.values(state.captures).filter((capture) => capture.asset !== null);
      (a as { lineage: { supersedes: string } }).lineage = { supersedes: b!.id };
    }, /\.lineage\.supersedes$/u],
    ['no-image availability on a capture with bytes', (state) => {
      const target = Object.values(state.captures).find((capture) => capture.asset !== null)!;
      (target.availability as { content: string }).content = 'no-image';
    }, /\.availability\.content$/u],
    ['an executable media type', (state) => {
      const target = Object.values(state.captures).find((capture) => capture.asset !== null)!;
      (target.asset as { mediaType: string }).mediaType = 'text/html';
    }, /\.asset\.mediaType$/u],
    ['a capture ID that is not its identity hash', (state) => {
      const [id, record] = Object.entries(state.captures).find(([, capture]) => capture.asset !== null)!;
      const other = `cap_${'e'.repeat(64)}`;
      delete (state.captures as Record<string, unknown>)[id];
      (state.captures as Record<string, unknown>)[other] = { ...record, id: other };
      for (const anchor of Object.values(state.anchors)) if (anchor.captureId === id) (anchor as { captureId: string }).captureId = other;
      for (const pin of Object.values(state.pins)) if (pin.captureId === id) (pin as { captureId: string }).captureId = other;
    }, /^\$\.captures\.cap_e+\.id$/u],
  ];
  for (const [name, tamper, expected] of tampers) {
    test(`rejects ${name}`, async () => {
      const { graph } = await populated();
      const broken = clone(graph.state);
      tamper(broken);
      const parsed = await parseGraphDocument(broken);
      assert.equal(parsed.status, 'invalid', JSON.stringify(parsed).slice(0, 200));
      assert.match((parsed as { path: string }).path, expected);
    });
  }

  test('the untouched document parses', async () => {
    const { graph } = await populated();
    assert.equal((await parseGraphDocument(clone(graph.state))).status, 'ok');
  });
});
