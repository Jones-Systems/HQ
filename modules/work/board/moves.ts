import {
  EMPTY_FILTERS, isLive, matchesFilters, sortByPosition, STATUS_IDS, STATUS_LABEL,
  type Anchor, type Filters, type Item, type Status,
} from '../core';

// The board's single move model (RV-1). Drag, keyboard and menu each produce a
// MoveIntent; resolveMove turns every intent into one `move` request with the
// same anchor rule, so equal effects make identical calls.

export interface MoveRequest { id: string; status: Status; anchor: Anchor }

export type MoveIntent =
  /** Alt+←/→, a menu status item, or a drop on a column header, collapsed column or status tab. */
  | { type: 'status'; status: Status }
  /** Alt+↑/↓ and the menu's Move up / Move down. */
  | { type: 'step'; delta: -1 | 1 }
  /** The menu's Move to top / Move to bottom. */
  | { type: 'edge'; edge: 'top' | 'bottom' }
  /** A drag drop: `index` counts the target column's visible cards, not including the moving card. */
  | { type: 'drop'; status: Status; index: number };

export type BoardColumns = Record<Status, Item[]>;

/** Live items per status in stored order, narrowed by the filters. Hidden cards keep their place on the server. */
export function boardColumns(items: readonly Item[], filters: Filters = EMPTY_FILTERS): BoardColumns {
  const columns = Object.fromEntries(STATUS_IDS.map((status) => [status, [] as Item[]])) as BoardColumns;
  for (const item of sortByPosition(items.filter((candidate) => isLive(candidate) && matchesFilters(candidate, filters)))) {
    columns[item.status].push(item);
  }
  return columns;
}

/**
 * The one anchor rule for a card landing at `index` among `others` (its new column's visible cards, without it):
 * the visible top is `place: top`, the visible end is `place: bottom`, anything between follows its upper
 * neighbour. Every status change therefore lands at `{place: 'top'}`, as RW-7 requires of the detail pills.
 */
export function anchorAt(others: readonly string[], index: number): Anchor {
  if (index <= 0 || others.length === 0) return { place: 'top' };
  if (index >= others.length) return { place: 'bottom' };
  return { after_id: others[index - 1]! };
}

function locate(columns: BoardColumns, id: string): { status: Status; index: number; ids: string[] } | null {
  for (const status of STATUS_IDS) {
    const ids = columns[status].map((item) => item.id);
    const index = ids.indexOf(id);
    if (index >= 0) return { status, index, ids };
  }
  return null;
}

/** Resolves an intent against the visible board. Null means the card would not move, so nothing is sent. */
export function resolveMove(columns: BoardColumns, id: string, intent: MoveIntent): MoveRequest | null {
  const at = locate(columns, id);
  if (!at) return null;
  const others = at.ids.filter((other) => other !== id);
  switch (intent.type) {
    case 'status': {
      if (intent.status === at.status) return null;
      const target = columns[intent.status].map((item) => item.id);
      return { id, status: intent.status, anchor: anchorAt(target, 0) };
    }
    case 'step': {
      const index = at.index + intent.delta;
      if (index < 0 || index >= at.ids.length) return null;
      return { id, status: at.status, anchor: anchorAt(others, index) };
    }
    case 'edge': {
      const index = intent.edge === 'top' ? 0 : others.length;
      if (index === at.index) return null;
      return { id, status: at.status, anchor: anchorAt(others, index) };
    }
    case 'drop': {
      if (intent.status === at.status) {
        const index = Math.max(0, Math.min(intent.index, others.length));
        return index === at.index ? null : { id, status: at.status, anchor: anchorAt(others, index) };
      }
      const target = columns[intent.status].map((item) => item.id).filter((other) => other !== id);
      return { id, status: intent.status, anchor: anchorAt(target, intent.index) };
    }
  }
}

/** The status `delta` columns away in fixed board order, or null past either end. */
export function neighbourStatus(status: Status, delta: -1 | 1): Status | null {
  return STATUS_IDS[STATUS_IDS.indexOf(status) + delta] ?? null;
}

/** Board keys on a focused card. Plain arrows move focus; Alt+arrows move the card (RV-1). */
export type CardKey =
  | { type: 'move'; intent: MoveIntent }
  | { type: 'focus'; axis: 'column' | 'card'; delta: -1 | 1 }
  | { type: 'menu' }
  | { type: 'open' };

export function cardKey(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>, status: Status): CardKey | null {
  if (event.ctrlKey || event.metaKey) return null;
  const horizontal = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
  const vertical = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
  if (event.altKey) {
    if (horizontal) {
      const target = neighbourStatus(status, horizontal);
      return target ? { type: 'move', intent: { type: 'status', status: target } } : null;
    }
    if (vertical) return { type: 'move', intent: { type: 'step', delta: vertical } };
    return null;
  }
  if (event.shiftKey) return null;
  if (horizontal) return { type: 'focus', axis: 'column', delta: horizontal };
  if (vertical) return { type: 'focus', axis: 'card', delta: vertical };
  if (event.key === 'm' || event.key === 'M') return { type: 'menu' };
  if (event.key === 'Enter') return { type: 'open' };
  return null;
}

export interface MoveMenuEntry { id: string; label: string; intent: MoveIntent; disabled: boolean }

/** The move menu: every status (the current one disabled), then up, down, top and bottom (RV-1). */
export function moveMenuEntries(columns: BoardColumns, id: string): MoveMenuEntry[] {
  const entries: MoveMenuEntry[] = STATUS_IDS.map((status) => {
    const intent: MoveIntent = { type: 'status', status };
    return { id: `status-${status}`, label: `Move to ${STATUS_LABEL[status]}`, intent, disabled: resolveMove(columns, id, intent) === null };
  });
  const order: [string, string, MoveIntent][] = [
    ['up', 'Move up', { type: 'step', delta: -1 }],
    ['down', 'Move down', { type: 'step', delta: 1 }],
    ['top', 'Move to top', { type: 'edge', edge: 'top' }],
    ['bottom', 'Move to bottom', { type: 'edge', edge: 'bottom' }],
  ];
  for (const [key, label, intent] of order) entries.push({ id: key, label, intent, disabled: resolveMove(columns, id, intent) === null });
  return entries;
}

/** Words for the live region and the drag badge. */
export function describeMove(request: MoveRequest, from: Status): string {
  return request.status === from ? 'Reorder' : `Move to ${STATUS_LABEL[request.status]}`;
}
