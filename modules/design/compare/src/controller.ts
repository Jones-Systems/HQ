/**
 * Framework-free comparison controller. Owns runtime resolution of each panel's
 * pinned source through injected ports, with stale-result fencing: a result for
 * a source or viewport that is no longer current is discarded (sessions closed).
 */
import type {
  CaptureImagePort, CompareStoragePort, ContentSize, PreviewCapability, PreviewQualification,
  PreviewSession, ScrollPosition, StaticCapture, VersionCatalogPort, VersionSummary, ViewSummary,
} from './contract.ts';
import { panelId as toPanelId, type ComparisonId, type PanelId, type VersionId, type ViewId } from './ids.ts';
import * as model from './model.ts';
import type { CompareError, ComparisonState, ContentMetrics, Outcome, Panel, PanelRole, PanelSource } from './model.ts';
import { comparisonKey, parseComparison, serializeComparison } from './persist.ts';
import { presetById, sameViewport } from './presets.ts';

export type PanelStatus = 'loading' | 'ready' | 'failed' | 'unavailable' | 'stale';

export interface PanelRuntime {
  readonly status: PanelStatus;
  readonly version: VersionSummary | null;
  readonly capture: StaticCapture | null;
  readonly imageSrc: string | null;
  readonly session: PreviewSession | null;
  /** Effective live qualification: qualified only if capability and session both say so. */
  readonly qualification: PreviewQualification | null;
  readonly contentSize: ContentSize | null;
  readonly error: string | null;
}

export type ControllerError = CompareError | 'unknown-version' | 'save-failed' | 'disposed';

/** What the catalog offers for this project, read on demand by `loadCatalog`. Never read for a pinned panel. */
export interface CatalogState {
  readonly status: 'idle' | 'loading' | 'ready' | 'failed';
  readonly views: readonly ViewSummary[];
}

export interface CompareSnapshot {
  readonly comparison: ComparisonState;
  readonly runtime: ReadonlyMap<PanelId, PanelRuntime>;
  readonly versions: ReadonlyMap<ViewId, readonly VersionSummary[]>;
  readonly catalog: CatalogState;
  readonly preview: { readonly qualification: PreviewQualification; readonly label: string } | null;
  readonly dirty: boolean;
  readonly lastError: ControllerError | null;
}

export interface CompareDeps {
  readonly catalog: VersionCatalogPort;
  readonly preview?: PreviewCapability | null;
  readonly captures?: CaptureImagePort | null;
  readonly storage?: CompareStoragePort | null;
}

export interface CompareController {
  getSnapshot(): CompareSnapshot;
  subscribe(listener: () => void): () => void;
  /** Host notifications are fenced to the currently resolved session. Stale stays held until reopened. */
  markPreviewStale(id: PanelId, sessionId: string): void;
  resize(id: PanelId, width: number): void;
  scroll(id: PanelId, position: ScrollPosition): void;
  setSyncScroll(enabled: boolean, leaderId: PanelId | null): void;
  setRole(id: PanelId, role: PanelRole): void;
  applyPreset(id: PanelId, presetId: string): void;
  matchViewports(leaderId: PanelId): readonly PanelId[];
  /** Binds an exact VersionId; resolves it through the catalog, never by recency. */
  selectVersion(id: PanelId, versionId: VersionId, mode?: PanelSource['kind']): Promise<void>;
  addPanel(fromId: PanelId): void;
  removePanel(id: PanelId): void;
  movePanel(id: PanelId, toIndex: number): void;
  /** Clears the last error so a notice about it can be dismissed. Changes nothing else. */
  dismissError(): void;
  /**
   * Lists the project's views and their versions so a panel can be added for any of them. It only fills
   * `snapshot.catalog` and `snapshot.versions`; it never changes a pinned panel. Safe to call repeatedly.
   */
  loadCatalog(): Promise<void>;
  /** Adds a panel pinned to an exact version: its static capture when it has one, else a live preview. */
  addVersionPanel(versionId: VersionId, mode?: PanelSource['kind']): Promise<void>;
  save(): Promise<boolean>;
  dispose(): void;
}

const LOADING: PanelRuntime = Object.freeze({
  status: 'loading', version: null, capture: null, imageSrc: null, session: null, qualification: null, contentSize: null, error: null,
});

function runtimeKey(panel: Panel): string {
  const { source } = panel;
  return source.kind === 'static-capture'
    ? `s|${source.versionId}|${source.captureId}|${source.captureDigest}`
    : `l|${source.versionId}|${source.route}|${source.state}|${panel.viewport.w}x${panel.viewport.h}@${panel.viewport.dpr}`;
}

interface Resolution {
  readonly key: string;
  readonly abort: AbortController;
  session: PreviewSession | null;
}

export type LoadResult =
  | { readonly status: 'ok'; readonly state: ComparisonState }
  | { readonly status: 'missing' | 'invalid' }
  | { readonly status: 'unsupported-version'; readonly schema: string };

/** Reads a saved layout. Never writes, repairs or migrates; a future schema is reported, not opened. */
export async function loadComparison(storage: CompareStoragePort, id: ComparisonId): Promise<LoadResult> {
  const raw = await storage.read(comparisonKey(id));
  if (raw === null) return { status: 'missing' };
  const parsed = parseComparison(raw);
  if (parsed.status === 'ok' && parsed.state.id !== id) return { status: 'invalid' };
  return parsed;
}

export function createCompareController(initial: ComparisonState, deps: CompareDeps): CompareController {
  const listeners = new Set<() => void>();
  const resolutions = new Map<PanelId, Resolution>();
  let disposed = false;
  let revision = 0;
  let savedRevision = 0;
  let saving: Promise<boolean> = Promise.resolve(true);
  const preview = deps.preview ?? null;
  let snapshot: CompareSnapshot = {
    comparison: initial, runtime: new Map(), versions: new Map(), catalog: { status: 'idle', views: [] },
    preview: preview === null ? null : { qualification: preview.qualification, label: preview.label },
    dirty: false, lastError: null,
  };

  const emit = (next: CompareSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const setRuntime = (id: PanelId, resolution: Resolution, runtime: PanelRuntime) => {
    if (disposed || resolutions.get(id) !== resolution) return false;
    const map = new Map(snapshot.runtime);
    map.set(id, runtime);
    emit({ ...snapshot, runtime: map });
    return true;
  };

  const metrics = (): ContentMetrics => {
    const map = new Map<PanelId, ContentSize>();
    for (const [id, runtime] of snapshot.runtime) if (runtime.contentSize !== null) map.set(id, runtime.contentSize);
    return map;
  };

  const loadVersions = async (viewId: ViewId) => {
    if (snapshot.versions.has(viewId)) return;
    try {
      const list = await deps.catalog.listVersions(viewId);
      if (disposed || snapshot.versions.has(viewId)) return;
      const versions = new Map(snapshot.versions);
      versions.set(viewId, list);
      emit({ ...snapshot, versions });
    } catch { /* Choices stay unavailable; the pinned panel is unaffected. */ }
  };

  let catalogLoad: Promise<void> | null = null;
  const loadCatalog = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    if (catalogLoad !== null) return catalogLoad;
    if (snapshot.catalog.status === 'ready') return Promise.resolve();
    emit({ ...snapshot, catalog: { status: 'loading', views: snapshot.catalog.views } });
    catalogLoad = (async () => {
      let views: readonly ViewSummary[] = [];
      let status: CatalogState['status'] = 'ready';
      const loaded = new Map<ViewId, readonly VersionSummary[]>();
      try {
        views = await deps.catalog.listViews(snapshot.comparison.projectId);
        for (const view of views) loaded.set(view.viewId, await deps.catalog.listVersions(view.viewId));
      } catch { status = 'failed'; }
      catalogLoad = null;
      if (disposed) return;
      const versions = new Map(snapshot.versions);
      for (const [id, list] of loaded) versions.set(id, list);
      emit({ ...snapshot, versions, catalog: { status, views } });
    })();
    return catalogLoad;
  };

  const failed = (version: VersionSummary | null, error: string): PanelRuntime => ({ ...LOADING, status: 'failed', version, error });

  const resolve = async (panel: Panel, resolution: Resolution) => {
    const { signal } = resolution.abort;
    const source = panel.source;
    let version: VersionSummary | null;
    try { version = await deps.catalog.getVersion(source.versionId, signal); }
    catch { setRuntime(panel.id, resolution, failed(null, 'Version lookup failed.')); return; }
    if (signal.aborted) return;
    if (version === null || version.versionId !== source.versionId) {
      setRuntime(panel.id, resolution, failed(null, `Version ${source.versionId} is not available.`));
      return;
    }
    void loadVersions(version.viewId);
    if (source.kind === 'static-capture') {
      const capture = version.captures.find((item) => item.captureId === source.captureId) ?? null;
      if (capture === null || capture.captureDigest !== source.captureDigest || capture.versionId !== source.versionId) {
        setRuntime(panel.id, resolution, failed(version, 'The pinned capture is not available for this version; nothing is substituted.'));
        return;
      }
      const base: PanelRuntime = { ...LOADING, version, capture, contentSize: capture.contentSize };
      if (deps.captures == null) { setRuntime(panel.id, resolution, { ...base, status: 'unavailable', error: 'Capture bytes are not connected.' }); return; }
      setRuntime(panel.id, resolution, base);
      try {
        const image = await deps.captures.readCapture(capture, signal);
        if (!signal.aborted) setRuntime(panel.id, resolution, { ...base, status: 'ready', imageSrc: image.src });
      } catch {
        if (!signal.aborted) setRuntime(panel.id, resolution, { ...base, status: 'failed', error: 'Capture bytes could not be read.' });
      }
      return;
    }
    if (preview === null) {
      setRuntime(panel.id, resolution, { ...LOADING, status: 'unavailable', version, error: 'No preview capability is connected.' });
      return;
    }
    setRuntime(panel.id, resolution, { ...LOADING, version });
    let session: PreviewSession;
    try { session = await preview.open({ versionId: source.versionId, route: source.route, state: source.state, viewport: panel.viewport }, signal); }
    catch {
      if (!signal.aborted) setRuntime(panel.id, resolution, failed(version, 'Preview could not be opened.'));
      return;
    }
    if (disposed || resolutions.get(panel.id) !== resolution) { session.close(); return; }
    if (session.versionId !== source.versionId) {
      session.close();
      setRuntime(panel.id, resolution, failed(version, 'Preview returned a different version; it is not shown.'));
      return;
    }
    resolution.session = session;
    const qualification: PreviewQualification = preview.qualification === 'qualified' && session.qualification === 'qualified' ? 'qualified' : 'labelled-fake';
    setRuntime(panel.id, resolution, { ...LOADING, status: 'ready', version, session, qualification, contentSize: session.contentSize });
  };

  const release = (id: PanelId) => {
    const resolution = resolutions.get(id);
    if (resolution === undefined) return;
    resolution.abort.abort();
    resolution.session?.close();
    resolutions.delete(id);
  };

  const reconcile = () => {
    const panels = snapshot.comparison.panels;
    const live = new Set(panels.map((panel) => panel.id));
    let runtime: Map<PanelId, PanelRuntime> | null = null;
    for (const id of [...resolutions.keys()]) {
      if (live.has(id)) continue;
      release(id);
      runtime ??= new Map(snapshot.runtime);
      runtime.delete(id);
    }
    const starts: Array<[Panel, Resolution]> = [];
    for (const panel of panels) {
      const key = runtimeKey(panel);
      if (resolutions.get(panel.id)?.key === key) continue;
      release(panel.id);
      const resolution: Resolution = { key, abort: new AbortController(), session: null };
      resolutions.set(panel.id, resolution);
      runtime ??= new Map(snapshot.runtime);
      runtime.set(panel.id, LOADING);
      starts.push([panel, resolution]);
    }
    if (runtime !== null) emit({ ...snapshot, runtime });
    for (const [panel, resolution] of starts) void resolve(panel, resolution);
  };

  const commit = (outcome: Outcome) => {
    if (disposed) return;
    if (!outcome.ok) { emit({ ...snapshot, lastError: outcome.reason }); return; }
    if (outcome.state === snapshot.comparison) {
      if (snapshot.lastError !== null) emit({ ...snapshot, lastError: null });
      return;
    }
    revision += 1;
    emit({ ...snapshot, comparison: outcome.state, dirty: true, lastError: null });
    reconcile();
  };

  const nextPanelId = (): PanelId => {
    const used = new Set<string>(snapshot.comparison.panels.map((panel) => panel.id));
    let n = snapshot.comparison.panels.length + 1;
    while (used.has(`panel-${n}`)) n += 1;
    return toPanelId(`panel-${n}`);
  };

  reconcile();

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    markPreviewStale(id, sessionId) {
      const resolution = resolutions.get(id);
      const runtime = snapshot.runtime.get(id);
      if (resolution === undefined || runtime?.session?.sessionId !== sessionId || runtime.status !== 'ready') return;
      setRuntime(id, resolution, { ...runtime, status: 'stale', error: 'Stale preview session. Reopen the preview to continue.' });
    },
    resize: (id, width) => commit(model.resizePanel(snapshot.comparison, id, width)),
    scroll: (id, position) => commit(model.scrollPanel(snapshot.comparison, id, position, metrics())),
    setSyncScroll: (enabled, leaderId) => commit(model.setSyncScroll(snapshot.comparison, enabled, leaderId, metrics())),
    setRole: (id, role) => commit(model.setRole(snapshot.comparison, id, role)),
    applyPreset(id, presetId) {
      const panel = model.panelById(snapshot.comparison, id);
      const preset = presetById(presetId);
      const version = snapshot.runtime.get(id)?.version ?? null;
      if (panel?.source.kind === 'static-capture' && preset !== null && version !== null) {
        commit(model.selectCaptureAtViewport(snapshot.comparison, id, version, preset.viewport));
      } else commit(model.applyPreset(snapshot.comparison, id, presetId));
    },
    matchViewports(leaderId) {
      const outcome = model.matchViewports(snapshot.comparison, leaderId);
      commit(outcome);
      return outcome.skipped;
    },
    async selectVersion(id, versionId, mode) {
      if (model.panelById(snapshot.comparison, id) === null) { commit({ ok: false, state: snapshot.comparison, reason: 'unknown-panel' }); return; }
      let version: VersionSummary | null = null;
      try { version = await deps.catalog.getVersion(versionId); } catch { version = null; }
      if (disposed) return;
      if (version === null || version.versionId !== versionId) { emit({ ...snapshot, lastError: 'unknown-version' }); return; }
      commit(model.selectVersion(snapshot.comparison, id, version, mode));
    },
    addPanel(fromId) {
      const from = model.panelById(snapshot.comparison, fromId);
      if (from === null) { commit({ ok: false, state: snapshot.comparison, reason: 'unknown-panel' }); return; }
      commit(model.addPanel(snapshot.comparison, { id: nextPanelId(), role: 'candidate', source: from.source, viewport: from.viewport, width: from.width }));
    },
    removePanel: (id) => commit(model.removePanel(snapshot.comparison, id)),
    dismissError() { if (!disposed && snapshot.lastError !== null) emit({ ...snapshot, lastError: null }); },
    loadCatalog,
    async addVersionPanel(versionId, mode) {
      let version: VersionSummary | null = null;
      try { version = await deps.catalog.getVersion(versionId); } catch { version = null; }
      if (disposed) return;
      if (version === null || version.versionId !== versionId) { emit({ ...snapshot, lastError: 'unknown-version' }); return; }
      const panels = snapshot.comparison.panels;
      const near = panels[panels.length - 1];
      const kind = mode ?? (version.captures.length > 0 || preview === null ? 'static-capture' : 'live-preview');
      let source: PanelSource;
      let viewport = near?.viewport ?? presetById('phone')!.viewport;
      if (kind === 'live-preview') source = model.liveSource(version);
      else {
        if (version.captures.some((item) => item.versionId !== version.versionId)) { commit({ ok: false, state: snapshot.comparison, reason: 'capture-version-mismatch' }); return; }
        const capture = version.captures.find((item) => near !== undefined && sameViewport(item.viewport, near.viewport)) ?? version.captures[0];
        if (capture === undefined) { commit({ ok: false, state: snapshot.comparison, reason: 'no-capture' }); return; }
        source = model.staticSource(capture);
        viewport = capture.viewport;
      }
      const role: PanelRole = panels.some((panel) => panel.role === 'baseline') ? (panels.some((panel) => panel.role === 'candidate') ? 'reference' : 'candidate') : 'baseline';
      commit(model.addPanel(snapshot.comparison, { id: nextPanelId(), role, source, viewport, width: near?.width }));
    },
    movePanel: (id, toIndex) => commit(model.movePanel(snapshot.comparison, id, toIndex)),
    save() {
      const storage = deps.storage ?? null;
      if (disposed || storage === null) {
        emit({ ...snapshot, lastError: disposed ? 'disposed' : 'save-failed' });
        return Promise.resolve(false);
      }
      saving = saving.then(async () => {
        const at = revision;
        const body = serializeComparison(snapshot.comparison);
        try { await storage.write(comparisonKey(snapshot.comparison.id), body); }
        catch { if (!disposed) emit({ ...snapshot, lastError: 'save-failed' }); return false; }
        savedRevision = Math.max(savedRevision, at);
        if (!disposed) emit({ ...snapshot, dirty: revision !== savedRevision, lastError: null });
        return true;
      });
      return saving;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const id of [...resolutions.keys()]) release(id);
      listeners.clear();
    },
  };
}
