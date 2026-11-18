/**
 * Pure comparison state. Every operation returns a new state and leaves
 * untouched panels as the identical objects, so callers can assert isolation.
 */
import type { ContentSize, ScrollPosition, StaticCapture, VersionSummary, Viewport } from './contract.ts';
import type { CaptureId, ComparisonId, PanelId, ProjectId, VersionId } from './ids.ts';
import { clampScroll, clampWidth, DEFAULT_PANEL_WIDTH, mapScroll, scrollRange } from './geometry.ts';
import { presetById, presetFor, sameViewport } from './presets.ts';

/** A panel always names one exact version. There is no "latest" source kind. */
export type PanelSource =
  | { readonly kind: 'static-capture'; readonly versionId: VersionId; readonly captureId: CaptureId; readonly captureDigest: string }
  | { readonly kind: 'live-preview'; readonly versionId: VersionId; readonly route: string; readonly state: string };

/** At most one baseline; candidates and references are compared against it. */
export type PanelRole = 'baseline' | 'candidate' | 'reference';
export const PANEL_ROLES: readonly PanelRole[] = ['baseline', 'candidate', 'reference'];

export interface Panel {
  readonly id: PanelId;
  readonly role: PanelRole;
  readonly source: PanelSource;
  readonly viewport: Viewport;
  readonly presetId: string | null;
  readonly width: number;
  readonly scroll: ScrollPosition;
}

export interface ComparisonState {
  readonly version: 1;
  readonly id: ComparisonId;
  readonly projectId: ProjectId;
  readonly panels: readonly Panel[];
  readonly syncScroll: boolean;
}

export const MAX_PANELS = 12;

export type CompareError =
  | 'unknown-panel' | 'duplicate-panel' | 'too-many-panels' | 'last-panel'
  | 'static-viewport-fixed' | 'no-capture' | 'no-capture-at-viewport'
  | 'capture-version-mismatch' | 'unknown-preset';

export type Outcome =
  | { readonly ok: true; readonly state: ComparisonState }
  | { readonly ok: false; readonly state: ComparisonState; readonly reason: CompareError };

/** Runtime content extents per panel (from capture records or preview sessions). */
export type ContentMetrics = ReadonlyMap<PanelId, ContentSize>;

const ok = (state: ComparisonState): Outcome => ({ ok: true, state });
const fail = (state: ComparisonState, reason: CompareError): Outcome => ({ ok: false, state, reason });
const ORIGIN: ScrollPosition = Object.freeze({ x: 0, y: 0 });

export interface PanelInit {
  readonly id: PanelId;
  readonly role?: PanelRole;
  readonly source: PanelSource;
  readonly viewport: Viewport;
  readonly width?: number;
}

function makePanel(init: PanelInit): Panel {
  return {
    id: init.id, role: init.role ?? 'reference', source: init.source, viewport: init.viewport,
    presetId: presetFor(init.viewport)?.id ?? null, width: clampWidth(init.width ?? DEFAULT_PANEL_WIDTH), scroll: ORIGIN,
  };
}

export function staticSource(capture: StaticCapture): PanelSource {
  return { kind: 'static-capture', versionId: capture.versionId, captureId: capture.captureId, captureDigest: capture.captureDigest };
}

export function liveSource(version: VersionSummary): PanelSource {
  return { kind: 'live-preview', versionId: version.versionId, route: version.route, state: version.state };
}

export function createComparison(id: ComparisonId, projectId: ProjectId, panels: readonly PanelInit[]): ComparisonState {
  let state: ComparisonState = { version: 1, id, projectId, panels: [], syncScroll: false };
  for (const init of panels) {
    const outcome = addPanel(state, init);
    if (!outcome.ok) throw new RangeError(`Cannot create comparison: ${outcome.reason}`);
    state = outcome.state;
  }
  return state;
}

/** Baseline/candidate pair, e.g. a returned candidate against its exact source version. */
export function createBaselineCandidate(
  id: ComparisonId, projectId: ProjectId,
  baseline: Omit<PanelInit, 'role'>, candidate: Omit<PanelInit, 'role'>,
): ComparisonState {
  return createComparison(id, projectId, [{ ...baseline, role: 'baseline' }, { ...candidate, role: 'candidate' }]);
}

function indexOf(state: ComparisonState, id: PanelId): number {
  return state.panels.findIndex((panel) => panel.id === id);
}

function replacePanel(state: ComparisonState, index: number, panel: Panel): ComparisonState {
  if (state.panels[index] === panel) return state;
  const panels = state.panels.slice();
  panels[index] = panel;
  return { ...state, panels };
}

export function panelById(state: ComparisonState, id: PanelId): Panel | null {
  return state.panels.find((panel) => panel.id === id) ?? null;
}

export function addPanel(state: ComparisonState, init: PanelInit): Outcome {
  if (indexOf(state, init.id) !== -1) return fail(state, 'duplicate-panel');
  if (state.panels.length >= MAX_PANELS) return fail(state, 'too-many-panels');
  let panels = state.panels;
  if (init.role === 'baseline') panels = panels.map((panel) => (panel.role === 'baseline' ? { ...panel, role: 'reference' } : panel));
  return ok({ ...state, panels: [...panels, makePanel(init)] });
}

export function removePanel(state: ComparisonState, id: PanelId): Outcome {
  const index = indexOf(state, id);
  if (index === -1) return fail(state, 'unknown-panel');
  if (state.panels.length === 1) return fail(state, 'last-panel');
  return ok({ ...state, panels: state.panels.filter((panel) => panel.id !== id) });
}

export function movePanel(state: ComparisonState, id: PanelId, toIndex: number): Outcome {
  const index = indexOf(state, id);
  if (index === -1) return fail(state, 'unknown-panel');
  const target = Math.max(0, Math.min(state.panels.length - 1, Math.trunc(toIndex)));
  if (target === index) return ok(state);
  const panels = state.panels.slice();
  const [panel] = panels.splice(index, 1);
  panels.splice(target, 0, panel);
  return ok({ ...state, panels });
}

/** Changes exactly one panel's width. No neighbour is redistributed or reflowed. */
export function resizePanel(state: ComparisonState, id: PanelId, width: number): Outcome {
  const index = indexOf(state, id);
  if (index === -1) return fail(state, 'unknown-panel');
  const panel = state.panels[index];
  const next = clampWidth(width);
  return ok(next === panel.width ? state : replacePanel(state, index, { ...panel, width: next }));
}

export function setRole(state: ComparisonState, id: PanelId, role: PanelRole): Outcome {
  const index = indexOf(state, id);
  if (index === -1) return fail(state, 'unknown-panel');
  if (state.panels[index].role === role) return ok(state);
  // A new baseline demotes the previous one to reference rather than silently swapping roles.
  const panels = state.panels.map((panel, i) => {
    if (i === index) return { ...panel, role };
    return role === 'baseline' && panel.role === 'baseline' ? { ...panel, role: 'reference' as const } : panel;
  });
  return ok({ ...state, panels });
}

/** Viewport/preset change for a live preview. A static capture's viewport is fixed by its bytes. */
export function setViewport(state: ComparisonState, id: PanelId, viewport: Viewport): Outcome {
  const index = indexOf(state, id);
  if (index === -1) return fail(state, 'unknown-panel');
  const panel = state.panels[index];
  if (panel.source.kind === 'static-capture') return fail(state, 'static-viewport-fixed');
  if (sameViewport(panel.viewport, viewport)) return ok(state);
  return ok(replacePanel(state, index, { ...panel, viewport, presetId: presetFor(viewport)?.id ?? null, scroll: ORIGIN }));
}

export function applyPreset(state: ComparisonState, id: PanelId, presetId: string): Outcome {
  const preset = presetById(presetId);
  return preset === null ? fail(state, 'unknown-preset') : setViewport(state, id, preset.viewport);
}

/** Bind a panel to one exact static capture; its viewport becomes the capture's viewport. */
export function selectCapture(state: ComparisonState, id: PanelId, capture: StaticCapture): Outcome {
  const index = indexOf(state, id);
  if (index === -1) return fail(state, 'unknown-panel');
  const panel = state.panels[index];
  const source = staticSource(capture);
  if (panel.source.kind === 'static-capture' && panel.source.captureId === capture.captureId
    && panel.source.captureDigest === capture.captureDigest) return ok(state);
  return ok(replacePanel(state, index, {
    ...panel, source, viewport: capture.viewport, presetId: presetFor(capture.viewport)?.id ?? null, scroll: ORIGIN,
  }));
}

/**
 * Bind a panel to an exact version, keeping its source mode. In static mode the
 * capture at the panel's current viewport is preferred, else the version's first capture.
 */
export function selectVersion(state: ComparisonState, id: PanelId, version: VersionSummary, mode?: PanelSource['kind']): Outcome {
  const index = indexOf(state, id);
  if (index === -1) return fail(state, 'unknown-panel');
  const panel = state.panels[index];
  const kind = mode ?? panel.source.kind;
  if (kind === 'live-preview') {
    const source = liveSource(version);
    const current = panel.source;
    if (current.kind === 'live-preview' && source.kind === 'live-preview' && current.versionId === source.versionId
      && current.route === source.route && current.state === source.state) return ok(state);
    return ok(replacePanel(state, index, { ...panel, source, scroll: ORIGIN }));
  }
  const captures = version.captures;
  if (captures.some((capture) => capture.versionId !== version.versionId)) return fail(state, 'capture-version-mismatch');
  const capture = captures.find((item) => sameViewport(item.viewport, panel.viewport)) ?? captures[0];
  return capture === undefined ? fail(state, 'no-capture') : selectCapture(state, id, capture);
}

/** For a static panel, choose another capture of the same version at a preset viewport. */
export function selectCaptureAtViewport(state: ComparisonState, id: PanelId, version: VersionSummary, viewport: Viewport): Outcome {
  const panel = panelById(state, id);
  if (panel === null) return fail(state, 'unknown-panel');
  if (version.versionId !== panel.source.versionId) return fail(state, 'capture-version-mismatch');
  const capture = version.captures.find((item) => item.versionId === version.versionId && sameViewport(item.viewport, viewport));
  return capture === undefined ? fail(state, 'no-capture-at-viewport') : selectCapture(state, id, capture);
}

/** Apply the leader's viewport to every live panel. Static panels keep their captured viewport. */
export function matchViewports(state: ComparisonState, leaderId: PanelId): Outcome & { readonly skipped: readonly PanelId[] } {
  const leader = panelById(state, leaderId);
  if (leader === null) return { ...fail(state, 'unknown-panel'), skipped: [] };
  const skipped: PanelId[] = [];
  let next = state;
  for (const panel of state.panels) {
    if (panel.id === leaderId || sameViewport(panel.viewport, leader.viewport)) continue;
    const outcome = setViewport(next, panel.id, leader.viewport);
    if (outcome.ok) next = outcome.state;
    else skipped.push(panel.id);
  }
  return { ok: true, state: next, skipped };
}

function rangeOf(panel: Panel, metrics: ContentMetrics): ScrollPosition | null {
  const content = metrics.get(panel.id);
  return content === undefined ? null : scrollRange(content, panel.viewport);
}

function follow(state: ComparisonState, leader: Panel, metrics: ContentMetrics): ComparisonState {
  const from = rangeOf(leader, metrics);
  if (from === null) return state;
  const panels = state.panels.map((panel) => {
    if (panel.id === leader.id) return panel;
    const to = rangeOf(panel, metrics);
    if (to === null) return panel; // Content not yet known: leave it, never guess.
    const scroll = mapScroll(leader.scroll, from, to);
    return scroll.x === panel.scroll.x && scroll.y === panel.scroll.y ? panel : { ...panel, scroll };
  });
  return panels.every((panel, i) => panel === state.panels[i]) ? state : { ...state, panels };
}

/**
 * Scroll one panel. With sync on, every other panel with known content follows
 * by scroll ratio; with sync off, only this panel moves.
 */
export function scrollPanel(state: ComparisonState, id: PanelId, position: ScrollPosition, metrics: ContentMetrics): Outcome {
  const index = indexOf(state, id);
  if (index === -1) return fail(state, 'unknown-panel');
  const panel = state.panels[index];
  const range = rangeOf(panel, metrics);
  const scroll = range === null ? panel.scroll : clampScroll(position, range);
  const moved = scroll.x !== panel.scroll.x || scroll.y !== panel.scroll.y;
  if (!moved) return ok(state);
  const next = replacePanel(state, index, { ...panel, scroll });
  return ok(next.syncScroll ? follow(next, next.panels[index], metrics) : next);
}

/** Turning sync on aligns the others to the leader once; turning it off unlinks without moving anything. */
export function setSyncScroll(state: ComparisonState, enabled: boolean, leaderId: PanelId | null, metrics: ContentMetrics): Outcome {
  if (state.syncScroll === enabled) return ok(state);
  const next = { ...state, syncScroll: enabled };
  if (!enabled || leaderId === null) return ok(next);
  const leader = panelById(next, leaderId);
  return leader === null ? fail(state, 'unknown-panel') : ok(follow(next, leader, metrics));
}

export function baselineOf(state: ComparisonState): Panel | null {
  return state.panels.find((panel) => panel.role === 'baseline') ?? null;
}
