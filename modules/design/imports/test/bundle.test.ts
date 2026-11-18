import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBundle, createDraftBackup, decodeBase64, encodeBase64, parseBundle, restoreBundle, serializeBundle, type Bundle } from '../src/bundle.ts';
import { DEFAULT_TEST_NAMESPACES, FakeStoragePort } from '../src/fake-storage.ts';
import { digestBytes, webCryptoDigest } from '../src/jcs.ts';
import { editImportedRecord, listRecords, runImport } from '../src/importer.ts';
import { fixedClock, PROJECT, png, setup, source, text } from './fixtures.ts';

/** Workspace with imports, an owner edit, extra docs/events; a draft namespace; a populated cache. */
async function populated() {
  const env = setup();
  await runImport(env.deps, { projectId: PROJECT, source: source(0) });
  env.clock.tick();
  const record = (await listRecords(env.deps, PROJECT)).find((item) => item.itemKey === 'screens/home.png')!;
  await editImportedRecord(env.deps, record.recordId, { notes: 'Ünïcödé — 😀 "quoted" \\ line\nbreak' });
  const draftImage = png(10, 10, 99);
  const draftDigest = await digestBytes(webCryptoDigest, draftImage);
  const orphan = text('unreferenced workspace attachment');
  const orphanDigest = await digestBytes(webCryptoDigest, orphan);
  const cacheBytes = text('cached preview');
  await env.storage.commit([
    { op: 'put-document', namespace: 'workspace', key: 'canvas/arrangement', value: { items: [{ x: 1.5, y: -2e-7, z: 1e21 }], empty: {}, list: [] }, expectedRevision: null },
    { op: 'put-blob', namespace: 'workspace', digest: orphanDigest, mediaType: 'text/plain', bytes: orphan },
    { op: 'append-event', namespace: 'workspace', stream: 'annotations', payload: { type: 'pick', letter: 'A' }, expectedSeq: 0 },
    { op: 'put-document', namespace: 'drafts', key: 'requests/draft-1', value: { privacy: 'draft', text: 'unsent idea', image: draftDigest }, expectedRevision: null },
    { op: 'put-blob', namespace: 'drafts', digest: draftDigest, mediaType: 'image/png', bytes: draftImage },
    { op: 'put-blob', namespace: 'cache', digest: await digestBytes(webCryptoDigest, cacheBytes), mediaType: 'text/plain', bytes: cacheBytes },
    { op: 'put-document', namespace: 'cache', key: 'previews/index', value: { stale: true }, expectedRevision: null },
  ]);
  return { ...env, orphanDigest, draftDigest };
}

const emptyStore = () => new FakeStoragePort(DEFAULT_TEST_NAMESPACES);
const sectionOf = (snapshot: string, namespace: string) => JSON.stringify((JSON.parse(snapshot) as Record<string, unknown>)[namespace]);

test('backup round-trip is lossless across serialize, parse and restore', async () => {
  const { storage, clock } = await populated();
  const bundle = await createBundle({ storage, clock }, { kind: 'backup' });
  const bytes = serializeBundle(bundle);
  const parsed = await parseBundle(bytes);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const target = emptyStore();
  const restored = await restoreBundle({ storage: target, clock }, parsed.bundle);
  assert.ok(restored.ok && restored.applied);
  assert.equal(sectionOf(target.snapshot(), 'workspace'), sectionOf(storage.snapshot(), 'workspace'), 'workspace content identical');
  const again = await createBundle({ storage: target, clock }, { kind: 'backup' });
  assert.deepEqual(serializeBundle(again), bytes, 'second-generation bundle is byte-identical');
  // Cache never travels; drafts need the separate draft backup.
  assert.equal(sectionOf(target.snapshot(), 'drafts'), JSON.stringify({ blobs: [], documents: [], streams: [] }));
  assert.deepEqual(bundle.coverage.omitted.map((item) => [item.namespace, item.reason]), [['cache', 'cache-excluded'], ['drafts', 'draft-backup-is-separate']]);
  assert.equal(bundle.privacy, 'owner');
});

test('restoring the same bundle twice writes nothing the second time; differing content conflicts with no writes', async () => {
  const { storage, clock } = await populated();
  const bundle = await createBundle({ storage, clock }, { kind: 'backup' });
  const target = emptyStore();
  await restoreBundle({ storage: target, clock }, bundle);
  const after = target.snapshot();
  const commits = target.commitCalls;
  const second = await restoreBundle({ storage: target, clock }, bundle);
  assert.ok(second.ok && !second.applied);
  assert.equal(target.commitCalls, commits);

  const diverged = emptyStore();
  await diverged.commit([{ op: 'put-document', namespace: 'workspace', key: 'canvas/arrangement', value: { different: true }, expectedRevision: null }]);
  const divergedBefore = diverged.snapshot();
  const conflict = await restoreBundle({ storage: diverged, clock }, bundle);
  assert.equal(!conflict.ok && conflict.reason, 'conflicts');
  assert.deepEqual(!conflict.ok && conflict.conflicts, [{ namespace: 'workspace', kind: 'document', key: 'canvas/arrangement' }]);
  assert.equal(diverged.snapshot(), divergedBefore, 'no destructive repair');
  assert.equal(target.snapshot(), after);
});

test('a publishable export excludes drafts and unreferenced attachments', async () => {
  const { storage, clock, orphanDigest, draftDigest } = await populated();
  const bundle = await createBundle({ storage, clock }, { kind: 'export' });
  assert.equal(bundle.privacy, 'publishable');
  assert.deepEqual(bundle.namespaces.map((ns) => ns.name), ['workspace']);
  const serialized = new TextDecoder().decode(serializeBundle(bundle));
  assert.doesNotMatch(serialized, /unsent idea/u);
  assert.doesNotMatch(serialized, /requests\/draft-1/u);
  assert.equal(serialized.includes(draftDigest), false);
  assert.equal(serialized.includes(orphanDigest), false);
  assert.equal(bundle.coverage.unreferencedBlobsOmitted, 1);
  assert.deepEqual(bundle.coverage.omitted.find((item) => item.namespace === 'drafts')?.reason, 'drafts-excluded-from-export');
  // Every attachment the imported versions reference is present.
  const blobDigests = new Set(bundle.namespaces[0]!.blobs.map((blob) => blob.digest));
  const versions = bundle.namespaces[0]!.documents.filter((document) => document.key.startsWith('imports/versions/'));
  for (const version of versions) {
    const content = (version.value as Record<string, any>).content;
    const digests = content.kind === 'html-bundle' ? content.files.map((file: { digest: string }) => file.digest) : content.digest ? [content.digest] : [];
    for (const digest of digests) assert.ok(blobDigests.has(digest), `${version.key} attachment ${digest}`);
  }
  await assert.rejects(createBundle({ storage, clock }, { kind: 'export', namespaces: ['drafts'] }), /carries only workspace/u);
});

test('the private draft backup is chosen separately and restores only into draft namespaces', async () => {
  const { storage, clock } = await populated();
  await assert.rejects(createDraftBackup({ storage, clock }, { confirmPrivate: false as unknown as true }), /explicitly chosen/u);
  await assert.rejects(createBundle({ storage, clock }, { kind: 'draft-backup' as 'backup' }), /createDraftBackup/u);
  const drafts = await createDraftBackup({ storage, clock }, { confirmPrivate: true });
  assert.equal(drafts.kind, 'draft-backup');
  assert.equal(drafts.privacy, 'private');
  assert.deepEqual(drafts.namespaces.map((ns) => ns.name), ['drafts']);
  const target = emptyStore();
  const refused = await restoreBundle({ storage: target, clock }, drafts);
  assert.equal(!refused.ok && refused.reason, 'drafts-not-allowed');
  assert.equal(target.commitCalls, 0);
  const restored = await restoreBundle({ storage: target, clock }, drafts, { allowDrafts: true });
  assert.ok(restored.ok && restored.applied);
  assert.equal(sectionOf(target.snapshot(), 'drafts'), sectionOf(storage.snapshot(), 'drafts'));
  assert.equal(target.writeCount('workspace'), 0);
});

test('an unsupported future bundle version or tampered bundle is rejected before any write', async () => {
  const { storage, clock } = await populated();
  const bundle = await createBundle({ storage, clock }, { kind: 'backup' });
  const raw = JSON.parse(new TextDecoder().decode(serializeBundle(bundle))) as Record<string, any>;
  const future = await parseBundle(JSON.stringify({ ...raw, schema: 'hq.design.bundle/v2' }));
  assert.deepEqual(future.ok ? null : future.reason, 'unsupported-version');
  const extra = await parseBundle(JSON.stringify({ ...raw, surprise: 1 }));
  assert.deepEqual(extra.ok ? null : extra.reason, 'invalid-bundle');
  const tampered = structuredClone(raw);
  tampered.namespaces[0].documents[0].value = { tampered: true };
  assert.deepEqual((await parseBundle(JSON.stringify(tampered))).ok ? null : 'rejected', 'rejected');
  const badBlob = structuredClone(raw);
  badBlob.namespaces[0].blobs[0].data = encodeBase64(text('swapped bytes'));
  const blobResult = await parseBundle(JSON.stringify(badBlob));
  assert.deepEqual(blobResult.ok ? null : blobResult.reason, 'digest-mismatch');
  const cacheSmuggled = structuredClone(raw);
  cacheSmuggled.namespaces.push({ name: 'cache', class: 'cache', documents: [], blobs: [], streams: [] });
  assert.deepEqual((await parseBundle(JSON.stringify(cacheSmuggled))).ok, false);
  const gappedEvents = structuredClone(raw);
  gappedEvents.namespaces[0].streams[0].events[0].seq = 2;
  assert.deepEqual((await parseBundle(JSON.stringify(gappedEvents))).ok, false);
  assert.equal(storage.writeCount('workspace') > 0, true);
});

test('restore refuses a namespace class mismatch with no writes', async () => {
  const { storage, clock } = await populated();
  const bundle: Bundle = await createBundle({ storage, clock }, { kind: 'backup' });
  const mismatched = new FakeStoragePort([{ name: 'workspace', class: 'draft' }]);
  const result = await restoreBundle({ storage: mismatched, clock: fixedClock() }, bundle);
  assert.equal(!result.ok && result.conflicts[0]!.kind, 'namespace');
  assert.equal(mismatched.commitCalls, 0);
});

test('base64 is exact and canonical', () => {
  for (const length of [0, 1, 2, 3, 4, 5, 255]) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 37 + length) & 255);
    assert.deepEqual(decodeBase64(encodeBase64(bytes)), bytes);
    assert.equal(encodeBase64(bytes), Buffer.from(bytes).toString('base64'));
  }
  assert.deepEqual(decodeBase64('QQ=='), new Uint8Array([65]));
  assert.equal(decodeBase64('QR=='), null, 'non-zero padding bits rejected');
  assert.equal(decodeBase64('Q'), null);
});
