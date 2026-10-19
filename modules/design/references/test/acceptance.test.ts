/**
 * Named acceptance checks for spec.hq-design#test.references.001, run against
 * labelled fake ports (fake:memory-reference-storage), not a real store.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ReferenceId } from '../src/contract.ts';
import { LIBRARY_DOCUMENT_KEY } from '../src/contract.ts';
import { fakePorts } from '../src/fakes.ts';
import { describeEvidence } from '../src/provenance.ts';
import { ReferenceLibrary } from '../src/service.ts';
import { appScreenshot, bytes, nativeReference, screenshot } from './fixtures.ts';

async function openLibrary() {
  const ports = fakePorts();
  return { ports, library: await ReferenceLibrary.open(ports) };
}

function created(outcome: Awaited<ReturnType<ReferenceLibrary['importReference']>>): ReferenceId {
  assert.equal(outcome.status, 'created', JSON.stringify(outcome));
  return (outcome as { id: ReferenceId }).id;
}

describe('re-importing the same reference keeps its ID', () => {
  test('identical re-import is unchanged and writes nothing', async () => {
    const { ports, library } = await openLibrary();
    const id = created(await library.importReference(screenshot()));
    const writes = ports.storage.operations.filter((op) => op.op === 'writeDocument').length;
    const again = await library.importReference(screenshot());
    assert.deepEqual(again, { status: 'unchanged', id, differences: [] });
    assert.equal(ports.storage.operations.filter((op) => op.op === 'writeDocument').length, writes);
    assert.equal(Object.keys(library.state.references).length, 1);
  });

  test('equivalent URL forms and a fresh capture time map to the same ID', async () => {
    const { library } = await openLibrary();
    const id = created(await library.importReference(screenshot()));
    const again = await library.importReference(screenshot({
      source: { kind: 'url', url: 'HTTPS://Example.COM:443/pricing#plans' },
      capturedAt: '2026-03-01T10:00:00.000Z',
    }));
    assert.equal(again.status, 'observed-again');
    assert.equal((again as { id: string }).id, id);
    assert.deepEqual((again as { differences: string[] }).differences, ['capturedAt']);
    const record = library.state.references[id]!;
    assert.equal(record.importCount, 2);
    assert.equal(record.capturedAt, '2026-02-01T10:00:00.000Z', 'earliest capture is preserved');
  });

  test('owner edits survive a re-import that carries different metadata', async () => {
    const { library } = await openLibrary();
    const id = created(await library.importReference(screenshot()));
    assert.equal((await library.updateDetails(id, { title: 'Owner title', notes: 'owner note' })).ok, true);
    assert.equal((await library.setTags(id, ['owner-tag'])).ok, true);
    const again = await library.importReference(screenshot({ title: 'Importer title', tags: ['importer'] }));
    assert.equal(again.status, 'observed-again');
    assert.deepEqual((again as { differences: string[] }).differences, ['title', 'notes', 'tags']);
    const record = library.state.references[id]!;
    assert.equal(record.title, 'Owner title');
    assert.equal(record.notes, 'owner note');
    assert.deepEqual(record.tags, ['owner-tag']);
  });

  test('a pre-stored blob digest yields the same ID as importing the bytes', async () => {
    const { ports, library } = await openLibrary();
    const id = created(await library.importReference(screenshot()));
    const { digest } = library.state.references[id]!.asset!;
    const again = await library.importReference(screenshot({ asset: { digest, byteLength: bytes('pricing').byteLength, mediaType: 'image/png' } }));
    assert.equal((again as { id: string }).id, id);
    assert.equal(ports.storage.blobs.size, 1);
  });

  test('titles never participate in identity; content does', async () => {
    const { library } = await openLibrary();
    const a = created(await library.importReference(screenshot({ title: 'Same title' })));
    const b = created(await library.importReference(screenshot({ title: 'Same title', asset: { bytes: bytes('other'), mediaType: 'image/png' } })));
    assert.notEqual(a, b);
    assert.match(a, /^ref_[0-9a-f]{64}$/u);
  });

  test('re-import of a tombstoned reference keeps its ID and does not resurrect it', async () => {
    const { library } = await openLibrary();
    const id = created(await library.importReference(screenshot()));
    assert.equal((await library.deleteReference(id)).ok, true);
    const again = await library.importReference(screenshot());
    assert.equal(again.status, 'tombstoned');
    assert.equal((again as { id: string }).id, id);
    assert.notEqual(library.state.references[id]!.tombstonedAt, null);
  });

  test('IDs persist across reopen', async () => {
    const { ports, library } = await openLibrary();
    const id = created(await library.importReference(appScreenshot()));
    const reopened = await ReferenceLibrary.open(ports);
    assert.deepEqual(reopened.state, library.state);
    assert.deepEqual(await reopened.importReference(appScreenshot()), { status: 'unchanged', id, differences: [] });
  });
});

describe('a screenshot is never labelled native execution', () => {
  test('a screenshot of a native app is a static image', async () => {
    const { library } = await openLibrary();
    const id = created(await library.importReference(appScreenshot()));
    const evidence = describeEvidence(library.state.references[id]!);
    assert.equal(evidence.isNativeExecution, false);
    assert.equal(evidence.executionClass, 'static-image');
    assert.equal(evidence.label, 'Screenshot of iOS app');
    assert.match(evidence.caveat!, /not native execution/u);
  });

  test('a screenshot or recording claiming native execution is rejected', async () => {
    const { ports, library } = await openLibrary();
    const evidence = { platform: 'ios', runtime: 'device', buildRef: 'b', claim: 'observed' };
    const shot = await library.importReference(appScreenshot({ nativeEvidence: evidence }));
    assert.equal(shot.status, 'rejected');
    assert.deepEqual((shot as { issues: unknown[] }).issues, [{ field: 'nativeEvidence', code: 'screenshot-cannot-claim-native-execution' }]);
    const recording = await library.importReference(appScreenshot({ kind: 'recording', nativeEvidence: evidence, asset: { bytes: bytes('rec'), mediaType: 'video/mp4' } }));
    assert.equal(recording.status, 'rejected');
    assert.equal(ports.storage.blobs.size, 0, 'rejected imports store nothing');
  });

  test('native kind needs an app source and native evidence; a web prototype is a browser mock', async () => {
    const { library } = await openLibrary();
    assert.equal((await library.importReference(nativeReference({ nativeEvidence: undefined }))).status, 'rejected');
    assert.equal((await library.importReference(nativeReference({ source: { kind: 'url', url: 'https://example.com' } }))).status, 'rejected');
    assert.equal((await library.importReference(nativeReference({
      nativeEvidence: { platform: 'android', runtime: 'device', buildRef: 'b', claim: 'observed' },
    }))).status, 'rejected', 'platform mismatch');
    const native = created(await library.importReference(nativeReference()));
    assert.equal(describeEvidence(library.state.references[native]!).isNativeExecution, true);
    const proto = created(await library.importReference({
      kind: 'web-prototype', source: { kind: 'url', url: 'https://example.com/proto' }, capturedAt: '2026-02-04T00:00:00Z',
      capturedBy: 'agent-reported', title: 'Prototype',
    }));
    const description = describeEvidence(library.state.references[proto]!);
    assert.equal(description.isNativeExecution, false);
    assert.match(description.caveat!, /not native acceptance evidence/u);
  });

  test('a screenshot must carry image bytes', async () => {
    const { library } = await openLibrary();
    const outcome = await library.importReference(screenshot({ asset: { bytes: bytes('x'), mediaType: 'video/mp4' } }));
    assert.equal(outcome.status, 'rejected');
  });

  test('exports carry the derived evidence class, never native for a screenshot', async () => {
    const { library } = await openLibrary();
    const id = created(await library.importReference(appScreenshot()));
    const exported = await library.export({ mode: 'internal' });
    const reference = exported.references.find((item) => item.id === id)!;
    assert.deepEqual(reference.evidence, { executionClass: 'static-image', isNativeExecution: false });
  });
});

describe('an asset without a permitted flag is excluded from a publishable export', () => {
  test('only explicitly permitted references and their blobs are published', async () => {
    const { library } = await openLibrary();
    const unknown = created(await library.importReference(screenshot({ notes: 'private note' })));
    const permitted = created(await library.importReference(appScreenshot({
      notes: 'private note', rights: { status: 'permitted', basis: 'Synthetic fixture, CC0', attribution: 'Synthetic' },
    })));
    const restricted = created(await library.importReference(screenshot({
      asset: { bytes: bytes('restricted'), mediaType: 'image/png' }, rights: { status: 'restricted', basis: 'No reuse' },
    })));
    const exported = await library.export({ mode: 'publishable' });
    assert.deepEqual(exported.references.map((item) => item.id), [permitted]);
    assert.deepEqual(exported.blobs, [library.state.references[permitted]!.asset!.digest]);
    assert.deepEqual(
      [...exported.excluded].sort((a, b) => a.id.localeCompare(b.id)),
      [{ id: unknown, reason: 'rights-not-permitted' }, { id: restricted, reason: 'rights-not-permitted' }].sort((a, b) => a.id.localeCompare(b.id)),
    );
    assert.equal('notes' in exported.references[0]!, false, 'notes are private');
    assert.ok(exported.omitted.includes('notes') && exported.omitted.includes('uses'));
    assert.match(exported.authoringDigest, /^[0-9a-f]{64}$/u);
    const internal = await library.export({ mode: 'internal' });
    assert.equal(internal.references.length, 3);
    assert.equal(internal.excluded.length, 0);
  });

  test('a permitted claim without a basis is rejected; owner can later permit', async () => {
    const { library } = await openLibrary();
    assert.equal((await library.importReference(screenshot({ rights: { status: 'permitted' } }))).status, 'rejected');
    const id = created(await library.importReference(screenshot()));
    assert.equal((await library.export({ mode: 'publishable' })).references.length, 0);
    assert.equal((await library.setRights(id, { status: 'permitted', basis: 'Owner licence note' })).ok, true);
    assert.equal(library.state.references[id]!.rights.setBy, 'owner-judged');
    assert.equal((await library.export({ mode: 'publishable' })).references.length, 1);
  });
});

describe('deleting a collection tombstones and never deletes referenced blobs', () => {
  test('collection delete keeps records, membership and blobs', async () => {
    const { ports, library } = await openLibrary();
    const a = created(await library.importReference(screenshot()));
    const b = created(await library.importReference(appScreenshot()));
    const col = await library.createCollection('Pricing patterns');
    assert.equal(col.ok, true);
    const collectionId = (col as { value: string }).value as Parameters<ReferenceLibrary['deleteCollection']>[0];
    await library.addToCollection(collectionId, a);
    await library.addToCollection(collectionId, b);
    const blobsBefore = new Map(ports.storage.blobs);
    const blobOpsBefore = ports.storage.operations.filter((op) => op.op === 'putBlob').length;

    assert.equal((await library.deleteCollection(collectionId)).ok, true);
    const collection = library.state.collections[collectionId]!;
    assert.notEqual(collection.tombstonedAt, null);
    assert.deepEqual(collection.referenceIds, [a, b]);
    assert.equal(library.state.references[a]!.tombstonedAt, null);
    assert.equal(library.state.references[b]!.tombstonedAt, null);
    assert.deepEqual(ports.storage.blobs, blobsBefore);
    assert.equal(ports.storage.operations.filter((op) => op.op === 'putBlob').length, blobOpsBefore);
    for (const digest of blobsBefore.keys()) assert.equal(await ports.storage.hasBlob(digest), true);

    // Tombstoned collections are hidden from exports and refuse edits, but can be restored.
    assert.equal((await library.export({ mode: 'internal' })).collections.length, 0);
    assert.equal((await library.addToCollection(collectionId, a)).ok, false);
    assert.equal((await library.restoreCollection(collectionId)).ok, true);
    assert.deepEqual(library.state.collections[collectionId]!.referenceIds, [a, b]);
  });

  test('deleting a reference tombstones it and keeps its blob', async () => {
    const { ports, library } = await openLibrary();
    const id = created(await library.importReference(screenshot()));
    const digest = library.state.references[id]!.asset!.digest;
    assert.equal((await library.deleteReference(id)).ok, true);
    assert.equal(ports.storage.blobs.has(digest), true);
    assert.equal((await library.export({ mode: 'internal' })).excluded[0]?.reason, 'tombstoned');
  });

  test('the storage port the library uses offers no blob deletion', async () => {
    const { ports } = await openLibrary();
    assert.equal('deleteBlob' in ports.storage, false);
    const writes: unknown[] = [];
    const reopened = await ReferenceLibrary.open({ ...ports, storage: new Proxy(ports.storage, {
      get(target, key) {
        if (typeof key === 'string' && /delete|remove|evict/iu.test(key)) writes.push(key);
        const value = Reflect.get(target, key) as unknown;
        return typeof value === 'function' ? value.bind(target) as unknown : value;
      },
    }) });
    created(await reopened.importReference(screenshot()));
    const col = await reopened.createCollection('Temp');
    await reopened.deleteCollection((col as { value: string }).value as never);
    assert.deepEqual(writes, []);
  });
});

test('library document key is in the workspace namespace', async () => {
  const { ports, library } = await openLibrary();
  created(await library.importReference(screenshot()));
  const write = ports.storage.operations.find((op) => op.op === 'writeDocument');
  assert.deepEqual(write, { op: 'writeDocument', namespace: 'workspace', key: LIBRARY_DOCUMENT_KEY });
});
