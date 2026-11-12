import { animateElement, prefersReducedMotion } from '@hq/ui';
import { flash } from '../motion';

// Motion for the Calendar and Timeline (flow assessment X-4 and D-2): the slide when a range or layout changes, the
// settle when a dropped date lands, and the shake for a refused drop. Each one is decoration: it animates transform
// and opacity only, never delays a write or a focus move, and does nothing under reduced motion (animateElement
// returns null and makes no animation call; `flash` is colour only and is the one cue that still plays).

/** The shared large travel distance (`--hq-motion-distance-lg`), read from the element so the token stays the source. */
function travel(el: Element, token = '--hq-motion-distance-lg', fallback = 16): number {
  const px = parseFloat(getComputedStyle(el).getPropertyValue(token));
  return Number.isFinite(px) && px > 0 ? px : fallback;
}

/**
 * Slides `el` in from the direction of travel: positive when the new content is later or deeper (it arrives from
 * the end side), negative when it is earlier. Zero is a plain fade.
 */
export function slideIn(el: Element | null | undefined, direction: number): Animation | null {
  if (!el || prefersReducedMotion()) return null;
  const from = Math.sign(direction) * travel(el);
  return animateElement(el, [
    { transform: `translateX(${from}px)`, opacity: 0 },
    { transform: 'translateX(0)', opacity: 1 },
  ], { duration: 'slow', easing: 'enter' });
}

/**
 * A dropped date landing: the accent flash shows where it is, and (when the pointer's drop point is known) the chip
 * glides the last few pixels from there with the shared spring.
 */
export function settleInto(el: Element | null | undefined, from: { x: number; y: number } | null): Animation | null {
  if (!el) return null;
  flash(el);
  if (!from || prefersReducedMotion()) return null;
  const box = el.getBoundingClientRect();
  const dx = Math.max(-80, Math.min(80, from.x - (box.left + box.width / 2)));
  const dy = Math.max(-80, Math.min(80, from.y - (box.top + box.height / 2)));
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return null;
  return animateElement(el, [
    { transform: `translate(${dx}px, ${dy}px) scale(1.04)` },
    { transform: 'translate(0, 0) scale(1)' },
  ], { duration: 'slow', easing: 'spring' });
}

/** One short side-to-side shake: a refused drop or a write that was rolled back. */
export function shake(el: Element | null | undefined): Animation | null {
  if (!el || prefersReducedMotion()) return null;
  const d = travel(el, '--hq-motion-distance-sm', 4);
  return animateElement(el, [
    { transform: 'translateX(0)' },
    { transform: `translateX(${-d}px)` },
    { transform: `translateX(${d}px)` },
    { transform: `translateX(${-d * 0.6}px)` },
    { transform: `translateX(${d * 0.4}px)` },
    { transform: 'translateX(0)' },
  ], { duration: 'slow', easing: 'standard' });
}
