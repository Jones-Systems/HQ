import { previewIdentity, rendererPreviewBookmark, type PreviewIdentity } from './preview-navigation.ts';
import type { CaptureRecord, PreviewParams, PreviewSession, PreviewValues, PreviewRect, PreviewViewport } from '@hq/contracts/preview';
import type { AgentChannelPort, AgentEvent, AgentMode, SourceFrame } from '../../annotations/src/contract.ts';
import { annotationId, versionId as annotationVersionId } from '../../annotations/src/contract.ts';
import { AnnotationController, loadAnnotations } from '../../annotations/src/controller.ts';
import { ProjectContentRepository } from '../../projects/src/repository.ts';
import { addView, addVersion, linkSource } from '../../projects/src/content.ts';
import { projectId, viewId, versionId, sourceProjectId } from '../../projects/src/ids.ts';
import { createFlowRepository } from '../../flows/src/repository.ts';
import { FLOW_SCHEMA, flowId, screenId, projectId as flowProjectId, versionId as flowVersionId, type FlowDocument } from '../../flows/src/contract.ts';
import { createProjectsStorage, createFlowsStorage, createAnnotationsStorage, type WorkspaceRecords } from '../storage/index.ts';
import type { RequestsEnvironment } from '../sections/requests/env.ts';
import { brandId } from '../../requests/src/validate.ts';
import type { DesignRuntimePorts, InteractiveCatalogItem } from './runtime-ports.ts';
import { authoringDigest } from './canonical.ts';
import { catalogProject, interactiveTarget } from './runtime-ports.ts';

export interface InteractiveSnapshot {
  readonly bookmark: PreviewIdentity | null;
  readonly items: readonly InteractiveCatalogItem[];
  readonly selected: InteractiveCatalogItem | null;
  readonly session: PreviewSession | null;
  readonly capture: CaptureRecord | null;
  readonly version: string | null;
  readonly image: string | null;
  readonly annotations: AnnotationController | null;
  readonly flow: FlowDocument | null;
  readonly busy: boolean;
  readonly held: boolean;
  readonly error: string | null;
  readonly notice: string | null;
  readonly history: readonly string[];
}

export function captureMatches(capture: CaptureRecord, session: PreviewSession): boolean {
  return capture.sessionId === session.sessionId && capture.versionId === session.versionId && capture.generation === session.generation
    && capture.route === session.route && capture.state === session.state
    && capture.viewport.w === session.viewport.w && capture.viewport.h === session.viewport.h && capture.viewport.dpr === session.viewport.dpr;
}

export function anchorMatches(frame: SourceFrame, capture: CaptureRecord | null, version: string | null): boolean {
  return capture !== null && frame.versionId === version && frame.route === capture.route && frame.state === capture.state
    && frame.viewport.w === capture.viewport.w && frame.viewport.h === capture.viewport.h && frame.viewport.dpr === capture.viewport.dpr
    && frame.captureDigest === capture.captureDigest;
}

/** One visible host session; all authoring reuses the existing durable section repositories. */
export function createInteractiveWorkspace(records: WorkspaceRecords | null, requests: RequestsEnvironment, ports: DesignRuntimePorts) {
  const listeners = new Set<() => void>();
  const agentListeners = new Set<(event: AgentEvent) => void>();
  const annotationsStore = records ? createAnnotationsStorage(records) : null;
  const repository = records ? new ProjectContentRepository(createProjectsStorage(records), requests.clock) : null;
  const flows = records ? createFlowRepository(createFlowsStorage(records)) : null;
  const bookmarkStore = ports.previewBookmark ?? rendererPreviewBookmark;
  let state: InteractiveSnapshot = { bookmark: bookmarkStore.read(), items: [], selected: null, session: null, capture: null, version: null, image: null, annotations: null, flow: null,
    busy: false, held: false, error: null, notice: null, history: [] };
  let after = 0;
  let polling = false;
  let pollDone = Promise.resolve();
  let lifecycle = 0;
  let mode: AgentMode = 'off';
  let unsubscribeAnnotations: (() => void) | undefined;
  let flowWritable = false;
  let operationHeld = false;
  const next = (kind: string) => `${kind}-${globalThis.crypto.randomUUID()}`;
  const update = (patch: Partial<InteractiveSnapshot>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  async function call<R extends keyof PreviewParams>(route: R, params: PreviewParams[R]): Promise<PreviewValues[R]> {
    if (!ports.preview) throw new Error('Live preview unavailable: the desktop preview port is not connected.');
    let result;
    try { result = await ports.preview.call(route, params); }
    catch {
      if (['open', 'capture', 'navigate', 'events'].includes(route)) {
        operationHeld = true; update({ held: true });
        throw new Error(`Preview ${route} outcome is unknown. Close the preview and reconcile before continuing.`);
      }
      throw new Error(`Preview ${route} unavailable.`);
    }
    if (!result.ok) throw new Error(`Preview ${result.kind}${result.reason ? `: ${result.reason}` : ''}`);
    return result.value;
  }
  async function action<T>(run: () => Promise<T>): Promise<T | undefined> {
    if (state.busy || operationHeld) return undefined;
    update({ busy: true, error: null, notice: null });
    try { await pollDone; return await run(); }
    catch (error) {
      const message = error instanceof Error ? error.message : 'Operation unavailable.';
      if (/unknown|unresolved/iu.test(message)) { operationHeld = true; update({ held: true }); }
      update({ error: message }); return undefined;
    }
    finally { update({ busy: false }); }
  }
  function observe(session: PreviewSession) {
    if (state.session && state.session.sessionId !== session.sessionId) throw new Error('Preview session changed. Reopen explicitly.');
    if (state.session && session.generation < state.session.generation) return;
    const location = session.route + session.state;
    const history = state.history.at(-1) === location ? state.history : [...state.history, location].slice(-100);
    update({ session, history, ...(state.capture && !captureMatches(state.capture, session) ? { capture: null, version: null, image: null } : {}) });
  }
  async function annotationsFor(id: string, frame?: SourceFrame) {
    if (!annotationsStore) throw new Error('Durable annotations unavailable.');
    const previous = state.annotations;
    if (previous?.snapshot.editor.document.versionId === id) {
      if (frame) previous.setFrame(frame);
      return previous;
    }
    const epoch = lifecycle;
    const pendingNote = previous?.snapshot.pendingNote ?? '';
    const tool = previous?.snapshot.editor.tool ?? null;
    const loaded = await loadAnnotations(annotationsStore, annotationVersionId(id));
    if (epoch !== lifecycle) return null;
    unsubscribeAnnotations?.(); previous?.dispose();
    const controller = new AnnotationController(loaded, { store: annotationsStore,
      ids: { adapter: 'real', next: () => annotationId(next('annotation')) },
      clipboard: { adapter: 'real', async writeText(text) { if (!globalThis.navigator?.clipboard) throw new Error('Clipboard unavailable.'); await globalThis.navigator.clipboard.writeText(text); } },
      ...(state.session?.pickQualified ? { agent } : {}) });
    if (frame) controller.setFrame(frame);
    controller.setPendingNote(pendingNote); controller.selectTool(tool);
    unsubscribeAnnotations = controller.subscribe(() => update({ annotations: controller }));
    update({ annotations: controller });
    return controller;
  }
  async function acceptCapture(capture: CaptureRecord) {
    const epoch = lifecycle;
    const session = state.session;
    const selected = state.selected;
    if (!session || !selected || !repository || !captureMatches(capture, session) || !/^sha256:[0-9a-f]{64}$/u.test(capture.captureDigest)) {
      throw new Error('Stale capture: its version, route, state or viewport no longer matches.');
    }
    // Host session identity stays native. Saved versions identify immutable capture frames, including empty state and scroll.
    const binding = { sourceProjectId: String(selected.entry.sourceProjectId), sourceRevision: selected.entry.revision ?? null,
      route: capture.route, state: capture.state, viewport: capture.viewport, scroll: capture.scroll, captureDigest: capture.captureDigest };
    const savedVersion = versionId(`capture-${(await authoringDigest(binding)).slice('sha256:'.length)}`);
    const project = catalogProject(selected);
    const vid = viewId(`interactive-${selected.entry.sourceProjectId}`);
    await repository.update(projectId(project.id), (content, now) => {
      if (content.versions.some((version) => version.id === savedVersion)) return content;
      let nextContent = linkSource(content, sourceProjectId(selected.entry.sourceProjectId), selected.entry.revision ?? null, now);
      if (!nextContent.views.some((view) => view.id === vid)) nextContent = addView(nextContent, { id: vid, title: project.name, kind: 'prototype' }, now);
      return addVersion(nextContent, { id: savedVersion, viewId: vid, label: `Live capture ${capture.route}`.slice(0, 300),
        origin: 'owner-created', capture: { route: capture.route + capture.state, viewport: capture.viewport, captureDigest: capture.captureDigest,
          ...(selected.entry.revision ? { sourceRevision: selected.entry.revision } : {}) } }, now);
    });
    if (epoch !== lifecycle) return false;
    if (state.annotations?.snapshot.editor.document.annotations.length) await state.annotations.save();
    if (epoch !== lifecycle) return false;
    const controller = await annotationsFor(savedVersion, { ...capture, versionId: annotationVersionId(savedVersion) });
    if (!controller || epoch !== lifecycle) return false;
    update({ capture, version: savedVersion });
    return true;
  }
  const agent: AgentChannelPort = {
    adapter: 'real',
    setMode(nextMode) {
      const changed = nextMode !== mode;
      mode = nextMode;
      // A finished action's notice would otherwise hide the new mode's instruction in the context line.
      if (changed && state.notice) update({ notice: null });
      const session = state.session;
      if (!session) return;
      // Placement and in-site navigation advance the host generation between polls. Setting a mode is
      // idempotent and sends nothing, so one stale reply re-reads the session and reapplies the mode.
      const apply = async (current: PreviewSession, retry: boolean): Promise<void> => {
        try { await call('mode', { sessionId: current.sessionId, generation: current.generation, mode: nextMode }); }
        catch (error) {
          if (!retry || !(error instanceof Error) || error.message !== 'Preview stale: navigation') throw error;
          const latest = await call('status', { sessionId: current.sessionId });
          if (mode !== nextMode || state.session?.sessionId !== current.sessionId) return;
          observe(latest);
          await apply(latest, false);
        }
      };
      void apply(session, true).catch((error: unknown) => update({ error: error instanceof Error ? error.message : 'Pick/Cite unavailable.' }));
    },
    async resolve(requests) {
      const session = state.session;
      if (!session || !state.capture || !captureMatches(state.capture, session)) throw new Error('Capture is stale. Capture this frame before resolving.');
      return call('resolve', { sessionId: session.sessionId, generation: session.generation, requests });
    },
    subscribe(listener) { agentListeners.add(listener); return () => { agentListeners.delete(listener); }; },
  };
  async function close() {
    const epoch = ++lifecycle;
    await pollDone;
    const session = state.session;
    if (session) await call('close', { sessionId: session.sessionId });
    if (epoch !== lifecycle) return;
    const controller = state.annotations;
    unsubscribeAnnotations?.(); unsubscribeAnnotations = undefined;
    update({ session: null, capture: null, version: null, image: null, annotations: null, history: [] });
    controller?.dispose(); agentListeners.clear(); mode = 'off'; after = 0;
  }
  return {
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    available: records !== null && ports.preview !== undefined,
    catalogAvailable: ports.sources !== undefined,
    selectProjectAvailable: ports.onSelectProject !== undefined,
    refresh: () => action(async () => {
      if (!ports.sources) throw new Error('Source catalogs unavailable. Connect an enrolled source in Settings.');
      const items = await ports.sources.list();
      if (state.selected) {
        const selected = items.find((item) => item.entry.sourceProjectId === state.selected?.entry.sourceProjectId && item.entry.hostId === state.selected.entry.hostId) ?? null;
        if (!selected || selected.entry.revision !== state.selected.entry.revision || JSON.stringify(selected.entry.metadata) !== JSON.stringify(state.selected.entry.metadata)
          || !interactiveTarget(selected)) await close();
        update({ selected });
      }
      update({ items });
    }),
    select: (item: InteractiveCatalogItem) => action(async () => {
      await close();
      const selected = state.items.find((candidate) => candidate.entry.sourceProjectId === item.entry.sourceProjectId && candidate.entry.hostId === item.entry.hostId);
      if (!selected) throw new Error('Source selection is stale. Refresh the catalog.');
      if (!interactiveTarget(selected)) throw new Error('This source has no available interactive presentation.');
      flowWritable = false;
      const bookmark = previewIdentity(selected);
      bookmarkStore.write(bookmark);
      update({ selected, flow: null, bookmark });
      ports.onSelectProject?.({ id: String(selected.entry.sourceProjectId), label: selected.entry.displayName, navigation: 'preserve-design' });
      const existing = await flows?.load(flowId(`interactive-${selected.entry.sourceProjectId}`));
      if (existing && existing.status !== 'ok' && existing.status !== 'missing') throw new Error('Saved interactive flow is invalid or unsupported; it was not replaced.');
      flowWritable = existing?.status === 'ok' || existing?.status === 'missing';
      update({ flow: existing?.status === 'ok' ? existing.flow : null });
    }),
    open: (viewport?: PreviewViewport) => action(async () => {
      if (!state.selected || !annotationsStore || !ports.onSelectProject) throw new Error('Select a connected source project before opening.');
      const target = interactiveTarget(state.selected);
      if (!target) throw new Error('This source has no available interactive presentation. Stills remain static references.');
      await close();
      const epoch = lifecycle;
      const id = annotationVersionId(next('version'));
      const session = await call('open', { versionId: id, url: target.url, label: state.selected.entry.displayName, viewport: viewport ?? (target.kind === 'web-prototype' ? { w: 390, h: 844, dpr: 1 } : { w: 1024, h: 720, dpr: 1 }) });
      if (epoch !== lifecycle) { await call('close', { sessionId: session.sessionId }); return; }
      if (session.versionId !== id) { await call('close', { sessionId: session.sessionId }); throw new Error('Preview returned a different version.'); }
      observe(session);
      await annotationsFor(id);
    }),
    close: () => close().catch((error: unknown) => update({ error: error instanceof Error ? error.message : 'Preview close unavailable.' })),
    deactivate: () => close().catch((error: unknown) => update({ error: error instanceof Error ? error.message : 'Preview close unavailable.' })),
    navigate: (route: string) => action(async () => {
      if (!state.session) return;
      observe(await call('navigate', { sessionId: state.session.sessionId, route }));
    }),
    back: () => action(async () => {
      if (!state.session || state.history.length < 2) return;
      const route = state.history.at(-2)!;
      update({ history: state.history.slice(0, -2) });
      observe(await call('navigate', { sessionId: state.session.sessionId, route }));
    }),
    async place(rect: PreviewRect, visible: boolean) {
      const session = state.session;
      if (!session) return;
      try { const nextSession = await call('place', { sessionId: session.sessionId, rect, visible }); if (state.session?.sessionId === session.sessionId) observe(nextSession); }
      catch (error) { update({ error: error instanceof Error ? error.message : 'Preview placement unavailable.' }); }
    },
    async poll() {
      if (polling || state.busy || !state.session) return;
      polling = true;
      const epoch = lifecycle;
      let releasePoll!: () => void;
      pollDone = new Promise<void>((resolve) => { releasePoll = resolve; });
      const sessionId = state.session.sessionId;
      try {
        const session = await call('status', { sessionId });
        if (epoch !== lifecycle || state.session?.sessionId !== sessionId) return;
        observe(session);
        if (mode === 'off' || !session.pickQualified) return;
        const batch = await call('events', { sessionId, after });
        if (epoch !== lifecycle || state.session?.sessionId !== sessionId) return;
        for (const event of batch.events) {
          if (event.sequence <= after) continue;
          after = event.sequence;
          if (event.generation !== state.session.generation || !captureMatches(event.capture, state.session)) {
            update({ notice: 'A stale pick was discarded. Pick again in the current frame.' }); continue;
          }
          if (!await acceptCapture(event.capture)) return;
          for (const listener of agentListeners) listener(event.event);
          await state.annotations?.save();
          if (state.error?.startsWith('Preview stale: mark-')) update({ error: null });
        }
        after = Math.max(after, batch.after);
      } catch (error) { update({ error: error instanceof Error ? error.message : 'Preview observation unavailable.' }); }
      finally { polling = false; releasePoll(); }
    },
    capture: () => action(async () => {
      if (!state.session) return;
      observe(await call('status', { sessionId: state.session.sessionId }));
      const session = state.session!;
      const capture = await call('capture', { sessionId: session.sessionId, expectedGeneration: session.generation });
      if (!await acceptCapture(capture)) return;
      const epoch = lifecycle;
      const image = await call('image', { captureId: capture.captureId });
      if (epoch !== lifecycle) return;
      if (!image.startsWith('data:image/png;base64,') || image.length > 24 * 1024 * 1024) throw new Error('Invalid capture image.');
      update({ image, notice: 'Coherent capture saved.' });
    }),
    saveAnnotations: () => action(async () => {
      const saved = await state.annotations?.save();
      update({ notice: saved === 'saved' ? 'Annotations saved on this device.' : 'Annotations are read-only.' });
    }),
    resolve: () => action(async () => { if (state.session) observe(await call('status', { sessionId: state.session.sessionId })); await state.annotations?.refreshResolution(); update({ notice: 'Resolution checked. Original anchors remain unchanged.' }); }),
    addScreen: () => action(async () => {
      if (state.session) observe(await call('status', { sessionId: state.session.sessionId }));
      const capture = state.capture;
      if (!flowWritable) throw new Error('Saved interactive flow is unavailable or read-only.');
      if (!capture || !state.session || !state.selected || !flows || !captureMatches(capture, state.session)) throw new Error('Capture the current frame before adding a screen.');
      // Flow state is nonempty; JSON string encoding preserves even an observed empty hash without inventing a state.
      const encodedState = JSON.stringify(capture.state);
      const screen = { id: screenId(next('screen')), title: capture.route, versionId: flowVersionId(state.version!), route: capture.route,
        state: encodedState, viewport: capture.viewport, captureDigest: capture.captureDigest };
      const current = state.flow;
      const routes = current?.routes ?? [];
      const declaration = routes.find((entry) => entry.route === capture.route);
      const nextRoutes = declaration ? routes.map((entry) => entry !== declaration || entry.states.includes(encodedState) ? entry : { ...entry, states: [...entry.states, encodedState] })
        : [...routes, { route: capture.route, states: [encodedState] }];
      const flow: FlowDocument = { schema: FLOW_SCHEMA, id: current?.id ?? flowId(`interactive-${state.selected.entry.sourceProjectId}`), projectId: flowProjectId(state.selected.entry.sourceProjectId),
        title: `${state.selected.entry.displayName} flow`, platform: 'web', start: current?.start ?? screen.id, routes: nextRoutes,
        screens: [...(current?.screens ?? []), screen], hotspots: current?.hotspots ?? [] };
      await flows.save(flow); update({ flow, notice: 'Screen saved to this project’s flow.' });
    }),
    createProposal: (intent: string) => action(async () => {
      if (state.session) observe(await call('status', { sessionId: state.session.sessionId }));
      const selected = state.selected;
      const capture = state.capture;
      const savedVersion = state.version;
      const annotations = state.annotations;
      const marks = annotations?.snapshot.editor.document.annotations ?? [];
      if (!savedVersion || !selected?.entry.revision || !capture || !state.session || !captureMatches(capture, state.session) || !intent.trim()) {
        throw new Error('A current capture, source revision and proposal are required.');
      }
      await annotations?.save();
      // Creation is local and unsent. The existing Requests/Runs pipeline alone owns freeze and explicit confirmation.
      const request = await requests.create({ title: `Changes to ${selected.entry.displayName}`, sources: [{ projectId: brandId(selected.entry.sourceProjectId),
        viewId: brandId(`interactive-${selected.entry.sourceProjectId}`), versionId: brandId(savedVersion), sourceRevision: selected.entry.revision }] });
      request.edit({ type: 'set-intent', intent: intent.trim() });
      for (const annotation of marks) {
        if (anchorMatches(annotation.anchor, capture, savedVersion)) request.edit({ type: 'add-annotation', annotation });
      }
      request.edit({ type: 'add-evidence', evidence: { evidenceId: brandId(next('capture')), kind: 'capture', label: (capture.route + capture.state).slice(0, 300), digest: capture.captureDigest, versionId: brandId(savedVersion) } });
      await request.flush();
      if (request.state.save === 'error') { operationHeld = true; update({ held: true }); throw new Error('Proposal save outcome is unresolved. Reopen Requests before creating another.'); }
      update({ notice: 'Proposal saved. Open Requests to review, freeze, and explicitly confirm a send.' });
      return request.state.requestId;
    }),
  };
}
export type InteractiveWorkspace = ReturnType<typeof createInteractiveWorkspace>;
