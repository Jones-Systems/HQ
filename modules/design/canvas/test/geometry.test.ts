import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ZOOM, MIN_ZOOM, ensureVisible, fitRect, panBy, screenToWorld, visibleWorld, worldToScreen, zoomAt, zoomTo,
} from '../src/geometry.ts';
import { close, rect } from './fixtures.ts';

test('zoom keeps the world point under the cursor fixed, including at the zoom limits', () => {
  const cameras = [{ x: 0, y: 0, zoom: 1 }, { x: -350.5, y: 1200.25, zoom: 0.37 }, { x: 99999, y: -4242, zoom: 7.5 }];
  const anchors = [{ x: 0, y: 0 }, { x: 512, y: 384 }, { x: 1023.5, y: 13.25 }];
  const factors = [1.1, 0.5, 3, 1 / 1.25, 1000, 0.0001];
  for (const camera of cameras) for (const anchor of anchors) for (const factor of factors) {
    const before = screenToWorld(camera, anchor);
    const next = zoomAt(camera, anchor, factor);
    const after = screenToWorld(next, anchor);
    assert.ok(close(after.x, before.x, 1e-9) && close(after.y, before.y, 1e-9), `drift for ${JSON.stringify({ camera, anchor, factor })}`);
    assert.ok(next.zoom >= MIN_ZOOM && next.zoom <= MAX_ZOOM);
    const screen = worldToScreen(next, before);
    assert.ok(close(screen.x, anchor.x, 1e-6) && close(screen.y, anchor.y, 1e-6));
  }
});

test('repeated wheel-sized zoom steps do not accumulate cursor drift', () => {
  let camera = { x: 10, y: 20, zoom: 1 };
  const anchor = { x: 300.5, y: 211.75 };
  const pinned = screenToWorld(camera, anchor);
  for (let step = 0; step < 400; step += 1) camera = zoomAt(camera, anchor, step % 3 === 0 ? 0.93 : 1.07);
  const after = screenToWorld(camera, anchor);
  assert.ok(close(after.x, pinned.x, 1e-7) && close(after.y, pinned.y, 1e-7));
});

test('zoomTo rejects non-finite zoom without moving the anchor', () => {
  const camera = { x: 5, y: 5, zoom: 2 };
  const next = zoomTo(camera, { x: 100, y: 100 }, Number.NaN);
  assert.equal(next.zoom, 1);
  assert.deepEqual(screenToWorld(next, { x: 100, y: 100 }), screenToWorld(camera, { x: 100, y: 100 }));
});

test('pan moves by screen pixels independent of zoom', () => {
  const camera = panBy({ x: 0, y: 0, zoom: 4 }, 40, -80);
  assert.deepEqual(camera, { x: 10, y: -20, zoom: 4 });
});

test('fit centers the target and never exceeds the max zoom', () => {
  const viewport = { width: 1000, height: 600 };
  const camera = fitRect(rect(100, 100, 200, 100), viewport, 50);
  assert.equal(camera.zoom, 1);
  const view = visibleWorld(camera, viewport);
  assert.ok(close(view.x + view.width / 2, 200) && close(view.y + view.height / 2, 150));
  const large = fitRect(rect(0, 0, 9000, 3000), viewport, 50);
  assert.ok(close(large.zoom, 900 / 9000));
});

test('ensureVisible pans minimally and leaves visible targets alone', () => {
  const viewport = { width: 800, height: 600 };
  const camera = { x: 0, y: 0, zoom: 1 };
  assert.equal(ensureVisible(camera, viewport, rect(100, 100, 50, 50)), camera);
  const right = ensureVisible(camera, viewport, rect(1000, 100, 100, 50), 24);
  assert.deepEqual(right, { x: 1000 + 100 + 24 - 800, y: 0, zoom: 1 });
  const left = ensureVisible({ x: 500, y: 0, zoom: 2 }, viewport, rect(400, 50, 10, 10), 24);
  assert.deepEqual(left, { x: 400 - 12, y: 0, zoom: 2 });
});
