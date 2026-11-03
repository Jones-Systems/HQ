/**
 * `hq.design.comparison/v1` layout document. Strict: unknown fields, malformed
 * IDs and moving version aliases are rejected; a future version is reported so
 * the caller can open read-only without writing.
 */
import type { ScrollPosition } from './contract.ts';
import { parseCaptureId, parseComparisonId, parsePanelId, parseProjectId, parseVersionId } from './ids.ts';
import { MAX_PANEL_WIDTH, MIN_PANEL_WIDTH } from './geometry.ts';
import { MAX_PANELS, PANEL_ROLES, type ComparisonState, type Panel, type PanelRole, type PanelSource } from './model.ts';
import { parseViewport, presetById, sameViewport } from './presets.ts';

export const COMPARISON_SCHEMA = 'hq.design.comparison/v1';
export const comparisonKey = (id: string): string => `compare/${encodeURIComponent(id)}`;

export type ParseResult =
  | { readonly status: 'ok'; readonly state: ComparisonState }
  | { readonly status: 'unsupported-version'; readonly schema: string }
  | { readonly status: 'invalid' };

type Json = Record<string, unknown>;

function record(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value: Json, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && own.every((key) => keys.includes(key));
}

function text(value: unknown, max = 2048): value is string {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value);
}

const DIGEST = /^sha256:[0-9a-f]{64}$/u;

function parseSource(value: unknown): PanelSource | null {
  if (!record(value)) return null;
  const versionId = parseVersionId(value.versionId);
  if (versionId === null) return null;
  if (value.kind === 'static-capture' && exactKeys(value, ['kind', 'versionId', 'captureId', 'captureDigest'])) {
    const captureId = parseCaptureId(value.captureId);
    if (captureId === null || typeof value.captureDigest !== 'string' || !DIGEST.test(value.captureDigest)) return null;
    return { kind: 'static-capture', versionId, captureId, captureDigest: value.captureDigest };
  }
  if (value.kind === 'live-preview' && exactKeys(value, ['kind', 'versionId', 'route', 'state'])
    && text(value.route) && text(value.state)) {
    return { kind: 'live-preview', versionId, route: value.route, state: value.state };
  }
  return null;
}

function parseScroll(value: unknown): ScrollPosition | null {
  if (!record(value) || !exactKeys(value, ['x', 'y'])) return null;
  const axis = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  return axis(value.x) && axis(value.y) ? { x: value.x, y: value.y } : null;
}

function parsePanel(value: unknown): Panel | null {
  if (!record(value) || !exactKeys(value, ['id', 'role', 'source', 'viewport', 'presetId', 'width', 'scroll'])) return null;
  const id = parsePanelId(value.id);
  const source = parseSource(value.source);
  const viewport = parseViewport(value.viewport);
  const scroll = parseScroll(value.scroll);
  const role = PANEL_ROLES.find((item) => item === value.role);
  const width = value.width;
  if (id === null || source === null || viewport === null || scroll === null || role === undefined
    || !Number.isInteger(width) || (width as number) < MIN_PANEL_WIDTH || (width as number) > MAX_PANEL_WIDTH) return null;
  let presetId: string | null = null;
  if (value.presetId !== null) {
    const preset = typeof value.presetId === 'string' ? presetById(value.presetId) : null;
    if (preset === null || !sameViewport(preset.viewport, viewport)) return null;
    presetId = preset.id;
  }
  return { id, role: role as PanelRole, source, viewport, presetId, width: width as number, scroll };
}

export function parseComparison(raw: string): ParseResult {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { status: 'invalid' }; }
  if (!record(value)) return { status: 'invalid' };
  if (value.schema !== COMPARISON_SCHEMA) {
    return typeof value.schema === 'string' && /^hq\.design\.comparison\/v\d+$/u.test(value.schema)
      ? { status: 'unsupported-version', schema: value.schema } : { status: 'invalid' };
  }
  if (!exactKeys(value, ['schema', 'id', 'projectId', 'panels', 'syncScroll'])) return { status: 'invalid' };
  const id = parseComparisonId(value.id);
  const projectId = parseProjectId(value.projectId);
  if (id === null || projectId === null || typeof value.syncScroll !== 'boolean'
    || !Array.isArray(value.panels) || value.panels.length === 0 || value.panels.length > MAX_PANELS) return { status: 'invalid' };
  const panels: Panel[] = [];
  for (const item of value.panels) {
    const panel = parsePanel(item);
    if (panel === null || panels.some((other) => other.id === panel.id)) return { status: 'invalid' };
    panels.push(panel);
  }
  if (panels.filter((panel) => panel.role === 'baseline').length > 1) return { status: 'invalid' };
  return { status: 'ok', state: { version: 1, id, projectId, panels, syncScroll: value.syncScroll } };
}

/** Deterministic field order so an unchanged layout serializes byte-identically. */
export function serializeComparison(state: ComparisonState): string {
  return JSON.stringify({
    schema: COMPARISON_SCHEMA, id: state.id, projectId: state.projectId,
    panels: state.panels.map((panel) => ({
      id: panel.id, role: panel.role,
      source: panel.source.kind === 'static-capture'
        ? { kind: panel.source.kind, versionId: panel.source.versionId, captureId: panel.source.captureId, captureDigest: panel.source.captureDigest }
        : { kind: panel.source.kind, versionId: panel.source.versionId, route: panel.source.route, state: panel.source.state },
      viewport: { w: panel.viewport.w, h: panel.viewport.h, dpr: panel.viewport.dpr },
      presetId: panel.presetId, width: panel.width, scroll: { x: panel.scroll.x, y: panel.scroll.y },
    })),
    syncScroll: state.syncScroll,
  });
}
