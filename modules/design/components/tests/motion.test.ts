import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Easing, MotionStudy } from '../src/contract.ts';
import { SYNTHETIC_MOTION } from '../src/fixtures.ts';
import {
  EASING_PRESETS, ease, easingToCss, frameToStyles, parseEasing, parseMotionStudy, progressAt, sampleStudy,
  totalDuration, withSegmentEasing,
} from '../src/model/motion.ts';
import { INITIAL_PLAYER, currentTime, frameAt, pause, play, replay, scrub, setLoop, tick } from '../src/model/player.ts';
import { createFakeClock } from '../src/workspace/fakes.ts';

const study = parseMotionStudy(SYNTHETIC_MOTION);

test('scrub is deterministic for a given t, independent of playback history', () => {
  const clock = createFakeClock(1000);
  const times = [0, 1, 59.5, 180, 299.99, 300, 360, 451.25, 599, 600];
  const fresh = times.map((t) => sampleStudy(study, t));

  // Drive an arbitrary history: play, irregular frames, pause, loop, scrubs out of order.
  let state = play(study, INITIAL_PLAYER, clock.now());
  for (const step of [16.7, 3, 41, 0.5, 120]) {
    clock.advance(step);
    state = tick(study, state, clock.now());
    frameAt(study, state, clock.now());
  }
  state = pause(study, state, clock.now());
  state = setLoop(study, state, true, clock.now());
  for (const t of [...times].reverse()) state = scrub(study, state, t);

  times.forEach((t, index) => {
    const scrubbed = scrub(study, state, t);
    assert.deepEqual(frameAt(study, scrubbed, clock.now() + 12345), fresh[index], `t=${t}`);
    assert.deepEqual(sampleStudy(study, t), fresh[index], `repeat t=${t}`);
  });
});

test('a frame does not depend on the clock while paused, and play advances by elapsed clock time only', () => {
  const clock = createFakeClock(50);
  let state = scrub(study, INITIAL_PLAYER, 200);
  assert.deepEqual(frameAt(study, state, 0), frameAt(study, state, 9e9));
  state = play(study, state, clock.now());
  clock.advance(100);
  assert.equal(currentTime(study, state, clock.now()), 300);
  assert.deepEqual(frameAt(study, state, clock.now()), sampleStudy(study, 300));
});

test('replay restarts from 0 and playback ends on the final frame', () => {
  const clock = createFakeClock();
  let state = play(study, INITIAL_PLAYER, clock.now());
  clock.advance(totalDuration(study) + 500);
  state = tick(study, state, clock.now());
  assert.equal(state.status, 'ended');
  assert.deepEqual(frameAt(study, state, clock.now() + 1000), sampleStudy(study, totalDuration(study)));
  state = replay(study, state, clock.now());
  assert.equal(currentTime(study, state, clock.now()), 0);
  assert.deepEqual(frameAt(study, state, clock.now()), sampleStudy(study, 0));
  clock.advance(150);
  assert.deepEqual(frameAt(study, state, clock.now()), sampleStudy(study, 150));
  // Playing from the end restarts too.
  const ended = { ...state, status: 'ended' as const, time: 600, anchoredAt: null };
  assert.equal(currentTime(study, play(study, ended, 0), 0), 0);
});

test('looping wraps time and never ends', () => {
  const clock = createFakeClock();
  let state = setLoop(study, play(study, INITIAL_PLAYER, clock.now()), true, clock.now());
  clock.advance(1450);
  state = tick(study, state, clock.now());
  assert.equal(state.status, 'playing');
  assert.equal(currentTime(study, state, clock.now()), 250);
});

test('fill, iterations and direction', () => {
  const twoWay = parseMotionStudy({ ...SYNTHETIC_MOTION, iterations: 2, direction: 'alternate' });
  assert.deepEqual(progressAt(twoWay, -50), { iteration: 0, progress: 0 });
  assert.deepEqual(progressAt(twoWay, 300), { iteration: 0, progress: 0.5 });
  assert.deepEqual(progressAt(twoWay, 900), { iteration: 1, progress: 0.5 });
  assert.deepEqual(progressAt(twoWay, 1200), { iteration: 1, progress: 0 });
  assert.deepEqual(progressAt(twoWay, 5000), { iteration: 1, progress: 0 });
  const reverse = parseMotionStudy({ ...SYNTHETIC_MOTION, direction: 'reverse' });
  assert.deepEqual(sampleStudy(reverse, 0), sampleStudy(study, 600));
  assert.deepEqual(sampleStudy(study, Number.NaN), sampleStudy(study, 0));
});

test('keyframe values and endpoints', () => {
  const start = sampleStudy(study, 0);
  const end = sampleStudy(study, 600);
  assert.deepEqual(start, { 'card-opacity': 0, 'card-rise': 24, 'badge-pop': 0 });
  assert.deepEqual(end, { 'card-opacity': 1, 'card-rise': 0, 'badge-pop': 1 });
  // Opacity reaches 1 at offset 0.6 and holds.
  assert.equal(sampleStudy(study, 360)['card-opacity'], 1);
  assert.equal(sampleStudy(study, 450)['card-opacity'], 1);
  // Badge holds at 0 until offset 0.5.
  assert.equal(sampleStudy(study, 299)['badge-pop'], 0);
  const styles = frameToStyles(study, end);
  assert.deepEqual(styles, { card: { opacity: '1', transform: 'translateY(0px)' }, badge: { transform: 'scale(1)' } });
});

test('cubic-bezier matches the CSS ease curve and the presets are exact', () => {
  const linearish: Easing = { kind: 'cubic-bezier', x1: 0, y1: 0, x2: 1, y2: 1 };
  for (const p of [0.1, 0.25, 0.5, 0.9]) assert.ok(Math.abs(ease(linearish, p) - p) < 1e-6);
  // Known values of CSS `ease` (0.25, 0.1, 0.25, 1).
  assert.ok(Math.abs(ease(EASING_PRESETS.ease, 0.5) - 0.8024033877399112) < 1e-5);
  assert.ok(Math.abs(ease(EASING_PRESETS['ease-in-out'], 0.5) - 0.5) < 1e-6);
  assert.equal(ease(EASING_PRESETS.ease, 0), 0);
  assert.equal(ease(EASING_PRESETS.ease, 1), 1);
  const overshoot: Easing = { kind: 'cubic-bezier', x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 };
  assert.ok(Math.max(...[0.5, 0.6, 0.7, 0.8].map((p) => ease(overshoot, p))) > 1, 'y overshoot is preserved');
  assert.equal(easingToCss(EASING_PRESETS.ease), 'cubic-bezier(0.25, 0.1, 0.25, 1)');
});

test('steps follow CSS jump positions', () => {
  const at = (position: 'jump-start' | 'jump-end' | 'jump-none' | 'jump-both', p: number) => ease({ kind: 'steps', count: 4, position }, p);
  assert.deepEqual([0, 0.2, 0.25, 0.99, 1].map((p) => at('jump-end', p)), [0, 0, 0.25, 0.75, 1]);
  assert.deepEqual([0, 0.2, 0.99, 1].map((p) => at('jump-start', p)), [0.25, 0.25, 1, 1]);
  assert.deepEqual([0, 0.3, 0.99, 1].map((p) => at('jump-none', p)), [0, 1 / 3, 1, 1]);
  assert.deepEqual([0, 0.3, 0.99, 1].map((p) => at('jump-both', p)), [0.2, 0.4, 0.8, 1]);
});

test('springs settle on the target at the end and respond to their parameters', () => {
  const soft: Easing = { kind: 'spring', stiffness: 100, damping: 5, mass: 1 };
  const stiff: Easing = { kind: 'spring', stiffness: 400, damping: 40, mass: 1 };
  assert.equal(ease(soft, 1, 600), 1);
  assert.ok(Math.max(...Array.from({ length: 30 }, (_, i) => ease(soft, i / 30, 1000))) > 1, 'underdamped spring overshoots');
  assert.ok(ease(stiff, 0.3, 600) > ease({ kind: 'spring', stiffness: 50, damping: 14, mass: 1 }, 0.3, 600));
  const critical: Easing = { kind: 'spring', stiffness: 100, damping: 20, mass: 1 };
  assert.ok(ease(critical, 0.5, 1000) > 0.9 && ease(critical, 0.5, 1000) < 1);
  assert.match(easingToCss(soft, 600), /^linear\(0, /u);
});

test('editing easing parameters creates a new draft and leaves the original untouched', () => {
  const before = JSON.stringify(study);
  const edited: MotionStudy = withSegmentEasing(study, 'card-opacity', 0, EASING_PRESETS['ease-in']);
  assert.equal(JSON.stringify(study), before);
  assert.deepEqual(edited.tracks[0]?.keyframes[0]?.easing, EASING_PRESETS['ease-in']);
  assert.notDeepEqual(sampleStudy(edited, 120), sampleStudy(study, 120));
  assert.throws(() => withSegmentEasing(study, 'card-opacity', 1, EASING_PRESETS.ease), RangeError, 'the last keyframe starts no segment');
});

test('invalid studies and easings are rejected', () => {
  assert.throws(() => parseEasing({ kind: 'cubic-bezier', x1: 1.5, y1: 0, x2: 0.5, y2: 1 }));
  assert.throws(() => parseEasing({ kind: 'steps', count: 1, position: 'jump-none' }));
  assert.throws(() => parseEasing({ kind: 'spring', stiffness: 0, damping: 1, mass: 1 }));
  assert.throws(() => parseMotionStudy({ ...SYNTHETIC_MOTION, duration: 0 }));
  const unordered = { ...SYNTHETIC_MOTION.tracks[0], keyframes: [{ offset: 0.5, value: 0, easing: { kind: 'linear' } }, { offset: 0.5, value: 1, easing: { kind: 'linear' } }] };
  assert.throws(() => parseMotionStudy({ ...SYNTHETIC_MOTION, tracks: [unordered] }), /increase/u);
  assert.throws(() => parseMotionStudy({ ...SYNTHETIC_MOTION, component: { componentId: 'synthetic-card' } }), /exact revision/u);
});
