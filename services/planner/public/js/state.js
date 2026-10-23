// Client state. The server is the authority: a change counts as saved only
// after the server confirms it. Drag moves show a visibly *pending* projection
// that is rolled back on rejection; a lost response leaves the change marked
// "unconfirmed" and it is re-sent with the same request id once reachable.

import { api, ApiError, NetworkError } from './api.js';
import { resolveZone, todayISO } from './dates.js';
import { uid } from './dom.js';
import { projectMove } from './ordering.js';

const SYNC_INTERVAL_MS = 20000;
const DRAFT_KEY = 'planning.drafts.v1';

export const state = {
  phase: 'loading', // loading | ready | error
  loadError: null,
  items: [],
  byId: new Map(),
  settings: { default_tz: 'America/New_York', week_start: 'sun', stale_days: 21 },
  version: 0,
  connection: 'online', // online | offline
  inFlight: 0,
  unconfirmed: [],
  pendingIds: new Set(),
  lastSavedAt: null,
  lastError: null,
  loadedAt: null,
  drafts: readDrafts(),
};

/** The owner's display zone for "today" and clock times (settings.default_tz). */
export function displayZone() {
  return resolveZone(state.settings?.default_tz);
}

/** Today's ISO day in the display zone. */
export function displayToday(now = new Date()) {
  return todayISO(now, displayZone());
}

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
let notifyQueued = false;
export function notify() {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    for (const fn of listeners) fn();
  });
}

export class OfflineError extends Error {
  constructor() {
    super('The planning server is unreachable, so this change was not sent.');
  }
}

function setItems(list) {
  state.items = list;
  state.byId = new Map(list.map((it) => [it.id, it]));
}

function upsert(item) {
  const index = state.items.findIndex((it) => it.id === item.id);
  const next = [...state.items];
  if (index >= 0) next[index] = item;
  else next.push(item);
  setItems(next);
}

function setConnection(value) {
  if (state.connection !== value) {
    state.connection = value;
    notify();
  }
}

export async function load({ quiet = false } = {}) {
  if (!quiet && state.phase !== 'ready') {
    state.phase = 'loading';
    notify();
  }
  try {
    const snapshot = await api.state();
    setItems(snapshot.items);
    state.settings = snapshot.settings;
    state.version = snapshot.state_version;
    state.phase = 'ready';
    state.loadError = null;
    state.loadedAt = new Date();
    setConnection('online');
  } catch (err) {
    if (state.phase !== 'ready') {
      state.phase = 'error';
      state.loadError = err.message;
    }
    if (err instanceof NetworkError) setConnection('offline');
  }
  notify();
}

function applyResult(result) {
  if (result && result.item) upsert(result.item);
  if (result && result.settings) state.settings = result.settings;
  if (result && typeof result.state_version === 'number') {
    const expectedOnlyOurs = result.state_version === state.version + 1;
    state.version = Math.max(state.version, result.state_version);
    // Another device changed something in between: pull the full picture.
    if (!expectedOnlyOurs) scheduleRefresh();
  }
}

let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (state.inFlight === 0 && state.unconfirmed.length === 0) load({ quiet: true });
  }, 250);
}

/**
 * Send one mutation. `project` may apply a pending local projection and must
 * return a function that undoes it.
 */
export async function mutate({ method, path, body, label = 'Change', project = null, requestId = uid(),
  onConfirmed = null }) {
  if (state.connection === 'offline') throw new OfflineError();
  const restore = project ? project() : null;
  state.inFlight += 1;
  notify();
  try {
    const result = await api.send(method, path, body, requestId);
    applyResult(result);
    state.lastSavedAt = new Date();
    state.lastError = null;
    if (restore) restore.settle();
    if (onConfirmed) onConfirmed(result);
    return result;
  } catch (err) {
    if (err instanceof NetworkError) {
      state.unconfirmed.push({ requestId, method, path, body, label, restore, onConfirmed });
      setConnection('offline');
      throw err;
    }
    if (restore) restore.rollback();
    if (err instanceof ApiError) {
      if (err.code === 'revision_conflict' && err.payload.current) upsert(err.payload.current);
      if (err.code === 'order_conflict' || err.code === 'not_found') scheduleRefresh();
    }
    state.lastError = err.message;
    throw err;
  } finally {
    state.inFlight -= 1;
    notify();
  }
}

/** Pending projection for a board move; returns {rollback, settle}. */
export function projectBoardMove(id, status, anchors) {
  const plan = projectMove(state.items, id, status, anchors);
  if (!plan) return null;
  const before = new Map();
  const next = state.items.map((it) => {
    const change = plan.get(it.id);
    if (!change) return it;
    before.set(it.id, it);
    return { ...it, status: change.status, position: change.position };
  });
  setItems(next);
  state.pendingIds.add(id);
  notify();
  return {
    rollback() {
      state.pendingIds.delete(id);
      setItems(state.items.map((it) => {
        const original = before.get(it.id);
        if (!original || it.revision !== original.revision) return it;
        return { ...it, status: original.status, position: original.position };
      }));
      scheduleRefresh();
    },
    settle() {
      state.pendingIds.delete(id);
      // Neighbours were renumbered server-side; refresh keeps positions exact.
      scheduleRefresh();
    },
  };
}

/** Pending projection for a field patch (used by calendar/timeline drags). */
export function projectPatch(id, patch) {
  const original = state.byId.get(id);
  if (!original) return null;
  upsert({ ...original, ...patch });
  state.pendingIds.add(id);
  notify();
  return {
    rollback() {
      state.pendingIds.delete(id);
      const current = state.byId.get(id);
      if (current && current.revision === original.revision) upsert(original);
    },
    settle() {
      state.pendingIds.delete(id);
    },
  };
}

/** Re-send unconfirmed changes with their original request ids. */
export async function retryUnconfirmed() {
  const failures = [];
  while (state.unconfirmed.length) {
    const entry = state.unconfirmed[0];
    try {
      const result = await api.send(entry.method, entry.path, entry.body, entry.requestId);
      applyResult(result);
      if (entry.restore) entry.restore.settle();
      if (entry.onConfirmed) entry.onConfirmed(result);
      state.lastSavedAt = new Date();
    } catch (err) {
      if (err instanceof NetworkError) {
        setConnection('offline');
        notify();
        return failures;
      }
      if (entry.restore) entry.restore.rollback();
      failures.push({ label: entry.label, message: err.message });
    }
    state.unconfirmed.shift();
  }
  setConnection('online');
  await load({ quiet: true });
  return failures;
}

let onReconnect = () => {};
export function setReconnectHandler(fn) {
  onReconnect = fn;
}

export async function checkServer() {
  try {
    const { state_version: version } = await api.version();
    const wasOffline = state.connection === 'offline';
    if (wasOffline) {
      setConnection('online');
      const failures = state.unconfirmed.length ? await retryUnconfirmed() : [];
      if (!state.unconfirmed.length) await load({ quiet: true });
      onReconnect(failures);
    } else if (version !== state.version && state.inFlight === 0 && state.unconfirmed.length === 0) {
      await load({ quiet: true });
    }
  } catch (err) {
    if (err instanceof NetworkError) setConnection('offline');
  }
}

export function startSync() {
  setInterval(() => {
    if (!document.hidden) checkServer();
  }, SYNC_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkServer();
  });
  window.addEventListener('online', () => checkServer());
  window.addEventListener('offline', () => setConnection('offline'));
}

// ------------------------------------------------------------------ drafts
// Device drafts exist only while the server is unreachable. They are labelled
// as not accepted by the planning store until sent and confirmed.

function readDrafts() {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((d) => d && d.localId && d.fields) : [];
  } catch {
    return [];
  }
}

function writeDrafts() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state.drafts));
    return true;
  } catch {
    return false;
  }
}

export function addDraft(fields) {
  const draft = { localId: uid(), requestId: uid(), fields, savedAt: new Date().toISOString() };
  state.drafts = [...state.drafts, draft];
  const ok = writeDrafts();
  notify();
  return ok;
}

export function discardDraft(localId) {
  state.drafts = state.drafts.filter((d) => d.localId !== localId);
  writeDrafts();
  notify();
}

export async function sendDraft(draft) {
  return mutate({
    method: 'POST', path: '/api/items', body: { fields: draft.fields },
    label: `Draft “${draft.fields.title}”`, requestId: draft.requestId,
    onConfirmed: () => discardDraft(draft.localId),
  });
}

export function getItem(id) {
  return state.byId.get(id) || null;
}

export function isPending(id) {
  return state.pendingIds.has(id) || state.unconfirmed.some((u) => u.path.includes(`/${id}`));
}
