import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CollectionId, ReferenceId } from '../src/contract.ts';
import { LIBRARY_DOCUMENT_KEY } from '../src/contract.ts';
import { toReferenceEnvelope } from '../src/envelope.ts';
import { fakePorts } from '../src/fakes.ts';
import { normalizeTag, usesForProject } from '../src/library.ts';
import { parseLibraryDocument } from '../src/persist.ts';
import { normalizeUrl } from '../src/provenance.ts';
import { parseSearchText, searchReferences, tagCounts } from '../src/search.ts';
import { ReferenceLibrary } from '../src/service.ts';
import { appScreenshot, bytes, nativeReference, screenshot } from './fixtures.ts';

async function seeded() {
  const ports = fakePorts();
  const library = await ReferenceLibrary.open(ports);
  const ids: ReferenceId[] = [];
  for (const candidate of [
    screenshot(),
    appScreenshot(),
    nativeReference(),
    screenshot({
      title: 'Checkout — café receipt', source: { kind: 'url', url: 'https://shop.example.org/checkout' },
      tags: ['checkout', 'cards'], asset: { bytes: bytes('checkout'), mediaType: 'image/webp' },
      capturedAt: '2026-04-01T00:00:00.000Z', rights: { status: 'permitted', basis: 'Synthetic CC0' },
    }),
  ]) {
    const outcome = await library.importReference(candidate);
    assert.equal(outcome.status, 'created', JSON.stringify(outcome));
    ids.push((outcome as { id: ReferenceId }).id);
  }
  return { ports, library, ids };
}

describe('validation and normalization', () => {
  test('URL normalization rejects credentials and non-web schemes', () => {
    assert.equal(normalizeUrl('https://user:pw@example.com/'), null);
    assert.equal(normalizeUrl('file:///etc/hosts'), null);
    assert.equal(normalizeUrl('javascript:alert(1)'), null);
    assert.equal(normalizeUrl('HTTP://Example.com:80/a?b=1#c'), 'http://example.com/a?b=1');
  });

  test('tags are normalized, deduplicated and bounded', () => {
    assert.equal(normalizeTag('  Dark   Mode '), 'dark mode');
    assert.equal(normalizeTag(''), null);
    assert.equal(normalizeTag('<script>'), null);
  });

  test('invalid candidates report every issue and write nothing', async () => {
    const ports = fakePorts();
    const library = await ReferenceLibrary.open(ports);
    const outcome = await library.importReference({
      kind: 'hologram', source: { kind: 'url', url: 'ftp://x' }, capturedAt: 'yesterday', capturedBy: 'me', title: '',
    });
    assert.equal(outcome.status, 'rejected');
    const fields = (outcome as { issues: { field: string }[] }).issues.map((issue) => issue.field);
    assert.deepEqual(fields, ['kind', 'source.url', 'capturedAt', 'capturedBy', 'title']);
    assert.equal(ports.storage.operations.some((op) => op.op === 'writeDocument' || op.op === 'putBlob'), false);
  });

  test('a pre-stored digest must already exist in the blob store', async () => {
    const library = await ReferenceLibrary.open(fakePorts());
    const outcome = await library.importReference(screenshot({
      asset: { digest: `sha256:${'a'.repeat(64)}`, byteLength: 10, mediaType: 'image/png' },
    }));
    assert.deepEqual(outcome, { status: 'rejected', issues: [{ field: 'asset.digest', code: 'blob-missing' }] });
  });
});

describe('search and tags', () => {
  test('free text matches title, notes, tags and source with accent folding', async () => {
    const { library, ids } = await seeded();
    const [pricing, notes, native, checkout] = ids;
    assert.deepEqual(searchReferences(library.state, { text: 'cafe' }).map((r) => r.id), [checkout]);
    assert.deepEqual(searchReferences(library.state, { text: 'example notes' }).map((r) => r.id).sort(), [notes, native].sort());
    assert.deepEqual(searchReferences(library.state, { text: 'shop.example.org' }).map((r) => r.id), [checkout]);
    assert.deepEqual(searchReferences(library.state, { tags: ['cards' as never] }).map((r) => r.id).sort(), [pricing, checkout].sort());
  });

  test('structured filters from the search box', async () => {
    const { library, ids } = await seeded();
    const query = parseSearchText('tag:Cards kind:screenshot is:publishable');
    assert.deepEqual(query, { text: '', tags: ['cards'], kinds: ['screenshot'], publishableOnly: true });
    assert.deepEqual(searchReferences(library.state, query).map((r) => r.id), [ids[3]]);
    assert.deepEqual(searchReferences(library.state, parseSearchText('kind:native')).map((r) => r.id), [ids[2]]);
  });

  test('results rank title matches first then newest capture; tombstones hidden by default', async () => {
    const { library, ids } = await seeded();
    assert.deepEqual(searchReferences(library.state, {}).map((r) => r.id), [ids[3], ids[2], ids[1], ids[0]]);
    await library.deleteReference(ids[3]!);
    assert.equal(searchReferences(library.state, {}).length, 3);
    assert.equal(searchReferences(library.state, { includeTombstoned: true }).length, 4);
    assert.deepEqual(tagCounts(library.state).slice(0, 1), [{ tag: 'cards', count: 1 }]);
  });

  test('collection filter', async () => {
    const { library, ids } = await seeded();
    const col = await library.createCollection('Mobile');
    const id = (col as { value: CollectionId }).value;
    await library.addToCollection(id, ids[1]!);
    assert.deepEqual(searchReferences(library.state, { collectionId: id }).map((r) => r.id), [ids[1]]);
  });
});

describe('use in project', () => {
  test('links are explicit, idempotent and produce a readable envelope', async () => {
    const { ports, library, ids } = await seeded();
    const first = await library.useInProject(ids[0]!, 'project-alpha', { purpose: 'Pricing layout inspiration' });
    assert.equal(first.ok, true);
    const use = (first as { value: { id: string; projectId: string } }).value;
    const writes = ports.storage.operations.filter((op) => op.op === 'writeDocument').length;
    const again = await library.useInProject(ids[0]!, 'project-alpha', { purpose: 'other' });
    assert.equal((again as { value: { id: string } }).value.id, use.id);
    assert.equal(ports.storage.operations.filter((op) => op.op === 'writeDocument').length, writes, 'repeat link writes nothing');
    assert.deepEqual(usesForProject(library.state, 'project-alpha').map((item) => item.referenceId), [ids[0]]);

    const envelope = toReferenceEnvelope(library.state.references[ids[0]!]!, library.state.uses[use.id]!);
    assert.deepEqual(envelope, {
      version: 1, domain: 'design', projectId: 'project-alpha', kind: 'design.reference', entityId: ids[0],
      title: 'Example pricing page', returnDestination: { domain: 'design', destination: `references/${ids[0]}` },
    });
  });

  test('a tombstoned reference cannot be newly linked; unlinking tombstones the link', async () => {
    const { library, ids } = await seeded();
    const linked = await library.useInProject(ids[1]!, 'project-beta', { viewId: 'view-1' });
    const useId = (linked as { value: { id: string } }).value.id;
    assert.equal((await library.unlinkUse(useId as never)).ok, true);
    assert.notEqual(library.state.uses[useId]!.tombstonedAt, null);
    await library.deleteReference(ids[0]!);
    assert.deepEqual(await library.useInProject(ids[0]!, 'project-beta'), { ok: false, code: 'reference-tombstoned' });
  });
});

describe('persistence and failure handling', () => {
  test('future schema opens read-only and is never written', async () => {
    const ports = fakePorts();
    ports.storage.seedDocument('workspace', LIBRARY_DOCUMENT_KEY, { schema: 'hq.design.references/v2', anything: true });
    const library = await ReferenceLibrary.open(ports);
    assert.deepEqual(library.access, { mode: 'read-only', reason: 'future-schema', detail: 'hq.design.references/v2' });
    const outcome = await library.importReference(screenshot());
    assert.equal(outcome.status, 'rejected');
    assert.equal(ports.storage.operations.some((op) => op.op === 'writeDocument' || op.op === 'putBlob'), false);
  });

  test('an invalid document is not repaired', async () => {
    const ports = fakePorts();
    ports.storage.seedDocument('workspace', LIBRARY_DOCUMENT_KEY, { schema: 'hq.design.references/v1', references: [], collections: {}, uses: {} });
    const library = await ReferenceLibrary.open(ports);
    assert.equal(library.access.mode, 'read-only');
    assert.equal((await library.createCollection('x')).ok, false);
    assert.equal(ports.storage.operations.some((op) => op.op === 'writeDocument'), false);
  });

  test('persisted screenshots cannot smuggle native evidence', async () => {
    const { library, ids } = await seeded();
    const doc = structuredClone(library.state) as unknown as { references: Record<string, Record<string, unknown>> };
    doc.references[ids[0]!]!.nativeEvidence = { platform: 'ios', runtime: 'device', buildRef: 'x', claim: 'observed' };
    assert.deepEqual(parseLibraryDocument(doc), { status: 'invalid', path: `$.references.${ids[0]}.nativeEvidence` });
  });

  test('a concurrent writer conflict reapplies once on fresh state', async () => {
    const { ports, library, ids } = await seeded();
    // Another writer adds a tag out of band.
    const other = structuredClone(library.state) as unknown as { references: Record<string, { tags: string[] }> };
    other.references[ids[1]!]!.tags = ['from-other-writer'];
    ports.storage.seedDocument('workspace', LIBRARY_DOCUMENT_KEY, other);
    assert.equal((await library.setTags(ids[0]!, ['mine'])).ok, true);
    assert.deepEqual(library.state.references[ids[1]!]!.tags, ['from-other-writer']);
    assert.deepEqual(library.state.references[ids[0]!]!.tags, ['mine']);
  });

  test('an unknown write effect fences writes until authoritative reload', async () => {
    const { ports, library, ids } = await seeded();
    ports.storage.failNextWrite = 'after-apply';
    assert.deepEqual(await library.setTags(ids[0]!, ['lost-response']), { ok: false, code: 'unknown-write-effect' });
    assert.deepEqual(library.access, { mode: 'fenced', reason: 'unknown-write-effect' });
    const writes = ports.storage.operations.filter((op) => op.op === 'writeDocument').length;
    assert.deepEqual(await library.setTags(ids[0]!, ['retry']), { ok: false, code: 'fenced' });
    assert.equal(ports.storage.operations.filter((op) => op.op === 'writeDocument').length, writes, 'no blind retry');
    assert.deepEqual(await library.reload(), { mode: 'writable' });
    assert.deepEqual(library.state.references[ids[0]!]!.tags, ['lost-response'], 'readback shows the write landed');
  });

  test('fake adapters are labelled as fakes', async () => {
    const { library } = await seeded();
    assert.ok(library.adapterLabels.every((label) => label.startsWith('fake:')));
  });
});
