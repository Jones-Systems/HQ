import { formatClock, resolveZone } from './upstream/manual-planner/dates.js';
import { projectMove } from './upstream/manual-planner/ordering.js';
import { attachDurability, registeredPersistence, type DurableUnconfirmed, type WorkPersistence } from './durability';
import { restoreAnchor } from './planning';
import {
  newRequestId, plannerErrorOf, recoveryErrorOf, REPLAY_FEATURE,
  type Anchor, type IndeterminateReason, type PlannerError, type PlannerLimit, type PlannerPort, type PlannerRecovery,
  type PlannerRecoveryError, type RecoveryIntent, type Snapshot, type UnavailableReason, type WriteResult,
} from './port';
import { HQ_REFERENCES_FEATURE, type Item, type ItemPatch, type NewItemFields, type PatchField, type Settings, type Status } from './types';
import { normalizeFields, stripDerived } from './validation';

// The Work state store (RW-5, RW-8, RW-9). It lives at module level, outside
// React, so it survives T0's remount of the module on every domain switch. All
// writes go through the PlannerPort; nothing here executes or dispatches work. A write whose outcome is unknown is
// never re-sent automatically or through its ordinary route: only the user's explicit Check (a replay lookup) and,
// once that proves it never landed, the explicit Apply (a replay resend) touch it, through the PlannerRecovery.
//
// With the offline queue on, an edit that finds the Planner unavailable (known not delivered) is kept as a queued
// write and projected on the board; when the Planner answers again each queued write is compared with what the Planner
// now holds before it is sent, so an edit never silently overwrites a change made elsewhere. A persistence registered
// for the port keeps queued and unconfirmed writes on this device across a restart (durability.ts).

export const UNDO_LIMIT = 40;
/** The most queued writes a store keeps, in any state; a write past it fails as it would without the queue. */
export const QUEUE_LIMIT = 200;
/** Unconfirmed writes live in memory only, unless a persistence keeps them on this device (`DURABLE_SCOPE_NOTE`). */
export const UNCONFIRMED_SCOPE_NOTE = 'Unconfirmed changes are kept for this session only.';
/** What a store with a persistence keeps on this device. */
export const DURABLE_SCOPE_NOTE = 'Queued and unconfirmed changes are kept on this device until resolved.';

/** The Planner capability that `no_batch` reports missing. */
const BATCH_FEATURE = 'items.batch_create';

export type WriteOp =
  | { op: 'create'; fields: NewItemFields }
  | { op: 'patch'; id: string; revision: number; patch: ItemPatch }
  | { op: 'move'; id: string; revision: number; status: Status; anchor: Anchor }
  | { op: 'setArchived'; id: string; revision: number; archived: boolean }
  | { op: 'markReviewed'; id: string; revision: number }
  | { op: 'updateSettings'; settings: Settings };

/** The answer of the last explicit Check of an unconfirmed write. */
export type RecoveryState =
  /** Provably not applied when checked; the user may Apply it, which the service applies at most once. */
  | { kind: 'not_applied'; checkedAt: string }
  /** Whether it was applied cannot be determined; read the board back. Nothing is sent for it. */
  | { kind: 'indeterminate'; reason: IndeterminateReason; checkedAt: string };

export interface UnconfirmedWrite {
  requestId: string;
  /** The intent as first sent. It is never re-sent through its ordinary route. */
  write: WriteOp;
  attemptedAt: string;
  /** The last confirmed state version before the attempt. */
  baseVersion: number;
  /**
   * `unconfirmed`: not yet checked, or the last check could not reach the Planner.
   * `awaiting_decision`: checked; `recovery` says whether Apply is possible or a read-back is needed.
   * `held`: the service reported request_id_reused, a defect; the queue stops.
   */
  state: 'unconfirmed' | 'awaiting_decision' | 'held';
  /** Set by an explicit Check; absent until then. */
  recovery?: RecoveryState;
  /** Heuristic flags (same title, created since the attempt). Never proof either way. */
  possiblySavedIds: string[];
}

export type UndoAction =
  | { type: 'patch'; itemId: string; before: Partial<Record<PatchField, unknown>>; after: Partial<Record<PatchField, unknown>> }
  | { type: 'move'; itemId: string; fromStatus: Status; toStatus: Status; restore: Anchor }
  | { type: 'archive'; itemId: string; archived: boolean }
  | { type: 'create'; itemId: string };

export interface UndoEntry { id: string; label: string; at: string; action: UndoAction }

export interface Conflict { itemId: string; requestId: string; current: Item; attempted: WriteOp }
export interface Notice { id: string; tone: 'info' | 'warning' | 'danger'; text: string }

/** Whether the Planner is answering. `connecting` lasts until the first read answers. */
export type ConnectionState =
  | { status: 'connecting' }
  | { status: 'online'; checkedAt: string; limits: PlannerLimit[] }
  /** `since` is the first failure of this offline period; it stays put until the Planner answers again. */
  | { status: 'offline'; since: string; checkedAt: string; reason: UnavailableReason };

/** A write kept on this device because the Planner could not take it yet. Never a create. */
export interface QueuedWrite {
  /** Unique across restarts (a UUID), never a per-session counter. */
  queueId: string;
  /** The ID of its latest send, or one reserved when it was queued. Every send assigns a fresh one; a sent ID is never reused. */
  requestId: string;
  write: WriteOp;
  /**
   * What the user saw when making the edit: the projected item (taken before this write itself is projected), or the
   * settings. The compare-and-swap base.
   */
  base: Item | Settings;
  queuedAt: string;
  /**
   * `queued`: waiting for the Planner. `sending`: sent, answer not yet known. `conflict`: the Planner changed what
   * this edit touches, so nothing was sent. `rejected`: the Planner refused it. A conflict or rejection blocks the
   * writes queued behind it for the same target until the user resolves it.
   */
  state: 'queued' | 'sending' | 'conflict' | 'rejected';
  /** State `conflict`: the differing fields (patch field names, `status`, `archived`, or settings keys) and the Planner's current version. */
  conflict?: { fields: string[]; current: Item | null; settings?: Settings };
  /** State `rejected`. */
  error?: PlannerError;
}

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving'; count: number }
  | { kind: 'saved'; at: string }
  | { kind: 'unconfirmed'; count: number }
  /** `queued` is the number of queued writes in any state; absent when there are none. */
  | { kind: 'offline'; queued?: number }
  | { kind: 'queued'; count: number };

export interface WorkState {
  load: 'idle' | 'loading' | 'ready' | 'unavailable';
  /** The last confirmed service view. */
  confirmed: Snapshot | null;
  /** Confirmed items with unconfirmed, queued (and sending) and pending writes projected on top, in that order. */
  items: Item[];
  pending: { requestId: string; write: WriteOp }[];
  unconfirmed: UnconfirmedWrite[];
  held: { requestId: string; reason: string } | null;
  conflicts: Conflict[];
  undo: UndoEntry[];
  notices: Notice[];
  save: SaveState;
  lastSyncedAt: string | null;
  /** A confirmed write could not read back its neighbours; the next poll refreshes even if the version is unchanged. */
  refreshDue?: boolean;
  connection: ConnectionState;
  /** Writes kept on this device, in the order they were made. Always empty with the offline queue off. */
  queued: QueuedWrite[];
  /** `off`: no durable storage (the example Planner, tests). `ok`: saved on this device. `failed`: the last save failed. */
  durable: 'off' | 'ok' | 'failed';
}

export interface SettingsResult { settings: Settings; stateVersion: number }

export type WriteOutcome<R = WriteResult> =
  | { status: 'saved'; result: R; undoId?: string }
  | { status: 'unconfirmed'; requestId: string }
  /** `queued` names the entry that kept the write, when the Planner was unavailable and the queue is on. */
  | { status: 'failed'; error: PlannerError; queued?: { queueId: string } };

export type UndoOutcome =
  | { status: 'undone' }
  | { status: 'refused'; message: string }
  | { status: 'empty' }
  | Exclude<WriteOutcome, { status: 'saved' }>;

export interface WorkStoreOptions {
  now?: () => Date;
  newRequestId?: () => string;
  /** Replay-aware recovery for unknown writes. Without it, Check sends nothing and asks for a read-back. */
  recovery?: PlannerRecovery;
  /** Keep edits made while the Planner is unavailable. Also on whenever a persistence is in effect. Off by default. */
  offlineQueue?: boolean;
  /** Keeps queued and unconfirmed writes on this device. Defaults to the persistence registered for the port. */
  persistence?: WorkPersistence;
}

/** What one explicit Check or Apply did. `refused` and `missing` sent nothing. */
export type RecoveryOutcome = 'confirmed' | 'not_applied' | 'indeterminate' | 'still_unknown' | 'stopped' | 'resolved' | 'refused' | 'missing';

const FIELD_LABEL: Record<PatchField, string> = {
  title: 'Title', kind: 'Kind', motivation: 'Why', horizon: 'Horizon', priority: 'Priority', area: 'Area',
  notes: 'Notes', next_steps: 'Checklist', references: 'Links', dates: 'Dates',
};

const clone = <T>(value: T): T => structuredClone(value);

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]));
  }
  return value;
}
/** A field's write form: dates lose their derived read-only members. */
function writable(field: PatchField, value: unknown): unknown {
  return field === 'dates' && Array.isArray(value) ? value.map(stripDerived) : clone(value);
}

function notChangedMessage(fields: string[]): string {
  const names = fields.length === 1 ? fields[0]! : `${fields.slice(0, -1).join(', ')} and ${fields[fields.length - 1]}`;
  return fields.length === 1
    ? `Not undone: ${names} was changed again since; the newer value was kept.`
    : `Not undone: ${names} were changed again since; the newer values were kept.`;
}

/** The visible save label: Saving… / Saved · time / N unconfirmed / N queued / Offline · N queued / Offline · not saving. */
export function saveLabel(save: SaveState, settings: Pick<Settings, 'default_tz'> | null): string {
  switch (save.kind) {
    case 'saving': return 'Saving…';
    case 'saved': return `Saved · ${formatClock(save.at, resolveZone(settings?.default_tz))}`;
    case 'unconfirmed': return `${save.count} unconfirmed`;
    case 'queued': return `${save.count} queued`;
    case 'offline': return save.queued ? `Offline · ${save.queued} queued` : 'Offline · not saving';
    default: return '';
  }
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const newQueueId = () => globalThis.crypto.randomUUID();

/** Why a failed read could not use the Planner: no answer is `unreachable`; any other Planner error is `incompatible`. */
function readFailureReason(reason: unknown): UnavailableReason {
  const error = plannerErrorOf(reason);
  return error.kind === 'unavailable' ? error.reason ?? 'unreachable' : 'incompatible';
}

/** The capabilities HQ uses that the Planner does not advertise, in a fixed order. */
function limitsOf(features: readonly string[]): PlannerLimit[] {
  const limits: PlannerLimit[] = [];
  if (!features.includes(REPLAY_FEATURE)) limits.push('no_replay');
  if (!features.includes(HQ_REFERENCES_FEATURE)) limits.push('no_hq_references');
  if (!features.includes(BATCH_FEATURE)) limits.push('no_batch');
  return limits;
}

/** The queue key of a write: its item, or `settings`. Creates are never queued. */
const queueTarget = (write: WriteOp): string | null => (write.op === 'create' ? null : write.op === 'updateSettings' ? 'settings' : write.id);

/** What a queued write touches, named as a conflict names it. */
function touchedBy(write: WriteOp, base: Item | Settings): string[] {
  switch (write.op) {
    case 'patch': return Object.keys(write.patch);
    case 'move': return ['status'];
    case 'setArchived': return ['archived'];
    case 'markReviewed': return ['reviewed'];
    case 'updateSettings': return (Object.keys(write.settings) as (keyof Settings)[]).filter((key) => !sameValue(write.settings[key], (base as Settings)[key]));
    default: return [];
  }
}

/** What the compare and swap decided for one queued write. */
type Decision =
  | { kind: 'send'; write: WriteOp }
  /** The Planner already holds what this write would do. */
  | { kind: 'drop' }
  | { kind: 'missing' }
  | { kind: 'conflict'; fields: string[]; current: Item | null; settings?: Settings };

/** Where one flush step left a queued write. */
type FlushStep = 'sent' | 'dropped' | 'blocked' | 'unknown' | 'skipped' | 'stop';

type QueueOutcome = WriteOutcome | WriteOutcome<SettingsResult>;

export type WorkStore = ReturnType<typeof createWorkStore>;

export function createWorkStore(port: PlannerPort, options: WorkStoreOptions = {}) {
  const now = options.now ?? (() => new Date());
  const nextRequestId = options.newRequestId ?? newRequestId;
  const recovery = options.recovery ?? null;
  const persistence = options.persistence ?? registeredPersistence(port);
  const queueEnabled = options.offlineQueue === true || persistence !== undefined;
  const slot = persistence ? attachDurability(persistence, now) : null;
  const listeners = new Set<() => void>();
  const chains = new Map<string, Promise<unknown>>();
  /** The connection is the single truth; the offline flag is read from it. */
  let connection: ConnectionState = { status: 'connecting' };
  let savedAt: string | null = null;
  let counter = 0;
  let state: WorkState = {
    load: 'idle', confirmed: null, items: [], pending: [], unconfirmed: [], held: null,
    conflicts: [], undo: [], notices: [], save: { kind: 'idle' }, lastSyncedAt: null,
    connection, queued: [], durable: slot ? slot.status() : 'off',
  };

  // Offline queue and durable state.
  /** The adapter's recorded intent for each unconfirmed write, taken when it became unconfirmed. Kept off the public state. */
  const intents = new Map<string, RecoveryIntent | null>();
  /** The offline period whose "changes are kept on this device" notice was shown. */
  let keptNoticeSince: string | null = null;
  let flushing: Promise<void> | null = null;
  /** A flush is owed: the Planner answered after an offline period, or queued writes were just restored. */
  let flushDue = false;
  let restoring: Promise<void> | null = null;
  /** Entries whose outcome a caller of `resolveQueued` is waiting for. */
  const outcomes = new Map<string, QueueOutcome | null>();
  const pendingDurable = new Map<string, DurableUnconfirmed>();
  let persistedPending = state.pending;
  let persistedQueued: QueuedWrite[] = state.queued;
  let persistedUnconfirmed: UnconfirmedWrite[] = state.unconfirmed;
  let persistedText = JSON.stringify({ queued: [], unconfirmed: [] });

  const stamp = () => now().toISOString();
  const localId = (prefix: string) => `${prefix}-${(counter += 1)}`;
  const isOffline = () => connection.status === 'offline';
  /** What a queued write reports as its reason: the connection's, or `unreachable` when it is online. */
  const reasonNow = (): UnavailableReason => (connection.status === 'offline' ? connection.reason : 'unreachable');

  /** The Planner answered. True when that ends an offline period. Published by the caller's next `set`. */
  function goOnline(checkedAt: string, features: readonly string[] | undefined = state.confirmed?.features): boolean {
    const ended = connection.status === 'offline';
    connection = { status: 'online', checkedAt, limits: features ? limitsOf(features) : [] };
    return ended;
  }

  /** The Planner could not be used. `since` stays at the first failure until it answers again. */
  function goOffline(reason: UnavailableReason = 'unreachable') {
    const checkedAt = stamp();
    connection = { status: 'offline', since: connection.status === 'offline' ? connection.since : checkedAt, checkedAt, reason };
  }

  /** An answer from the Planner. One that ends an offline period wakes the queue. */
  function answered(checkedAt: string) {
    if (goOnline(checkedAt) && queueEnabled) queueMicrotask(() => { if (state.queued.some((q) => q.state === 'queued')) void runFlush(true); });
  }

  function project(confirmed: Snapshot | null, writes: readonly { write: WriteOp; at?: string }[]): Item[] {
    let items = confirmed ? confirmed.items : [];
    for (const { write, at } of writes) {
      switch (write.op) {
        case 'patch':
          items = items.map((item) => item.id === write.id ? { ...item, ...(clone(write.patch) as Partial<Item>) } : item);
          break;
        case 'move': {
          const placed = projectMove(items, write.id, write.status, write.anchor);
          if (placed) items = items.map((item) => placed.has(item.id) ? { ...item, ...placed.get(item.id)!, status: placed.get(item.id)!.status as Status } : item);
          break;
        }
        case 'setArchived':
          items = items.map((item) => item.id === write.id ? { ...item, archived_at: write.archived ? at ?? stamp() : null } : item);
          break;
        case 'markReviewed':
          items = items.map((item) => item.id === write.id ? { ...item, reviewed_at: at ?? stamp() } : item);
          break;
        default:
          break;
      }
    }
    return items;
  }

  function set(patch: Partial<WorkState>) {
    const next = { ...state, ...patch };
    // Conflicting and rejected queue entries are not projected: the board shows the Planner's version there.
    const writes = [
      ...next.unconfirmed.map((u) => ({ write: u.write })),
      ...next.queued.filter((q) => q.state === 'queued' || q.state === 'sending').map((q) => ({ write: q.write, at: q.queuedAt })),
      ...next.pending.map((p) => ({ write: p.write })),
    ];
    const unconfirmedCount = next.unconfirmed.length;
    const queuedCount = next.queued.length;
    const save: SaveState = connection.status === 'offline' ? (queuedCount ? { kind: 'offline', queued: queuedCount } : { kind: 'offline' })
      : unconfirmedCount ? { kind: 'unconfirmed', count: unconfirmedCount }
        : queuedCount ? { kind: 'queued', count: queuedCount }
          : next.pending.length ? { kind: 'saving', count: next.pending.length }
            : savedAt ? { kind: 'saved', at: savedAt } : { kind: 'idle' };
    state = { ...next, connection, items: project(next.confirmed, writes), save };
    persist();
    for (const listener of listeners) listener();
  }

  /** Pending sends are stored as unknown outcomes: a restart never repeats them automatically. */
  function persist() {
    if (!slot || (state.pending === persistedPending && state.queued === persistedQueued && state.unconfirmed === persistedUnconfirmed)) return;
    persistedPending = state.pending;
    for (const id of pendingDurable.keys()) if (!state.pending.some((p) => p.requestId === id)) pendingDurable.delete(id);
    persistedQueued = state.queued;
    persistedUnconfirmed = state.unconfirmed;
    for (const id of [...intents.keys()]) if (!state.unconfirmed.some((u) => u.requestId === id)) intents.delete(id);
    const unconfirmed: DurableUnconfirmed[] = [
      ...pendingDurable.values(),
      ...state.unconfirmed.map((u) => ({ ...u, intent: intents.get(u.requestId) ?? null })),
    ];
    const text = JSON.stringify({ queued: state.queued, unconfirmed });
    if (text === persistedText) return;
    persistedText = text;
    slot.update({ queued: state.queued, unconfirmed });
  }

  if (slot) slot.onStatus(() => set({ durable: slot.status() }));

  function notify(tone: Notice['tone'], text: string) {
    set({ notices: [...state.notices, { id: localId('notice'), tone, text }].slice(-10) });
  }

  function confirmedItem(id: string): Item | undefined {
    return state.confirmed?.items.find((item) => item.id === id);
  }

  /** Serializes writes per item so each is sent at the latest confirmed revision. */
  function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = chains.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    chains.set(key, run.catch(() => undefined));
    return run;
  }

  function absorb(result: WriteResult | SettingsResult) {
    const confirmed = state.confirmed;
    if (!confirmed) return;
    const known = confirmed.stateVersion;
    const replayed = 'replayed' in result && result.replayed;
    const stale = 'stale' in result && result.stale === true;
    if (stale) set({ refreshDue: true });
    // A replay carries the originally recorded items, which may be stale. Responses may arrive out of order, so an
    // older response still contributes each item at a newer revision than the one held, and the state version only
    // moves forward. A move renumbers neighbours without a new revision, so a newer response also keeps equal ones.
    if (!replayed) {
      const newer = result.stateVersion > known;
      let items = confirmed.items;
      const updates = 'settings' in result ? [] : [...(result.item ? [result.item] : []), ...result.changed];
      for (const update of updates) {
        const held = items.find((item) => item.id === update.id);
        if (!held) items = [...items, update];
        else if (update.revision > held.revision || (newer && update.revision === held.revision)) items = items.map((item) => item.id === update.id ? update : item);
      }
      if (newer || items !== confirmed.items) {
        set({ confirmed: { ...confirmed, items, stateVersion: Math.max(known, result.stateVersion), settings: newer && 'settings' in result ? result.settings : confirmed.settings } });
      }
    }
    if (replayed || stale || result.stateVersion !== known + 1) void refresh();
  }

  async function refresh(): Promise<boolean> {
    try {
      const snapshot = await port.snapshot();
      if (state.confirmed && snapshot.stateVersion < state.confirmed.stateVersion) return true;
      if (goOnline(snapshot.observedAt, snapshot.features) && queueEnabled) flushDue = true;
      set({ confirmed: snapshot, load: 'ready', lastSyncedAt: snapshot.observedAt, refreshDue: false });
      flagPossiblySaved();
      return true;
    } catch (reason) {
      goOffline(readFailureReason(reason));
      set({ load: state.confirmed ? state.load : 'unavailable' });
      return false;
    }
  }

  function flagPossiblySaved() {
    const items = state.confirmed?.items ?? [];
    set({
      unconfirmed: state.unconfirmed.map((entry) => {
        if (entry.write.op !== 'create') return entry;
        const { title } = entry.write.fields;
        return { ...entry, possiblySavedIds: items.filter((item) => item.title === title && item.created_at >= entry.attemptedAt).map((item) => item.id) };
      }),
    });
  }

  function send(write: WriteOp, requestId: string): Promise<WriteResult | SettingsResult> {
    switch (write.op) {
      case 'create': return port.create(write.fields, requestId);
      case 'patch': return port.patch(write.id, write.revision, write.patch, requestId);
      case 'move': return port.move(write.id, write.revision, write.status, write.anchor, requestId);
      case 'setArchived': return port.setArchived(write.id, write.revision, write.archived, requestId);
      case 'markReviewed': return port.markReviewed(write.id, write.revision, requestId);
      case 'updateSettings': return port.updateSettings(write.settings, requestId);
    }
  }

  const targetOf = (write: WriteOp) => ('id' in write ? write.id : null);

  /** Settles a failed send. Returns the outcome; `unknown` queues the exact request. */
  function settleFailure(write: WriteOp, requestId: string, error: PlannerError, baseVersion: number, attemptedAt: string): Exclude<WriteOutcome, { status: 'saved' }> {
    const pending = state.pending.filter((p) => p.requestId !== requestId);
    if (error.kind === 'unknown') {
      if (isOffline()) answered(stamp());
      return addUnconfirmed({ pending }, { requestId, write, attemptedAt, baseVersion, state: 'unconfirmed', possiblySavedIds: [] });
    }
    if (error.kind === 'unavailable') goOffline(error.reason);
    else answered(stamp());
    set({ pending });
    applyError(write, requestId, error);
    return { status: 'failed', error };
  }

  /** Adds an unconfirmed write, keeping the adapter's recorded intent for the durable copy. */
  function addUnconfirmed(patch: Partial<WorkState>, entry: UnconfirmedWrite): { status: 'unconfirmed'; requestId: string } {
    intents.set(entry.requestId, recovery?.exportIntent?.(entry.requestId) ?? null);
    set({ ...patch, unconfirmed: [...state.unconfirmed, entry] });
    return { status: 'unconfirmed', requestId: entry.requestId };
  }

  function applyError(write: WriteOp, requestId: string, error: PlannerError) {
    if (error.kind === 'revision_conflict' && state.confirmed) {
      const current = error.current;
      const items = state.confirmed.items.map((item) => item.id === current.id ? current : item);
      set({ confirmed: { ...state.confirmed, items }, conflicts: [...state.conflicts.filter((c) => c.itemId !== current.id), { itemId: current.id, requestId, current, attempted: write }] });
    } else if (error.kind === 'order_conflict') {
      notify('warning', 'The board changed since it was loaded, so nothing moved. It has been refreshed.');
      void refresh();
    } else if (error.kind === 'request_id_reused') {
      set({ held: { requestId, reason: 'The Planner reports this request ID was already used for a different change.' } });
    } else if (error.kind === 'unavailable') {
      notify('warning', 'The Planner is unavailable; nothing was saved.');
    }
  }

  /**
   * Sends one write through the ordinary first-send path. With `keep` (what the user saw), a send that fails
   * `unavailable` (known not delivered) is queued instead of failing.
   */
  async function dispatchWrite<R extends WriteResult | SettingsResult = WriteResult>(write: WriteOp, onSaved?: (result: WriteResult) => UndoAction | null, label?: string, keep?: Item | Settings): Promise<WriteOutcome<R>> {
    if (slot) await ensureRestored();
    const requestId = nextRequestId();
    const baseVersion = state.confirmed?.stateVersion ?? 0;
    const attemptedAt = stamp();
    if (slot) pendingDurable.set(requestId, { requestId, write: clone(write), attemptedAt, baseVersion, state: 'unconfirmed', possiblySavedIds: [], intent: null });
    set({ pending: [...state.pending, { requestId, write }] });
    if (slot) await slot.settle();
    try {
      const result = await send(write, requestId) as R;
      savedAt = stamp();
      answered(savedAt);
      set({ pending: state.pending.filter((p) => p.requestId !== requestId), conflicts: state.conflicts.filter((c) => c.itemId !== targetOf(write)) });
      absorb(result);
      if (!('replayed' in result)) return { status: 'saved', result };
      const action = onSaved?.(result) ?? null;
      if (!action) return { status: 'saved', result };
      const entry: UndoEntry = { id: localId('undo'), label: label ?? 'Change', at: stamp(), action };
      set({ undo: [...state.undo, entry].slice(-UNDO_LIMIT) });
      return { status: 'saved', result, undoId: entry.id };
    } catch (reason) {
      const error = plannerErrorOf(reason, requestId);
      if (keep && error.kind === 'unavailable') {
        goOffline(error.reason);
        return enqueue<R>(write, keep, requestId);
      }
      return settleFailure(write, requestId, error, baseVersion, attemptedAt);
    }
  }

  // ----------------------------------------------------------- offline queue

  const hasQueued = (target: string) => state.queued.some((q) => queueTarget(q.write) === target);

  /**
   * Sends a write that may be queued. It is queued without sending while the Planner is offline or while its target
   * already has queued writes (so per-target order holds even online); otherwise it is sent, and queued if that fails
   * `unavailable`. With the queue off it is simply sent.
   */
  function submit<R extends WriteResult | SettingsResult = WriteResult>(target: string, write: WriteOp, seen: () => Item | Settings | undefined, onSaved?: (result: WriteResult) => UndoAction | null, label?: string): Promise<WriteOutcome<R>> {
    const base = queueEnabled ? seen() : undefined;
    if (base === undefined) return dispatchWrite<R>(write, onSaved, label);
    const kept = clone(base);
    if (isOffline() || hasQueued(target)) return Promise.resolve(enqueue<R>(write, kept, null));
    return dispatchWrite<R>(write, onSaved, label, kept);
  }

  /** The item as the user sees it, projected writes included. */
  const projectedItem = (id: string): Item | undefined => state.items.find((item) => item.id === id);

  /** Keeps `write` on this device. `sentRequestId` is the failed first send, which is no longer pending. */
  function enqueue<R extends WriteResult | SettingsResult = WriteResult>(write: WriteOp, base: Item | Settings, sentRequestId: string | null): Exclude<WriteOutcome<R>, { status: 'saved' }> {
    const pending = sentRequestId ? state.pending.filter((p) => p.requestId !== sentRequestId) : state.pending;
    const reason = reasonNow();
    if (state.queued.length >= QUEUE_LIMIT) {
      set({ pending });
      notify('danger', `${QUEUE_LIMIT} changes are already kept on this device, so this change was not kept.`);
      return { status: 'failed', error: { kind: 'unavailable', reason } };
    }
    const entry: QueuedWrite = { queueId: newQueueId(), requestId: sentRequestId ?? nextRequestId(), write: clone(write), base, queuedAt: stamp(), state: 'queued' };
    set({ pending, queued: [...state.queued, entry] });
    if (connection.status === 'offline' && keptNoticeSince !== connection.since) {
      keptNoticeSince = connection.since;
      notify('info', 'The Planner is unavailable. Changes are kept on this device and sent when it is back.');
    }
    return { status: 'failed', error: { kind: 'unavailable', reason }, queued: { queueId: entry.queueId } };
  }

  const features = () => state.confirmed?.features ?? [];
  const localInvalid = (errors: { field: string; message: string }[]): WriteOutcome => ({ status: 'failed', error: { kind: 'invalid', errors } });

  function patchItem(id: string, patch: ItemPatch): Promise<WriteOutcome> {
    return serial(id, async () => {
      if ('status' in patch) return localInvalid([{ field: 'status', message: 'Status changes use move.' }]);
      const normalized = normalizeFields(patch, { creating: false, features: features() });
      if (!normalized.ok) return localInvalid(normalized.errors);
      const item = confirmedItem(id);
      if (!item) return { status: 'failed', error: { kind: 'not_found' } };
      const body = normalized.value as ItemPatch;
      const fields = Object.keys(body) as PatchField[];
      const before = Object.fromEntries(fields.map((f) => [f, writable(f, item[f])]));
      return submit(id, { op: 'patch', id, revision: item.revision, patch: body }, () => projectedItem(id) ?? item, (result) => {
        if (!result.changed.length || !result.item) return null;
        return { type: 'patch', itemId: id, before, after: Object.fromEntries(fields.map((f) => [f, writable(f, result.item![f])])) };
      }, `Edited ${fields.map((f) => FIELD_LABEL[f]).join(', ')}`);
    });
  }

  function moveItem(id: string, status: Status, anchor: Anchor): Promise<WriteOutcome> {
    return serial(id, async () => {
      const item = confirmedItem(id);
      if (!item || !state.confirmed) return { status: 'failed', error: { kind: 'not_found' } };
      const restore = restoreAnchor(state.confirmed.items, id)!;
      const fromStatus = item.status;
      return submit(id, { op: 'move', id, revision: item.revision, status, anchor }, () => projectedItem(id) ?? item, (result) => (
        result.item && result.item.revision !== item.revision ? { type: 'move', itemId: id, fromStatus, toStatus: status, restore } : null
      ), 'Moved');
    });
  }

  function archiveItem(id: string, archived: boolean): Promise<WriteOutcome> {
    return serial(id, async () => {
      const item = confirmedItem(id);
      if (!item) return { status: 'failed', error: { kind: 'not_found' } };
      return submit(id, { op: 'setArchived', id, revision: item.revision, archived }, () => projectedItem(id) ?? item, (result) => (
        result.changed.length ? { type: 'archive', itemId: id, archived } : null
      ), archived ? 'Archived' : 'Restored');
    });
  }

  // ---------------------------------------------------------------- undo

  async function runUndo(entry: UndoEntry): Promise<UndoOutcome> {
    const { action } = entry;
    return serial(action.itemId, async () => {
      if (hasQueued(action.itemId)) return { status: 'refused', message: 'Not undone: this item has changes queued on this device.' };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const current = confirmedItem(action.itemId);
        if (!current) return { status: 'refused', message: 'Not undone: the item is no longer available.' };
        let write: WriteOp;
        if (action.type === 'patch') {
          const changed = (Object.keys(action.after) as PatchField[]).filter((f) => !sameValue(writable(f, current[f]), action.after[f]));
          if (changed.length) return { status: 'refused', message: notChangedMessage(changed.map((f) => FIELD_LABEL[f])) };
          write = { op: 'patch', id: current.id, revision: current.revision, patch: clone(action.before) as ItemPatch };
        } else if (action.type === 'move') {
          if (current.status !== action.toStatus) return { status: 'refused', message: notChangedMessage(['Status']) };
          write = { op: 'move', id: current.id, revision: current.revision, status: action.fromStatus, anchor: action.restore };
        } else {
          const archived = action.type === 'archive' ? action.archived : false;
          if (Boolean(current.archived_at) !== archived) return { status: 'refused', message: notChangedMessage(['Archived']) };
          write = { op: 'setArchived', id: current.id, revision: current.revision, archived: !archived };
        }
        const outcome = await dispatchWrite(write);
        if (outcome.status === 'saved') return { status: 'undone' };
        // A stale local revision: re-check the swap against the current item once.
        if (outcome.status === 'failed' && outcome.error.kind === 'revision_conflict' && attempt === 0) {
          set({ conflicts: state.conflicts.filter((c) => c.itemId !== action.itemId) });
          continue;
        }
        if (outcome.status === 'failed' && outcome.error.kind === 'order_conflict') {
          return { status: 'refused', message: 'Not undone: its old neighbour moved, so nothing was changed.' };
        }
        return outcome;
      }
      return { status: 'refused', message: 'Not undone: the item keeps changing; nothing was changed.' };
    });
  }

  function take(entryId?: string): UndoEntry | null {
    const index = entryId === undefined ? state.undo.length - 1 : state.undo.findIndex((e) => e.id === entryId);
    if (index < 0) return null;
    const entry = state.undo[index]!;
    set({ undo: state.undo.filter((_, i) => i !== index) });
    return entry;
  }

  // -------------------------------------------------------- reconciliation

  function updateEntry(requestId: string, change: (entry: UnconfirmedWrite) => UnconfirmedWrite) {
    set({ unconfirmed: state.unconfirmed.map((u) => u.requestId === requestId ? change(u) : u) });
  }

  function confirm(entry: UnconfirmedWrite, result: WriteResult | SettingsResult, message: string): RecoveryOutcome {
    savedAt = stamp();
    answered(savedAt);
    set({ unconfirmed: state.unconfirmed.filter((u) => u.requestId !== entry.requestId) });
    absorb(result);
    void refresh();
    notify('info', message);
    return 'confirmed';
  }

  function recoveryFailure(entry: UnconfirmedWrite, error: PlannerRecoveryError): RecoveryOutcome {
    switch (error.kind) {
      case 'replay_indeterminate':
        answered(stamp());
        updateEntry(entry.requestId, (u) => ({ ...u, state: 'awaiting_decision', recovery: { kind: 'indeterminate', reason: error.reason, checkedAt: stamp() } }));
        return 'indeterminate';
      case 'unavailable':
        // The failed Check or Apply consumed the adapter's Apply authorization, so a `not_applied` answer no longer
        // stands: Apply needs a fresh Check.
        goOffline(error.reason);
        if (entry.recovery?.kind === 'not_applied') updateEntry(entry.requestId, ({ recovery: _previous, ...u }) => ({ ...u, state: 'unconfirmed' }));
        else set({});
        return 'stopped';
      case 'unknown': {
        // An apply whose answer was lost may have landed just now: back to unconfirmed, and Apply needs a new Check.
        if (isOffline()) answered(stamp());
        updateEntry(entry.requestId, ({ recovery: _previous, ...u }) => ({ ...u, state: 'unconfirmed' }));
        return 'still_unknown';
      }
      case 'request_id_reused':
        set({
          unconfirmed: state.unconfirmed.map((u) => u.requestId === entry.requestId ? { ...u, state: 'held' } : u),
          held: { requestId: entry.requestId, reason: 'The Planner reports this request ID was already used for a different change. This is a defect; the queue is held.' },
        });
        return 'stopped';
      default:
        // An apply the service refused rolled back: it did not land, now or before.
        set({ unconfirmed: state.unconfirmed.filter((u) => u.requestId !== entry.requestId) });
        applyError(entry.write, entry.requestId, error);
        if (error.kind === 'revision_conflict') notify('warning', 'An unconfirmed change was not applied: the item changed since. Its current version is shown.');
        else if (error.kind !== 'order_conflict') notify('danger', 'An unconfirmed change was rejected by the Planner.');
        return 'resolved';
    }
  }

  /** The explicit Check: a replay lookup. It never applies or re-sends the write. */
  async function check(entry: UnconfirmedWrite): Promise<RecoveryOutcome> {
    if (!recovery) return recoveryFailure(entry, { kind: 'replay_indeterminate', requestId: entry.requestId, reason: 'unsupported' });
    try {
      const answer = await recovery.check(entry.requestId);
      if (answer.outcome === 'replayed') return confirm(entry, answer.result, 'An unconfirmed change was already saved; confirmed.');
      answered(stamp());
      updateEntry(entry.requestId, (u) => ({ ...u, state: 'awaiting_decision', recovery: { kind: 'not_applied', checkedAt: stamp() } }));
      return 'not_applied';
    } catch (reason) {
      return recoveryFailure(entry, recoveryErrorOf(reason, entry.requestId, 'check'));
    }
  }

  /** The explicit Apply: a replay resend, offered only after a Check proved the write never landed. */
  async function apply(entry: UnconfirmedWrite): Promise<RecoveryOutcome> {
    if (!recovery || entry.recovery?.kind !== 'not_applied') return 'refused';
    try {
      const answer = await recovery.apply(entry.requestId);
      return confirm(entry, answer.result, answer.outcome === 'applied_now' ? 'An unconfirmed change is now saved.' : 'An unconfirmed change was already saved; confirmed.');
    } catch (reason) {
      return recoveryFailure(entry, recoveryErrorOf(reason, entry.requestId, 'apply'));
    }
  }

  /** A Check can still change the answer: unchecked, not applied, or the Planner lacked the replay route. */
  const checkable = (u: UnconfirmedWrite) => u.state === 'unconfirmed'
    || (u.state === 'awaiting_decision' && (u.recovery?.kind === 'not_applied' || (u.recovery?.kind === 'indeterminate' && u.recovery.reason === 'unsupported')));

  /** Check now: looks up every checkable unconfirmed write, one at a time. Sends no write. */
  async function reconcile(): Promise<void> {
    if (state.held) return;
    flagPossiblySaved();
    for (const { requestId } of [...state.unconfirmed]) {
      if (state.held) return;
      const entry = state.unconfirmed.find((u) => u.requestId === requestId);
      if (!entry || !checkable(entry)) continue;
      if (await check(entry) === 'stopped') return;
    }
  }

  // ----------------------------------------------------------------- flushing

  const queuedEntry = (queueId: string) => state.queued.find((q) => q.queueId === queueId);

  function changeEntry(queueId: string, change: (entry: QueuedWrite) => QueuedWrite) {
    set({ queued: state.queued.map((q) => q.queueId === queueId ? change(q) : q) });
  }

  function removeEntry(queueId: string) {
    set({ queued: state.queued.filter((q) => q.queueId !== queueId) });
  }

  /** Records the outcome for a caller of `resolveQueued` that is waiting for it. */
  function finish(queueId: string, outcome: QueueOutcome) {
    if (outcomes.has(queueId)) outcomes.set(queueId, outcome);
  }

  const titleOf = (entry: QueuedWrite): string => {
    const { write } = entry;
    if (write.op === 'updateSettings' || write.op === 'create') return 'Planner settings';
    return `“${confirmedItem(write.id)?.title ?? (entry.base as Item).title}”`;
  };

  /**
   * The compare and swap: what to do with a queued write against what the Planner holds now, field by field, three
   * ways (the base the user saw, the write, the current Planner version).
   */
  function decide(entry: QueuedWrite): Decision {
    const { write } = entry;
    if (write.op === 'updateSettings') {
      const current = state.confirmed?.settings;
      if (!current) return { kind: 'missing' };
      const base = entry.base as Settings;
      const keys = (Object.keys(write.settings) as (keyof Settings)[]).filter((key) => !sameValue(write.settings[key], base[key]));
      if (!keys.length) return { kind: 'drop' };
      const clash = keys.filter((key) => !sameValue(current[key], base[key]) && !sameValue(current[key], write.settings[key]));
      if (clash.length) return { kind: 'conflict', fields: clash, current: null, settings: clone(current) };
      if (keys.every((key) => sameValue(current[key], write.settings[key]))) return { kind: 'drop' };
      return { kind: 'send', write: { op: 'updateSettings', settings: { ...current, ...Object.fromEntries(keys.map((key) => [key, clone(write.settings[key])])) } } };
    }
    if (write.op === 'create') return { kind: 'missing' };
    const current = confirmedItem(write.id);
    if (!current) return { kind: 'missing' };
    const base = entry.base as Item;
    const conflict = (fields: string[]): Decision => ({ kind: 'conflict', fields, current: clone(current) });
    switch (write.op) {
      case 'patch': {
        const fields = Object.keys(write.patch) as PatchField[];
        const mine = (f: PatchField) => writable(f, write.patch[f]);
        const clash = fields.filter((f) => !sameValue(writable(f, base[f]), writable(f, current[f])) && !sameValue(writable(f, current[f]), mine(f)));
        if (clash.length) return conflict(clash);
        if (fields.every((f) => sameValue(writable(f, current[f]), mine(f)))) return { kind: 'drop' };
        return { kind: 'send', write: { ...write, revision: current.revision } };
      }
      case 'move': {
        const clash: string[] = [];
        if (current.status !== base.status && current.status !== write.status) clash.push('status');
        if (Boolean(current.archived_at) !== Boolean(base.archived_at)) clash.push('archived');
        return clash.length ? conflict(clash) : { kind: 'send', write: { ...write, revision: current.revision } };
      }
      case 'setArchived':
        return Boolean(current.archived_at) === write.archived ? { kind: 'drop' } : { kind: 'send', write: { ...write, revision: current.revision } };
      default:
        return { kind: 'send', write: { ...write, revision: current.revision } };
    }
  }

  function markConflict(entry: QueuedWrite, decision: Extract<Decision, { kind: 'conflict' }>) {
    changeEntry(entry.queueId, (q) => ({
      ...q, state: 'conflict',
      conflict: { fields: decision.fields, current: decision.current, ...(decision.settings ? { settings: decision.settings } : {}) },
    }));
    notify('warning', `${titleOf(entry)} changed in the Planner while this change was waiting, so it was not sent. Keep yours or discard it.`);
  }

  function markRejected(entry: QueuedWrite, error: PlannerError) {
    changeEntry(entry.queueId, (q) => ({ ...q, state: 'rejected', error }));
    notify('warning', error.kind === 'not_found'
      ? `${titleOf(entry)} is no longer in the Planner, so its queued change was not sent.`
      : `The Planner rejected the queued change to ${titleOf(entry)}.`);
    finish(entry.queueId, { status: 'failed', error });
  }

  /** Sends the head entry of its target through the ordinary path, once its compare and swap passes. */
  async function sendHead(queueId: string): Promise<FlushStep> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const entry = queuedEntry(queueId);
      if (!entry || entry.state !== 'queued') return 'skipped';
      const decision = decide(entry);
      if (decision.kind === 'drop') {
        removeEntry(queueId);
        return 'dropped';
      }
      if (decision.kind === 'missing') {
        markRejected(entry, { kind: 'not_found' });
        return 'blocked';
      }
      if (decision.kind === 'conflict') {
        markConflict(entry, decision);
        return 'blocked';
      }
      const { write } = decision;
      const requestId = nextRequestId();
      const baseVersion = state.confirmed?.stateVersion ?? 0;
      const attemptedAt = stamp();
      changeEntry(queueId, (q) => ({ ...q, state: 'sending', requestId, write }));
      // The `sending` state is on this device before the send, so a restart cannot lose track of it.
      if (slot) await slot.settle();
      let result: WriteResult | SettingsResult;
      try {
        result = await send(write, requestId);
      } catch (reason) {
        const error = plannerErrorOf(reason, requestId);
        if (error.kind === 'unknown') {
          removeEntry(queueId);
          addUnconfirmed({}, { requestId, write, attemptedAt, baseVersion, state: 'unconfirmed', possiblySavedIds: [] });
          finish(queueId, { status: 'unconfirmed', requestId });
          return 'unknown';
        }
        if (error.kind === 'unavailable') {
          goOffline(error.reason);
          changeEntry(queueId, (q) => ({ ...q, state: 'queued' }));
          finish(queueId, { status: 'failed', error: { kind: 'unavailable', reason: reasonNow() }, queued: { queueId } });
          return 'stop';
        }
        answered(stamp());
        if (error.kind === 'revision_conflict' && state.confirmed) {
          // The item moved on since: its current version is the new confirmed one, and the swap is run once more.
          const { current } = error;
          set({ confirmed: { ...state.confirmed, items: state.confirmed.items.map((item) => item.id === current.id ? current : item) } });
          changeEntry(queueId, (q) => ({ ...q, state: 'queued' }));
          if (attempt === 0) continue;
          markConflict(entry, { kind: 'conflict', fields: touchedBy(write, entry.base), current: clone(current) });
          return 'blocked';
        }
        if (error.kind === 'request_id_reused') {
          set({ held: { requestId, reason: 'The Planner reports this request ID was already used for a different change.' } });
          markRejected(entry, error);
          return 'stop';
        }
        markRejected(entry, error);
        if (error.kind === 'order_conflict') await refresh();
        return 'blocked';
      }
      savedAt = stamp();
      answered(savedAt);
      try {
        absorb(result);
        set({ conflicts: state.conflicts.filter((c) => c.itemId !== targetOf(write)) });
      } finally {
        // The write is confirmed whatever happens to the local view: it is never left `sending`.
        removeEntry(queueId);
      }
      finish(queueId, { status: 'saved', result } as QueueOutcome);
      return 'sent';
    }
    return 'skipped';
  }

  /** The first queued write of each target that is waiting to be sent; a conflict or rejection holds its target. */
  function nextSendable(tried: ReadonlySet<string>): QueuedWrite | null {
    const seen = new Set<string>();
    for (const entry of state.queued) {
      const target = queueTarget(entry.write)!;
      if (seen.has(target)) continue;
      seen.add(target);
      if (entry.state === 'queued' && !tried.has(entry.queueId)) return entry;
    }
    return null;
  }

  async function flush(refreshFirst: boolean): Promise<void> {
    if (slot) await ensureRestored();
    if (refreshFirst && !(await refresh())) return;
    flushDue = false;
    if (isOffline()) return;
    const tried = new Set<string>();
    let sent = 0;
    for (;;) {
      const entry = nextSendable(tried);
      if (!entry) break;
      tried.add(entry.queueId);
      const step = await serial(queueTarget(entry.write)!, () => sendHead(entry.queueId));
      if (step === 'sent') sent += 1;
      else if (step === 'stop') break;
    }
    if (sent) notify('info', `Sent ${plural(sent, 'queued change')}.`);
  }

  /** One flush at a time; a caller during a flush waits for it. */
  function runFlush(refreshFirst: boolean): Promise<void> {
    if (!queueEnabled) return Promise.resolve();
    flushing ??= flush(refreshFirst).finally(() => { flushing = null; });
    return flushing;
  }

  /** Drops one queued, conflicting or rejected write; the writes behind it for the same target may then be sent. */
  async function discard(entry: QueuedWrite): Promise<void> {
    set({ queued: state.queued.filter((q) => q.queueId !== entry.queueId), held: state.held?.requestId === entry.requestId ? null : state.held });
    if (!isOffline() && state.queued.some((q) => q.state === 'queued')) await runFlush(true);
  }

  /** After a read that just answered: sends what is owed, if the Planner is still there. */
  async function flushIfDue(): Promise<void> {
    if (!flushDue || isOffline()) return;
    flushDue = false;
    if (state.queued.some((q) => q.state === 'queued')) await runFlush(false);
  }

  // ------------------------------------------------------------------ restore

  /** Takes the stored entries, if this store is the first to claim them. `sending` entries become unconfirmed. */
  function ensureRestored(): Promise<void> {
    restoring ??= (async () => {
      const stored = await slot!.claim();
      const queued: QueuedWrite[] = [];
      const unconfirmed: UnconfirmedWrite[] = [];
      for (const { intent, ...entry } of stored.unconfirmed) {
        if (intent) {
          try {
            recovery?.adoptIntent?.(intent);
          } catch {
            // Not adopted: the entry stays and a Check will report no_intent.
          }
        }
        intents.set(entry.requestId, intent);
        // The adapter's Apply authorization does not survive a restart, so a stored `not_applied` or `held` answer is stale.
        const stale = entry.state === 'held' || (entry.state === 'awaiting_decision' && entry.recovery?.kind === 'not_applied');
        unconfirmed.push(stale ? (({ recovery: _stale, ...rest }) => ({ ...rest, state: 'unconfirmed' as const }))(entry) : entry);
      }
      for (const entry of stored.queued) {
        // Whether a `sending` write reached the Planner is unknown; it is never re-queued or re-sent.
        if (entry.state === 'sending') {
          intents.set(entry.requestId, null);
          unconfirmed.push({ requestId: entry.requestId, write: entry.write, attemptedAt: entry.queuedAt, baseVersion: 0, state: 'unconfirmed', possiblySavedIds: [] });
        } else queued.push(entry);
      }
      const restored = queued.length + unconfirmed.length;
      flushDue = queued.some((q) => q.state === 'queued');
      set({ queued: [...queued, ...state.queued], unconfirmed: [...unconfirmed, ...state.unconfirmed], durable: slot!.status() });
      if (restored) notify('info', `Restored ${plural(restored, 'change')} kept on this device.`);
      if (stored.dropped) notify('warning', `Ignored ${plural(stored.dropped, 'unreadable change')} kept on this device.`);
    })();
    return restoring;
  }

  return {
    getState: (): WorkState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    async load(): Promise<void> {
      if (!state.confirmed) set({ load: 'loading' });
      if (slot) await ensureRestored();
      if (await refresh()) await flushIfDue();
    },

    /** Cheap version check while visible; pulls the snapshot when it moved, then reconciles. */
    async poll(): Promise<void> {
      if (slot) await ensureRestored();
      let current: number;
      try {
        current = await port.version();
      } catch (reason) {
        goOffline(readFailureReason(reason));
        set({});
        return;
      }
      if (isOffline() || !state.confirmed || state.refreshDue || current !== state.confirmed.stateVersion) await refresh();
      else {
        const at = stamp();
        goOnline(at);
        set({ lastSyncedAt: at });
      }
      // Unconfirmed writes are only flagged here; checking them waits for the user.
      if (state.unconfirmed.length) flagPossiblySaved();
      await flushIfDue();
    },

    /** Sends the queued writes now, in order, after refreshing. Nothing is sent while the Planner cannot be read. */
    flushQueued: (): Promise<void> => runFlush(true),
    /**
     * Keep mine: a conflicting write is sent again against what the Planner holds now (it is compared once more). Discard:
     * drops a queued, conflicting or rejected write. Returns the outcome of the entry's send, or null if it was not sent.
     */
    async resolveQueued(queueId: string, choice: 'keep_mine' | 'discard'): Promise<QueueOutcome | null> {
      const entry = queuedEntry(queueId);
      if (!entry) return null;
      if (choice === 'discard') {
        if (entry.state !== 'sending') await discard(entry);
        return null;
      }
      const current = entry.conflict?.settings ?? entry.conflict?.current;
      if (entry.state !== 'conflict' || !current) return null;
      const { conflict: _conflict, ...rest } = entry;
      outcomes.set(queueId, null);
      try {
        changeEntry(queueId, () => ({ ...rest, base: clone(current), state: 'queued' }));
        if (!isOffline()) {
          await runFlush(true);
          // A flush already running may have passed this entry before it was queued again.
          if (queuedEntry(queueId)?.state === 'queued' && !isOffline()) await runFlush(false);
        }
        return outcomes.get(queueId) ?? null;
      } finally {
        outcomes.delete(queueId);
      }
    },
    /** Drops a queued, conflicting or rejected write; a `sending` one cannot be dropped. */
    discardQueued(queueId: string): void {
      const entry = queuedEntry(queueId);
      if (entry && entry.state !== 'sending') void discard(entry);
    },

    /** Creates at the top of its status (default Inbox). */
    async create(fields: NewItemFields): Promise<WriteOutcome> {
      const normalized = normalizeFields(fields, { creating: true, features: features() });
      if (!normalized.ok) return localInvalid(normalized.errors);
      return dispatchWrite({ op: 'create', fields: normalized.value as NewItemFields }, (result) => (
        result.item ? { type: 'create', itemId: result.item.id } : null
      ), 'Created');
    },
    patch: patchItem,
    /** Every status change, including status pills and selects (RW-7). */
    move: moveItem,
    setArchived: archiveItem,
    markReviewed(id: string): Promise<WriteOutcome> {
      return serial(id, async () => {
        const item = confirmedItem(id);
        if (!item) return { status: 'failed', error: { kind: 'not_found' } };
        return submit(id, { op: 'markReviewed', id, revision: item.revision }, () => projectedItem(id) ?? item);
      });
    },
    updateSettings(settings: Settings): Promise<WriteOutcome<SettingsResult>> {
      return serial('settings', () => submit<SettingsResult>('settings', { op: 'updateSettings', settings: clone(settings) }, () => state.confirmed?.settings));
    },
    history: (id: string) => port.history(id),

    /** Ctrl/⌘+Z: consumes the newest entry. */
    async undo(): Promise<UndoOutcome> {
      const entry = take();
      return entry ? runUndo(entry) : { status: 'empty' };
    },
    /** A toast's Undo: consumes that entry if Ctrl/⌘+Z has not already. */
    async undoEntry(entryId: string): Promise<UndoOutcome> {
      const entry = take(entryId);
      return entry ? runUndo(entry) : { status: 'empty' };
    },

    reconcile,
    /** The explicit Check of one unconfirmed write: a lookup only. */
    async checkUnconfirmed(requestId: string): Promise<RecoveryOutcome> {
      const entry = state.unconfirmed.find((u) => u.requestId === requestId);
      if (!entry || entry.state === 'held') return 'missing';
      return check(entry);
    },
    /**
     * The user's explicit Apply of one unconfirmed write that a Check proved never landed. It goes through the replay
     * route with the original intent and baseline, so the service applies it at most once. Otherwise nothing is sent.
     */
    async retryUnconfirmed(requestId: string): Promise<RecoveryOutcome> {
      const entry = state.unconfirmed.find((u) => u.requestId === requestId);
      if (!entry || entry.state === 'held') return 'missing';
      return apply(entry);
    },
    /** True when Apply may be offered for this write: a Check proved it never landed. */
    canApply: (requestId: string): boolean => recovery !== null
      && state.unconfirmed.some((u) => u.requestId === requestId && u.state === 'awaiting_decision' && u.recovery?.kind === 'not_applied'),
    /** Stops tracking one unconfirmed request; its effect stays unknown. Releases a hold it caused. */
    dismissUnconfirmed(requestId: string): void {
      recovery?.release(requestId);
      set({
        unconfirmed: state.unconfirmed.filter((u) => u.requestId !== requestId),
        held: state.held?.requestId === requestId ? null : state.held,
      });
      notify('warning', 'Stopped tracking an unconfirmed change. It may or may not have been saved.');
    },
    dismissConflict(itemId: string): void {
      set({ conflicts: state.conflicts.filter((c) => c.itemId !== itemId) });
    },
    dismissNotice(id: string): void {
      set({ notices: state.notices.filter((n) => n.id !== id) });
    },
    /** True when HQ references may be written to this Planner. */
    canWriteHqReferences: () => features().includes(HQ_REFERENCES_FEATURE),
  };
}

const shared = new Map<string, WorkStore>();

/** One store per key for the session; module remounts get the same instance back. */
export function sharedWorkStore(key: string, create: () => WorkStore): WorkStore {
  let store = shared.get(key);
  if (!store) shared.set(key, store = create());
  return store;
}
