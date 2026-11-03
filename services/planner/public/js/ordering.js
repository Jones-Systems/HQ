// Board ordering. The server owns positions; the client describes a drop by
// anchoring to a neighbour that was visible where the card was dropped. When
// filters hide cards, hidden cards keep their relative order and the moved
// card lands directly beside the visible neighbour, which keeps the global
// order deterministic.

const byPosition = (a, b) => a.position - b.position
  || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)
  || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function sortByPosition(items) {
  return [...items].sort(byPosition);
}

/**
 * Anchors for inserting at `index` among the visible ids of the target column
 * (which must not include the moving card).
 */
export function anchorsForDrop(visibleIds, index) {
  const i = Math.max(0, Math.min(index, visibleIds.length));
  if (i > 0) return { after_id: visibleIds[i - 1] };
  if (visibleIds.length) return { before_id: visibleIds[0] };
  return { place: 'top' };
}

/** Anchors that would return `id` to its current place among all ids of its status. */
export function anchorsToRestore(allIdsInStatus, id) {
  const index = allIdsInStatus.indexOf(id);
  if (index < 0) return { place: 'top' };
  if (index > 0) return { after_id: allIdsInStatus[index - 1] };
  if (allIdsInStatus.length > 1) return { before_id: allIdsInStatus[1] };
  return { place: 'top' };
}

/**
 * Apply a move to a list of items the same way the server does, returning a
 * map of id -> {status, position} for every item whose placement changed.
 * Used for the visibly-pending projection before the server confirms.
 */
export function projectMove(items, id, status, anchors) {
  const moving = items.find((it) => it.id === id);
  if (!moving) return null;
  const column = sortByPosition(items.filter((it) => it.status === status && it.id !== id));
  const ids = column.map((it) => it.id);
  let index;
  if (anchors.after_id != null) {
    index = ids.indexOf(anchors.after_id);
    if (index < 0) return null;
    index += 1;
  } else if (anchors.before_id != null) {
    index = ids.indexOf(anchors.before_id);
    if (index < 0) return null;
  } else {
    index = anchors.place === 'bottom' ? ids.length : 0;
  }
  ids.splice(index, 0, id);
  const out = new Map();
  ids.forEach((itemId, i) => out.set(itemId, { status, position: (i + 1) * 1024 }));
  return out;
}

/** Index a card would take among `visibleIds` after moving one step up/down. */
export function stepAnchors(visibleIds, id, delta) {
  const index = visibleIds.indexOf(id);
  if (index < 0) return null;
  const target = index + delta;
  if (target < 0 || target >= visibleIds.length) return null;
  const others = visibleIds.filter((x) => x !== id);
  return anchorsForDrop(others, target);
}
