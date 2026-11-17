import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Node } from '@oxc-project/types';
import { parseAst } from 'rolldown/parseAst';
import { expect, it } from 'vitest';
import type { PreviewViewport } from '@hq/contracts/preview';
import { pixelDigest, type CapturePixels, type CaptureReading } from './coherence';
import { acceptFullExtent, FULL_PAGE_CAPTURE_ENABLED, FULL_DEADLINE_MS, MAX_DEVICE_EDGE, MAX_DEVICE_PIXELS,
  planFullExtent, type StabilityReading } from './full-page';

const viewport: PreviewViewport = { w: 390, h: 844, dpr: 2 };
const extent = { w: 390, h: 2400 };
const initial: CaptureReading = {
  generation: 7, url: 'https://example.com/page#state', mutationCounter: 3,
  frame: { viewport, scroll: { x: 0, y: 0 } }, contentSize: extent,
  results: [{ found: true, identity: 'target', text: 'same', rects: [{ x: 1, y: 2, width: 3, height: 4 }] }],
};
const stable: StabilityReading = { windowResizeEvents: 0, visualViewportResizeEvents: 0,
  windowScrollEvents: 0, visualViewportScrollEvents: 0, runningAnimations: 0, fontsStatus: 'loaded', imagesComplete: true };
const image: CapturePixels = { bytes: new Uint8Array([1, 2, 3]), width: 780, height: 4800 };
const expected = { generation: 7, viewport, extent };
function accept(readings: [CaptureReading, CaptureReading, CaptureReading, CaptureReading] = [initial, initial, initial, initial],
  stability: [StabilityReading, StabilityReading, StabilityReading] = [stable, stable, stable],
  first = image, second = image) {
  return acceptFullExtent(readings, stability, first, second, expected);
}

it('plans only an explicit inert full-page method with the A1 finite limits', () => {
  expect(FULL_PAGE_CAPTURE_ENABLED).toBe(false);
  expect([MAX_DEVICE_EDGE, MAX_DEVICE_PIXELS, FULL_DEADLINE_MS]).toEqual([16384, 33554432, 10000]);
  const before = structuredClone(initial);
  expect(planFullExtent(initial, viewport, 1)).toEqual({
    ok: true, extent, held: { size: { width: 780, height: 4800 }, scale: 2 },
    shot: { format: 'png', fromSurface: true, captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 390, height: 2400, scale: 1 } },
  });
  expect(initial).toEqual(before);
});

it.each([1, 2, 3] as const)('holds full widget geometry without changing viewport metrics at DPR %s', dpr => {
  const view = { ...viewport, dpr }, reading = { ...initial, frame: { ...initial.frame, viewport: view } };
  for (const factor of [1, 2, 1.25]) {
    const plan = planFullExtent(reading, view, factor);
    expect(plan).toMatchObject({ ok: true, held: { size: { width: Math.round(390 * dpr / factor), height: Math.round(2400 * dpr / factor) }, scale: dpr / factor } });
    const pixels = { ...image, width: 390 * dpr, height: 2400 * dpr };
    expect(acceptFullExtent([reading, reading, reading, reading], [stable, stable, stable], pixels, pixels, { ...expected, viewport: view }).ok).toBe(true);
  }
});

const planRefusals: { reason: string; reading: CaptureReading }[] = [
  { reason: 'scroll-origin', reading: { ...initial, frame: { ...initial.frame, scroll: { x: 1, y: 0 } } } },
  { reason: 'scroll-origin', reading: { ...initial, frame: { ...initial.frame, scroll: { x: 0, y: 1 } } } },
  { reason: 'horizontal-extent', reading: { ...initial, contentSize: { w: 389, h: 2400 } } },
  { reason: 'horizontal-extent', reading: { ...initial, contentSize: { w: 391, h: 2400 } } },
  { reason: 'extent-changed', reading: { ...initial, contentSize: { w: 390, h: 843 } } },
  { reason: 'dpr', reading: { ...initial, frame: { ...initial.frame, viewport: { ...viewport, h: 845 } } } },
];
it.each(planRefusals)('refuses plan precondition $reason: $reading', ({ reading, reason }) => {
  expect(planFullExtent(reading, viewport, 1)).toEqual({ ok: false, reason });
  expect(accept([reading, reading, reading, reading])).toEqual({ ok: false, reason });
});

it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('refuses invalid extent coordinate %s', coordinate => {
  for (const contentSize of [{ w: coordinate, h: 2400 }, { w: 390, h: coordinate }]) {
    expect(planFullExtent({ ...initial, contentSize }, viewport, 1)).toEqual({ ok: false, reason: 'extent-oversize' });
  }
});

it.each([0, -1, NaN, Infinity, Number.MIN_VALUE, Number.MAX_VALUE])('refuses an unusable display factor %s', factor => {
  expect(planFullExtent(initial, viewport, factor)).toEqual({ ok: false, reason: 'dpr' });
});

it('enforces both device edges and device area inclusively before any acquisition', () => {
  for (const [w, h, dpr, ok] of [
    [2048, 16384, 1, true], [2048, 16385, 1, false], [2049, 16384, 1, false],
    [16384, 100, 1, true], [16385, 100, 1, false], [16384, 16384, 1, false],
    [1024, 8192, 2, true], [1024, 8193, 2, false], [1025, 8192, 2, false],
    [100, 5461, 3, true], [100, 5462, 3, false],
  ] as const) {
    const view = { w, h: 100, dpr }, reading = { ...initial, frame: { ...initial.frame, viewport: view }, contentSize: { w, h } };
    const plan = planFullExtent(reading, view, 1);
    if (ok) expect(plan.ok).toBe(true);
    else expect(plan).toEqual({ ok: false, reason: 'extent-oversize' });
  }
  expect(planFullExtent({ ...initial, contentSize: { w: 390, h: 844 } }, viewport, 1).ok).toBe(true);
});

const readingRefusals: { reason: string; change: (reading: CaptureReading) => CaptureReading }[] = [
  { reason: 'navigation', change: reading => ({ ...reading, generation: 8 }) },
  { reason: 'navigation', change: reading => ({ ...reading, url: 'https://example.com/other' }) },
  { reason: 'scroll', change: reading => ({ ...reading, frame: { ...reading.frame, scroll: { x: 0, y: 1 } } }) },
  { reason: 'target-changed', change: reading => ({ ...reading, results: [{ ...reading.results[0], text: 'else' }] }) },
  { reason: 'mutation', change: reading => ({ ...reading, mutationCounter: 4 }) },
  { reason: 'dpr', change: reading => ({ ...reading, frame: { ...reading.frame, viewport: { ...viewport, dpr: 1 } } }) },
  { reason: 'extent-changed', change: reading => ({ ...reading, contentSize: { w: 390, h: 2401 } }) },
];
it.each(readingRefusals)('checks $reason across held and restored readings', ({ reason, change }) => {
  for (const index of [1, 2, 3]) {
    const readings: [CaptureReading, CaptureReading, CaptureReading, CaptureReading] = [initial, initial, initial, initial];
    readings[index] = change(initial);
    expect(accept(readings)).toEqual({ ok: false, reason });
  }
});

it('binds the initial reading to the caller generation and planned extent', () => {
  expect(acceptFullExtent([initial, initial, initial, initial], [stable, stable, stable], image, image, { ...expected, generation: 8 }))
    .toEqual({ ok: false, reason: 'navigation' });
  expect(acceptFullExtent([initial, initial, initial, initial], [stable, stable, stable], image, image, { ...expected, extent: { w: 390, h: 2399 } }))
    .toEqual({ ok: false, reason: 'extent-changed' });
});

it.each([
  ['windowResizeEvents', 'layout-resized'], ['visualViewportResizeEvents', 'layout-resized'],
  ['windowScrollEvents', 'scroll'], ['visualViewportScrollEvents', 'scroll'],
] as const)('refuses even transient %s through the post-restore observation', (counter, reason) => {
  for (const index of [0, 1, 2]) {
    const observations: [StabilityReading, StabilityReading, StabilityReading] = [stable, stable, stable];
    observations[index] = { ...stable, [counter]: 1 };
    expect(accept(undefined, observations)).toEqual({ ok: false, reason });
  }
});

it.each([
  ['animating', { ...stable, runningAnimations: 1 }],
  ['fonts-pending', { ...stable, fontsStatus: 'loading' }],
  ['media-pending', { ...stable, imagesComplete: false }],
] as const)('requires readiness at R0 and R2: %s', (reason, observation) => {
  expect(accept(undefined, [observation, stable, stable])).toEqual({ ok: false, reason });
  expect(accept(undefined, [stable, observation, stable])).toEqual({ ok: false, reason });
  expect(accept(undefined, [stable, stable, observation]).ok).toBe(true);
});

it('requires exact dimensions on both shots and equal digests, returning only verified bytes', () => {
  for (const wrong of [{ ...image, width: 390 }, { ...image, height: 1688 }]) {
    expect(accept(undefined, undefined, wrong, image)).toEqual({ ok: false, reason: 'dpr' });
    expect(accept(undefined, undefined, image, wrong)).toEqual({ ok: false, reason: 'dpr' });
  }
  expect(accept(undefined, undefined, image, { ...image, bytes: new Uint8Array([3, 2, 1]) })).toEqual({ ok: false, reason: 'pixels-unstable' });
  const post = structuredClone(initial);
  expect(accept([initial, initial, initial, post])).toEqual({ ok: true, bytes: image.bytes, digest: pixelDigest(image.bytes), reading: post });
});

it('accepts the 12 MiB PNG boundary and refuses either shot one byte above it', () => {
  const boundary = { ...image, bytes: new Uint8Array(12 * 1024 * 1024) };
  const oversize = { ...image, bytes: new Uint8Array(12 * 1024 * 1024 + 1) };
  expect(accept(undefined, undefined, boundary, boundary).ok).toBe(true);
  expect(accept(undefined, undefined, oversize, boundary)).toEqual({ ok: false, reason: 'bytes-oversize' });
  expect(accept(undefined, undefined, boundary, oversize)).toEqual({ ok: false, reason: 'bytes-oversize' });
});

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const generated = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'dist-design-host', 'dist-wiki-host', 'coverage', '.cache']);
function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink() || generated.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionSources(path);
    return entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name) ? [path] : [];
  });
}
function isNode(value: unknown): value is Node {
  return value !== null && typeof value === 'object' && 'type' in value && typeof value.type === 'string';
}
function importsFullPage(source: string, path: string): boolean {
  const lang = /\.d\.[cm]?ts$/u.test(path) ? 'dts' : /\.[cm]?tsx?$/u.test(path) ? (path.endsWith('x') ? 'tsx' : 'ts') : 'jsx';
  let found = false;
  function walk(node: Node) {
    if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration' || node.type === 'ImportExpression') {
      if (node.source?.type === 'Literal' && typeof node.source.value === 'string'
        && /(?:^|\/)full-page(?:\.[cm]?[jt]sx?)?(?:[?#].*)?$/u.test(node.source.value)) found = true;
    }
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') {
      const argument = node.arguments[0];
      if (argument?.type === 'Literal' && typeof argument.value === 'string'
        && /(?:^|\/)full-page(?:\.[cm]?[jt]sx?)?(?:[?#].*)?$/u.test(argument.value)) found = true;
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) { for (const child of value) if (isNode(child)) walk(child); }
      else if (isNode(value)) walk(value);
    }
  }
  walk(parseAst(source, { lang, sourceType: 'unambiguous' }, path));
  return found;
}

it('keeps every production source free of full-page imports while the source capsule is unallocated to the host', () => {
  for (const source of ['import { planFullExtent } from "./full-page";', 'export * from "./full-page.js";',
    'const module = import("./full-page.ts");', 'const module = require("./full-page");']) {
    expect(importsFullPage(source, 'fixture.ts')).toBe(true);
  }
  expect(importsFullPage('const text = "./full-page"; // import "./full-page";', 'fixture.ts')).toBe(false);
  const violations: string[] = [];
  for (const path of ['apps', 'modules', 'packages'].flatMap(root => productionSources(join(repo, root)))) {
    const source = readFileSync(path, 'utf8');
    if (source.includes('full-page') && importsFullPage(source, path)) violations.push(relative(repo, path));
  }
  expect(violations).toEqual([]);
});
