import { useLayoutEffect, useRef, type RefObject } from 'react';
import { animateElement, prefersReducedMotion, type MotionDuration, type MotionOptions } from './motion';

interface Point { readonly left: number; readonly top: number }

/** Attribute that names each animated child of a `useListMotion` container. */
export const LIST_MOTION_KEY = 'data-hq-motion-key';

export interface ListMotionOptions {
  /** Duration token for moves. Default `slow`. */
  readonly duration?: MotionDuration;
  /** Fade and rise children that appear after the first render. Default true. */
  readonly animateEntering?: boolean;
}

function measure(root: HTMLElement): Map<string, Point> {
  const origin = root.getBoundingClientRect();
  const points = new Map<string, Point>();
  for (const item of root.querySelectorAll<HTMLElement>(`[${LIST_MOTION_KEY}]`)) {
    const rect = item.getBoundingClientRect();
    points.set(item.getAttribute(LIST_MOTION_KEY)!, { left: rect.left - origin.left, top: rect.top - origin.top });
  }
  return points;
}

/**
 * FLIP list motion: children marked `data-hq-motion-key="<stable id>"` glide from their previous position to their
 * new one whenever `order` changes (reorder, insert, remove, filter). New children fade in. The "first" positions
 * are read while React renders the new order, before the DOM changes, so earlier layout shifts never cause a jump.
 * Nothing runs under reduced motion.
 *
 *   const listRef = useListMotion<HTMLUListElement>(cards.map(card => card.id));
 *   <ul ref={listRef}>{cards.map(card => <li key={card.id} data-hq-motion-key={card.id}>…</li>)}</ul>
 */
export function useListMotion<T extends HTMLElement>(order: readonly string[] | string, options: ListMotionOptions = {}): RefObject<T | null> {
  const container = useRef<T | null>(null);
  const committed = useRef<string | null>(null);
  const first = useRef<Map<string, Point> | null>(null);
  const gliding = useRef(new Set<Animation>());
  const signature = typeof order === 'string' ? order : order.join('\u0000');
  const { duration = 'slow', animateEntering = true } = options;

  // Read-only measurement during render: the DOM still shows the last committed order here.
  if (committed.current !== null && committed.current !== signature && first.current === null && container.current) {
    first.current = measure(container.current);
  }

  useLayoutEffect(() => {
    const before = first.current;
    first.current = null;
    committed.current = signature;
    const root = container.current;
    if (!root || !before) return;
    // Glides still running were measured into `before` with their leftover offset. Stop them so `after` is the true
    // layout; otherwise a reorder during a glide would jump by that leftover.
    for (const animation of gliding.current) animation.cancel();
    gliding.current.clear();
    if (prefersReducedMotion()) return;
    const after = measure(root);
    const run = (item: HTMLElement, keyframes: Keyframe[], timing: MotionOptions) => {
      const animation = animateElement(item, keyframes, timing);
      if (!animation) return;
      gliding.current.add(animation);
      const done = () => { gliding.current.delete(animation); };
      animation.finished.then(done, done);
    };
    for (const item of root.querySelectorAll<HTMLElement>(`[${LIST_MOTION_KEY}]`)) {
      const key = item.getAttribute(LIST_MOTION_KEY)!;
      const from = before.get(key);
      const to = after.get(key)!;
      if (!from) {
        if (animateEntering) {
          run(item, [{ opacity: 0, transform: 'translateY(4px) scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: 'base', easing: 'enter' });
        }
        continue;
      }
      const dx = from.left - to.left;
      const dy = from.top - to.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      run(item, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration, easing: 'standard' });
    }
  }, [signature, duration, animateEntering]);

  return container;
}
