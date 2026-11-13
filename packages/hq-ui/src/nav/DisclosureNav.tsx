import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { cx } from '../components/cx';
import { buildNavModel, isNavBranch, matchCurrentNavId, navAncestors, reconcileNavExpansion, recoverNavFocus, visibleNavIds } from './state';
import type { NavExpansionState, NavNode } from './types';

export interface DisclosureNavProps {
  readonly label: string;
  readonly projectId: string;
  readonly nodes: readonly NavNode[];
  readonly destination: string | null;
  /** Undefined uses exact destination matching; null explicitly indicates no current item. */
  readonly currentId?: string | null;
  /** Supply an effective-location key when a bare route resolves to a remembered child. Max 1,024 characters. */
  readonly locationKey?: string;
  /** Controlled owners must accept onExpansionChange, including location reconciliation. No persistence is performed. */
  readonly expansion?: NavExpansionState;
  readonly onExpansionChange?: (state: NavExpansionState) => void;
  readonly onNavigate: (destination: string, node: NavNode) => void;
  readonly onExpand?: (nodeId: string) => void;
  readonly status?: 'ready' | 'loading' | 'error' | 'stale';
  readonly statusMessage?: string;
  readonly emptyMessage?: string;
  /** Preserve a source adapter's bounded-snapshot warning when passing its already-sanitized nodes. */
  readonly limited?: boolean;
  readonly className?: string;
}

function Chevron({ open }: { open: boolean }) {
  return <svg className="hq-nav-chevron" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"
    fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d={open ? 'm4 6 4 4 4-4' : 'm6 4 4 4-4 4'} />
  </svg>;
}

export function DisclosureNav({ label, projectId, nodes, destination, currentId: suppliedCurrentId, locationKey,
  expansion, onExpansionChange, onNavigate, onExpand, status = 'ready', statusMessage, emptyMessage = 'No destinations', limited = false, className }: DisclosureNavProps) {
  const id = useId();
  const model = useMemo(() => buildNavModel(nodes), [nodes]);
  const currentId = matchCurrentNavId(model, destination, suppliedCurrentId);
  const key = locationKey ?? JSON.stringify([destination, currentId]);
  const [localExpansion, setLocalExpansion] = useState<NavExpansionState>(() => ({ projectId, locationKey: key, expandedIds: navAncestors(model, currentId) }));
  const input = expansion ?? localExpansion;
  const state = useMemo(() => reconcileNavExpansion(input, model, key, currentId, projectId), [input, model, key, currentId, projectId]);
  const expanded = new Set(state.expandedIds);
  const ancestors = new Set(navAncestors(model, currentId));
  const visible = visibleNavIds(model, state.expandedIds);
  const root = useRef<HTMLElement>(null);
  const controls = useRef(new Map<string, HTMLButtonElement>());
  const focused = useRef<{ id: string; element: HTMLElement } | null>(null);
  const previousModel = useRef(model);

  useLayoutEffect(() => {
    if (state !== input) {
      if (!expansion) setLocalExpansion(state);
      onExpansionChange?.(state);
    }
  }, [state, input, expansion, onExpansionChange]);

  useLayoutEffect(() => {
    const last = focused.current;
    if (last && (!last.element.isConnected || !visible.includes(last.id))) {
      const next = recoverNavFocus(previousModel.current, last.id, visible);
      focused.current = null;
      (next ? controls.current.get(next) : root.current)?.focus();
    }
    previousModel.current = model;
  });

  const changeExpanded = (node: NavNode, open: boolean) => {
    const ids = new Set(state.expandedIds);
    if (open) ids.add(node.id); else ids.delete(node.id);
    const next = { ...state, expandedIds: [...ids] };
    if (!expansion) setLocalExpansion(next);
    onExpansionChange?.(next);
    if (open) onExpand?.(node.id);
  };

  const move = (nodeId: string | null | undefined) => { if (nodeId) controls.current.get(nodeId)?.focus(); };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLButtonElement)) return;
    const nodeId = event.target.dataset.hqNavId;
    const node = nodeId ? model.entries.get(nodeId)?.node : undefined;
    if (!node || !nodeId) return;
    const index = visible.indexOf(nodeId);
    switch (event.key) {
      case 'ArrowDown': move(visible[Math.min(index + 1, visible.length - 1)]); break;
      case 'ArrowUp': move(visible[Math.max(0, index - 1)]); break;
      case 'Home': move(visible[0]); break;
      case 'End': move(visible[visible.length - 1]); break;
      case 'ArrowRight':
        if (isNavBranch(node)) {
          if (!expanded.has(node.id)) changeExpanded(node, true);
          else move(node.children?.find(child => child.destination !== null || isNavBranch(child))?.id);
        }
        break;
      case 'ArrowLeft':
        if (isNavBranch(node) && expanded.has(node.id)) changeExpanded(node, false);
        else move(model.entries.get(node.id)?.parentId);
        break;
      default: return;
    }
    event.preventDefault();
  };

  const primaryRef = (nodeId: string) => (element: HTMLButtonElement | null) => {
    if (element) controls.current.set(nodeId, element); else controls.current.delete(nodeId);
  };
  const renderNodes = (items: readonly NavNode[], listId?: string): ReactElement => <ul id={listId} className="hq-nav-list">{items.map(node => {
    const branch = isNavBranch(node);
    const open = expanded.has(node.id);
    const childListId = `${id}-${node.id}-children`;
    const statusId = `${id}-${node.id}-status`;
    const ancestorId = `${id}-${node.id}-ancestor`;
    const describedBy = [node.status ? statusId : '', ancestors.has(node.id) ? ancestorId : ''].filter(Boolean).join(' ') || undefined;
    const disclosureName = `${open ? 'Collapse' : 'Expand'} ${node.label}`;
    const content = <>
      {node.icon != null && <span className="hq-nav-icon" aria-hidden="true">{node.icon}</span>}
      <span className="hq-nav-label">{node.label}</span>
      {node.tag && <span className="hq-nav-tag">{node.tag}</span>}
      {node.count != null && <span className="hq-nav-count">{node.count}</span>}
      {ancestors.has(node.id) && <span id={ancestorId} className="hq-nav-ancestor">Contains current page</span>}
    </>;
    return <li key={node.id} className="hq-nav-item">
      <div className="hq-nav-row" data-contains-current={ancestors.has(node.id) || undefined}>
        {node.destination != null ? <button type="button" ref={primaryRef(node.id)} data-hq-nav-id={node.id}
          className="hq-nav-destination" aria-current={currentId === node.id ? 'page' : undefined}
          aria-describedby={describedBy} onClick={() => onNavigate(node.destination!, node)}>{content}</button>
          : branch ? <button type="button" ref={primaryRef(node.id)} data-hq-nav-id={node.id} className="hq-nav-group"
            aria-label={disclosureName} aria-expanded={open} aria-controls={childListId} aria-describedby={describedBy}
            onClick={() => changeExpanded(node, !open)}>{content}<Chevron open={open} /></button>
            : <span className="hq-nav-static">{content}</span>}
        {branch && node.destination != null && <button type="button" data-hq-nav-id={node.id} className="hq-nav-toggle"
          aria-label={disclosureName} aria-expanded={open} aria-controls={childListId} onClick={() => changeExpanded(node, !open)}><Chevron open={open} /></button>}
      </div>
      {node.status && <span id={statusId} className="hq-nav-status">{node.statusLabel ?? { loading: 'Loading destinations', error: 'Destinations could not be loaded', stale: 'Destinations may be out of date' }[node.status]}</span>}
      {branch && <div hidden={!open}>{renderNodes(node.children ?? [], childListId)}</div>}
    </li>;
  })}</ul>;

  return <nav ref={root} aria-label={label} tabIndex={-1} className={cx('hq-disclosure-nav', className)}
    aria-busy={status === 'loading' || undefined} onKeyDown={onKeyDown}
    onFocusCapture={event => {
      if (!(event.target instanceof HTMLButtonElement)) return;
      const nodeId = event.target.dataset.hqNavId;
      if (nodeId) focused.current = { id: nodeId, element: event.target };
    }} onBlurCapture={event => {
      if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) focused.current = null;
    }}>
    {status !== 'ready' && <p className="hq-nav-status" role="status">{statusMessage ?? {
      loading: 'Loading navigation', error: 'Navigation could not be loaded', stale: 'Navigation may be out of date',
    }[status]}</p>}
    {(limited || model.limited) && <p className="hq-nav-status" role="status">Some navigation entries are unavailable</p>}
    {renderNodes(model.nodes)}
    {!model.nodes.length && status === 'ready' && <p className="hq-nav-status">{emptyMessage}</p>}
  </nav>;
}
