import { animateElement, MOTION_DURATIONS, MOTION_EASINGS, prefersReducedMotion } from '@hq/ui';

// Work-only motion extras on top of the shared @hq/ui primitives (docs/design/hq-visual-system/motion-and-feedback.md).
// Use the shared ones first: useListMotion for reflow, Presence for enter/exit, PageTransition for view switches,
// `hq-flash` for "it landed here". This file adds only what Work needs beyond them: the capture-to-Inbox flight and
// drag tilt/settle for the board. Each is decoration: it never delays a write, a focus move or an announcement, and
// under reduced motion (OS setting or the shell's data-hq-motion="reduce") it does nothing.

/** One-shot accent wash on `el` (the shared `hq-flash` class), restarted if it is already playing. */
export function flash(el: Element | null | undefined): void {
  if (!el) return;
  el.classList.remove('hq-flash');
  // Reading layout restarts the CSS animation when the class is added again.
  void (el as HTMLElement).offsetWidth;
  el.classList.add('hq-flash');
  el.addEventListener('animationend', () => el.classList.remove('hq-flash'), { once: true });
}

/**
 * Flies a small labelled token from `from` to `to` (a capture landing in the Inbox), then flashes the target. The
 * token is aria-hidden decoration; callers announce the result themselves. Returns null when nothing animates.
 */
export function flyTo(from: DOMRect | Element, to: Element, label: string): Animation | null {
  const doc = to.ownerDocument;
  if (prefersReducedMotion() || typeof (to as HTMLElement).animate !== 'function') {
    flash(to);
    return null;
  }
  const start = from instanceof Element ? from.getBoundingClientRect() : from;
  const end = to.getBoundingClientRect();
  const token = doc.createElement('div');
  token.className = 'wk-fly-token';
  token.setAttribute('aria-hidden', 'true');
  token.textContent = label;
  doc.body.appendChild(token);
  const height = token.offsetHeight;
  const x0 = start.left + Math.min(24, start.width / 2);
  const y0 = start.top + start.height / 2 - height / 2;
  const x1 = end.left + Math.min(16, end.width / 2);
  const y1 = end.top + Math.min(18, end.height / 2) - height / 2;
  // A shallow arc: the midpoint lifts above the straight line in proportion to the distance travelled.
  const lift = Math.min(90, Math.hypot(x1 - x0, y1 - y0) * 0.18);
  const animation = animateElement(token, [
    { transform: `translate(${x0}px, ${y0}px) scale(1)`, opacity: 1 },
    { transform: `translate(${(x0 + x1) / 2}px, ${Math.min(y0, y1) - lift}px) scale(0.92)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${x1}px, ${y1}px) scale(0.6)`, opacity: 0 },
  ], { duration: 'slower', easing: 'standard' });
  if (!animation) { token.remove(); flash(to); return null; }
  animation.addEventListener('finish', () => { token.remove(); flash(to); }, { once: true });
  animation.addEventListener('cancel', () => token.remove(), { once: true });
  return animation;
}

/** Drag tilt in degrees for a horizontal pointer velocity in px/ms, clamped to ±4°. */
export function tiltFor(velocityX: number): number {
  if (!Number.isFinite(velocityX)) return 0;
  return Math.max(-4, Math.min(4, velocityX * 6));
}

/**
 * Glides a fixed-position drag ghost from where it is onto `target` with the shared spring, fading at the end, then
 * calls `done`. Under reduced motion `done` runs at once.
 */
export function settleGhost(ghost: HTMLElement, target: DOMRect, done: () => void): void {
  if (prefersReducedMotion() || typeof ghost.animate !== 'function') { done(); return; }
  const from = ghost.getBoundingClientRect();
  const computed = ghost.ownerDocument.defaultView?.getComputedStyle(ghost).transform ?? 'none';
  const base = computed === 'none' ? '' : computed;
  const landed = `${base} translate(${target.left - from.left}px, ${target.top - from.top}px) rotate(0deg)`;
  const animation = ghost.animate([
    { transform: base || 'none', opacity: 1 },
    { transform: landed, opacity: 1, offset: 0.8 },
    { transform: landed, opacity: 0 },
  ], { duration: MOTION_DURATIONS.slow, easing: MOTION_EASINGS.spring, fill: 'forwards' });
  animation.addEventListener('finish', done, { once: true });
  animation.addEventListener('cancel', done, { once: true });
}
