import {
  DEFAULT_PALETTE_ID, PALETTE_IDS, PALETTE_PRESETS, PALETTE_ROLES, isPaletteHex, isPaletteId, isPaletteRole,
  paletteTokens, resolvePalette, type PaletteColors, type PaletteId, type PaletteOverrides, type PaletteRole,
} from '@hq/ui';
import type { StoragePort } from '../state';

/** Owned by this module; the appearance mode stays in `hq.appearance.v1`. */
export const PALETTE_KEY = 'hq.palette.v1';

/** Selected dark palette plus per-preset colour overrides. Only canonical `#RRGGBB` values are stored. */
export interface PaletteState {
  readonly preset: PaletteId;
  readonly overrides: Readonly<Record<PaletteId, PaletteOverrides>>;
}

const emptyOverrides = (): Record<PaletteId, PaletteOverrides> =>
  Object.fromEntries(PALETTE_IDS.map((id) => [id, {}])) as Record<PaletteId, PaletteOverrides>;

export const DEFAULT_PALETTE_STATE: PaletteState = { preset: DEFAULT_PALETTE_ID, overrides: emptyOverrides() };

/** Keeps every valid preset id, role and colour; anything else, or unreadable JSON, falls back field by field. */
export function parsePaletteState(raw: string | null): PaletteState {
  if (raw === null) return DEFAULT_PALETTE_STATE;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return DEFAULT_PALETTE_STATE; }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_PALETTE_STATE;
  const candidate = value as Record<string, unknown>;
  const overrides = emptyOverrides();
  const stored = candidate.overrides;
  if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
    for (const [id, roles] of Object.entries(stored)) {
      if (!isPaletteId(id) || typeof roles !== 'object' || roles === null || Array.isArray(roles)) continue;
      const kept: Partial<Record<PaletteRole, string>> = {};
      for (const [role, color] of Object.entries(roles)) {
        if (isPaletteRole(role) && isPaletteHex(color) && color !== PALETTE_PRESETS[id].colors[role]) kept[role] = color;
      }
      overrides[id] = kept;
    }
  }
  return { preset: isPaletteId(candidate.preset) ? candidate.preset : DEFAULT_PALETTE_ID, overrides };
}

export function readPaletteState(storage: StoragePort): PaletteState {
  try { return parsePaletteState(storage.getItem(PALETTE_KEY)); } catch { return DEFAULT_PALETTE_STATE; }
}

export function serializePaletteState(state: PaletteState): string {
  const overrides = Object.fromEntries(PALETTE_IDS.flatMap((id) => {
    const roles = Object.fromEntries(PALETTE_ROLES.flatMap((role) => {
      const color = state.overrides[id][role];
      return isPaletteHex(color) ? [[role, color]] : [];
    }));
    return Object.keys(roles).length > 0 ? [[id, roles]] : [];
  }));
  return JSON.stringify({ version: 1, preset: state.preset, overrides });
}

export function selectPreset(state: PaletteState, preset: PaletteId): PaletteState {
  return isPaletteId(preset) ? { ...state, preset } : state;
}

/** Sets one role on the current preset. A colour equal to the preset's own value clears the override. */
export function setPaletteColor(state: PaletteState, role: PaletteRole, color: string): PaletteState {
  if (!isPaletteRole(role) || !isPaletteHex(color)) return state;
  const current: Partial<Record<PaletteRole, string>> = { ...state.overrides[state.preset] };
  if (color === PALETTE_PRESETS[state.preset].colors[role]) delete current[role];
  else current[role] = color;
  return { ...state, overrides: { ...state.overrides, [state.preset]: current } };
}

export function resetPaletteColor(state: PaletteState, role: PaletteRole): PaletteState {
  if (!(role in state.overrides[state.preset])) return state;
  const current: Partial<Record<PaletteRole, string>> = { ...state.overrides[state.preset] };
  delete current[role];
  return { ...state, overrides: { ...state.overrides, [state.preset]: current } };
}

/** Restores the current preset's original colours; other presets' edits are kept. */
export function resetPreset(state: PaletteState): PaletteState {
  return { ...state, overrides: { ...state.overrides, [state.preset]: {} } };
}

export function activeColors(state: PaletteState, preset: PaletteId = state.preset): PaletteColors {
  return resolvePalette(preset, state.overrides[preset]);
}

export function isEdited(state: PaletteState, preset: PaletteId): boolean {
  return Object.keys(state.overrides[preset]).length > 0;
}

/** Inline colour roles written by the last `applyPalette`, so switching to light removes exactly those. */
const applied = new WeakMap<HTMLElement, readonly string[]>();

/**
 * Sets the palette's `--hq-*` colour roles on `root` through CSSOM, or removes them when `colors` is null
 * (light mode keeps the generated light tokens). Only colour roles are written; artwork invariants, radius and
 * every other token stay as generated.
 */
export function applyPalette(root: HTMLElement, colors: PaletteColors | null): void {
  for (const name of applied.get(root) ?? []) root.style.removeProperty(name);
  if (!colors) { applied.delete(root); return; }
  const tokens = Object.entries(paletteTokens(colors));
  for (const [name, value] of tokens) root.style.setProperty(name, value!);
  applied.set(root, tokens.map(([name]) => name));
}
