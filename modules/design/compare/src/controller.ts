/**
 * Framework-free comparison controller. Owns runtime resolution of each panel's
 * pinned source through injected ports, with stale-result fencing: a result for
 * a source or viewport that is no longer current is discarded (sessions closed).
 */
import type {
  CaptureImagePort, CompareStoragePort, ContentSize, PreviewCapability, PreviewQualification,
  PreviewSession, ScrollPosition, StaticCapture, VersionCatalogPort, VersionSummary,
} from './contract.ts';
import { panelId as toPanelId, type ComparisonId, type PanelId, type VersionId, type ViewId } from './ids.ts';
import * as model from './model.ts';
import type { CompareError, ComparisonState, ContentMetrics, Outcome, Panel, PanelRole, PanelSource } from './model.ts';
import { comparisonKey, parseComparison, serializeComparison } from './persist.ts';
import { presetById } from './presets.ts';

export type PanelStatus = 'loading' | 'ready' | 'failed' | 'unavailable';

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

export interface CompareSnapshot {
  readonly comparison: ComparisonState;
  readonly runtime: ReadonlyMap<PanelId, PanelRuntime>;
  readonly versions: ReadonlyMap<ViewId, readonly VersionSummary[]>;
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
    comparison: initial, runtime: new Map(), versions: new Map(),
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
