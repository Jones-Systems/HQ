/**
 * Dark chrome palettes. Every preset shares one control geometry and selection treatment (the Warm Graphite
 * styling in `components/hq-ui.css`); presets differ only in colour. A palette is a map of editable roles to
 * opaque `#RRGGBB` values. `paletteTokens` maps those roles, plus deterministic derived tints, onto the
 * `--hq-*` colour roles so they can be applied through CSSOM. Artwork invariants are never touched.
 */
import { contrastRatio, parseColor } from './contrast';
import type { HqColorRole } from './tokens';

export const PALETTE_IDS = ['slate', 'graphite', 'harbor', 'sage'] as const;
export type PaletteId = (typeof PALETTE_IDS)[number];
export const DEFAULT_PALETTE_ID: PaletteId = 'graphite';

export const PALETTE_ROLES = [
  'canvas', 'nav', 'surface', 'raised',
  'accent', 'onAccent', 'control', 'controlBorder',
  'selected', 'selectedText',
  'text', 'muted', 'accentText',
  'sunken', 'border', 'controlHover', 'controlPressed', 'controlBorderHover', 'disabledFill', 'disabled', 'subtle',
  'accentHover', 'accentPressed', 'focus', 'success', 'warning', 'danger', 'dangerFill', 'info',
] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];
export type PaletteColors = Readonly<Record<PaletteRole, string>>;

export interface PaletteRoleInfo {
  readonly label: string;
  readonly group: 'Backgrounds' | 'Buttons and accent' | 'Selection' | 'Text' | 'More colors';
}

/** Labels for the editor. The first four groups are always shown; `More colors` is expandable. */
export const PALETTE_ROLE_INFO: Readonly<Record<PaletteRole, PaletteRoleInfo>> = {
  canvas: { label: 'Window background', group: 'Backgrounds' },
  nav: { label: 'Navigation', group: 'Backgrounds' },
  surface: { label: 'Working surface', group: 'Backgrounds' },
  raised: { label: 'Panels and cards', group: 'Backgrounds' },
  accent: { label: 'Primary button', group: 'Buttons and accent' },
  onAccent: { label: 'Primary button text', group: 'Buttons and accent' },
  control: { label: 'Secondary button', group: 'Buttons and accent' },
  controlBorder: { label: 'Control border', group: 'Buttons and accent' },
  selected: { label: 'Selected fill', group: 'Selection' },
  selectedText: { label: 'Selected text', group: 'Selection' },
  text: { label: 'Text', group: 'Text' },
  muted: { label: 'Secondary text', group: 'Text' },
  accentText: { label: 'Accent text and links', group: 'Text' },
  sunken: { label: 'Inputs and wells', group: 'More colors' },
  border: { label: 'Dividers and outlines', group: 'More colors' },
  controlHover: { label: 'Secondary button hover', group: 'More colors' },
  controlPressed: { label: 'Secondary button pressed', group: 'More colors' },
  controlBorderHover: { label: 'Control border hover', group: 'More colors' },
  disabledFill: { label: 'Disabled fill', group: 'More colors' },
  disabled: { label: 'Disabled text', group: 'More colors' },
  subtle: { label: 'Placeholders and metadata', group: 'More colors' },
  accentHover: { label: 'Primary button hover', group: 'More colors' },
  accentPressed: { label: 'Primary button pressed', group: 'More colors' },
  focus: { label: 'Focus ring', group: 'More colors' },
  success: { label: 'Success', group: 'More colors' },
  warning: { label: 'Warning', group: 'More colors' },
  danger: { label: 'Danger text', group: 'More colors' },
  dangerFill: { label: 'Destructive button', group: 'More colors' },
  info: { label: 'Information', group: 'More colors' },
};

export interface PalettePreset {
  readonly id: PaletteId;
  readonly name: string;
  readonly description: string;
  readonly colors: PaletteColors;
}

/** First-party preset values from the owner-selected theme study; contrast is checked by `test/palettes.test.ts`. */
export const PALETTE_PRESETS: Readonly<Record<PaletteId, PalettePreset>> = {
  slate: {
    id: 'slate', name: 'Slate', description: 'Neutral grey-blue with a cornflower action',
    colors: {
      canvas: '#2C3038', nav: '#30353E', surface: '#363C46', raised: '#414854',
      accent: '#86B6FF', onAccent: '#0D1D36', control: '#454D5A', controlBorder: '#8D97A6',
      selected: '#3D4C64', selectedText: '#FFFFFF',
      text: '#F3F5F8', muted: '#C9D0DA', accentText: '#A6C9FF',
      sunken: '#282C33', border: '#4E5664', controlHover: '#505968', controlPressed: '#5A6474', controlBorderHover: '#A3ACBA',
      disabledFill: '#3A404A', disabled: '#7F8794', subtle: '#B3BBC7',
      accentHover: '#A3C7FF', accentPressed: '#6FA3F2', focus: '#A6C9FF',
      success: '#7CD9A8', warning: '#F2C063', danger: '#FF9E92', dangerFill: '#C43C2C', info: '#8DBBFF',
    },
  },
  graphite: {
    id: 'graphite', name: 'Warm Graphite', description: 'Warm brown-grey with an apricot action',
    colors: {
      canvas: '#33302D', nav: '#383431', surface: '#3E3A36', raised: '#4A4540',
      accent: '#F2A27C', onAccent: '#2E1408', control: '#4E4843', controlBorder: '#9C9389',
      selected: '#614A3D', selectedText: '#FFF6EC',
      text: '#F7F2EC', muted: '#D6CCC1', accentText: '#F5B494',
      sunken: '#2E2B28', border: '#59524B', controlHover: '#5A534D', controlPressed: '#665E57', controlBorderHover: '#B3AA9F',
      disabledFill: '#433F3B', disabled: '#8A8075', subtle: '#C3B8AC',
      accentHover: '#F6B697', accentPressed: '#E48D65', focus: '#F5B494',
      success: '#9AD6A0', warning: '#EBCB6B', danger: '#FF9A8E', dangerFill: '#C43C2C', info: '#8DBBFF',
    },
  },
  harbor: {
    id: 'harbor', name: 'Harbor', description: 'Cool blue-grey with a teal action',
    colors: {
      canvas: '#273241', nav: '#2B3747', surface: '#313E4F', raised: '#3A495C',
      accent: '#5ED3C6', onAccent: '#062B27', control: '#3E4E63', controlBorder: '#8396AE',
      selected: '#2F5458', selectedText: '#F2FFFD',
      text: '#EEF4FB', muted: '#C4D2E2', accentText: '#73DDD1',
      sunken: '#232D3A', border: '#495A70', controlHover: '#485A71', controlPressed: '#53667F', controlBorderHover: '#9AACC2',
      disabledFill: '#344253', disabled: '#75859D', subtle: '#ABBBCE',
      accentHover: '#7FE0D5', accentPressed: '#47BFB2', focus: '#73DDD1',
      success: '#8FE0B0', warning: '#F0C46A', danger: '#FF9E92', dangerFill: '#C43C2C', info: '#8DBBFF',
    },
  },
  sage: {
    id: 'sage', name: 'Sage', description: 'Lighter olive-grey with a pale lime action',
    colors: {
      canvas: '#363C35', nav: '#3B4139', surface: '#41483F', raised: '#4B5348',
      accent: '#BFDB86', onAccent: '#1F2A0B', control: '#4F584C', controlBorder: '#9AA593',
      selected: '#515E3B', selectedText: '#FAFFF0',
      text: '#F3F6EE', muted: '#D1D9C8', accentText: '#C8E295',
      sunken: '#30352F', border: '#5A6356', controlHover: '#5A6456', controlPressed: '#667162', controlBorderHover: '#B0BAA8',
      disabledFill: '#454C43', disabled: '#858F7D', subtle: '#BEC8B3',
      accentHover: '#D0E8A0', accentPressed: '#AACB6D', focus: '#C8E295',
      success: '#A8DDB0', warning: '#F2C46B', danger: '#FFB1A8', dangerFill: '#C43C2C', info: '#A0C7FF',
    },
  },
};

const HEX6 = /^#[0-9A-F]{6}$/;
const HEX_INPUT = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** True only for a canonical stored value: `#RRGGBB`, upper case. */
export function isPaletteHex(value: unknown): value is string {
  return typeof value === 'string' && HEX6.test(value);
}

/** Accepts `#RGB`, `#RRGGBB`, with or without `#`, any case. Returns canonical `#RRGGBB` or null. */
export function normalizeHex(value: string): string | null {
  const match = HEX_INPUT.exec(value.trim());
  if (!match) return null;
  const digits = match[1]!.length === 3 ? [...match[1]!].map((c) => c + c).join('') : match[1]!;
  return `#${digits.toUpperCase()}`;
}

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && (PALETTE_IDS as readonly string[]).includes(value);
}

export function isPaletteRole(value: unknown): value is PaletteRole {
  return typeof value === 'string' && (PALETTE_ROLES as readonly string[]).includes(value);
}

export type PaletteOverrides = Readonly<Partial<Record<PaletteRole, string>>>;

/** Preset colours with validated overrides applied; invalid override values are ignored. */
export function resolvePalette(id: PaletteId, overrides: PaletteOverrides = {}): PaletteColors {
  const colors: Record<PaletteRole, string> = { ...PALETTE_PRESETS[id].colors };
  for (const role of PALETTE_ROLES) {
    const value = overrides[role];
    if (isPaletteHex(value)) colors[role] = value;
  }
  return colors;
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = parseColor(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/**
 * Every `--hq-*` colour role a palette sets in dark mode. Values are canonical hex or `rgba()` built here from
 * canonical hex, never user text. Derived roles: hover/pressed overlays and skeletons from text, soft tints and
 * text selection from their base colour, and the fixed scrim and danger label.
 */
export function paletteTokens(colors: PaletteColors): Readonly<Partial<Record<HqColorRole, string>>> {
  return {
    '--hq-canvas': colors.canvas, '--hq-nav': colors.nav, '--hq-surface': colors.surface,
    '--hq-surface-raised': colors.raised, '--hq-surface-overlay': colors.raised, '--hq-surface-sunken': colors.sunken,
    '--hq-surface-hover': alpha(colors.text, 0.07), '--hq-surface-pressed': alpha(colors.text, 0.12),
    '--hq-surface-selected': colors.selected,
    '--hq-border': colors.border, '--hq-border-strong': colors.border, '--hq-border-control': colors.controlBorder,
    '--hq-border-control-hover': colors.controlBorderHover,
    '--hq-control': colors.control, '--hq-control-hover': colors.controlHover, '--hq-control-pressed': colors.controlPressed,
    '--hq-control-disabled': colors.disabledFill,
    '--hq-text': colors.text, '--hq-text-muted': colors.muted, '--hq-text-subtle': colors.subtle,
    '--hq-text-disabled': colors.disabled, '--hq-text-selected': colors.selectedText,
    '--hq-accent': colors.accent, '--hq-accent-hover': colors.accentHover, '--hq-accent-pressed': colors.accentPressed,
    '--hq-accent-edge': alpha(colors.accent, 0), '--hq-on-accent': colors.onAccent, '--hq-accent-text': colors.accentText,
    '--hq-accent-strong': colors.accent, '--hq-accent-soft': alpha(colors.accent, 0.14), '--hq-focus': colors.focus,
    '--hq-selection': alpha(colors.accent, 0.3),
    '--hq-success': colors.success, '--hq-success-soft': alpha(colors.success, 0.14),
    '--hq-warning': colors.warning, '--hq-warning-soft': alpha(colors.warning, 0.14),
    '--hq-danger': colors.danger, '--hq-danger-soft': alpha(colors.danger, 0.14),
    '--hq-danger-fill': colors.dangerFill, '--hq-on-danger': '#FFFFFF',
    '--hq-info': colors.info, '--hq-info-soft': alpha(colors.info, 0.14),
    '--hq-skeleton': alpha(colors.text, 0.07), '--hq-skeleton-sheen': alpha(colors.text, 0.12),
    '--hq-scrim': 'rgba(0, 0, 0, 0.5)',
  };
}

export interface PaletteContrastPair {
  readonly fg: PaletteRole | 'white';
  readonly on: readonly PaletteRole[];
  readonly min: 4.5 | 3;
}

/** Pairs measured for each palette. Disabled colours and decorative dividers are intentionally exempt. */
export const PALETTE_CONTRAST_PAIRS: readonly PaletteContrastPair[] = [
  { fg: 'text', on: ['canvas', 'nav', 'surface', 'raised', 'sunken', 'control', 'controlHover', 'controlPressed'], min: 4.5 },
  { fg: 'muted', on: ['canvas', 'nav', 'surface', 'raised', 'sunken', 'control', 'selected'], min: 4.5 },
  { fg: 'subtle', on: ['surface', 'raised', 'sunken'], min: 4.5 },
  { fg: 'accentText', on: ['nav', 'surface', 'raised'], min: 4.5 },
  { fg: 'onAccent', on: ['accent', 'accentHover', 'accentPressed'], min: 4.5 },
  { fg: 'selectedText', on: ['selected'], min: 4.5 },
  { fg: 'success', on: ['surface', 'raised'], min: 4.5 },
  { fg: 'warning', on: ['surface', 'raised'], min: 4.5 },
  { fg: 'danger', on: ['surface', 'raised'], min: 4.5 },
  { fg: 'info', on: ['surface', 'raised'], min: 4.5 },
  { fg: 'white', on: ['dangerFill'], min: 4.5 },
  { fg: 'focus', on: ['canvas', 'nav', 'surface', 'raised'], min: 3 },
  { fg: 'controlBorder', on: ['nav', 'surface', 'raised'], min: 3 },
  { fg: 'controlBorderHover', on: ['surface', 'raised'], min: 3 },
];

export interface PaletteContrastResult {
  readonly fg: PaletteRole | 'white';
  readonly on: PaletteRole;
  readonly ratio: number;
  readonly min: number;
  readonly pass: boolean;
}

export function paletteContrast(colors: PaletteColors): PaletteContrastResult[] {
  const color = (role: PaletteRole | 'white') => parseColor(role === 'white' ? '#FFFFFF' : colors[role]);
  return PALETTE_CONTRAST_PAIRS.flatMap(({ fg, on, min }) => on.map((bg) => {
    const ratio = contrastRatio(color(fg), color(bg));
    return { fg, on: bg, ratio, min, pass: ratio + 1e-9 >= min };
  }));
}

/** The weakest measured pair involving `role`, or null when the role is exempt from contrast targets. */
export function weakestContrast(colors: PaletteColors, role: PaletteRole): PaletteContrastResult | null {
  const rows = paletteContrast(colors).filter((row) => row.fg === role || row.on === role);
  if (rows.length === 0) return null;
  return rows.reduce((worst, row) => (row.ratio / row.min < worst.ratio / worst.min ? row : worst));
}
