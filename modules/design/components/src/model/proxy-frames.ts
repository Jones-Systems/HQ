/** Frames a held motion proxy steps through while reduced motion is on. */
export const REDUCED_PROXY_FRAMES = 5;

/**
 * Snaps a playback time to one of `frames` evenly spaced sample times across `duration`, so a proxy shown under
 * reduced motion jumps between a few sampled frames instead of gliding. Playback itself keeps its exact time.
 */
export function snapToSampleFrames(t: number, duration: number, frames: number = REDUCED_PROXY_FRAMES): number {
  if (!Number.isFinite(t) || !Number.isFinite(duration) || duration <= 0 || frames < 1) return 0;
  const step = duration / Math.floor(frames);
  return Math.min(duration, Math.max(0, Math.round(t / step) * step));
}
