import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describePreviewError, fitFrame, frameFullyVisible, MIN_STAGE_HEIGHT, stageHeightBudget, STAGE_GUTTER } from '../preview-frame.ts';

const desktop = { w: 1024, h: 720 };
const phone = { w: 390, h: 844 };

test('the frame uses the available width instead of a fixed 420px height', () => {
  // The owner's panel: 1006px wide. The old fixed placeholder scaled the page to 0.583.
  const fit = fitFrame({ width: 1006, height: 760 }, desktop);
  assert.deepEqual({ width: fit.width, height: fit.height }, { width: 1006, height: 707 });
  assert.ok(fit.scale > 0.98);
});

test('widening HQ never enlarges the page past its logical viewport', () => {
  for (const width of [1280, 1600, 2400]) {
    const fit = fitFrame({ width, height: 2000 }, desktop);
    assert.deepEqual({ width: fit.width, height: fit.height, scale: fit.scale }, { width: 1024, height: 720, scale: 1 });
  }
});

test('short scrollports letterbox by height and tall phones stay inside the stage', () => {
  const short = fitFrame({ width: 1006, height: 420 }, desktop);
  assert.deepEqual({ width: short.width, height: short.height }, { width: 597, height: 420 });
  const tall = fitFrame({ width: 900, height: 600 }, phone);
  assert.ok(tall.width <= 900 && tall.height <= 600);
  assert.equal(tall.height, 600);
  for (const [width, height] of [[333.7, 241.2], [1, 1], [0, 500], [5000, 3]]) {
    const fit = fitFrame({ width, height }, desktop);
    assert.ok(fit.width <= Math.floor(width) && fit.height <= Math.floor(height), `${width}×${height}`);
  }
});

test('the stage budget fits controls, frame and caption in one scrollport, with a floor', () => {
  assert.equal(stageHeightBudget(900, 120, 30), 900 - 120 - 30 - 2 * STAGE_GUTTER);
  assert.equal(stageHeightBudget(300, 120, 30), MIN_STAGE_HEIGHT);
});

test('the native view shows only while the whole frame is inside the window and the scrollport', () => {
  const windowBox = { x: 0, y: 0, width: 1400, height: 900 };
  const scrollport = { x: 240, y: 88, width: 1100, height: 800 };
  const frame = { x: 264, y: 200, width: 1006, height: 600 };
  assert.equal(frameFullyVisible(frame, [windowBox, scrollport]), true);
  assert.equal(frameFullyVisible({ ...frame, y: 80 }, [windowBox, scrollport]), false, 'under HQ chrome above the scrollport');
  assert.equal(frameFullyVisible({ ...frame, y: 300 }, [windowBox, scrollport]), false, 'past the bottom of the scrollport');
  assert.equal(frameFullyVisible({ ...frame, y: 87.6 + 0.1 }, [windowBox, { ...scrollport, y: 88 }]), true, 'sub-pixel layout');
  assert.equal(frameFullyVisible({ ...frame, width: 0 }, [windowBox]), false);
});

test('transport failures read as actions; unknown text is preserved', () => {
  assert.match(describePreviewError('Preview stale: navigation'), /page changed/u);
  assert.match(describePreviewError('Preview stale: pixels-unstable'), /still changing.*pixels-unstable/u);
  assert.match(describePreviewError('Preview blocked: navigation'), /leaves this site/u);
  const held = 'Preview capture outcome is unknown. Close the preview and reconcile before continuing.';
  assert.equal(describePreviewError(held), held);
});
