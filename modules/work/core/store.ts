import { formatClock, resolveZone } from './upstream/manual-planner/dates.js';
import { projectMove } from './upstream/manual-planner/ordering.js';
import { restoreAnchor } from './planning';
import {
  newRequestId, plannerErrorOf, recoveryErrorOf,
  type Anchor, type IndeterminateReason, type PlannerError, type PlannerPort, type PlannerRecovery, type PlannerRecoveryError,
  type Snapshot, type WriteResult,
} from './port';
import { HQ_REFERENCES_FEATURE, type Item, type ItemPatch, type NewItemFields, type PatchField, type Settings, type Status } from './types';
import { normalizeFields, stripDerived } from './validation';

// The Work state store (RW-5, RW-8, RW-9). It lives at module level, outside
// React, so it survives T0's remount of the module on every domain switch. All
// writes go through the PlannerPort; nothing here executes or dispatches work. A write whose outcome is unknown is
// never re-sent automatically or through its ordinary route: only the user's explicit Check (a replay lookup) and,
// once that proves it never landed, the explicit Apply (a replay resend) touch it, through the PlannerRecovery.

export const UNDO_LIMIT = 40;
/** The unconfirmed queue is in memory until a shell storage member exists (G-3). */
export const UNCONFIRMED_SCOPE_NOTE = 'Unconfirmed changes are kept for this session only.';

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

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving'; count: number }
  | { kind: 'saved'; at: string }
  | { kind: 'unconfirmed'; count: number }
  | { kind: 'offline' };

export interface WorkState {
  load: 'idle' | 'loading' | 'ready' | 'unavailable';
  /** The last confirmed service view. */
  confirmed: Snapshot | null;
  /** Confirmed items with pending and unconfirmed writes projected on top. */
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
}

export interface SettingsResult { settings: Settings; stateVersion: number }

export type WriteOutcome<R = WriteResult> =
  | { status: 'saved'; result: R; undoId?: string }
  | { status: 'unconfirmed'; requestId: string }
  | { status: 'failed'; error: PlannerError };

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

/** The visible save label: Saving… / Saved · time / N unconfirmed / Offline · not saving. */
export function saveLabel(save: SaveState, settings: Pick<Settings, 'default_tz'> | null): string {
  switch (save.kind) {
    case 'saving': return 'Saving…';
    case 'saved': return `Saved · ${formatClock(save.at, resolveZone(settings?.default_tz))}`;
    case 'unconfirmed': return `${save.count} unconfirmed`;
    case 'offline': return 'Offline · not saving';
    default: return '';
  }
}

export type WorkStore = ReturnType<typeof createWorkStore>;

export function createWorkStore(port: PlannerPort, options: WorkStoreOptions = {}) {
  const now = options.now ?? (() => new Date());
  const nextRequestId = options.newRequestId ?? newRequestId;
  const recovery = options.recovery ?? null;
  const listeners = new Set<() => void>();
  const chains = new Map<string, Promise<unknown>>();
  let offline = false;
  let savedAt: string | null = null;
  let counter = 0;
  let state: WorkState = {
    load: 'idle', confirmed: null, items: [], pending: [], unconfirmed: [], held: null,
    conflicts: [], undo: [], notices: [], save: { kind: 'idle' }, lastSyncedAt: null,
  };

  const stamp = () => now().toISOString();
  const localId = (prefix: string) => `${prefix}-${(counter += 1)}`;

  function project(confirmed: Snapshot | null, writes: readonly WriteOp[]): Item[] {
    let items = confirmed ? confirmed.items : [];
    for (const write of writes) {
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
          items = items.map((item) => item.id === write.id ? { ...item, archived_at: write.archived ? stamp() : null } : item);
          break;
        case 'markReviewed':
          items = items.map((item) => item.id === write.id ? { ...item, reviewed_at: stamp() } : item);
          break;
        default:
          break;
      }
    }
    return items;
  }

  function set(patch: Partial<WorkState>) {
    const next = { ...state, ...patch };
    const writes = [...next.unconfirmed.map((u) => u.write), ...next.pending.map((p) => p.write)];
    const unconfirmedCount = next.unconfirmed.length;
    const save: SaveState = offline ? { kind: 'offline' }
      : unconfirmedCount ? { kind: 'unconfirmed', count: unconfirmedCount }
        : next.pending.length ? { kind: 'saving', count: next.pending.length }
          : savedAt ? { kind: 'saved', at: savedAt } : { kind: 'idle' };
    state = { ...next, items: project(next.confirmed, writes), save };
    for (const listener of listeners) listener();
  }

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
    // A replay carries the originally recorded items, which may be stale.
    if (!replayed && result.stateVersion > known) {
      let items = confirmed.items;
      const updates = 'settings' in result ? [] : [...(result.item ? [result.item] : []), ...result.changed];
      for (const update of updates) {
        items = items.some((item) => item.id === update.id) ? items.map((item) => item.id === update.id ? update : item) : [...items, update];
      }
      set({ confirmed: { ...confirmed, items, stateVersion: result.stateVersion, settings: 'settings' in result ? result.settings : confirmed.settings } });
    }
    if (replayed || stale || result.stateVersion !== known + 1) void refresh();
  }

  async function refresh(): Promise<boolean> {
    try {
      const snapshot = await port.snapshot();
      if (state.confirmed && snapshot.stateVersion < state.confirmed.stateVersion) return true;
      offline = false;
      set({ confirmed: snapshot, load: 'ready', lastSyncedAt: snapshot.observedAt, refreshDue: false });
      flagPossiblySaved();
      return true;
    } catch {
      offline = true;
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
      offline = false;
      set({ pending, unconfirmed: [...state.unconfirmed, { requestId, write, attemptedAt, baseVersion, state: 'unconfirmed', possiblySavedIds: [] }] });
      return { status: 'unconfirmed', requestId };
    }
    offline = error.kind === 'unavailable';
    set({ pending });
    applyError(write, requestId, error);
    return { status: 'failed', error };
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

  async function dispatchWrite<R extends WriteResult | SettingsResult = WriteResult>(write: WriteOp, onSaved?: (result: WriteResult) => UndoAction | null, label?: string): Promise<WriteOutcome<R>> {
    const requestId = nextRequestId();
    const baseVersion = state.confirmed?.stateVersion ?? 0;
    const attemptedAt = stamp();
    set({ pending: [...state.pending, { requestId, write }] });
    try {
      const result = await send(write, requestId) as R;
      offline = false;
      savedAt = stamp();
      set({ pending: state.pending.filter((p) => p.requestId !== requestId), conflicts: state.conflicts.filter((c) => c.itemId !== targetOf(write)) });
      absorb(result);
      if (!('replayed' in result)) return { status: 'saved', result };
      const action = onSaved?.(result) ?? null;
      if (!action) return { status: 'saved', result };
      const entry: UndoEntry = { id: localId('undo'), label: label ?? 'Change', at: stamp(), action };
      set({ undo: [...state.undo, entry].slice(-UNDO_LIMIT) });
      return { status: 'saved', result, undoId: entry.id };
    } catch (reason) {
      return settleFailure(write, requestId, plannerErrorOf(reason, requestId), baseVersion, attemptedAt);
    }
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
      return dispatchWrite({ op: 'patch', id, revision: item.revision, patch: body }, (result) => {
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
      return dispatchWrite({ op: 'move', id, revision: item.revision, status, anchor }, (result) => (
        result.item && result.item.revision !== item.revision ? { type: 'move', itemId: id, fromStatus, toStatus: status, restore } : null
      ), 'Moved');
    });
  }

  function archiveItem(id: string, archived: boolean): Promise<WriteOutcome> {
    return serial(id, async () => {
      const item = confirmedItem(id);
      if (!item) return { status: 'failed', error: { kind: 'not_found' } };
      return dispatchWrite({ op: 'setArchived', id, revision: item.revision, archived }, (result) => (
        result.changed.length ? { type: 'archive', itemId: id, archived } : null
      ), archived ? 'Archived' : 'Restored');
    });
  }

  // ---------------------------------------------------------------- undo

  async function runUndo(entry: UndoEntry): Promise<UndoOutcome> {
    const { action } = entry;
    return serial(action.itemId, async () => {
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
    offline = false;
    savedAt = stamp();
    set({ unconfirmed: state.unconfirmed.filter((u) => u.requestId !== entry.requestId) });
    absorb(result);
    void refresh();
    notify('info', message);
    return 'confirmed';
  }

  function recoveryFailure(entry: UnconfirmedWrite, error: PlannerRecoveryError): RecoveryOutcome {
    switch (error.kind) {
      case 'replay_indeterminate':
        offline = false;
        updateEntry(entry.requestId, (u) => ({ ...u, state: 'awaiting_decision', recovery: { kind: 'indeterminate', reason: error.reason, checkedAt: stamp() } }));
        return 'indeterminate';
      case 'unavailable':
        offline = true;
        set({});
        return 'stopped';
      case 'unknown': {
        // An apply whose answer was lost may have landed just now: back to unconfirmed, and Apply needs a new Check.
        offline = false;
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
      offline = false;
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

  return {
    getState: (): WorkState => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    async load(): Promise<void> {
      if (!state.confirmed) set({ load: 'loading' });
      await refresh();
    },

    /** Cheap version check while visible; pulls the snapshot when it moved, then reconciles. */
    async poll(): Promise<void> {
      let current: number;
      try {
        current = await port.version();
      } catch {
        offline = true;
        set({});
        return;
      }
      if (offline || !state.confirmed || state.refreshDue || current !== state.confirmed.stateVersion) await refresh();
      else {
        offline = false;
        set({ lastSyncedAt: stamp() });
      }
      // Unconfirmed writes are only flagged here; checking them waits for the user.
      if (state.unconfirmed.length) flagPossiblySaved();
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
        return dispatchWrite({ op: 'markReviewed', id, revision: item.revision });
      });
    },
    updateSettings(settings: Settings): Promise<WriteOutcome<SettingsResult>> {
      return serial('settings', () => dispatchWrite<SettingsResult>({ op: 'updateSettings', settings: clone(settings) }));
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
