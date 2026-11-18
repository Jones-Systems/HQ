import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CaptureRecord, PreviewParams, PreviewSession, PreviewTransport, PreviewValues } from '@hq/contracts/preview';
import type { CatalogEntry } from '@hq/contracts/catalog';
import { summarize } from '../../../projects/src/content.ts';
import { DEFAULT_LIMITS } from '../../../projects/src/controller.ts';
import { createBridgeWorkspaceDocuments } from '../bridge-documents.ts';
import { designFeedback } from '../errors.ts';
import type { InteractiveCatalogItem } from '../runtime-ports.ts';
import { createDesignWorkspace } from '../workspace.ts';
import { createTransportDouble } from './bridge-double.ts';
import { digestOf, png } from './content-fixtures.ts';

const entry: CatalogEntry = { sourceProjectId: 'c'.repeat(64) as CatalogEntry['sourceProjectId'], hostId: 'fixture-host' as CatalogEntry['hostId'],
  rootId: 'fixture-root' as CatalogEntry['rootId'], relativePath: 'sample', displayName: 'Sample website', revision: 'fixture-revision',
  repoIdentity: { localOnly: true }, previews: [], metadata: { experienceKind: 'website', launchStatus: 'available', launchUrl: 'https://example.com/document.html' } };
const item: InteractiveCatalogItem = { entry, hostLabel: 'Fixture source', freshness: 'fresh' };
const sourceProject = String(entry.sourceProjectId);

/** A live preview host double whose captures are PNGs stored in the blob store under their own digest, like the real host. */
function fixture(captured: Uint8Array | null, options: { digest?: string; route?: string } = {}) {
  const d = createTransportDouble();
  const blobs = new Map<string, Uint8Array>();
  let failure: ((route: string) => unknown) | null = null;
  d.failWith((route, params) => failure?.(route) ?? (route === 'blob.get' ? { ok: true, value: blobs.get((params as { digest: string }).digest) ?? null }
    : route === 'event.read' ? { ok: true, value: { events: [], status: { state: 'ok' } } } : undefined));
  const digest = options.digest ?? (captured ? digestOf(captured) : `sha256:${'a'.repeat(64)}`);
  if (captured) blobs.set(digest, captured);
  let session: PreviewSession = { sessionId: 'fixture-session', versionId: 'unset', generation: 0, route: '/document.html', state: '',
    viewport: { w: 1024, h: 720, dpr: 1 }, contentSize: { w: 1024, h: 720 }, status: 'open', pickQualified: true };
  const preview: PreviewTransport = {
    async call<R extends keyof PreviewParams>(route: R, params: PreviewParams[R]) {
      let value: PreviewValues[keyof PreviewValues];
      if (route === 'open') { session = { ...session, versionId: (params as PreviewParams['open']).versionId }; value = session; }
      else if (route === 'capture') {
        const record: CaptureRecord = { ...session, route: options.route ?? session.route, captureId: 'fixture-capture-1', scroll: { x: 0, y: 0 }, captureDigest: digest as CaptureRecord['captureDigest'],
          capturedAt: '2026-01-01T00:00:00Z' };
        value = record;
      } else if (route === 'image') value = 'data:image/png;base64,AA==';
      else if (route === 'status' || route === 'place' || route === 'navigate') value = session;
      else value = null;
      return { ok: true as const, value: value as PreviewValues[R] };
    },
  };
  const workspace = createDesignWorkspace(createBridgeWorkspaceDocuments(d.transport), { preview, sources: { async list() { return [item]; } }, onSelectProject: () => undefined });
  if (!workspace.bridged) throw new Error('expected the durable workspace');
  return { d, blobs, workspace, ui: workspace.interactive, fail: (next: typeof failure) => { failure = next; } };
}

async function captureOnce(f: ReturnType<typeof fixture>) {
  await f.ui.refresh(); await f.ui.select(item); await f.ui.open();
  assert.equal(f.ui.snapshot().error, null);
  await f.ui.capture();
}

const saved = async (f: ReturnType<typeof fixture>) => (await f.workspace.contentFor({ id: sourceProject, name: entry.displayName })).content;

test('a saved live capture carries a thumbnail when its stored PNG qualifies, and Projects can resolve it', async () => {
  const bytes = png(11, 64, 40);
  const f = fixture(bytes);
  const revision = f.workspace.contentEvents.revision(sourceProject);
  await captureOnce(f);
  assert.equal(f.ui.snapshot().error, null);
  const content = await saved(f);
  assert.equal(content.versions.length, 1);
  const version = content.versions[0]!;
  assert.deepEqual(version.thumbnail, { digest: digestOf(bytes), mediaType: 'image/png', bytes: bytes.byteLength, w: 64, h: 40 });
  assert.equal(version.thumbnail!.digest, version.capture.captureDigest, 'the thumbnail is the capture itself');
  assert.deepEqual(summarize(content).cover, version.thumbnail, 'Gallery uses it as the cover');
  const env = await f.workspace.contentFor({ id: sourceProject, name: entry.displayName });
  assert.deepEqual((await env.thumbnails.readThumbnail(version.thumbnail!, new AbortController().signal)).bytes, bytes);
  assert.equal(f.workspace.contentEvents.revision(sourceProject), revision + 1, 'readers were told once');
});

test('a capture too large for a thumbnail is saved without one', async () => {
  const oversized = new Uint8Array(DEFAULT_LIMITS.maxThumbnailBytes + 1);
  oversized.set(png(12).subarray(0, 64));
  const f = fixture(oversized);
  await captureOnce(f);
  const version = (await saved(f)).versions[0]!;
  assert.equal(version.capture.captureDigest, digestOf(oversized));
  assert.equal('thumbnail' in version, false);
  assert.equal(summarize(await saved(f)).cover, undefined);
});

test('a capture whose bytes are not stored, or do not match its digest, is saved without a thumbnail', async () => {
  const missing = fixture(null);
  await captureOnce(missing);
  assert.equal('thumbnail' in (await saved(missing)).versions[0]!, false);
  const mismatched = fixture(png(13), { digest: digestOf(png(14)) });
  mismatched.blobs.set(digestOf(png(14)), png(13));
  await captureOnce(mismatched);
  assert.equal('thumbnail' in (await saved(mismatched)).versions[0]!, false);
});

test('a stale capture is a typed stale failure, writes nothing and tells no reader', async () => {
  const f = fixture(png(15), { route: '/somewhere-else' });
  await f.ui.refresh(); await f.ui.select(item); await f.ui.open();
  const revision = f.workspace.contentEvents.revision(sourceProject);
  await f.ui.capture();
  const { failure, error } = f.ui.snapshot();
  assert.deepEqual([failure?.kind, failure?.operation, failure?.section, failure?.outcome], ['stale', 'captures.accept', 'captures', 'no-effect']);
  assert.match(error!, /capture it again/iu);
  assert.equal(designFeedback(failure!).action?.kind, 'choose-again');
  assert.equal(f.d.calls.some((call) => call.route === 'doc.put'), false);
  assert.equal(f.workspace.contentEvents.revision(sourceProject), revision);
  assert.equal(f.ui.snapshot().held, false);
});

test('a save whose result is unknown is a typed unknown failure, holds further work, and still tells readers to re-read', async () => {
  const f = fixture(png(16));
  await f.ui.refresh(); await f.ui.select(item); await f.ui.open();
  const revision = f.workspace.contentEvents.revision(sourceProject);
  f.fail((route) => (route === 'doc.put' ? { ok: false, kind: 'unknown' } : undefined));
  await f.ui.capture();
  const { failure, held } = f.ui.snapshot();
  assert.deepEqual([failure?.kind, failure?.outcome, failure?.operation, failure?.recovery], ['unknown', 'unknown-effect', 'captures.accept', 'check']);
  assert.equal(held, true, 'no blind retry');
  assert.equal(f.workspace.contentEvents.revision(sourceProject), revision + 1);
});

test('a conflicting save is a typed conflict that offers a reload', async () => {
  const f = fixture(png(17));
  await f.ui.refresh(); await f.ui.select(item); await f.ui.open();
  f.fail((route) => (route === 'doc.put' ? { ok: false, kind: 'conflict' } : undefined));
  await f.ui.capture();
  const { failure } = f.ui.snapshot();
  assert.deepEqual([failure?.kind, failure?.outcome, failure?.recovery], ['conflict', 'no-effect', 'reload']);
  assert.equal(f.ui.snapshot().held, false);
});

test('the failure goes away with the error when the next action starts', async () => {
  const f = fixture(png(18), { route: '/somewhere-else' });
  await f.ui.refresh(); await f.ui.select(item); await f.ui.open();
  await f.ui.capture();
  assert.ok(f.ui.snapshot().failure);
  await f.ui.refresh();
  assert.equal(f.ui.snapshot().error, null);
  assert.equal(f.ui.snapshot().failure, null);
});

test('adding a screen to the flow tells the readers of that project', async () => {
  const f = fixture(png(19));
  await captureOnce(f);
  const revision = f.workspace.contentEvents.revision(sourceProject);
  await f.ui.addScreen();
  assert.equal(f.ui.snapshot().error, null);
  assert.equal(f.workspace.contentEvents.revision(sourceProject), revision + 1);
  const flows = await f.workspace.flowsFor({ id: sourceProject, name: entry.displayName });
  assert.equal(flows.flows.length, 1);
  assert.equal(flows.flows[0]!.screens.length, 1);
});
