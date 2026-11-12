import { createElement as h } from 'react';

const CHEVRONS = { up: 'm4 10 4-4 4 4', down: 'm4 6 4 4 4-4', left: 'm10 4-4 4 4 4', right: 'm6 4 4 4-4 4' } as const;

/**
 * Drawn rather than typed: arrow glyphs are missing from some hosts' fonts and render as empty boxes. Mirrors the
 * Design secondary panels' chevron (16×16 viewBox, 1.5 stroke, current colour).
 */
export function Chevron({ direction, className = 'hqp-chevron' }: { direction: keyof typeof CHEVRONS; className?: string }) {
  return h('svg', {
    className, width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true, focusable: false, fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
  }, h('path', { d: CHEVRONS[direction] }));
}
