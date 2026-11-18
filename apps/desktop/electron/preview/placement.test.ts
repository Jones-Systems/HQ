import { expect, it } from 'vitest';
import { fitPlacement } from './placement';

const desktop = { w: 1024, h: 720, dpr: 1 } as const;
const phone = { w: 390, h: 844, dpr: 1 } as const;
const inside = (outer: { x: number; y: number; width: number; height: number }, inner: typeof outer) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

it('fills a height-limited placeholder with the page instead of leaving native background beside it', () => {
  // The owner's 1006×420 placeholder previously received 1006×420 bounds and a 0.583 page scale.
  const rect = { x: 120, y: 179, width: 1006, height: 420 };
  const { bounds, scale } = fitPlacement(rect, desktop);
  expect(bounds).toEqual({ x: 325, y: 179, width: 597, height: 420 });
  expect(Math.abs(bounds.width - desktop.w * scale)).toBeLessThanOrEqual(1);
  expect(Math.abs(bounds.height - desktop.h * scale)).toBeLessThanOrEqual(1);
});

it('keeps an already fitted renderer frame unchanged so DOM and native edges coincide', () => {
  for (const rect of [{ x: 40, y: 96, width: 1006, height: 707 }, { x: 0, y: 0, width: 1024, height: 720 }, { x: 8, y: 8, width: 597, height: 420 }]) {
    expect(fitPlacement(rect, desktop).bounds).toEqual(rect);
  }
  expect(fitPlacement({ x: 0, y: 0, width: 1024, height: 720 }, desktop).scale).toBe(1);
});

it.each([
  [{ x: 0, y: 0, width: 519, height: 420 }, phone],
  [{ x: 3, y: 5, width: 1100, height: 700 }, desktop],
  [{ x: 0, y: 0, width: 1280, height: 800 }, desktop],
  [{ x: 11, y: 13, width: 333, height: 999 }, desktop],
])('never extends past the requested placeholder %o', (rect, viewport) => {
  const { bounds, scale } = fitPlacement(rect, viewport);
  expect(inside(rect, bounds)).toBe(true);
  expect(viewport.w * scale).toBeLessThanOrEqual(bounds.width + 0.5);
  expect(viewport.h * scale).toBeLessThanOrEqual(bounds.height + 0.5);
});

it('converts renderer CSS pixels to window DIP using the main renderer zoom', () => {
  const zoomedOut = fitPlacement({ x: 100, y: 50, width: 1024, height: 720 }, desktop, 0.8);
  expect(zoomedOut.bounds).toEqual({ x: 80, y: 40, width: 819, height: 576 });
  expect(fitPlacement({ x: 100, y: 50, width: 1024, height: 720 }, desktop, Number.NaN).bounds).toEqual({ x: 100, y: 50, width: 1024, height: 720 });
});

it('keeps a positive emulation scale for an empty placeholder', () => {
  const { bounds, scale } = fitPlacement({ x: 0, y: 0, width: 0, height: 0 }, desktop);
  expect(bounds.width).toBe(0); expect(bounds.height).toBe(0); expect(scale).toBeGreaterThan(0);
});
