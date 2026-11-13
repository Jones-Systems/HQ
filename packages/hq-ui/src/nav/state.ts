import type { NavExpansionState, NavModel, NavNode, NavEntry } from './types';

export const NAV_LIMITS = Object.freeze({ nodes: 512, depth: 8, id: 128, label: 256, destination: 512 });
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
export const isNavBranch = (node: NavNode): boolean => Boolean(node.children?.length || node.lazy);

/** Copies at most one bounded snapshot; duplicate IDs, cycles and malformed entries cannot grow state. */
export function buildNavModel(input: readonly NavNode[]): NavModel {
  const entries = new Map<string, NavEntry>();
  let examined = 0;
  let limited = false;
  const visit = (items: readonly NavNode[], parentId: string | null, depth: number): NavNode[] => {
    const result: NavNode[] = [];
    if (!Array.isArray(items) || depth > NAV_LIMITS.depth) { limited = true; return result; }
    for (const value of items) {
      if (examined >= NAV_LIMITS.nodes) { limited = true; break; }
      examined++;
      if (!value || typeof value !== 'object' || !text(value.id, NAV_LIMITS.id) || !ID.test(value.id)
        || entries.has(value.id) || !text(value.label, NAV_LIMITS.label)
        || (value.destination !== null && !text(value.destination, NAV_LIMITS.destination))) { limited = true; continue; }
      const node: NavNode = {
        id: value.id, label: value.label, destination: value.destination, icon: value.icon,
        ...(text(value.tag, 64) ? { tag: value.tag } : {}),
        ...(Number.isSafeInteger(value.count) && value.count! >= 0 ? { count: value.count } : {}),
        ...(value.lazy === true ? { lazy: true } : {}),
        ...(['loading', 'error', 'stale'].includes(value.status ?? '') ? { status: value.status } : {}),
        ...(text(value.statusLabel, NAV_LIMITS.label) ? { statusLabel: value.statusLabel } : {}),
      };
      entries.set(node.id, { node, parentId });
      const children = value.children ? visit(value.children, node.id, depth + 1) : [];
      const complete = children.length ? { ...node, children } : node;
      entries.set(node.id, { node: complete, parentId });
      result.push(complete);
    }
    return result;
  };
  const nodes = visit(input, null, 1);
  return { nodes, entries, limited };
}

export function navAncestors(model: NavModel, id: string | null): string[] {
  const result: string[] = [];
  let parent = id ? model.entries.get(id)?.parentId : null;
  while (parent && result.length < NAV_LIMITS.depth) {
    result.push(parent);
    parent = model.entries.get(parent)?.parentId;
  }
  return result;
}

export function matchCurrentNavId(model: NavModel, destination: string | null, currentId?: string | null): string | null {
  if (currentId !== undefined) return currentId && model.entries.get(currentId)?.node.destination != null ? currentId : null;
  if (destination === null) return null;
  for (const { node } of model.entries.values()) if (node.destination === destination) return node.id;
  return null;
}

export function visibleNavIds(model: NavModel, expandedIds: readonly string[]): string[] {
  const expanded = new Set(expandedIds.slice(0, NAV_LIMITS.nodes));
  const visible: string[] = [];
  const visit = (nodes: readonly NavNode[]) => {
    for (const node of nodes) {
      if (node.destination !== null || isNavBranch(node)) visible.push(node.id);
      if (expanded.has(node.id) && node.children) visit(node.children);
    }
  };
  visit(model.nodes);
  return visible;
}

export function reconcileNavExpansion(state: NavExpansionState, model: NavModel, locationKey: string, currentId: string | null, projectId = state.projectId): NavExpansionState {
  if (projectId.length > 128 || locationKey.length > 1024) throw new RangeError('Navigation location exceeds its bounds');
  const ids = new Set((state.projectId === projectId ? state.expandedIds : []).slice(0, NAV_LIMITS.nodes).filter(id => {
    const node = model.entries.get(id)?.node;
    return node && isNavBranch(node);
  }));
  if (state.projectId !== projectId || state.locationKey !== locationKey) for (const id of navAncestors(model, currentId)) ids.add(id);
  const expandedIds = [...ids];
  if (state.projectId === projectId && state.locationKey === locationKey && expandedIds.length === state.expandedIds.length
    && expandedIds.every((id, index) => id === state.expandedIds[index])) return state;
  return { projectId, locationKey, expandedIds };
}

export function recoverNavFocus(previous: NavModel, focusedId: string, visibleIds: readonly string[]): string | null {
  const visible = new Set(visibleIds);
  if (visible.has(focusedId)) return focusedId;
  return navAncestors(previous, focusedId).find(id => visible.has(id)) ?? visibleIds[0] ?? null;
}
