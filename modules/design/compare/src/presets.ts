import type { Viewport } from './contract.ts';

export interface ViewportPreset {
  readonly id: string;
  readonly label: string;
  readonly group: 'phone' | 'tablet' | 'laptop' | 'desktop';
  readonly viewport: Viewport;
}

/** Generic device classes; sizes are CSS pixels. Not a claim about any real device runtime. */
const PRESETS: readonly ViewportPreset[] = [
  { id: 'phone-compact', label: 'Phone compact', group: 'phone', viewport: { w: 375, h: 667, dpr: 2 } },
  { id: 'phone', label: 'Phone', group: 'phone', viewport: { w: 390, h: 844, dpr: 3 } },
  { id: 'phone-large', label: 'Phone large', group: 'phone', viewport: { w: 430, h: 932, dpr: 3 } },
  { id: 'tablet-portrait', label: 'Tablet portrait', group: 'tablet', viewport: { w: 820, h: 1180, dpr: 2 } },
  { id: 'tablet-landscape', label: 'Tablet landscape', group: 'tablet', viewport: { w: 1180, h: 820, dpr: 2 } },
  { id: 'laptop', label: 'Laptop', group: 'laptop', viewport: { w: 1440, h: 900, dpr: 2 } },
  { id: 'desktop', label: 'Desktop', group: 'desktop', viewport: { w: 1920, h: 1080, dpr: 1 } },
];
export const VIEWPORT_PRESETS: readonly ViewportPreset[] = Object.freeze(
  PRESETS.map((preset) => Object.freeze({ ...preset, viewport: Object.freeze({ ...preset.viewport }) })));

export const MAX_VIEWPORT_EDGE = 10_000;
export const MAX_DPR = 8;

export function parseViewport(value: unknown): Viewport | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { w, h, dpr, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  const edge = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= MAX_VIEWPORT_EDGE;
  if (!edge(w) || !edge(h) || typeof dpr !== 'number' || !Number.isFinite(dpr) || dpr <= 0 || dpr > MAX_DPR) return null;
  return { w, h, dpr };
}

export function sameViewport(a: Viewport, b: Viewport): boolean {
  return a.w === b.w && a.h === b.h && a.dpr === b.dpr;
}

export function presetById(id: string): ViewportPreset | null {
  return VIEWPORT_PRESETS.find((preset) => preset.id === id) ?? null;
}

/** The preset that exactly matches, if any. A near match is a custom viewport. */
export function presetFor(viewport: Viewport): ViewportPreset | null {
  return VIEWPORT_PRESETS.find((preset) => sameViewport(preset.viewport, viewport)) ?? null;
}

export function describeViewport(viewport: Viewport): string {
  return `${viewport.w} × ${viewport.h} @${viewport.dpr}x`;
}
