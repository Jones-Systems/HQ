import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import { describe, it } from 'node:test';
import type { PreviewRef } from '../../../projects/src/contract.ts';
import { addVersion, addView } from '../../../projects/src/content.ts';
import { versionId, viewId } from '../../../projects/src/ids.ts';
import { createThumbnailLoader, type LoadState, type ThumbnailLoader } from '../../../projects/src/loader.ts';
import { createBridgeWorkspaceDocuments } from '../bridge-documents.ts';
import { createBridgedWorkspace } from '../bridged-workspace.ts';
import { createTransportDouble } from './bridge-double.ts';

const project = { id: 'project-synthetic', name: 'Synthetic project' };
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
const ref: PreviewRef = { digest: `sha256:${createHash('sha256').update(png).digest('hex')}`, mediaType: 'image/png', bytes: png.length };
const loaderFor = (thumbnails: Parameters<typeof createThumbnailLoader>[0]) => createThumbnailLoader(thumbnails, { concurrency: 1, retain: 2, maxBytesPerItem: 2 * 1024 * 1024 });

async function result(loader: ThumbnailLoader, selected: PreviewRef = ref): Promise<LoadState<string>> {
  let release: (() => void) | undefined;
  try {
    return await new Promise((resolve) => { release = loader.subscribe(selected, 'visible', (state) => { if (state.status !== 'pending') resolve(state); }); });
  } finally { release?.(); }
}

function fixture(payload: unknown = png) {
  const double = createTransportDouble();
  double.failWith((route) => route === 'blob.get' ? { ok: true, value: payload } : null);
  const documents = createBridgeWorkspaceDocuments(double.transport);
  return { double, documents, workspace: createBridgedWorkspace(documents) };
}

describe('bridged workspace thumbnails', () => {
  it('reads saved version bytes through the production document bridge, verifies them, and survives recomposition', async () => {
    const { double, documents, workspace } = fixture();
    assert.deepEqual(double.calls, [], 'construction performs no I/O');
    const env = await workspace.contentFor(project);
    assert.deepEqual(double.calls.map((call) => call.route), ['doc.get'], 'opening empty content never seeds it');
    await env.repository.update(env.content.projectId, (content, now) => addVersion(
      addView(content, { id: viewId('view-synthetic'), title: 'Screen', kind: 'screen' }, now),
      { id: versionId('version-synthetic'), viewId: viewId('view-synthetic'), label: 'Version one', origin: 'synthetic-fixture',
        capture: { route: '/screen', viewport: { w: 320, h: 640, dpr: 1 }, captureDigest: ref.digest }, thumbnail: ref }, now));
    const writesBefore = double.calls.filter((call) => call.route === 'doc.put').length;
    const reopened = await createBridgedWorkspace(documents).contentFor(project);
    const saved = reopened.content.versions[0]!.thumbnail!;
    const fetched = await reopened.thumbnails.readThumbnail(saved, new AbortController().signal);
    assert.equal(fetched.mediaType, 'image/png');
    assert.deepEqual(fetched.bytes, png);
    const ready = await result(loaderFor(reopened.thumbnails), saved);
    assert.equal(ready.status, 'ready');
    if (ready.status === 'ready') {
      assert.match(ready.value, /^data:image\/png;base64,/u);
      const bytes = Uint8Array.from(atob(ready.value.split(',')[1]!), (c) => c.charCodeAt(0));
      assert.deepEqual(bytes, png);
      assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, saved.digest);
    }
    assert.deepEqual(double.calls.filter((call) => call.route === 'blob.get').map((call) => call.params), [{ digest: ref.digest }, { digest: ref.digest }]);
    assert.equal(double.calls.filter((call) => call.route === 'doc.put').length, writesBefore);
    assert.equal(double.calls.some((call) => call.route === 'blob.put'), false);
  });

  for (const [label, payload] of [
    ['missing', null], ['digest mismatch', new Uint8Array(png.length)], ['invalid payload', [1, 2, 3]],
  ] as const) {
    it(`keeps ${label} unavailable through the production bridge`, async () => {
      const { workspace, double } = fixture(payload);
      const env = await workspace.contentFor(project);
      const state = await result(loaderFor(env.thumbnails));
      assert.equal(state.status, 'error');
      assert.equal(double.calls.filter((call) => call.route === 'blob.get').length, 1);
      assert.equal(double.calls.some((call) => call.route === 'blob.put' || call.route === 'doc.put'), false);
    });
  }

  it('retains loader digest verification even for an injected blob reader', async () => {
    const { documents } = fixture();
    const env = await createBridgedWorkspace({ ...documents, async getBlob() { return new Uint8Array(png.length); } }).contentFor(project);
    const state = await result(loaderFor(env.thumbnails));
    assert.equal(state.status, 'error');
    if (state.status === 'error') assert.match(state.reason, /digest mismatch/u);
  });

  it('keeps document-only workspaces unavailable without attempting another capability', async () => {
    const { documents, double } = fixture();
    const { getBlob: _getBlob, ...documentOnly } = documents;
    const env = await createBridgedWorkspace(documentOnly).contentFor(project);
    const state = await result(loaderFor(env.thumbnails));
    assert.deepEqual(state, { status: 'error', reason: 'Thumbnail storage is unavailable' });
    assert.deepEqual(double.calls.map((call) => call.route), ['doc.get']);
  });

  it('rejects invalid references, unsupported media and size mismatches before display', async () => {
    const { workspace, double } = fixture();
    const env = await workspace.contentFor(project);
    for (const invalid of [
      { ...ref, digest: 'some/path.png' }, { ...ref, bytes: -1 }, { ...ref, bytes: 0.5 },
      { ...ref, bytes: 2 * 1024 * 1024 + 1 }, { ...ref, mediaType: 'image/svg+xml' },
    ]) {
      await assert.rejects(env.thumbnails.readThumbnail(invalid, new AbortController().signal), /Invalid or unsupported/u);
    }
    assert.equal(double.calls.some((call) => call.route === 'blob.get'), false);
    const wrongSize = await result(loaderFor(env.thumbnails), { ...ref, bytes: ref.bytes + 1 });
    assert.deepEqual(wrongSize, { status: 'error', reason: 'Invalid thumbnail payload' });
  });

  it('does not read after cancellation or publish a late result to the next project subscriber', async () => {
    const { documents } = fixture();
    const pending: ((bytes: Uint8Array) => void)[] = [];
    const workspace = createBridgedWorkspace({ ...documents, getBlob() { return new Promise((resolve) => pending.push(resolve)); } });
    const first = await workspace.contentFor(project);
    const second = await workspace.contentFor({ id: 'project-next', name: 'Next synthetic project' });
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(first.thumbnails.readThumbnail(ref, aborted.signal), { name: 'AbortError' });
    assert.equal(pending.length, 0);
    const loader = loaderFor(first.thumbnails);
    const oldEvents: LoadState<string>[] = [];
    const release = loader.subscribe(ref, 'visible', (state) => oldEvents.push(state));
    assert.equal(pending.length, 1);
    release();
    assert.equal(first.thumbnails, second.thumbnails, 'the composed port is shared while subscriptions own visibility');
    const next = result(loader);
    assert.equal(pending.length, 2);
    pending[1]!(png);
    assert.equal((await next).status, 'ready');
    pending[0]!(new Uint8Array(png.length));
    await setImmediate();
    assert.deepEqual(oldEvents, []);
    assert.equal(loader.stats().aborted, 1);
    assert.equal(loader.stats().failed, 0);
    assert.equal(loader.stats().completed, 1);
  });
});
