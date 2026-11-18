import assert from 'node:assert/strict';
import { test } from 'node:test';
import { REDUCED_PROXY_FRAMES, snapToSampleFrames } from '../src/model/proxy-frames.ts';

test('a playback time snaps to one of a few evenly spaced sample times', () => {
  assert.equal(REDUCED_PROXY_FRAMES, 5);
  assert.equal(snapToSampleFrames(0, 600), 0);
  assert.equal(snapToSampleFrames(250, 600), 240);
  assert.equal(snapToSampleFrames(300, 600), 360);
  assert.equal(snapToSampleFrames(599, 600), 600);
  assert.equal(snapToSampleFrames(600, 600), 600);
  const seen = new Set<number>();
  for (let t = 0; t <= 600; t += 7) seen.add(snapToSampleFrames(t, 600));
  assert.deepEqual([...seen].sort((a, b) => a - b), [0, 120, 240, 360, 480, 600]);
});

test('out-of-range, non-finite and degenerate inputs stay inside the study', () => {
  assert.equal(snapToSampleFrames(-50, 600), 0);
  assert.equal(snapToSampleFrames(9999, 600), 600);
  assert.equal(snapToSampleFrames(Number.NaN, 600), 0);
  assert.equal(snapToSampleFrames(10, 0), 0);
  assert.equal(snapToSampleFrames(10, Number.POSITIVE_INFINITY), 0);
  assert.equal(snapToSampleFrames(10, 600, 0), 0);
  assert.equal(snapToSampleFrames(450, 600, 2), 600);
  assert.equal(snapToSampleFrames(100, 600, 2.9), 0);
});
