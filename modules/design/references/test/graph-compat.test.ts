/** hq.design.references/v1 stays compatible; the graph reads it without changing it. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ReferenceId } from '../src/contract.ts';
import { EXPORT_SCHEMA, LIBRARY_DOCUMENT_KEY, LIBRARY_SCHEMA } from '../src/contract.ts';
import { fakePorts } from '../src/fakes.ts';
import { GRAPH_DOCUMENT_KEY, GRAPH_SCHEMA } from '../src/graph-contract.ts';
import { planFlatAdoption } from '../src/graph-flat.ts';
import { deriveSubjectId } from '../src/graph-identity.ts';
import { capturesOfSubject } from '../src/graph-ops.ts';
import { ReferenceGraph } from '../src/graph-service.ts';
import { parseLibraryDocument } from '../src/persist.ts';
import { deriveReferenceId } from '../src/provenance.ts';
import { ReferenceLibrary } from '../src/service.ts';
import { appScreenshot, nativeReference, screenshot } from './fixtures.ts';

describe('schemas and identities already shipped do not move', () => {
  test('constants and document keys are unchanged and distinct from the graph', () => {
    assert.equal(LIBRARY_SCHEMA, 'hq.design.references/v1');
    assert.equal(EXPORT_SCHEMA, 'hq.design.references-export/v1');
    assert.equal(LIBRARY_DOCUMENT_KEY, 'design/references/library');
    assert.equal(GRAPH_SCHEMA, 'hq.design.reference-graph/v1');
    assert.notEqual(GRAPH_DOCUMENT_KEY, LIBRARY_DOCUMENT_KEY);
  });

  test('a v1 reference ID matches the vector computed from the PR6 source (3cedea4) before the graph existed', async () => {
    const id = await deriveReferenceId({ kind: 'url', url: 'https://example.com/pricing' }, 'screenshot', `sha256:${'0'.repeat(64)}` as never);
    assert.equal(id, 'ref_cc4ed7ecb51ba82fa343022d68832a78bd08a5a8925c33bb25d72b587b1330a5');
  });

  test('an old strict v1 document still parses with only v1 fields', () => {
    const parsed = parseLibraryDocument({ schema: LIBRARY_SCHEMA, references: {}, collections: {}, uses: {} });
    assert.equal(parsed.status, 'ok');
    assert.equal(parseLibraryDocument({ schema: LIBRARY_SCHEMA, references: {}, collections: {}, uses: {}, graph: {} }).status, 'invalid', 'v1 stays closed');
    assert.equal(parseLibraryDocument({ schema: 'hq.design.references/v2', anything: 1 }).status, 'future-schema');
  });

  test('the library keeps working beside the graph and never writes the graph document', async () => {
    const ports = fakePorts();
    const library = await ReferenceLibrary.open(ports);
    const graph = await ReferenceGraph.open({ storage: ports.storage, clock: ports.clock });
    assert.equal((await library.importReference(screenshot())).status, 'created');
    const writtenKeys = ports.storage.operations.filter((operation) => operation.op === 'writeDocument').map((operation) => (operation as { key: string }).key);
    assert.deepEqual(writtenKeys, [LIBRARY_DOCUMENT_KEY]);
    assert.deepEqual(graph.state.subjects, {});
  });
});

describe('adopting the flat library into the graph', () => {
  async function seeded() {
    const ports = fakePorts();
    const library = await ReferenceLibrary.open(ports);
    const web = await library.importReference(screenshot({ rights: { status: 'permitted', basis: 'synthetic fixture' } }));
    const app = await library.importReference(appScreenshot());
    const native = await library.importReference(nativeReference());
    const html = await library.importReference({
      kind: 'web-prototype', source: { kind: 'url', url: 'https://example.com/proto' }, capturedAt: '2026-02-01T10:00:00.000Z',
      capturedBy: 'observed', title: 'Prototype', asset: { bytes: new TextEncoder().encode('<script>1</script>'), mediaType: 'text/html' },
    });
    assert.deepEqual([web.status, app.status, native.status, html.status], ['created', 'created', 'created', 'created']);
    await library.setRights((app as { id: ReferenceId }).id, { status: 'restricted' });
    const graph = await ReferenceGraph.open({ storage: ports.storage, clock: ports.clock });
    return { ports, library, graph, ids: { web: (web as { id: string }).id, app: (app as { id: string }).id, native: (native as { id: string }).id, html: (html as { id: string }).id } };
  }

  test('url references become site > page and app references app > screen, linked back by reference ID', async () => {
    const { library, graph, ids } = await seeded();
    const plan = planFlatAdoption(library.state);
    assert.deepEqual(plan.skipped, [{ id: ids.html, code: 'executable-or-unsupported-media-type' }]);
    const adopted = await graph.adoptFlatLibrary(library.state);
    assert.ok(adopted.outcomes.every((outcome) => outcome.ok), JSON.stringify(adopted.outcomes));
    const page = capturesOfSubject(graph.state, await deriveSubjectId({ kind: 'page', url: 'https://example.com/pricing' }));
    assert.equal(page.length, 1);
    assert.equal(page[0]!.referenceId, ids.web);
    assert.equal(page[0]!.provenance.origin, 'flat-library');
    assert.equal(page[0]!.rights.effective, 'permitted');
    assert.equal(page[0]!.availability.content, 'present');
    const app = await deriveSubjectId({ kind: 'app', platform: 'ios', appId: 'com.example.notes' });
    const editor = await deriveSubjectId({ kind: 'screen', app, key: 'editor' });
    const kinds = capturesOfSubject(graph.state, editor).map((capture) => capture.kind).sort();
    assert.deepEqual(kinds, ['native', 'screenshot']);
  });

  test('an owner-judged v1 rights decision keeps its claim level; the library itself is not changed', async () => {
    const { ports, library, graph, ids } = await seeded();
    const before = JSON.stringify((await ports.storage.readDocument('workspace', LIBRARY_DOCUMENT_KEY))!.value);
    await graph.adoptFlatLibrary(library.state);
    const adopted = Object.values(graph.state.captures).find((capture) => capture.referenceId === ids.app)!;
    assert.equal(adopted.rights.effective, 'restricted');
    assert.equal(adopted.rights.setBy, 'owner-judged');
    assert.equal(JSON.stringify((await ports.storage.readDocument('workspace', LIBRARY_DOCUMENT_KEY))!.value), before);
  });

  test('adoption is idempotent and a tombstoned v1 reference is skipped', async () => {
    const { ports, library, graph, ids } = await seeded();
    await graph.adoptFlatLibrary(library.state);
    const written = ports.storage.operations.filter((operation) => operation.op === 'writeDocument').length;
    const again = await graph.adoptFlatLibrary(library.state);
    assert.ok(again.outcomes.every((outcome) => outcome.ok && outcome.status === 'unchanged'));
    assert.equal(ports.storage.operations.filter((operation) => operation.op === 'writeDocument').length, written);
    await library.deleteReference(ids.web as never);
    assert.ok(planFlatAdoption(library.state).skipped.some((item) => item.id === ids.web && item.code === 'tombstoned'));
  });
});
