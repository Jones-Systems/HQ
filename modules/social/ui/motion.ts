import { animateElement, type MotionOptions } from '@hq/ui';

/**
 * FLIP for moves across containers (a calendar chip dropped on another day, a panel that changes column): measure
 * `from` before the change, then call this after it to slide the element from there to its new place. Lists that
 * reorder inside one container should use `@hq/ui` `useListMotion` instead. Does nothing under reduced motion.
 */
export function flipFrom(element: Element | null | undefined, from: DOMRect | null | undefined, options: MotionOptions = {}): Animation | null {
  if (!element || !from) return null;
  const to = element.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;
  return animateElement(element, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], { duration: 'slow', easing: 'spring', ...options });
}
