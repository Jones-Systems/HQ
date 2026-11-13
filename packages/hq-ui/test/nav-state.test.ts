import { describe, expect, it } from 'vitest';
import { buildNavModel, matchCurrentNavId, NAV_LIMITS, navAncestors, reconcileNavExpansion, recoverNavFocus, visibleNavIds } from '../src/nav/state';
import type { NavExpansionState, NavNode } from '../src/nav/types';

const nodes: readonly NavNode[] = [
  { id: 'review', label: 'Review', destination: 'review', children: [
    { id: 'compare', label: 'Compare', destination: 'review/compare', children: [
      { id: 'matrix', label: 'Matrix', destination: 'review/compare/matrix' },
      { id: 'swipe', label: 'Swipe', destination: 'review/compare/swipe' },
    ] },
  ] },
  { id: 'about', label: 'About', destination: 'about' },
];
const state: NavExpansionState = { projectId: 'a', locationKey: '', expandedIds: [] };

describe('bounded injected navigation state', () => {
  it('matches an exact destination or an explicitly injected effective item, without prefix matching', () => {
    const model = buildNavModel(nodes);
    expect(matchCurrentNavId(model, 'review/compare/matrix')).toBe('matrix');
    expect(matchCurrentNavId(model, 'review/compare/matrix/unknown')).toBeNull();
    expect(matchCurrentNavId(model, 'review/compare', 'swipe')).toBe('swipe');
    expect(matchCurrentNavId(model, 'review/compare', null)).toBeNull();
    expect(matchCurrentNavId(model, 'review/compare', 'missing')).toBeNull();
    expect(navAncestors(model, 'matrix')).toEqual(['compare', 'review']);
  });

  it('expands on location change once, preserves deliberate collapse, prunes stale IDs and isolates projects', () => {
    const model = buildNavModel(nodes);
    const opened = reconcileNavExpansion(state, model, 'matrix', 'matrix');
    expect(new Set(opened.expandedIds)).toEqual(new Set(['review', 'compare']));
    const collapsed = { ...opened, expandedIds: ['review'] };
    expect(reconcileNavExpansion(collapsed, model, 'matrix', 'matrix')).toBe(collapsed);
    expect(reconcileNavExpansion(collapsed, model, 'swipe', 'swipe').expandedIds).toContain('compare');
    const nextProject = reconcileNavExpansion(opened, model, 'about', 'about', 'b');
    expect(nextProject).toEqual({ projectId: 'b', locationKey: 'about', expandedIds: [] });
    const removed = buildNavModel([nodes[1]!]);
    expect(reconcileNavExpansion(opened, removed, 'matrix', null).expandedIds).toEqual([]);
  });

  it('recovers the nearest surviving ancestor, then a surviving first destination', () => {
    const model = buildNavModel(nodes);
    expect(visibleNavIds(model, ['review'])).toEqual(['review', 'compare', 'about']);
    expect(recoverNavFocus(model, 'matrix', visibleNavIds(model, ['review']))).toBe('compare');
    expect(recoverNavFocus(model, 'matrix', ['about'])).toBe('about');
    expect(recoverNavFocus(model, 'matrix', [])).toBeNull();
  });

  it('bounds duplicate, cyclic, oversized, deep and wide data, including remembered expansion IDs', () => {
    const cycle: NavNode = { id: 'cycle', label: 'Cycle', destination: null };
    Object.assign(cycle, { children: [cycle] });
    const malformed = buildNavModel([
      cycle, { id: 'cycle', label: 'Duplicate', destination: 'duplicate' },
      { id: 'invalid id', label: 'Invalid', destination: 'bad' },
      { id: 'long', label: 'x'.repeat(NAV_LIMITS.label + 1), destination: 'bad' },
      { id: 'route', label: 'Route', destination: 'x'.repeat(NAV_LIMITS.destination + 1) },
    ]);
    expect(malformed.entries.size).toBe(1);
    expect(malformed.limited).toBe(true);
    let deep: NavNode = { id: 'leaf', label: 'Leaf', destination: 'leaf' };
    for (let i = 0; i < 30; i++) deep = { id: `level${i}`, label: 'Level', destination: null, children: [deep] };
    expect(buildNavModel([deep]).entries.size).toBe(NAV_LIMITS.depth);
    const wide = buildNavModel(Array.from({ length: NAV_LIMITS.nodes + 10 }, (_, i) => ({ id: `node${i}`, label: 'Node', destination: null, lazy: true })));
    expect(wide.entries.size).toBe(NAV_LIMITS.nodes);
    expect(wide.limited).toBe(true);
    const expansion = reconcileNavExpansion({ ...state, expandedIds: [...wide.entries.keys(), ...wide.entries.keys(), 'gone'] }, wide, 'same', null);
    expect(expansion.expandedIds).toHaveLength(NAV_LIMITS.nodes);
    expect(new Set(expansion.expandedIds).size).toBe(expansion.expandedIds.length);
    expect(() => reconcileNavExpansion(state, wide, 'x'.repeat(1025), null)).toThrow(RangeError);
  });

  it('does not put a non-actionable label into the row focus sequence', () => {
    const model = buildNavModel([{ id: 'label', label: 'Label', destination: null }, ...nodes]);
    expect(visibleNavIds(model, [])).toEqual(['review', 'about']);
  });
});
