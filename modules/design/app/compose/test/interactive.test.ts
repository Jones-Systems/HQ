import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CaptureRecord, PreviewSession, PreviewTransport, PreviewParams, PreviewValues } from '@hq/contracts/preview';
import type { CatalogEntry } from '@hq/contracts/catalog';
import type { InteractiveCatalogItem } from '../runtime-ports.ts';
import { interactiveTarget } from '../runtime-ports.ts';
import { createDesignWorkspace } from '../workspace.ts';
import { createBridgeWorkspaceDocuments } from '../bridge-documents.ts';
import { createTransportDouble } from './bridge-double.ts';
import { createAnnotationsStorage } from '../../storage/index.ts';
import { loadAnnotations } from '../../../annotations/src/controller.ts';
import { versionId } from '../../../annotations/src/contract.ts';
import { createFakeReceiver, syntheticCatalog, syntheticDestination, syntheticIdentity } from '../../../connector/src/fakes.ts';
import type { TransportPort } from '../../../connector/src/contract.ts';
import type { RunsConnection } from '../../sections/runs/env.ts';

const digest = `sha256:${'a'.repeat(64)}` as const;
const entry: CatalogEntry = { sourceProjectId: 'a'.repeat(64) as CatalogEntry['sourceProjectId'], hostId: 'fixture-host' as CatalogEntry['hostId'],
  rootId: 'fixture-root' as CatalogEntry['rootId'], relativePath: 'sample', displayName: 'Sample website', revision: 'fixture-revision',
  repoIdentity: { localOnly: true }, previews: [], metadata: { experienceKind: 'website', launchStatus: 'available', launchUrl: 'https://example.com/document.html' } };
const item: InteractiveCatalogItem = { entry, hostLabel: 'Fixture source', freshness: 'fresh' };

function fixture(connection?: RunsConnection) {
  const d = createTransportDouble();
  d.failWith((route) => route === 'event.read' ? { ok: true, value: { events: [], status: { state: 'ok' } } } : undefined);
  const records = createBridgeWorkspaceDocuments(d.transport);
  const calls: { route: keyof PreviewParams; params: PreviewParams[keyof PreviewParams] }[] = [];
  const selected: { id: string; label: string }[] = [];
  let session: PreviewSession = { sessionId: 'fixture-session', versionId: 'unset', generation: 0, route: '/document.html', state: '',
    viewport: { w: 1024, h: 720, dpr: 1 }, contentSize: { w: 1024, h: 720 }, status: 'open', pickQualified: true };
  let captures = 0;
  let stale = false;
  let loseCaptureReply = false;
  let opening: Promise<void> | null = null;
  let releaseOpen: (() => void) | undefined;
  let enteredOpen: (() => void) | undefined;
  let queued: PreviewValues['events']['events'] = [];
  const capture = (): CaptureRecord => ({ ...session, captureId: `fixture-capture-${++captures}`, scroll: { x: 0, y: 0 }, captureDigest: session.route.includes('workout') ? `sha256:${'b'.repeat(64)}` : digest,
    capturedAt: '2026-01-01T00:00:00Z' });
  const preview: PreviewTransport = {
    async call<R extends keyof PreviewParams>(route: R, params: PreviewParams[R]) {
      calls.push({ route, params });
      let value: PreviewValues[keyof PreviewValues];
      if (route === 'open') { enteredOpen?.(); if (opening) await opening; session = { ...session, versionId: (params as PreviewParams['open']).versionId }; value = session; }
      else if (route === 'navigate') {
        const url = new URL((params as PreviewParams['navigate']).route, 'https://example.com');
        session = { ...session, route: url.pathname + url.search, state: url.hash, generation: session.generation + 1 }; value = session;
      } else if (route === 'capture') {
        if (loseCaptureReply) throw new Error('Lost capture response');
        if (stale) return { ok: false as const, kind: 'stale' as const, reason: 'pixels-unstable' };
        value = capture();
      } else if (route === 'events') { value = { after: queued.at(-1)?.sequence ?? 0, events: queued }; queued = []; }
      else if (route === 'status' || route === 'place') value = session;
      else if (route === 'image') value = 'data:image/png;base64,AA==';
      else if (route === 'resolve') value = { frame: { viewport: session.viewport, scroll: { x: 0, y: 0 } }, results: [] };
      else value = null;
      return { ok: true as const, value: value as PreviewValues[R] };
    },
  };
  const workspace = createDesignWorkspace(records, { preview, sources: { async list() { return [item]; } },
    onSelectProject: (project) => selected.push(project), runsConnection: connection });
  return { d, records, workspace, ui: workspace.interactive, calls, selected, stale: () => { stale = true; },
    loseCaptureReply: () => { loseCaptureReply = true; },
    holdOpen() { opening = new Promise<void>((resolve) => { releaseOpen = resolve; }); return { release: () => releaseOpen!(), entered: new Promise<void>((resolve) => { enteredOpen = resolve; }) }; },
    cite() {
      const captured = capture();
      queued = [{ sequence: 2, generation: session.generation, capture: captured, event: { type: 'text-cited', generation: session.generation,
        snapshot: { identity: 'quote:Continue', text: 'Continue', rects: [{ x: 10, y: 20, width: 100, height: 30 }] },
        target: { kind: 'text', quote: 'Continue', prefix: 'Ready? ', suffix: ' now', rects: [{ x: 10, y: 20, width: 100, height: 30 }] },
        frame: { viewport: session.viewport, scroll: { x: 0, y: 0 } } } }];
    },
    pick() {
      const captured = capture();
      queued = [{ sequence: 1, generation: session.generation, capture: captured, event: { type: 'element-picked', generation: session.generation,
        snapshot: { identity: '#cta', text: 'Continue', rects: [{ x: 10, y: 20, width: 100, height: 30 }] },
        target: { kind: 'element', path: '#cta', rect: { x: 10, y: 20, width: 100, height: 30 } }, frame: { viewport: session.viewport, scroll: { x: 0, y: 0 } } } }];
    },
  };
}

async function open(f: ReturnType<typeof fixture>) {
  await f.ui.refresh(); await f.ui.select(item); await f.ui.open();
  assert.equal(f.ui.snapshot().error, null);
}

test('catalog selection opens the full document only after explicit Open and binds the real catalog identity', async () => {
  const f = fixture();
  await f.ui.refresh(); await f.ui.select(item);
  assert.deepEqual(f.selected, [{ id: entry.sourceProjectId, label: entry.displayName }]);
  assert.equal(f.calls.length, 0);
  assert.equal(f.d.documents.size, 0);
  await f.ui.open();
  assert.equal(f.calls[0]?.route, 'open');
  assert.equal((f.calls[0]?.params as PreviewParams['open']).url, 'https://example.com/document.html');
  assert.equal(f.d.documents.size, 0, 'opening has no authoring write');
  await f.ui.navigate('/next?screen=details#expanded');
  assert.equal(f.ui.snapshot().session?.state, '#expanded');
  await f.ui.back();
  assert.equal(f.ui.snapshot().session?.route, '/document.html');
  await f.ui.place({ x: 20, y: 40, width: 800, height: 420 }, false);
  assert.deepEqual(f.calls.at(-1)?.params, { sessionId: 'fixture-session', rect: { x: 20, y: 40, width: 800, height: 420 }, visible: false });
  await f.ui.close(); assert.equal(f.calls.at(-1)?.route, 'close');
});

test('stills, held sources, unsafe URLs and missing capabilities stay unavailable', async () => {
  for (const metadata of [
    { ...entry.metadata, experienceKind: 'stills' }, { ...entry.metadata, launchUrl: 'http://example.com/site' },
    { ...entry.metadata, launchUrl: 'https://user:pass@example.com/site' }, { ...entry.metadata, launchStatus: 'unavailable' },
  ]) assert.equal(interactiveTarget({ ...item, entry: { ...entry, metadata } }), null);
  const missing = createDesignWorkspace(null).interactive;
  assert.equal(missing.available, false); await missing.refresh(); assert.match(missing.snapshot().error!, /Source catalogs unavailable/u);
  const runs = await fixture().workspace.closure.runs();
  assert.equal(runs.catalog.destinations.length, 0);
});

test('coherent Pick saves durable exact anchors and flow screens; navigation leaves previous anchors stale', async () => {
  const f = fixture(); await open(f);
  const controller = f.ui.snapshot().annotations!;
  controller.setPendingNote('Increase spacing'); controller.selectTool('pick');
  f.pick(); await f.ui.poll();
  assert.equal(f.ui.snapshot().error, null);
  const annotation = f.ui.snapshot().annotations!.snapshot.editor.document.annotations[0]!;
  assert.equal(annotation.note, 'Increase spacing');
  assert.equal(annotation.anchor.versionId, f.ui.snapshot().version);
  assert.notEqual(annotation.anchor.versionId, f.ui.snapshot().session?.versionId);
  assert.equal(annotation.anchor.route, '/document.html'); assert.equal(annotation.anchor.state, ''); assert.equal(annotation.anchor.captureDigest, digest);
  const loaded = await loadAnnotations(createAnnotationsStorage(f.records), versionId(annotation.anchor.versionId));
  assert.equal(loaded.document.annotations[0]?.note, 'Increase spacing');
  f.ui.snapshot().annotations!.selectTool('cite'); f.cite(); await f.ui.poll();
  const cited = f.ui.snapshot().annotations!.snapshot.editor.document.annotations[1]!;
  assert.equal(cited.kind, 'cite'); assert.equal(cited.anchor.target.kind, 'text');
  if (cited.anchor.target.kind === 'text') assert.equal(cited.anchor.target.quote, 'Continue');
  assert.equal(cited.anchor.versionId, annotation.anchor.versionId);
  const savedCite = await loadAnnotations(createAnnotationsStorage(f.records), versionId(annotation.anchor.versionId));
  assert.equal(savedCite.document.annotations[1]?.kind, 'cite');
  await f.ui.addScreen();
  assert.equal(f.ui.snapshot().error, null);
  assert.equal(f.ui.snapshot().flow?.projectId, entry.sourceProjectId);
  assert.equal(f.ui.snapshot().flow?.screens[0]?.state, '""', 'empty observed state uses lossless JSON encoding');
  await f.ui.navigate('/other#new');
  assert.equal(f.ui.snapshot().capture, null);
  assert.equal(f.ui.snapshot().annotations!.snapshot.editor.document.annotations[0]?.anchor.route, '/document.html');
  await f.ui.addScreen(); assert.match(f.ui.snapshot().error!, /Capture the current frame/u);
  await f.ui.close();
});

test('stale capture writes no project, annotation or flow records', async () => {
  const f = fixture(); await open(f); f.stale(); await f.ui.capture();
  assert.match(f.ui.snapshot().error!, /pixels-unstable/u);
  assert.equal(f.d.documents.size, 0); assert.equal(f.ui.snapshot().capture, null);
  await f.ui.close();
});

test('preview to proposal preserves anchors through the frozen packet; only Runs confirmation sends', async () => {
  const receiver = createFakeReceiver({ clock: { now: Date.now }, identity: syntheticIdentity() });
  const destination = syntheticDestination({ endpoint: { transport: 'jones-code', locator: 'fixture:thread' } });
  const transport: TransportPort = { descriptor: { kind: 'jones-code', provenance: 'jones', label: 'Source fixture only', qualification: { level: 'qualified', evidenceRef: 'fixture-only' } },
    identify: (endpoint, signal) => receiver.identify(endpoint, signal),
    async send(handoff, endpoint, signal) { const result = await receiver.send(handoff, endpoint, signal); return result.kind === 'rejected' ? result : { ...result, receipt: { ...result.receipt, provenance: 'jones' } }; },
    lookup: (query, signal) => receiver.lookup(query, signal) };
  const connection: RunsConnection = { getCatalog: () => ({ ...syntheticCatalog(), observedAt: new Date().toISOString(), destinations: [destination] }), transports: { 'jones-code': transport } };
  const memoryOnly = await createDesignWorkspace(null, { runsConnection: connection }).closure.runs();
  assert.equal(memoryOnly.catalog.destinations.length, 0, 'a live connection requires durable workspace records');
  const f = fixture(connection);
  await open(f);
  f.ui.snapshot().annotations!.selectTool('pick'); f.pick(); await f.ui.poll();
  const requestId = await f.ui.createProposal('Make the selected control easier to read');
  assert.equal(f.ui.snapshot().error, null); assert.ok(requestId);
  const request = await f.workspace.closure.requests.open(requestId);
  assert.equal(request.state.draft?.sources[0]?.projectId, entry.sourceProjectId);
  assert.equal(request.state.draft?.annotations[0]?.anchor.captureDigest, digest);
  request.edit({ type: 'set-destination', destination: { kind: 'existing-thread', destinationId: destination.destinationId, label: destination.label } });
  const runs = await f.workspace.closure.runs();
  const packet = await runs.pipeline.freeze(request); assert.ok(packet);
  assert.equal(packet.annotations[0]?.anchor.route, '/document.html');
  await runs.pipeline.selectPacket(request, packet.packetId);
  assert.equal(receiver.calls.send, 0);
  runs.controller.requestSend(); assert.equal(receiver.calls.send, 0);
  const result = await runs.pipeline.confirm();
  assert.equal(result?.outcome, 'attempted'); assert.equal(receiver.calls.send, 1);
  await f.ui.close();
});


test('deactivation closes a late Open response and never leaves a live session in the module', async () => {
  const f = fixture(); await f.ui.refresh(); await f.ui.select(item);
  const gate = f.holdOpen();
  const opening = f.ui.open();
  await gate.entered;
  await f.ui.deactivate(); gate.release(); await opening;
  assert.equal(f.ui.snapshot().session, null);
  assert.equal(f.calls.at(-1)?.route, 'close');
});

test('an unknown capture outcome is held and never retried by another click', async () => {
  const f = fixture(); await open(f); f.loseCaptureReply();
  await f.ui.capture(); await f.ui.capture();
  assert.equal(f.calls.filter((call) => call.route === 'capture').length, 1);
  assert.equal(f.ui.snapshot().held, true); assert.match(f.ui.snapshot().error!, /unknown/u);
  assert.equal(f.d.documents.size, 0); await f.ui.close();
});


test('one app session captures two routes into distinct immutable versions and reopens flow, annotations and frozen proposal', async () => {
  const f = fixture(); await open(f);
  const hostSession = f.ui.snapshot().session!.sessionId;
  await f.ui.capture(); await f.ui.addScreen();
  const today = f.ui.snapshot().version!;
  assert.equal(f.ui.snapshot().error, null);
  await f.ui.navigate('/workout?screen=workout');
  await f.ui.capture(); await f.ui.addScreen();
  const workout = f.ui.snapshot().version!;
  assert.equal(f.ui.snapshot().error, null); assert.notEqual(workout, today);
  assert.equal(f.ui.snapshot().session!.sessionId, hostSession);
  const controller = f.ui.snapshot().annotations!;
  controller.setPendingNote('Clarify the workout action'); controller.selectTool('pick');
  f.pick(); await f.ui.poll();
  assert.equal(f.ui.snapshot().version, workout, 'same coherent frame reuses its immutable capture version');
  const proposalId = await f.ui.createProposal('Clarify the workout action'); assert.ok(proposalId);
  const request = await f.workspace.closure.requests.open(proposalId);
  const packet = await request.freeze(); assert.ok(packet);
  assert.equal(packet.sources[0]?.versionId, workout);
  assert.equal(packet.annotations[0]?.anchor.versionId, workout);
  assert.equal(packet.annotations[0]?.anchor.route, '/workout?screen=workout');
  assert.equal(packet.annotations[0]?.anchor.captureDigest, `sha256:${'b'.repeat(64)}`);
  await f.ui.close();
  const reopened = createDesignWorkspace(f.records);
  assert.ok(reopened.bridged);
  const project = { id: String(entry.sourceProjectId), name: entry.displayName };
  const { content } = await reopened.contentFor(project);
  assert.equal(content.versions.length, 2);
  assert.equal(content.versions.find((version) => version.id === today)?.capture.route, '/document.html');
  assert.equal(content.versions.find((version) => version.id === today)?.capture.captureDigest, digest);
  assert.equal(content.versions.find((version) => version.id === workout)?.capture.route, '/workout?screen=workout');
  const { flows } = await reopened.flowsFor(project);
  assert.deepEqual(flows[0]?.screens.map((screen) => screen.versionId), [today, workout]);
  const annotations = await reopened.annotationsEnv().controllerFor(versionId(workout));
  assert.equal(annotations.snapshot.editor.document.annotations[0]?.note, 'Clarify the workout action');
  const recovered = await reopened.closure.requests.open(proposalId);
  assert.equal(recovered.state.packets[0]?.authoringDigest, packet.authoringDigest);
  assert.equal(recovered.state.sends.length, 0);
});
