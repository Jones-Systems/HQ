import type { MotionFrame, MotionStudy } from '../contract.ts';
import { sampleStudy, totalDuration } from './motion.ts';

/**
 * Motion player reducer. `now` always comes from an injected clock, so tests
 * use a fake clock and rendering uses `performance.now()`. The displayed frame
 * is always `sampleStudy(study, currentTime(...))`; playback history never
 * leaks into the frame.
 */
export interface PlayerState {
  readonly status: 'paused' | 'playing' | 'ended';
  /** Study time in ms at the anchor. */
  readonly time: number;
  /** Clock reading when playback was anchored; null unless playing. */
  readonly anchoredAt: number | null;
  readonly loop: boolean;
}

export const INITIAL_PLAYER: PlayerState = Object.freeze({ status: 'paused', time: 0, anchoredAt: null, loop: false });

function clampTime(study: MotionStudy, t: number): number {
  return Number.isFinite(t) ? Math.min(Math.max(t, 0), totalDuration(study)) : 0;
}

export function currentTime(study: MotionStudy, state: PlayerState, now: number): number {
  if (state.status !== 'playing' || state.anchoredAt === null) return clampTime(study, state.time);
  const total = totalDuration(study);
  const elapsed = state.time + Math.max(0, now - state.anchoredAt);
  return state.loop ? elapsed % total : Math.min(elapsed, total);
}

export function play(study: MotionStudy, state: PlayerState, now: number): PlayerState {
  if (state.status === 'playing') return state;
  const from = state.status === 'ended' || clampTime(study, state.time) >= totalDuration(study) ? 0 : clampTime(study, state.time);
  return { ...state, status: 'playing', time: from, anchoredAt: now };
}

export function pause(study: MotionStudy, state: PlayerState, now: number): PlayerState {
  if (state.status !== 'playing') return state;
  return { ...state, status: 'paused', time: currentTime(study, state, now), anchoredAt: null };
}

/** Scrubbing pauses at exactly `t` (clamped to the study). */
export function scrub(study: MotionStudy, state: PlayerState, t: number): PlayerState {
  return { ...state, status: 'paused', time: clampTime(study, t), anchoredAt: null };
}

export function replay(_study: MotionStudy, state: PlayerState, now: number): PlayerState {
  return { ...state, status: 'playing', time: 0, anchoredAt: now };
}

export function setLoop(study: MotionStudy, state: PlayerState, loop: boolean, now: number): PlayerState {
  if (state.status !== 'playing') return { ...state, loop };
  return { ...state, loop, time: currentTime(study, state, now), anchoredAt: now };
}

/** Advances status only; ended playback rests on the final frame. */
export function tick(study: MotionStudy, state: PlayerState, now: number): PlayerState {
  if (state.status !== 'playing' || state.loop || state.anchoredAt === null) return state;
  const total = totalDuration(study);
  return state.time + (now - state.anchoredAt) >= total ? { ...state, status: 'ended', time: total, anchoredAt: null } : state;
}

export function frameAt(study: MotionStudy, state: PlayerState, now: number): MotionFrame {
  return sampleStudy(study, currentTime(study, state, now));
}
