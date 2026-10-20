import { hasOnlyKeys, isPlainRecord } from './json.ts';

export const PANEL_IDS = ['sidebar', 'inspector'] as const;
export type PanelId = (typeof PANEL_IDS)[number];

export interface PanelState {
  readonly size: number;
  readonly collapsed: boolean;
}
export type PanelLayout = Readonly<Record<PanelId, PanelState>>;

export interface PanelBounds { readonly min: number; readonly max: number; readonly initial: number }
export const PANEL_BOUNDS: Readonly<Record<PanelId, PanelBounds>> = {
  sidebar: { min: 180, max: 420, initial: 240 },
  inspector: { min: 240, max: 560, initial: 300 },
};
/** The workspace (canvas, gallery…) always keeps at least this much width. */
export const MAIN_MIN = 320;
export const KEY_STEP = 16;
export const KEY_STEP_LARGE = 64;

export const DEFAULT_LAYOUT: PanelLayout = {
  sidebar: { size: PANEL_BOUNDS.sidebar.initial, collapsed: false },
  inspector: { size: PANEL_BOUNDS.inspector.initial, collapsed: false },
};

export interface ResolvedLayout {
  readonly sidebar: number;
  readonly inspector: number;
  readonly main: number;
  /** Panels hidden only because the window is too narrow; stored preference is unchanged. */
  readonly squeezed: readonly PanelId[];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const other = (panel: PanelId): PanelId => (panel === 'sidebar' ? 'inspector' : 'sidebar');

/**
 * Effective widths for a container. Narrow windows squeeze the inspector first,
 * then the sidebar, without rewriting the user's stored sizes or collapse state.
 */
export function resolveLayout(layout: PanelLayout, width: number): ResolvedLayout {
  const available = Math.max(0, width);
  const squeezed: PanelId[] = [];
  for (;;) {
    const sizes: Record<PanelId, number> = { sidebar: 0, inspector: 0 };
    for (const panel of PANEL_IDS) {
      if (!layout[panel].collapsed && !squeezed.includes(panel)) sizes[panel] = layout[panel].size;
    }
    // Shrink towards minimums (inspector first) before hiding anything.
    let overflow = sizes.sidebar + sizes.inspector + MAIN_MIN - available;
    for (const panel of ['inspector', 'sidebar'] as const) {
      if (overflow <= 0 || sizes[panel] === 0) continue;
      const reduced = Math.max(PANEL_BOUNDS[panel].min, sizes[panel] - overflow);
      overflow -= sizes[panel] - reduced;
      sizes[panel] = reduced;
    }
    const hide = overflow > 0 ? (['inspector', 'sidebar'] as const).find((panel) => sizes[panel] > 0) : undefined;
    if (hide === undefined) {
      return { sidebar: sizes.sidebar, inspector: sizes.inspector, main: Math.max(0, available - sizes.sidebar - sizes.inspector), squeezed };
    }
    squeezed.push(hide);
  }
}

/** Largest size this panel may take without pushing the workspace below MAIN_MIN. */
export function maxSize(layout: PanelLayout, panel: PanelId, width: number): number {
  const neighbour = resolveLayout(layout, width)[other(panel)];
  return clamp(width - neighbour - MAIN_MIN, PANEL_BOUNDS[panel].min, PANEL_BOUNDS[panel].max);
}

/** Change one panel's size. The other panel is never resized; the workspace absorbs the difference. */
export function setPanelSize(layout: PanelLayout, panel: PanelId, size: number, width: number): PanelLayout {
  if (!Number.isFinite(size)) return layout;
  const next = Math.round(clamp(size, PANEL_BOUNDS[panel].min, maxSize(layout, panel, width)));
  if (next === layout[panel].size && !layout[panel].collapsed) return layout;
  return { ...layout, [panel]: { size: next, collapsed: false } };
}

/** Pointer drag or keyboard step expressed as a change of panel size (positive = wider). */
export function resizePanel(layout: PanelLayout, panel: PanelId, delta: number, width: number): PanelLayout {
  return setPanelSize(layout, panel, layout[panel].size + delta, width);
}

export function togglePanel(layout: PanelLayout, panel: PanelId): PanelLayout {
  return { ...layout, [panel]: { ...layout[panel], collapsed: !layout[panel].collapsed } };
}

/**
 * Keyboard model for a splitter (WAI-ARIA window splitter). Arrow keys move
 * the visible edge: for the sidebar Right widens, for the inspector Left widens.
 * Returns null when the key is not handled.
 */
export function splitterKey(layout: PanelLayout, panel: PanelId, key: string, shift: boolean, width: number): PanelLayout | null {
  const step = shift ? KEY_STEP_LARGE : KEY_STEP;
  const direction = panel === 'sidebar' ? 1 : -1;
  switch (key) {
    case 'ArrowRight': return resizePanel(layout, panel, step * direction, width);
    case 'ArrowLeft': return resizePanel(layout, panel, -step * direction, width);
    case 'Home': return setPanelSize(layout, panel, PANEL_BOUNDS[panel].min, width);
    case 'End': return setPanelSize(layout, panel, maxSize(layout, panel, width), width);
    case 'Enter': return togglePanel(layout, panel);
    default: return null;
  }
}

function parsePanel(value: unknown, panel: PanelId): PanelState | null {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['size', 'collapsed'])) return null;
  const { size, collapsed } = value;
  if (typeof size !== 'number' || !Number.isInteger(size) || typeof collapsed !== 'boolean') return null;
  if (size < PANEL_BOUNDS[panel].min || size > PANEL_BOUNDS[panel].max) return null;
  return { size, collapsed };
}

export function parseLayout(value: unknown): PanelLayout | null {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, PANEL_IDS)) return null;
  const sidebar = parsePanel(value.sidebar, 'sidebar');
  const inspector = parsePanel(value.inspector, 'inspector');
  return sidebar && inspector ? { sidebar, inspector } : null;
}
