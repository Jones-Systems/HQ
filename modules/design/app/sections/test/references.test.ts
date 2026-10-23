import assert from 'node:assert/strict';
import test from 'node:test';
import { websiteTree } from '../../../references/test/graph-fixtures.ts';
import { parsePacket } from '../../../references/src/packet.ts';
import { createReferencesEnvironment } from '../references/env.ts';
import { MAX_IMAGE_BYTES, readSelectedImage } from '../references/images.ts';
import type { SelectedImageFile } from '../references/images.ts';
import { compareSlot, doubles, sent, source } from './doubles.ts';

test('reference library, graph, project pins and packet round trip survive environment rebuild', async () => {
  const { d, runs, session, dispatchId } = await sent();
  const options = { storage: d.referenceStorage, clock: d.clock, ids: d.ids, compareSlot, previewUrl: () => null };
  const refs = await createReferencesEnvironment(options);
  const imported = await refs.library.importReference({
    kind: 'screenshot', source: { kind: 'url', url: 'https://example.com/synthetic' },
    capturedAt: d.clock.now(), capturedBy: 'agent-reported', title: 'Synthetic reference',
    asset: { bytes: new TextEncoder().encode('synthetic-image'), mediaType: 'image/png', w: 1, h: 1 },
  });
  assert.ok('id' in imported);
  assert.equal((await refs.library.useInProject(imported.id, source.projectId)).ok, true);
  assert.equal((await refs.graph.importTree(websiteTree())).ok, true);
  const capture = Object.values(refs.graph.state.captures)[0]!;
  assert.equal((await refs.graph.pin(capture.id, source.projectId)).ok, true);
  const exported = await refs.graph.exportPacket({ mode: 'internal', projectId: source.projectId });
  assert.ok(exported.ok);
  const parsed = await parsePacket(exported.value.packet);
  assert.equal(parsed.status, 'ok');
  const candidate = await runs.pipeline.simulateReturn(session, dispatchId);
  assert.ok(candidate);
  assert.equal((await runs.pipeline.review(session, candidate, 'accept'))?.decision, 'accept');
  const rebuilt = await createReferencesEnvironment(options);
  assert.equal(Object.keys(rebuilt.library.state.references).length, 1);
  assert.deepEqual(rebuilt.graph.state, refs.graph.state);
  const again = await rebuilt.graph.exportPacket({ mode: 'internal', projectId: source.projectId });
  assert.deepEqual(again, exported);
  const other = doubles();
  const receiving = await createReferencesEnvironment({ ...options, storage: other.referenceStorage });
  assert.equal((await receiving.graph.adoptPacket(exported.value.packet)).ok, true);
  assert.equal(d.writes.filter((entry) => entry === 'outbox:accepted').length, 1);
});

test('reference unknown write fences mutations, then recovers the durable record', async () => {
  const d = doubles();
  const options = { storage: d.referenceStorage, clock: d.clock, ids: d.ids, compareSlot, previewUrl: () => null };
  const env = await createReferencesEnvironment(options);
  d.referenceStorage.failNextWrite = 'after-apply';
  const result = await env.library.createCollection('Synthetic collection');
  assert.equal(result.ok, false);
  assert.equal(env.library.access.mode, 'fenced');
  const rebuilt = await createReferencesEnvironment(options);
  assert.equal(rebuilt.library.access.mode, 'writable');
  assert.equal(Object.keys(rebuilt.library.state.collections).length, 1);
});


test('selected screenshot import persists selected bytes and rebuilds verified previews', async () => {
  const d = doubles();
  const options = { storage: d.referenceStorage, clock: d.clock, ids: d.ids, compareSlot, previewUrl: () => null,
    readBlob: async (digest: string) => d.referenceStorage.blobs.get(digest as never)?.bytes ?? null,
    imageDecoder: async () => ({ w: 1, h: 1 }) };
  const refs = await createReferencesEnvironment(options);
  assert.equal(typeof (refs as unknown as { importScreenshot?: unknown }).importScreenshot, 'function', 'References must expose the selected screenshot import, not only an empty library');
  const result = await refs.importScreenshot(selectedImage(), { title: 'Synthetic screenshot', source: { kind: 'url', url: 'https://example.com/' } });
  assert.equal(result.status, 'saved');
  if (result.status !== 'saved') throw new Error('Expected a saved image');
  assert.equal(result.graphReady, true);
  const record = refs.library.state.references[result.id]!;
  assert.equal(record.kind, 'screenshot');
  assert.equal(record.nativeEvidence, null);
  assert.equal(record.rights.status, 'unknown');
  assert.equal(record.capturedAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(d.referenceStorage.blobs.get(record.asset!.digest)!.bytes, png);
  await refs.library.updateDetails(result.id, { title: 'Owner title', notes: 'Owner notes' });
  await refs.library.setRights(result.id, { status: 'permitted', basis: 'Synthetic owner-authored fixture' });
  const rebuilt = await createReferencesEnvironment(options);
  assert.equal(await rebuilt.previewImage!(rebuilt.library.state.references[result.id]!.asset!), `data:image/png;base64,${pngBase64}`);
  const duplicate = await rebuilt.importScreenshot(selectedImage(), { title: 'Importer replacement', source: { kind: 'url', url: 'https://example.com/' } });
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(Object.keys(rebuilt.library.state.references).length, 1);
  assert.equal(rebuilt.library.state.references[result.id]!.title, 'Owner title');
  assert.equal(rebuilt.library.state.references[result.id]!.notes, 'Owner notes');
  assert.equal(rebuilt.library.state.references[result.id]!.rights.status, 'permitted');
});


const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
const png = Uint8Array.from(atob(pngBase64), (character) => character.charCodeAt(0));
function selectedImage(patch: Partial<SelectedImageFile> = {}): SelectedImageFile {
  return { name: 'synthetic.png', type: 'image/png', size: png.length, lastModified: Date.parse('2026-01-01T00:00:00Z'),
    arrayBuffer: async () => png.slice().buffer, ...patch };
}

test('selected screenshot validation rejects spoofed types, oversized files and decode failures before import', async () => {
  let reads = 0;
  await assert.rejects(readSelectedImage(selectedImage({ size: MAX_IMAGE_BYTES + 1, arrayBuffer: async () => { reads++; return png.buffer; } })), /16 MiB/u);
  assert.equal(reads, 0, 'oversized files must be rejected before allocation');
  await assert.rejects(readSelectedImage(selectedImage({ type: 'image/svg+xml' })), /PNG, JPEG or WebP/u);
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  await assert.rejects(readSelectedImage(selectedImage({ size: svg.length, arrayBuffer: async () => svg.buffer })), /SVG and HTML/u);
  await assert.rejects(readSelectedImage(selectedImage({ type: 'image/jpeg' }), async () => ({ w: 1, h: 1 })), /do not match/u);
  await assert.rejects(readSelectedImage(selectedImage(), async () => { throw new Error('Synthetic decoder failure'); }), /could not be decoded/u);
  await assert.rejects(readSelectedImage(selectedImage(), async () => ({ w: 2, h: 1 })), /dimensions are invalid/u);
  const huge = png.slice(); new DataView(huge.buffer).setUint32(16, 20_000);
  let decoded = false;
  await assert.rejects(readSelectedImage(selectedImage({ arrayBuffer: async () => huge.buffer }), async () => { decoded = true; return { w: 20_000, h: 1 }; }), /too large/u);
  assert.equal(decoded, false, 'header dimensions are bounded before decode');
});

test('persisted previews reject corrupt bytes, type/size/dimension mismatches and unavailable reads', async () => {
  const d = doubles();
  const options = { storage: d.referenceStorage, clock: d.clock, ids: d.ids, compareSlot, previewUrl: () => null,
    readBlob: async (digest: string) => d.referenceStorage.blobs.get(digest as never)?.bytes ?? null,
    imageDecoder: async () => ({ w: 1, h: 1 }) };
  const env = await createReferencesEnvironment(options);
  const result = await env.importScreenshot(selectedImage(), { title: 'Synthetic', source: { kind: 'url', url: 'https://example.com' } });
  assert.equal(result.status, 'saved'); if (result.status !== 'saved') return;
  const asset = env.library.state.references[result.id]!.asset!;
  assert.equal(await env.previewImage!({ ...asset, bytes: asset.bytes + 1 }), null);
  assert.equal(await env.previewImage!({ ...asset, mediaType: 'image/svg+xml' }), null);
  assert.equal(await env.previewImage!({ ...asset, w: 2 }), null);
  d.referenceStorage.blobs.set(asset.digest, { bytes: png.slice(0, -1), mediaType: 'image/png' });
  assert.equal(await env.previewImage!(asset), null);
  const unavailable = await createReferencesEnvironment({ ...options, readBlob: async () => { throw new Error('Synthetic unavailable bridge'); } });
  assert.equal(await unavailable.previewImage!(asset), null);
});

test('an unknown import fences further writes and a graph failure reports a saved library independently', async () => {
  const d = doubles();
  const options = { storage: d.referenceStorage, clock: d.clock, ids: d.ids, compareSlot, previewUrl: () => null,
    imageDecoder: async () => ({ w: 1, h: 1 }) };
  const env = await createReferencesEnvironment(options);
  d.referenceStorage.failNextWrite = 'after-apply';
  const unknown = await env.importScreenshot(selectedImage(), { title: 'Synthetic', source: { kind: 'url', url: 'https://example.com' } });
  assert.equal(unknown.status, 'unknown');
  assert.equal(env.library.access.mode, 'fenced');
  const writes = d.referenceStorage.operations.filter((op) => op.op === 'writeDocument').length;
  assert.equal((await env.importScreenshot(selectedImage(), { title: 'Synthetic', source: { kind: 'url', url: 'https://example.com' } })).status, 'unknown');
  assert.equal(d.referenceStorage.operations.filter((op) => op.op === 'writeDocument').length, writes);
  const rebuilt = await createReferencesEnvironment(options);
  assert.equal(Object.keys(rebuilt.library.state.references).length, 1, 'unknown write survived reopen');
  rebuilt.graph.adoptFlatLibrary = async () => { throw new Error('Synthetic graph failure'); };
  const second = await rebuilt.importScreenshot(selectedImage(), { title: 'Second synthetic', source: { kind: 'url', url: 'https://example.com/second' } });
  assert.equal(second.status, 'saved');
  if (second.status === 'saved') assert.equal(second.graphReady, false);
  assert.equal(Object.keys(rebuilt.library.state.references).length, 2, 'a graph failure cannot undo the saved library');
});
