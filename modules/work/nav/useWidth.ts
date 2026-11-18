import { useLayoutEffect, useState, type RefObject } from 'react';

/**
 * The element's content width in px, kept current as it resizes, or 0 while it cannot be measured (no layout yet, as in
 * a component test). Callers treat 0 as "unknown" and keep their wide layout.
 */
export function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [ref]);
  return width;
}
