import { useSyncExternalStore } from 'react';

/**
 * Motion tokens for script-driven animation (Web Animations API, timers). CSS uses the `--hq-duration-*`,
 * `--hq-ease-*` and `--hq-motion-*` custom properties directly; these mirror their default values and
 * `test/motion.test.ts` keeps both in step with `tokens/hq-tokens.json`.
 */
export const MOTION_DURATIONS = { instant: 60, fast: 90, base: 160, slow: 240, slower: 360 } as const;
export type MotionDuration = keyof typeof MOTION_DURATIONS;

export const MOTION_EASINGS = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
  enter: 'cubic-bezier(0.05, 0.7, 0.1, 1)',
  spring: 'linear(0, 0.059 4%, 0.193 8%, 0.357 12%, 0.519 16%, 0.664 20%, 0.808 25%, 0.910 30%, 0.975 35%, 1.011 40%, 1.030 47%, 1.028 55%, 1.016 65%, 1.003 80%, 1)',
} as const;
export type MotionEasing = keyof typeof MOTION_EASINGS;

/** Shell override for the OS preference: `<html data-hq-motion="reduce">` turns every movement off. */
export const REDUCED_MOTION_ATTRIBUTE = 'data-hq-motion';
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/** True when the OS asks for reduced motion or the shell has set `data-hq-motion="reduce"`. */
export function prefersReducedMotion(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.documentElement.getAttribute(REDUCED_MOTION_ATTRIBUTE) === 'reduce') return true;
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_QUERY).matches;
}

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const query = typeof window.matchMedia === 'function' ? window.matchMedia(REDUCED_QUERY) : null;
  query?.addEventListener('change', onChange);
  const observer = typeof MutationObserver === 'function' ? new MutationObserver(onChange) : null;
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: [REDUCED_MOTION_ATTRIBUTE] });
  return () => { query?.removeEventListener('change', onChange); observer?.disconnect(); };
}

/** Live reduced-motion preference; re-renders when the OS setting or the shell override changes. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, () => false);
}

/** Milliseconds for a duration token, or 0 when motion is reduced. */
export function motionDuration(name: MotionDuration): number {
  return prefersReducedMotion() ? 0 : MOTION_DURATIONS[name];
}

export interface MotionOptions {
  readonly duration?: MotionDuration;
  readonly easing?: MotionEasing;
  readonly delay?: number;
}

/**
 * Runs a Web Animations API animation with HQ tokens. Returns null, and does nothing, when motion is reduced or
 * the element cannot animate (happy-dom, old engines). WAAPI writes no `style` attribute, so it is CSP-safe.
 */
export function animateElement(element: Element, keyframes: Keyframe[] | PropertyIndexedKeyframes, options: MotionOptions = {}): Animation | null {
  if (prefersReducedMotion() || typeof (element as HTMLElement).animate !== 'function') return null;
  try {
    return element.animate(keyframes, {
      duration: MOTION_DURATIONS[options.duration ?? 'base'],
      easing: MOTION_EASINGS[options.easing ?? 'standard'],
      delay: options.delay ?? 0,
      fill: 'none',
    });
  } catch {
    return null;
  }
}
