// Owner-level operations: send the change, report the confirmed outcome, and
// register an undo. Every drag gesture routes through these same functions as
// its menu/keyboard alternative.

import { ApiError, NetworkError } from './api.js';
import { announce } from './dom.js';
import { STATUS_LABEL } from './model.js';
import { anchorsToRestore, sortByPosition } from './ordering.js';
import { INDETERMINATE_MESSAGE, OfflineError, getItem, mutate, projectBoardMove, projectPatch, state } from './state.js';
import { toast } from './ui.js';

const undoStack = [];
const MAX_UNDO = 40;

export function canUndo() {
  return undoStack.length > 0;
}

export async function undoLast() {
  const entry = undoStack.pop();
  if (!entry) {
    toast('Nothing to undo.');
    return;
  }
  await entry.run();
}

function undoAction(entry) {
  return {
    label: 'Undo',
    icon: 'undo',
    run: async () => {
      const index = undoStack.indexOf(entry);
      if (index >= 0) undoStack.splice(index, 1);
      await entry.run();
    },
  };
}

function remember(label, run, message) {
  const entry = { label, run };
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  toast(message, { kind: 'success', action: undoAction(entry) });
}

export function reportError(err, what) {
  if (err instanceof OfflineError) {
    toast(`${what}: not sent`, { kind: 'error', detail: err.message });
  } else if (err instanceof NetworkError) {
    toast(`${what}: not confirmed yet`, {
      kind: 'error',
      timeout: 12000,
      detail: 'The server did not answer. The change is marked unconfirmed and will be re-sent safely when the connection returns.',
    });
  } else if (err instanceof ApiError && err.code === 'replay_indeterminate') {
    toast(`${what}: outcome unknown`, { kind: 'error', timeout: 12000, detail: INDETERMINATE_MESSAGE });
  } else if (err instanceof ApiError && err.code === 'revision_conflict') {
    toast(`${what}: changed elsewhere`, {
      kind: 'error', detail: 'This item was edited on another device or tab. The latest version is now shown; please try again.',
    });
  } else if (err instanceof ApiError && err.code === 'order_conflict') {
    toast(`${what}: the board changed`, { kind: 'error', detail: 'The latest order has been loaded. Please try again.' });
  } else if (err instanceof ApiError && err.payload.errors) {
    toast(`${what}: not saved`, { kind: 'error', detail: err.payload.errors.map((e) => e.message).join(' ') });
  } else {
    toast(`${what}: not saved`, { kind: 'error', detail: err.message });
  }
}

const itemPath = (id) => `/api/items/${encodeURIComponent(id)}`;
const fresh = (item) => getItem(item.id) || item;

export async function createItem(fields, { quiet = false } = {}) {
  try {
    const result = await mutate({ method: 'POST', path: '/api/items', body: { fields }, label: 'New item' });
    if (!quiet) toast(`Added “${result.item.title}” to ${STATUS_LABEL[result.item.status]}.`, { kind: 'success' });
    return result.item;
  } catch (err) {
    reportError(err, 'New item');
    throw err;
  }
}

/**
 * Patch fields. `undo` registers an inverse patch. `project` shows a visibly
 * pending projection (used for drag gestures) instead of waiting silently.
 */
export async function patchItem(item, patch, { label = 'Change', message = null, undo = true,
  project = false, report = true } = {}) {
  const base = fresh(item);
  const inverse = Object.fromEntries(Object.keys(patch).map((k) => [k, base[k]]));
  try {
    const result = await mutate({
      method: 'PATCH',
      path: itemPath(base.id),
      body: { revision: base.revision, patch },
      label,
      project: project ? () => projectPatch(base.id, patch) : null,
    });
    if (undo && result.changed && result.changed.length) {
      remember(label, async () => {
        try {
          await patchItem(getItem(base.id), inverse, { label: 'Undo', undo: false });
          toast('Undone.', { timeout: 2500 });
        } catch {
          /* reported by patchItem */
        }
      }, message || `${label} saved.`);
    }
    return result.item;
  } catch (err) {
    if (report) reportError(err, label);
    throw err;
  }
}

export async function moveItem(item, status, anchors, { undo = true, label = null } = {}) {
  const base = fresh(item);
  const oldStatus = base.status;
  const oldIds = sortByPosition(state.items.filter((it) => it.status === oldStatus)).map((it) => it.id);
  const restore = anchorsToRestore(oldIds, base.id);
  const what = label || (status === oldStatus ? 'Reorder' : `Move to ${STATUS_LABEL[status]}`);
  try {
    const result = await mutate({
      method: 'POST',
      path: `${itemPath(base.id)}/move`,
      body: { revision: base.revision, status, ...anchors },
      label: what,
      project: () => projectBoardMove(base.id, status, anchors),
    });
    if (result.changed && result.changed.length) {
      const msg = status === oldStatus ? `Reordered “${base.title}”.` : `Moved “${base.title}” to ${STATUS_LABEL[status]}.`;
      announce(msg);
      if (undo) {
        remember(what, async () => {
          const latest = getItem(base.id);
          if (!latest) return;
          try {
            await moveItem(latest, oldStatus, restore, { undo: false, label: 'Undo move' });
          } catch (err) {
            if (err instanceof ApiError && err.code === 'order_conflict') {
              await moveItem(getItem(base.id), oldStatus, { place: 'top' }, { undo: false, label: 'Undo move' });
            }
          }
        }, msg);
      }
    }
    return result.item;
  } catch (err) {
    reportError(err, what);
    throw err;
  }
}

export async function setArchived(item, archived, { undo = true } = {}) {
  const base = fresh(item);
  const what = archived ? 'Archive' : 'Restore';
  try {
    const result = await mutate({
      method: 'POST',
      path: `${itemPath(base.id)}/${archived ? 'archive' : 'restore'}`,
      body: { revision: base.revision },
      label: what,
    });
    const msg = archived ? `Archived “${base.title}”.` : `Restored “${base.title}”.`;
    if (undo) {
      remember(what, async () => {
        try {
          await setArchived(getItem(base.id), !archived, { undo: false });
        } catch { /* reported */ }
      }, msg);
    } else {
      toast(msg, { kind: 'success', timeout: 3000 });
    }
    return result.item;
  } catch (err) {
    reportError(err, what);
    throw err;
  }
}

export async function markReviewed(item) {
  const base = fresh(item);
  try {
    const result = await mutate({
      method: 'POST', path: `${itemPath(base.id)}/reviewed`, body: { revision: base.revision }, label: 'Mark reviewed',
    });
    toast(`Marked “${base.title}” as reviewed.`, { kind: 'success', timeout: 3000 });
    return result.item;
  } catch (err) {
    reportError(err, 'Mark reviewed');
    throw err;
  }
}

/** Replace one date entry (by id), add one (no id match), or remove one (entry null). */
export async function changeDate(item, dateId, entry, { label, message, project = false } = {}) {
  const base = fresh(item);
  let dates;
  if (entry === null) dates = base.dates.filter((d) => d.id !== dateId);
  else if (dateId && base.dates.some((d) => d.id === dateId)) {
    dates = base.dates.map((d) => (d.id === dateId ? { ...entry, id: dateId } : d));
  } else dates = [...base.dates, entry];
  return patchItem(base, { dates: dates.map(stripDerived) }, { label, message, project });
}

export function stripDerived(entry) {
  const { instant, end_instant: endInstant, tz_abbr: abbr, ...rest } = entry;
  return rest;
}

export async function saveSettings(patch) {
  try {
    await mutate({ method: 'PUT', path: '/api/settings', body: { settings: patch }, label: 'Preferences' });
    toast('Preferences saved.', { kind: 'success', timeout: 2500 });
  } catch (err) {
    reportError(err, 'Preferences');
    throw err;
  }
}
