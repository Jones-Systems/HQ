/**
 * W6: every Design section's durable path, end to end through the REAL desktop Design host and the REAL file
 * store. Each test drives the same section adapters the renderer composes, over the renderer bridge, an
 * in-process copy of the preload IPC, `createDesignHost` and the default store in a temp directory, then closes
 * the host, reopens it on the same files and reads the data back through a fresh composition.
 * Failure classes are in design-host.e2e.failures.test.ts. Harness: ../test-support/design-e2e/harness.ts.
 */
import { describe, expect, it } from 'vitest';
import { withDesignE2E, type E2EWindow } from '../test-support/design-e2e/harness.ts';
import { PNG, PNG_REF, SHELL_PROJECT, flowRaw } from '../test-support/design-e2e/fixtures.ts';
import type { ProjectsController } from '../../../modules/design/projects/src/controller.ts';
import { projectId, type ViewId } from '../../../modules/design/projects/src/ids.ts';
import { SYNTHETIC_BUTTON, SYNTHETIC_BUTTON_VARIANTS, SYNTHETIC_CARD, SYNTHETIC_MOTION, SYNTHETIC_SYSTEM } from '../../../modules/design/components/src/fixtures.ts';
import { brandId as componentsId } from '../../../modules/design/components/src/model/ids.ts';
import { parseFlow } from '../../../modules/design/flows/src/model.ts';
import type { FlowId } from '../../../modules/design/flows/src/contract.ts';
import { createCompareController, loadComparison } from '../../../modules/design/compare/src/controller.ts';
import { comparisonId, panelId, projectId as compareProjectId, versionId as compareVersionId } from '../../../modules/design/compare/src/ids.ts';
import { createBaselineCandidate } from '../../../modules/design/compare/src/model.ts';
import { versionId as annotationVersionId } from '../../../modules/design/annotations/src/contract.ts';
import { artboardId as canvasArtboardId } from '../../../modules/design/canvas/src/contract.ts';
import { loadAnnotations } from '../../../modules/design/annotations/src/controller.ts';
import { addArtboard, emptyArrangement } from '../../../modules/design/canvas/src/arrangement.ts';
import { loadArrangement, saveArrangement } from '../../../modules/design/canvas/src/codec.ts';
import { createCompareStorage } from '../../../modules/design/app/storage/index.ts';
import { createProjectCompareCatalog } from '../../../modules/design/app/compose/compare-catalog.ts';
import { linkOf } from '../../../modules/design/requests/src/draft.ts';
import { annotation, candidate, evidence as requestEvidence, source as requestSource } from '../test-support/design-e2e/requests-fixtures.ts';
import { createOutbox } from '../../../modules/design/connector/src/outbox.ts';
import { createConfirmation } from '../../../modules/design/connector/src/confirmation.ts';
import { intakeEvidence, type ResultEvidence } from '../../../modules/design/connector/src/evidence.ts';
import { createFakeClock, createFakeReceiver, syntheticDestination, syntheticEvidence, syntheticIdentity, syntheticPacket } from '../../../modules/design/connector/src/fakes.ts';
import type { DispatchId } from '../../../modules/design/connector/src/ids.ts';
import { CATALOG_CACHE_KEY, serializeCatalogCache } from '../../../modules/design/discovery/src/cache.ts';
import { EMPTY_CATALOG } from '../../../modules/design/discovery/src/catalog.ts';
import { isoTime } from '../../../modules/design/discovery/src/contract.ts';
import { TEXT_FORMAT } from '../../../modules/design/app/storage/index.ts';
import { TASTE_JOURNAL_KEY } from './design-host.ts';

/** Waits for a controller snapshot to satisfy `read`; the Projects controller loads asynchronously. */
async function until<T>(controller: ProjectsController, read: (snapshot: ReturnType<ProjectsController['getSnapshot']>) => T | undefined): Promise<T> {
  const found = read(controller.getSnapshot());
  if (found !== undefined) return found;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { release(); reject(new Error('Timed out waiting for the Projects controller')); }, 5_000);
    const release = controller.subscribe(() => {
      const value = read(controller.getSnapshot());
      if (value !== undefined) { clearTimeout(timer); release(); resolve(value); }
    });
  });
}
const activeContent = (controller: ProjectsController) => until(controller, (snapshot) => snapshot.active?.status === 'ready' ? snapshot.active.content : undefined);
const openProject = async (window: E2EWindow, id: string) => {
  const controller = await window.workspace.projectsFor(SHELL_PROJECT);
  controller.openProject(projectId(id));
  return { controller, content: await activeContent(controller) };
};
const stored = async (window: E2EWindow, key: string) => {
  const document = await window.records.getDocument(key);
  if (document === null) throw new Error(`No stored document at ${key}`);
  return document;
};

describe('Projects', () => {
  it('creates a project, adds and renames a view, appends a version with a thumbnail, and keeps all of it across close and reopen', async () => {
    await withDesignE2E(async (e2e) => {
      const first = await e2e.window.workspace.projectsFor(SHELL_PROJECT);
      expect(first.getSnapshot().registry).toMatchObject({ status: 'ready', projects: [] });

      // Registry create, through the production Projects controller.
      expect(await first.createProject('Landing site')).toEqual({ ok: true });
      const id = first.getSnapshot().session.activeProjectId!;
      expect(first.getSnapshot().registry.projects.map((record) => record.name)).toEqual(['Landing site']);
      await activeContent(first);

      // Content views: add, rename.
      expect(await first.addView('Home', 'screen')).toEqual({ ok: true });
      const viewId = (await activeContent(first)).views[0]!.id as ViewId;
      expect(await first.renameView(viewId, 'Home page')).toEqual({ ok: true });

      // Thumbnails: the bytes go through blob.put, the version keeps only the digest reference.
      expect(await e2e.window.records.putBlob(PNG)).toEqual({ digest: PNG_REF.digest, bytes: PNG.length });
      expect(await first.addVersion({ viewId, label: 'First pass', origin: 'owner-created', thumbnail: PNG_REF,
        capture: { route: '/', viewport: { w: 320, h: 640, dpr: 1 } } })).toEqual({ ok: true });
      const written = await activeContent(first);
      expect(written.views.map((view) => view.title)).toEqual(['Home page']);
      expect(written.versions).toHaveLength(1);

      // Durable across a host close and a brand-new composition over the same files.
      const window = await e2e.reopen();
      const { controller: second, content } = await openProject(window, id);
      expect(second.getSnapshot().registry.projects.map((record) => record.name)).toEqual(['Landing site']);
      expect(content.views.map((view) => view.title)).toEqual(['Home page']);
      expect(content.versions.map((version) => [version.ordinal, version.label, version.thumbnail?.digest])).toEqual([[1, 'First pass', PNG_REF.digest]]);
      const env = await window.workspace.contentFor({ id, name: 'Landing site' });
      const thumbnail = await env.thumbnails.readThumbnail(env.content.versions[0]!.thumbnail!, new AbortController().signal);
      expect(thumbnail.mediaType).toBe('image/png');
      expect(Array.from(thumbnail.bytes)).toEqual(Array.from(PNG));
    });
  });

  it('appends versions and keeps earlier ones byte-identical, in order, across reopen', async () => {
    await withDesignE2E(async (e2e) => {
      const first = await e2e.window.workspace.projectsFor(SHELL_PROJECT);
      await first.createProject('Ordered');
      const id = first.getSnapshot().session.activeProjectId!;
      await activeContent(first);
      await first.addView('Page', 'page');
      const viewId = (await activeContent(first)).views[0]!.id as ViewId;
      for (const label of ['One', 'Two', 'Three']) {
        expect(await first.addVersion({ viewId, label, origin: 'owner-created', capture: { route: '/', viewport: { w: 100, h: 100, dpr: 1 } } })).toEqual({ ok: true });
      }
      const before = (await activeContent(first)).versions.map((version) => JSON.stringify(version));
      const window = await e2e.reopen();
      const { content } = await openProject(window, id);
      expect(content.versions.map((version) => JSON.stringify(version))).toEqual(before);
      expect(content.versions.map((version) => [version.label, version.ordinal])).toEqual([['One', 1], ['Two', 2], ['Three', 3]]);
    });
  });
});

describe('Components', () => {
  it('saves source revisions, variants, a design system, a motion study and project membership, and reads them back after reopen', async () => {
    await withDesignE2E(async (e2e) => {
      const library = await e2e.window.workspace.componentsFor(SHELL_PROJECT);
      const one = await library.saveSource(SYNTHETIC_BUTTON);
      const variants = await library.saveVariants(one, { componentId: one.componentId, sourceRevision: one.revision, variants: SYNTHETIC_BUTTON_VARIANTS });
      const card = await library.saveSource(SYNTHETIC_CARD);
      const system = await library.saveDesignSystem(SYNTHETIC_SYSTEM);
      const motion = await library.saveMotionStudy(SYNTHETIC_MOTION);
      const two = await library.saveSource({ ...SYNTHETIC_BUTTON, name: 'Synthetic Button, second revision' });
      expect([one.revision, two.revision]).toEqual([1, 2]);
      // Saving unchanged content writes nothing new: it returns the existing latest revision.
      expect((await library.saveSource({ ...SYNTHETIC_BUTTON, name: 'Synthetic Button, second revision' })).revision).toBe(2);
      const membership = await library.setProjectMembership({ projectId: componentsId('ProjectId', SHELL_PROJECT.id),
        components: [{ componentId: one.componentId, revision: 1 }, { componentId: card.componentId, revision: 1 }], studies: [{ studyId: motion.id, revision: motion.revision }] });

      const window = await e2e.reopen();
      const reopened = await window.workspace.componentsFor(SHELL_PROJECT);
      expect(await reopened.listComponents()).toEqual([one.componentId, card.componentId].sort());
      expect(await reopened.revisions(one.componentId)).toEqual([1, 2]);
      expect(await reopened.getSource(one.componentId, 1)).toEqual(one);
      expect(await reopened.getSource(one.componentId, 2)).toEqual(two);
      expect(await reopened.getVariants(one)).toEqual(variants);
      expect(await reopened.listDesignSystems()).toEqual([system]);
      expect(await reopened.getMotionStudy(motion.id, motion.revision)).toEqual(motion);
      expect(await reopened.getProjectMembership(componentsId('ProjectId', SHELL_PROJECT.id))).toEqual(membership);
      // Section documents live under the fixed Components root, and nothing else was written.
      const keys = await window.records.listDocuments('design/components/');
      expect(keys.length).toBeGreaterThan(6);
      expect(keys.every((key) => key.startsWith('design/components/design-components/'))).toBe(true);
      expect((await stored(window, `design/components/design-components/source/${one.componentId}/00000002`)).revision).toBe(1);
    });
  });
});

describe('Flows', () => {
  it('saves flows, overwrites one, and lists and loads them for the project after reopen', async () => {
    await withDesignE2E(async (e2e) => {
      const { repository } = await e2e.window.workspace.flowsFor(SHELL_PROJECT);
      const parsed = parseFlow(flowRaw());
      if (!parsed.ok) throw new Error(parsed.errors.join('; '));
      await repository.save(parsed.flow);
      const second = parseFlow(flowRaw(SHELL_PROJECT.id, 'flow-second', 'Second'));
      if (!second.ok) throw new Error(second.errors.join('; '));
      await repository.save(second.flow);
      await repository.save({ ...parsed.flow, title: 'Checkout, renamed' });
      const other = parseFlow(flowRaw('project-elsewhere', 'flow-elsewhere', 'Elsewhere'));
      if (!other.ok) throw new Error(other.errors.join('; '));
      await repository.save(other.flow);

      const window = await e2e.reopen();
      const env = await window.workspace.flowsFor(SHELL_PROJECT);
      expect(env.flows.map((flow) => flow.title).sort()).toEqual(['Checkout, renamed', 'Second']);
      expect(await env.repository.load('flow-checkout' as FlowId)).toMatchObject({ status: 'ok', flow: { title: 'Checkout, renamed', platform: 'ios' } });
      expect(await env.repository.load('flow-missing' as FlowId)).toEqual({ status: 'missing' });
      // The overwrite is the second revision of the same stored document.
      expect((await stored(window, 'design/flows/design/flows/flow-checkout')).revision).toBe(2);
      expect((await window.records.listDocuments('design/flows/')).length).toBe(3);
    });
  });
});

describe('Compare', () => {
  it('saves a comparison, loads it through the composed controller after reopen, and resaves it', async () => {
    await withDesignE2E(async (e2e) => {
      const id = comparisonId(`${SHELL_PROJECT.id}-compare`);
      const viewport = { w: 390, h: 844, dpr: 3 };
      const source = (version: string) => ({ kind: 'live-preview' as const, versionId: compareVersionId(version), route: '/', state: 'default' });
      const initial = createBaselineCandidate(id, compareProjectId(SHELL_PROJECT.id),
        { id: panelId('panel-baseline'), source: source('v-before'), viewport }, { id: panelId('panel-candidate'), source: source('v-after'), viewport });
      const repository = (await e2e.window.workspace.contentFor(SHELL_PROJECT)).repository;
      const first = createCompareController(initial, { storage: createCompareStorage(e2e.window.records),
        catalog: createProjectCompareCatalog(repository, projectId(SHELL_PROJECT.id)) });
      expect(await first.save()).toBe(true);
      first.dispose();
      expect((await stored(e2e.window, `design/compare/compare/${id}`)).revision).toBe(1);

      const window = await e2e.reopen();
      const loaded = await loadComparison(createCompareStorage(window.records), id);
      expect(loaded).toEqual({ status: 'ok', state: initial });
      const composed = await window.workspace.compareFor(SHELL_PROJECT);
      expect(composed.getSnapshot().comparison).toEqual(initial);
      composed.resize(panelId('panel-candidate'), 500);
      expect(composed.getSnapshot().dirty).toBe(true);
      expect(await composed.save()).toBe(true);
      composed.dispose();
      expect((await stored(window, `design/compare/compare/${id}`)).revision).toBe(2);
      const resaved = await loadComparison(createCompareStorage(window.records), id);
      expect(resaved.status === 'ok' && resaved.state.panels.map((panel) => panel.width)).toEqual([initial.panels[0]!.width, 500]);
    });
  });

  it('is unconditional last-write-wins by design: two windows both save, and the second save is kept', async () => {
    await withDesignE2E(async (e2e) => {
      const id = comparisonId(`${SHELL_PROJECT.id}-compare`);
      const viewport = { w: 390, h: 844, dpr: 3 };
      const source = { kind: 'live-preview' as const, versionId: compareVersionId('v-one'), route: '/', state: 'default' };
      const make = (window: E2EWindow, width: number) => createCompareController(
        createBaselineCandidate(id, compareProjectId(SHELL_PROJECT.id), { id: panelId('panel-a'), source, viewport, width }, { id: panelId('panel-b'), source, viewport }),
        { storage: createCompareStorage(window.records), catalog: { listViews: async () => [], listVersions: async () => [], getVersion: async () => null } });
      const other = e2e.openWindow();
      expect(await make(e2e.window, 400).save()).toBe(true);
      expect(await make(other, 600).save()).toBe(true);
      const loaded = await loadComparison(createCompareStorage(e2e.window.records), id);
      expect(loaded.status === 'ok' && loaded.state.panels[0]!.width).toBe(600);
      expect((await stored(e2e.window, `design/compare/compare/${id}`)).revision).toBe(2);
    });
  });
});

describe('Annotations', () => {
  it('saves a mark with its note and loads it after reopen', async () => {
    await withDesignE2E(async (e2e) => {
      const version = annotationVersionId('version-synthetic');
      const frame = { versionId: version, route: '/', state: 'default', viewport: { w: 390, h: 844, dpr: 3 }, scroll: { x: 0, y: 0 }, captureDigest: PNG_REF.digest };
      const env = e2e.window.workspace.annotationsEnv();
      const controller = await env.controllerFor(version);
      controller.setFrame(frame);
      controller.selectTool('box');
      expect(controller.draw('box', [{ x: 10, y: 20 }, { x: 110, y: 90 }], 'Tighten the spacing')).toMatchObject({ status: 'applied' });
      expect(await controller.save()).toBe('saved');
      const expected = controller.snapshot.editor.document;

      const window = await e2e.reopen();
      const loaded = await loadAnnotations(window.workspace.annotationsEnv().store, version);
      expect(loaded.status).toBe('loaded');
      expect(loaded.document).toEqual(expected);
      expect(loaded.document.annotations.map((mark) => mark.note)).toEqual(['Tighten the spacing']);
      // A different version has its own, empty document.
      expect((await loadAnnotations(window.workspace.annotationsEnv().store, annotationVersionId('version-other'))).status).toBe('empty');
      expect((await stored(window, 'design/annotations/version-synthetic')).revision).toBe(1);
    });
  });
});

describe('Canvas', () => {
  it('saves an arrangement through the one-shot read token and loads it after reopen', async () => {
    await withDesignE2E(async (e2e) => {
      const env = await e2e.window.workspace.canvasFor(SHELL_PROJECT);
      expect(env).not.toBeNull();
      const canvas = env!;
      expect(canvas.sourceErrors).toEqual([]);
      expect(await loadArrangement(canvas.storage, canvas.canvasId)).toEqual({ status: 'missing' });
      const arranged = addArtboard(emptyArrangement(canvas.canvasId, canvas.projectId), { id: canvasArtboardId('artboard-one'), name: 'Phone', frame: { x: 0, y: 0, width: 390, height: 844 } });
      const saved = await saveArrangement(canvas.storage, arranged, null);
      expect(saved.status).toBe('saved');

      const window = await e2e.reopen();
      const again = await window.workspace.canvasFor(SHELL_PROJECT);
      const loaded = await loadArrangement(again!.storage, again!.canvasId);
      expect(loaded.status).toBe('loaded');
      expect(loaded.status === 'loaded' && loaded.arrangement).toEqual(arranged);
      // A second save from the loaded text updates the same document: revision 2, CAS-checked by the store.
      const edited = addArtboard(arranged, { id: canvasArtboardId('artboard-two'), name: 'Tablet', frame: { x: 500, y: 0, width: 820, height: 1180 } });
      expect((await saveArrangement(again!.storage, edited, loaded.status === 'loaded' ? loaded.baseText : null)).status).toBe('saved');
      expect((await stored(window, `design.canvas.arrangement.v1/${canvas.canvasId}`)).revision).toBe(2);
    });
  });
});

describe('References', () => {
  const screenshot = (overrides: Record<string, unknown> = {}) => ({
    kind: 'screenshot', source: { kind: 'url' as const, url: 'https://example.com/pricing' }, capturedAt: '2026-02-01T10:00:00.000Z',
    capturedBy: 'owner-judged', title: 'Example pricing page', tags: ['pricing'], asset: { bytes: PNG, mediaType: 'image/png', w: 1, h: 1 }, ...overrides,
  });

  it('keeps a reference record and its image bytes (through blob.put) across reopen, and re-importing is idempotent', async () => {
    await withDesignE2E(async (e2e) => {
      const env = await e2e.window.workspace.closure.references();
      const imported = await env.library.importReference(screenshot());
      expect(imported.status).toBe('created');
      if (imported.status !== 'created') throw new Error('Expected a newly created reference');
      const id = imported.id;
      const record = env.library.state.references[id]!;
      expect(record.asset).toMatchObject({ digest: PNG_REF.digest, mediaType: 'image/png' });
      // The image went through blob.put, and the library document keeps only its digest.
      expect(e2e.window.transport.calls.filter((call) => call.route === 'blob.put').map((call) => call.outcome)).toEqual(['replied']);
      expect(await env.library.importReference(screenshot())).toMatchObject({ status: 'unchanged', id });
      expect(await env.library.importReference(screenshot({ capturedAt: '2026-03-01T10:00:00.000Z' }))).toMatchObject({ status: 'observed-again', id });

      const window = await e2e.reopen();
      const reopened = await window.workspace.closure.references();
      expect(reopened.library.access).toEqual({ mode: 'writable' });
      expect(Object.keys(reopened.library.state.references)).toEqual([id]);
      expect(reopened.library.state.references[id]).toMatchObject({ title: 'Example pricing page', importCount: 2, capturedAt: '2026-02-01T10:00:00.000Z' });
      const bytes = await window.records.getBlob(PNG_REF.digest);
      expect(bytes && Array.from(bytes)).toEqual(Array.from(PNG));
      expect(await window.records.hasBlob(PNG_REF.digest)).toBe(true);
      expect(await window.records.hasBlob(`sha256:${'0'.repeat(64)}`)).toBe(false);
      expect(await window.records.getBlob(`sha256:${'0'.repeat(64)}`)).toBeNull();
      // One library document, written once per change: create (1), observed-again (2).
      expect((await stored(window, 'design/references/library')).revision).toBe(2);
    });
  });

  it('adopts the library into the reference graph and keeps it after reopen', async () => {
    await withDesignE2E(async (e2e) => {
      const env = await e2e.window.workspace.closure.references();
      expect((await env.library.importReference(screenshot())).status).toBe('created');
      const adopted = await env.graph.adoptFlatLibrary(env.library.state);
      expect(adopted.outcomes.every((outcome) => outcome.ok)).toBe(true);
      const window = await e2e.reopen();
      const reopened = await window.workspace.closure.references();
      expect(Object.keys(reopened.graph.state.subjects).length).toBeGreaterThan(0);
      expect(Object.keys(reopened.graph.state.captures).length).toBeGreaterThan(0);
      expect(reopened.graph.state).toEqual(env.graph.state);
      expect(await window.records.listDocuments('design/references/')).toEqual(['design/references/graph', 'design/references/library']);
    });
  });
});

describe('Requests', () => {
  it('keeps a request draft, its frozen packet and review events (design/requests/*) across reopen', async () => {
    await withDesignE2E(async (e2e) => {
      const requests = e2e.window.workspace.closure.requests;
      const session = await requests.create({ title: 'Tighten home heading', sources: [requestSource()] });
      const requestId = session.state.requestId;
      session.edit({ type: 'set-intent', intent: 'Reduce the gap above the second heading.\nKeep the hero unchanged.' });
      session.edit({ type: 'add-annotation', annotation: annotation('A') });
      session.edit({ type: 'add-evidence', evidence: requestEvidence() });
      await session.flush();
      const packet = (await session.freeze())!;
      expect(packet).toBeTruthy();
      const returned = candidate(linkOf(packet));
      expect(await session.review(returned, 'defer', 'Check on mobile first.')).toBeTruthy();
      expect(await session.review(returned, 'accept', 'Looks right.')).toBeTruthy();
      session.dispose();
      const prefix = `design/requests/${requestId}/`;
      const keysBefore = await e2e.window.records.listDocuments(prefix);
      expect(keysBefore).toEqual(expect.arrayContaining([`${prefix}draft`, `${prefix}packets/000001`, `${prefix}candidates/${returned.candidateId}`]));
      const events = await e2e.window.records.readEvents(`${prefix}review`);
      expect(events.status).toEqual({ state: 'ok' });
      expect(events.events.map((event) => event.seq)).toEqual([1, 2]);

      const window = await e2e.reopen();
      const reopened = await window.workspace.closure.requests.open(requestId);
      expect(reopened.state.packets.map((item) => item.packetId)).toEqual([packet.packetId]);
      expect(reopened.state.reviews.map((event) => event.decision)).toEqual(['defer', 'accept']);
      expect(reopened.state.candidates).toEqual([returned]);
      expect(await window.workspace.closure.requests.store.listRequests()).toEqual([requestId]);
      expect(await window.records.listDocuments(prefix)).toEqual(keysBefore);
      const reread = await window.records.readEvents(`${prefix}review`);
      expect(reread).toEqual(events);
      reopened.dispose();
    });
  });

  it('appends review events idempotently by eventId across a retried append', async () => {
    await withDesignE2E(async (e2e) => {
      const stream = 'design/requests/request-retry/review';
      const payload = { eventId: 'event-retry', decision: 'accept' };
      const first = await e2e.window.records.appendEvent(stream, { type: 'requests.event-bytes', payload, clientEventId: 'event-retry' });
      const retried = await e2e.window.records.appendEvent(stream, { type: 'requests.event-bytes', payload, clientEventId: 'event-retry' });
      expect(retried).toEqual(first);
      const window = await e2e.reopen();
      expect((await window.records.readEvents(stream)).events).toEqual([{ seq: 1, payload }]);
    });
  });
});

describe('Connector', () => {
  it('keeps the outbox dispatch (revision CAS) and result evidence across reopen', async () => {
    await withDesignE2E(async (e2e) => {
      const { outboxStore, evidenceStore } = e2e.window.workspace.closure;
      const clock = createFakeClock();
      const receiver = createFakeReceiver({ identity: syntheticIdentity(), clock });
      const packet = await syntheticPacket();
      const destination = syntheticDestination();
      const outbox = createOutbox({ store: outboxStore, transports: { 'fake-receiver': receiver }, clock, sessionId: 'session-e2e', sendTimeoutMs: 50, probeTimeoutMs: 50 });
      const submitted = await outbox.submit({ packet, destination, confirmation: createConfirmation({ packet, destination, clock, newId: () => 'e2e-1' }) });
      if (submitted.outcome !== 'attempted') throw new Error(`Expected an attempt, got ${JSON.stringify(submitted)}`);
      expect(submitted.attempt.state).toBe('accepted');
      const dispatchId: DispatchId = submitted.dispatchId;

      // submitting (rev 1) -> accepted (rev 2) is a real revision CAS in the store.
      const record = await outboxStore.get(dispatchId);
      expect(record?.revision).toBe(2);
      expect(await outboxStore.put(record!.record, 1)).toMatchObject({ ok: false, reason: 'conflict', current: { revision: 2 } });
      expect(await outboxStore.put(record!.record, null)).toMatchObject({ ok: false, reason: 'conflict' });

      const receipt = receiver.receiptFor(submitted.attempt.idempotencyKey)!;
      const result = JSON.parse(JSON.stringify(syntheticEvidence({ dispatchId, attemptId: submitted.attempt.attemptId, receipt, packet, model: destination.model ?? null }))) as ResultEvidence;
      const intake = await intakeEvidence({ outbox: outboxStore, evidence: evidenceStore, clock }, result);
      expect(intake).toMatchObject({ ok: true, duplicate: false });
      expect(await intakeEvidence({ outbox: outboxStore, evidence: evidenceStore, clock }, result)).toMatchObject({ ok: true, duplicate: true });

      const window = await e2e.reopen();
      const reopened = window.workspace.closure;
      expect((await reopened.outboxStore.list()).map((item) => [item.record.dispatchId, item.revision, item.record.attempts.at(-1)?.state])).toEqual([[dispatchId, 2, 'accepted']]);
      expect((await reopened.evidenceStore.listByDispatch(dispatchId)).map((entry) => entry.evidence.evidenceId)).toEqual([result.evidenceId]);
      expect((await reopened.evidenceStore.get(result.evidenceId))?.digest).toBe(intake.ok ? intake.entry.digest : undefined);
      // The host allows exactly two connector roots, so each is listed on its own.
      expect(await window.records.listDocuments('design/connector/outbox/')).toEqual([`design/connector/outbox/${dispatchId}`]);
      expect(await window.records.listDocuments('design/connector/evidence/')).toEqual([`design/connector/evidence/${dispatchId}/${result.evidenceId}`]);
    });
  });
});

describe('Discovery cache', () => {
  it('writes and reads the exact catalog key through cache.put and cache.get, and the discovery adapter sees it after reopen', async () => {
    await withDesignE2E(async (e2e) => {
      const discovery = await e2e.window.workspace.discoveryEnv();
      // With no selected folder, discovery clears the cache on open: that is already one cache.put.
      expect(e2e.window.transport.calls.filter((call) => call.route === 'cache.put').map((call) => call.outcome)).toEqual(['replied']);
      const text = serializeCatalogCache(EMPTY_CATALOG, isoTime('2026-01-01T00:00:00.000Z'));
      await discovery.cache.writeDocument(CATALOG_CACHE_KEY, text);
      expect(await discovery.cache.readDocument(CATALOG_CACHE_KEY)).toBe(text);
      const document = await e2e.window.transport.call('cache.get', { key: CATALOG_CACHE_KEY });
      expect(document).toMatchObject({ ok: true, value: { namespace: 'cache', key: CATALOG_CACHE_KEY, revision: 2, value: { format: TEXT_FORMAT, text } } });

      const window = await e2e.reopen();
      const again = await window.workspace.discoveryEnv();
      expect(await again.cache.readDocument(CATALOG_CACHE_KEY)).toBeTruthy();
      expect(await window.transport.call('cache.get', { key: CATALOG_CACHE_KEY })).toMatchObject({ ok: true, value: { key: CATALOG_CACHE_KEY, value: { format: TEXT_FORMAT } } });
    });
  });
});

describe('Taste journal', () => {
  it('round-trips the exact journal key with create-only then CAS writes, across reopen', async () => {
    await withDesignE2E(async (e2e) => {
      expect(TASTE_JOURNAL_KEY).toBe('design/taste/journal.v1');
      expect(await e2e.window.records.getDocument(TASTE_JOURNAL_KEY)).toBeNull();
      const created = await e2e.window.records.putDocument(TASTE_JOURNAL_KEY, { entries: [{ id: 'entry-1' }] }, { expectedRevision: null });
      expect(created.revision).toBe(1);
      const window = await e2e.reopen();
      expect(await window.records.getDocument(TASTE_JOURNAL_KEY)).toEqual(created);
      const updated = await window.records.putDocument(TASTE_JOURNAL_KEY, { entries: [{ id: 'entry-1' }, { id: 'entry-2' }] }, { expectedRevision: 1 });
      expect(updated.revision).toBe(2);
      expect((await window.records.getDocument(TASTE_JOURNAL_KEY))?.value).toEqual({ entries: [{ id: 'entry-1' }, { id: 'entry-2' }] });
    });
  });
});
