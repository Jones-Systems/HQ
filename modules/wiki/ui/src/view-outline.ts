// "On this page": the h2/h3 outline of a parsed page. Activating an item scrolls to its heading (smoothly, or at once
// under reduced motion) and the section being read is highlighted as the reader scrolls.

import { createElement as h, useCallback, useEffect, useState, type ReactElement, type RefObject } from 'react';
import type { OutlineItem } from './reader-model.ts';

/** The OS preference or the shell's override (`<html data-hq-motion="reduce">`). */
export function reducedMotion(): boolean {
  try {
    if (document.documentElement.getAttribute('data-hq-motion') === 'reduce') return true;
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const headingIn = (scope: HTMLElement, id: string): HTMLElement | null => scope.querySelector<HTMLElement>(`[id="${id}"]`);

/**
 * The id of the last heading at or above the reading line (the top third of the scroller), or null above the first.
 * Without IntersectionObserver nothing is highlighted and the outline still works.
 */
function useActiveHeading(ids: readonly string[], scope: RefObject<HTMLElement | null>): readonly [string | null, (id: string) => void] {
  const [active, setActive] = useState<string | null>(null);
  const key = ids.join('\u0000');
  useEffect(() => {
    const root = scope.current;
    if (root === null || ids.length === 0 || typeof IntersectionObserver === 'undefined') return undefined;
    const states = new Map<string, 'above' | 'in' | 'below'>();
    const scroller = root.closest<HTMLElement>('.wiki-scroll');
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const top = entry.rootBounds === null ? 0 : entry.rootBounds.top;
          states.set(entry.target.id, entry.isIntersecting ? 'in' : entry.boundingClientRect.top < top ? 'above' : 'below');
        }
        let current: string | null = null;
        for (const id of ids) {
          const state = states.get(id);
          if (state === 'in' || state === 'above') current = id;
        }
        setActive(current);
      },
      { root: scroller, rootMargin: '0px 0px -66% 0px' },
    );
    for (const id of ids) {
      const element = headingIn(root, id);
      if (element !== null) observer.observe(element);
    }
    return () => observer.disconnect();
    // `key` names the ids; `ids` itself is rebuilt with every page object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, scope]);
  return [active, setActive];
}

export function Outline(props: { readonly items: readonly OutlineItem[]; readonly scope: RefObject<HTMLElement | null> }): ReactElement | null {
  const { items, scope } = props;
  const [active, setActive] = useActiveHeading(
    items.map((item) => item.id),
    scope,
  );
  const go = useCallback(
    (id: string) => {
      const root = scope.current;
      const target = root === null ? null : headingIn(root, id);
      if (target === null) return;
      target.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
      // Keyboard users land on the heading; the scroll above already moved the page.
      target.focus({ preventScroll: true });
      setActive(id);
    },
    [scope, setActive],
  );
  if (items.length === 0) return null;
  return h(
    'nav',
    { className: 'wiki-outline', 'aria-label': 'On this page' },
    h('h3', { className: 'wiki-rail-title' }, 'On this page'),
    h(
      'ol',
      { className: 'wiki-outline-list' },
      items.map((item) =>
        h(
          'li',
          { key: item.id, className: 'wiki-outline-item', 'data-level': item.level },
          h(
            'button',
            {
              type: 'button',
              className: 'wiki-outline-link',
              'data-target': item.id,
              'aria-current': active === item.id ? 'location' : undefined,
              onClick: () => go(item.id),
            },
            item.text,
          ),
        ),
      ),
    ),
  );
}
