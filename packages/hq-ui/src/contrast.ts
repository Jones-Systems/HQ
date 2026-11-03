/**
 * WCAG 2.x contrast for the T2 token source (`tokens/hq-tokens.json`). This mirrors T2's
 * `tools/hq_tokens.py` at f3c1daff: `role@base` composites a translucent role over an opaque base, and a
 * foreground without `@` is composited over its background so translucent text is measured as rendered.
 */

export type ColorMode = 'light' | 'dark';
export const COLOR_MODES: readonly ColorMode[] = ['light', 'dark'];

/** The part of `hq-tokens.json` the contrast check reads. */
export interface ContrastTokenSource {
  readonly color: Readonly<Record<string, Readonly<Record<ColorMode, string>>>>;
  readonly contrast: readonly { readonly fg: string; readonly on: readonly string[]; readonly min: number }[];
}

/** Opaque or translucent sRGB colour: channels 0–255, alpha 0–1. */
export type Rgba = readonly [number, number, number, number];

export interface ContrastRow {
  readonly fg: string;
  readonly on: string;
  readonly mode: ColorMode;
  readonly ratio: number;
  readonly min: number;
  readonly pass: boolean;
}

const HEX = /^#([0-9a-fA-F]{6})$/;
const RGBA = /^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\s*\)$/;

export function parseColor(value: string): Rgba {
  const hex = HEX.exec(value);
  if (hex) {
    const h = hex[1]!;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const rgba = RGBA.exec(value);
  if (rgba) {
    const [r, g, b, a] = rgba.slice(1, 5).map(Number) as [number, number, number, number];
    if (!(a >= 0 && a <= 1) || ![r, g, b].every((c) => c >= 0 && c <= 255)) throw new Error(`colour out of range: ${value}`);
    return [r, g, b, a];
  }
  throw new Error(`unsupported colour syntax: ${value}`);
}

export function composite(top: Rgba, bottom: Rgba): Rgba {
  if (bottom[3] !== 1) throw new Error('composite base must be opaque');
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
}

export function relativeLuminance(rgb: Rgba): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const [hi, lo] = [relativeLuminance(fg), relativeLuminance(bg)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function roleColor(tokens: ContrastTokenSource, role: string, mode: ColorMode): Rgba {
  const token = tokens.color[role];
  if (!token) throw new Error(`unknown colour role ${role}`);
  return parseColor(token[mode]);
}

/** Resolve `role` or `role@base`; a translucent role must name its opaque base. */
export function resolveRole(tokens: ContrastTokenSource, expr: string, mode: ColorMode): Rgba {
  const at = expr.indexOf('@');
  const top = at === -1 ? expr : expr.slice(0, at);
  const colour = roleColor(tokens, top, mode);
  if (at !== -1) return composite(colour, resolveRole(tokens, expr.slice(at + 1), mode));
  if (colour[3] !== 1) throw new Error(`translucent role ${top} needs an explicit @base in contrast pairs`);
  return colour;
}

/** Every declared pair × background × mode, in T2's report order. */
export function contrastRows(tokens: ContrastTokenSource): ContrastRow[] {
  const rows: ContrastRow[] = [];
  for (const pair of tokens.contrast) {
    for (const on of pair.on) {
      for (const mode of COLOR_MODES) {
        const bg = resolveRole(tokens, on, mode);
        const fg = pair.fg.includes('@') ? resolveRole(tokens, pair.fg, mode) : composite(roleColor(tokens, pair.fg, mode), bg);
        const ratio = contrastRatio(fg, bg);
        rows.push({ fg: pair.fg, on, mode, ratio, min: pair.min, pass: ratio + 1e-9 >= pair.min });
      }
    }
  }
  return rows;
}
