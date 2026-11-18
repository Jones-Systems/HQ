/**
 * Runtime pixel evidence (Node). Compares two real browser screenshots of the
 * harness, one per appearance, at the same layout:
 *   node modules/design/ui/harness/pixel-evidence.ts light.png dark.png regions.json
 * regions.json: { dpr, surfaces: Rect[], chrome: Rect[] } in CSS pixels, read from
 * getBoundingClientRect in the page. Surfaces must be pixel-identical across
 * themes; every chrome region must change. Exit code 1 on any violation.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { decodePng, type DecodedPng } from './png.ts';

export interface Rect { readonly name: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface Regions { readonly dpr: number; readonly surfaces: readonly Rect[]; readonly chrome: readonly Rect[] }

export interface RegionResult { readonly name: string; readonly pixels: number; readonly differing: number }

export function compareRegion(a: DecodedPng, b: DecodedPng, rect: Rect, dpr: number, inset = 2): RegionResult {
  // Inset by a couple of device pixels to stay clear of anti-aliased edges and focus rings.
  const x0 = Math.ceil(rect.x * dpr) + inset; const y0 = Math.ceil(rect.y * dpr) + inset;
  const x1 = Math.floor((rect.x + rect.width) * dpr) - inset; const y1 = Math.floor((rect.y + rect.height) * dpr) - inset;
  let pixels = 0; let differing = 0;
  for (let y = Math.max(0, y0); y < Math.min(y1, a.height, b.height); y += 1) {
    for (let x = Math.max(0, x0); x < Math.min(x1, a.width, b.width); x += 1) {
      const i = (y * a.width + x) * 4; const j = (y * b.width + x) * 4;
      pixels += 1;
      if (a.rgba[i] !== b.rgba[j] || a.rgba[i + 1] !== b.rgba[j + 1] || a.rgba[i + 2] !== b.rgba[j + 2]) differing += 1;
    }
  }
  return { name: rect.name, pixels, differing };
}

export function evaluate(light: DecodedPng, dark: DecodedPng, regions: Regions) {
  const surfaces = regions.surfaces.map((rect) => compareRegion(light, dark, rect, regions.dpr));
  const chrome = regions.chrome.map((rect) => compareRegion(light, dark, rect, regions.dpr));
  const ok = light.width === dark.width && light.height === dark.height
    && surfaces.every((r) => r.pixels > 0 && r.differing === 0)
    && chrome.every((r) => r.pixels > 0 && r.differing / r.pixels > 0.9);
  return { ok, size: [light.width, light.height], surfaces, chrome };
}

if (import.meta.main) {
  const [lightPath, darkPath, regionsPath] = process.argv.slice(2);
  if (!lightPath || !darkPath || !regionsPath) { console.error('usage: pixel-evidence.ts light.png dark.png regions.json'); process.exit(2); }
  const read = (path: string) => decodePng(new Uint8Array(readFileSync(path)), (data) => new Uint8Array(inflateSync(data)));
  const result = evaluate(read(lightPath), read(darkPath), JSON.parse(readFileSync(regionsPath, 'utf8')) as Regions);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
