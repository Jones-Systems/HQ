import assert from 'node:assert/strict';
import test from 'node:test';
import { createBridgeWorkspaceDocuments } from '../bridge-documents.ts';
import { createClosureWorkspace } from '../closure-workspace.ts';
import { createTransportDouble } from './bridge-double.ts';

test('selected image bytes and verified previews survive closure recreation through the existing record bridge', async (t) => {
  const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const d = createTransportDouble();
  const blobs = new Map<string, Uint8Array>();
  d.failWith((route, params) => {
    if (route === 'blob.put' && 'expectedDigest' in params && 'bytes' in params) {
      blobs.set(params.expectedDigest, new Uint8Array(params.bytes));
      return { ok: true, value: { digest: params.expectedDigest, bytes: params.bytes.byteLength } };
    }
    if (route === 'blob.get' && 'digest' in params) return { ok: true, value: blobs.get(params.digest) ?? null };
    if (route === 'blob.has' && 'digest' in params) return { ok: true, value: blobs.has(params.digest) };
    return undefined;
  });
  // Only the browser decoder is a double. Document/blob serialization, CAS and digest checks are real.
  const oldDecoder = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap');
  let closed = 0;
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async (blob: Blob) => {
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
    return { width: 1, height: 1, close: () => { closed++; } };
  } });
  t.after(() => {
    if (oldDecoder) Object.defineProperty(globalThis, 'createImageBitmap', oldDecoder);
    else Reflect.deleteProperty(globalThis, 'createImageBitmap');
  });
  const first = await createClosureWorkspace(createBridgeWorkspaceDocuments(d.transport)).references();
  const imported = await first.importScreenshot({ name: 'synthetic.png', type: 'image/png', size: bytes.length,
    lastModified: Date.parse('2026-01-01T00:00:00Z'), arrayBuffer: async () => bytes.slice().buffer },
  { title: 'Synthetic selected screenshot', source: { kind: 'app', platform: 'ios', appId: 'com.example.synthetic', appName: 'Synthetic', screen: 'Home' } });
  assert.equal(imported.status, 'saved');
  if (imported.status !== 'saved') throw new Error('Expected a durable selected image');
  assert.equal(blobs.size, 1);
  assert.ok(d.calls.some((call) => call.route === 'blob.put'));
  const reopened = await createClosureWorkspace(createBridgeWorkspaceDocuments(d.transport)).references();
  const record = reopened.library.state.references[imported.id]!;
  assert.equal(record.source.kind, 'app');
  assert.equal(record.nativeEvidence, null);
  assert.equal(await reopened.previewImage!(record.asset!), `data:image/png;base64,${base64}`);
  assert.ok(d.calls.some((call) => call.route === 'blob.get'));
  assert.equal(closed, 2, 'decoded bitmaps are released on import and preview');
  assert.equal(d.calls.some((call) => call.route === 'event.append'), false, 'image selection must not dispatch work');
});
