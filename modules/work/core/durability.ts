import type { PlannerPort, RecoveryIntent } from './port';
import type { QueuedWrite, UnconfirmedWrite } from './store';
import { STATUS_IDS, type Settings } from './types';

// Durable Work state (G1): the offline queue, the unconfirmed writes with the adapter's recorded intents, and the HQ
// drafts, kept on this device through a persistence the production shell registers for the live Planner. One hub per
// persistence aggregates every store that uses it (several HQ projects share one Planner) into a single document.
// Nothing here talks to the Planner; the store decides what is queued, sent or restored.

/** A storage the shell provides. `load` resolves the last saved document (or null); `save` replaces it. */
export interface WorkPersistence { load(): Promise<unknown>; save(value: unknown): Promise<void> }

export const DURABLE_SCHEMA = 'hq.work-durable/v1';

/** An unconfirmed write as stored: the write plus the adapter's recorded intent, taken when it became unconfirmed. */
export interface DurableUnconfirmed extends UnconfirmedWrite { intent: RecoveryIntent | null }

export interface DurableEntries { queued: QueuedWrite[]; unconfirmed: DurableUnconfirmed[] }

/** What a store receives when it claims the stored entries; `dropped` counts malformed ones that were not kept. */
export interface DurableRestore extends DurableEntries { dropped: number }

/** `ok`: the last save landed (or none was needed). `failed`: the last save failed, or the stored document was unreadable. */
export type DurableStatus = 'ok' | 'failed';

/** One store's connection to its hub. */
export interface DurableSlot {
  /** Waits for the load. The first store to claim receives the stored entries; later ones receive none. */
  claim(): Promise<DurableRestore>;
  /** Replaces this store's entries and requests a save. */
  update(entries: DurableEntries): void;
  /** Requests a save and resolves once one holding the latest entries has settled, whether it succeeded or not. */
  settle(): Promise<void>;
  status(): DurableStatus;
  onStatus(listener: () => void): () => void;
}

/** The slot the capture lane adopts for HQ drafts. The first claimant receives the stored drafts. */
export interface DurableDrafts {
  claim(): Promise<unknown[]>;
  save(drafts: unknown[]): void;
  settle(): Promise<void>;
  status(): DurableStatus;
  onStatus(listener: () => void): () => void;
}

interface Stored extends DurableEntries { drafts: unknown[]; dropped: number }

interface Hub {
  slot(): DurableSlot;
  drafts(): DurableDrafts;
}

let registered = new WeakMap<PlannerPort, WorkPersistence>();
let hubs = new WeakMap<WorkPersistence, Hub>();

/** Production shell: call before the first Work session for `port`; a store created for that port then uses it. */
export function registerWorkDurability(port: PlannerPort, persistence: WorkPersistence): void {
  registered.set(port, persistence);
}

/** The persistence registered for `port`, if any. */
export function registeredPersistence(port: PlannerPort): WorkPersistence | undefined {
  return registered.get(port);
}

/** A slot the capture lane can adopt later for HQ drafts: the first claimant receives the stored drafts. */
export function durableDrafts(port: PlannerPort): DurableDrafts | null {
  const persistence = registered.get(port);
  return persistence ? hubFor(persistence).drafts() : null;
}

/** Test seam: forget every registration and hub. */
export function resetWorkDurability(): void {
  registered = new WeakMap();
  hubs = new WeakMap();
}

/** A store's slot on the hub for `persistence`; the first caller's clock stamps the saved document. */
export function attachDurability(persistence: WorkPersistence, now: () => Date): DurableSlot {
  return hubFor(persistence, now).slot();
}

function hubFor(persistence: WorkPersistence, now: () => Date = () => new Date()): Hub {
  let hub = hubs.get(persistence);
  if (!hub) hubs.set(persistence, hub = createHub(persistence, now));
  return hub;
}

function createHub(persistence: WorkPersistence, now: () => Date): Hub {
  let status: DurableStatus = 'ok';
  /** False once a load could not be read: the hub then never saves, so it cannot overwrite what it could not read. */
  let writable = true;
  let loaded: Promise<void> | null = null;
  /** The stored document, until its entries and drafts are claimed. */
  let stored: Stored | null = null;
  let entriesClaimed = false;
  let draftsClaimed = false;
  const slots = new Set<{ queued: QueuedWrite[]; unconfirmed: DurableUnconfirmed[] }>();
  const handles = new Set<{ drafts: unknown[] }>();
  const listeners = new Set<() => void>();

  function setStatus(next: DurableStatus) {
    if (next === status) return;
    status = next;
    for (const listener of [...listeners]) listener();
  }

  function load(): Promise<void> {
    loaded ??= (async () => {
      let raw: unknown;
      try {
        raw = await persistence.load();
      } catch {
        writable = false;
        setStatus('failed');
        return;
      }
      const parsed = parseDocument(raw);
      if (!parsed) {
        writable = false;
        setStatus('failed');
        return;
      }
      stored = parsed;
    })();
    return loaded;
  }

  /** The whole document: stored entries nobody has claimed yet, then every store's and every drafts handle's own. */
  function aggregate() {
    const claimedEntries = entriesClaimed || !stored;
    const claimedDrafts = draftsClaimed || !stored;
    return structuredClone({
      schema: DURABLE_SCHEMA,
      savedAt: now().toISOString(),
      queued: [...(claimedEntries ? [] : stored!.queued), ...[...slots].flatMap((slot) => slot.queued)],
      unconfirmed: [...(claimedEntries ? [] : stored!.unconfirmed), ...[...slots].flatMap((slot) => slot.unconfirmed)],
      drafts: [...(claimedDrafts ? [] : stored!.drafts), ...[...handles].flatMap((handle) => handle.drafts)],
    });
  }

  // One save in flight; changes that arrive meanwhile share one more save with the latest aggregate.
  let waiting: (() => void)[] = [];
  let saving = false;
  async function pump() {
    if (saving) return;
    saving = true;
    try {
      await load();
      while (waiting.length) {
        const batch = waiting;
        waiting = [];
        if (writable) {
          try {
            await persistence.save(aggregate());
            setStatus('ok');
          } catch {
            setStatus('failed');
          }
        }
        for (const done of batch) done();
      }
    } finally {
      saving = false;
    }
  }
  function save(): Promise<void> {
    return new Promise<void>((resolve) => {
      waiting.push(resolve);
      void pump();
    });
  }

  return {
    slot() {
      const own = { queued: [] as QueuedWrite[], unconfirmed: [] as DurableUnconfirmed[] };
      slots.add(own);
      return {
        async claim() {
          await load();
          if (!stored || entriesClaimed) return { queued: [], unconfirmed: [], dropped: 0 };
          entriesClaimed = true;
          // Held here at once, so a save in between still carries them until the store has restored them.
          own.queued = stored.queued;
          own.unconfirmed = stored.unconfirmed;
          return { queued: stored.queued, unconfirmed: stored.unconfirmed, dropped: stored.dropped };
        },
        update(entries) {
          own.queued = entries.queued;
          own.unconfirmed = entries.unconfirmed;
          void save();
        },
        settle: save,
        status: () => status,
        onStatus(listener) {
          listeners.add(listener);
          return () => void listeners.delete(listener);
        },
      };
    },
    drafts() {
      const own = { drafts: [] as unknown[] };
      handles.add(own);
      return {
        async claim() {
          await load();
          if (!stored || draftsClaimed) return [];
          draftsClaimed = true;
          own.drafts = stored.drafts;
          return [...stored.drafts];
        },
        save(drafts) {
          own.drafts = drafts;
          void save();
        },
        settle: save,
        status: () => status,
        onStatus(listener) {
          listeners.add(listener);
          return () => void listeners.delete(listener);
        },
      };
    },
  };
}

// ------------------------------------------------------------------ reading

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T => typeof value === 'string' && (allowed as readonly string[]).includes(value);

function parseDocument(raw: unknown): Stored | null {
  if (raw === null || raw === undefined) return { queued: [], unconfirmed: [], drafts: [], dropped: 0 };
  if (!isRecord(raw) || raw.schema !== DURABLE_SCHEMA) return null;
  if (!Array.isArray(raw.queued) || !Array.isArray(raw.unconfirmed) || !Array.isArray(raw.drafts)) return null;
  let dropped = 0;
  const queued: QueuedWrite[] = [];
  for (const entry of raw.queued) {
    const read = readQueued(entry);
    if (read && !queued.some((q) => q.queueId === read.queueId)) queued.push(read);
    else dropped += 1;
  }
  const unconfirmed: DurableUnconfirmed[] = [];
  for (const entry of raw.unconfirmed) {
    const read = readUnconfirmed(entry);
    if (read && !unconfirmed.some((u) => u.requestId === read.requestId)) unconfirmed.push(read);
    else dropped += 1;
  }
  return { queued, unconfirmed, drafts: [...raw.drafts], dropped };
}

function validAnchor(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  return (keys[0] === 'after_id' || keys[0] === 'before_id') ? isText(value[keys[0]]) : keys[0] === 'place' && oneOf(value.place, ['top', 'bottom'] as const);
}

/** A write in the store's `WriteOp` form, or null when it is not one. */
function readWrite(value: unknown, allowCreate: boolean): QueuedWrite['write'] | null {
  if (!isRecord(value)) return null;
  switch (value.op) {
    case 'create': return allowCreate && isRecord(value.fields) ? { op: 'create', fields: value.fields as never } : null;
    case 'patch': return isText(value.id) && isCount(value.revision) && isRecord(value.patch) ? { op: 'patch', id: value.id, revision: value.revision, patch: value.patch as never } : null;
    case 'move': return isText(value.id) && isCount(value.revision) && oneOf(value.status, STATUS_IDS) && validAnchor(value.anchor)
      ? { op: 'move', id: value.id, revision: value.revision, status: value.status, anchor: value.anchor as never } : null;
    case 'setArchived': return isText(value.id) && isCount(value.revision) && typeof value.archived === 'boolean' ? { op: 'setArchived', id: value.id, revision: value.revision, archived: value.archived } : null;
    case 'markReviewed': return isText(value.id) && isCount(value.revision) ? { op: 'markReviewed', id: value.id, revision: value.revision } : null;
    case 'updateSettings': return validSettings(value.settings) ? { op: 'updateSettings', settings: value.settings } : null;
    default: return null;
  }
}

function validSettings(value: unknown): value is Settings {
  return isRecord(value) && isText(value.default_tz) && oneOf(value.week_start, ['sun', 'mon'] as const) && typeof value.stale_days === 'number';
}

const validItem = (value: unknown): boolean => isRecord(value) && isText(value.id) && isCount(value.revision) && typeof value.title === 'string' && typeof value.status === 'string';

const ERROR_KINDS = ['invalid', 'revision_conflict', 'order_conflict', 'request_id_reused', 'not_found', 'unavailable', 'unknown'] as const;

function readQueued(value: unknown): QueuedWrite | null {
  if (!isRecord(value)) return null;
  const write = readWrite(value.write, false);
  if (!write || write.op === 'create') return null;
  if (!isText(value.queueId) || !isText(value.requestId) || !isText(value.queuedAt)) return null;
  if (!oneOf(value.state, ['queued', 'sending', 'conflict', 'rejected'] as const)) return null;
  const base = value.base;
  if (write.op === 'updateSettings' ? !validSettings(base) : !(validItem(base) && (base as { id: string }).id === write.id)) return null;
  const entry: QueuedWrite = { queueId: value.queueId, requestId: value.requestId, write, base: base as QueuedWrite['base'], queuedAt: value.queuedAt, state: value.state };
  if (value.state === 'conflict') {
    const { conflict } = value;
    if (!isRecord(conflict) || !isStrings(conflict.fields)) return null;
    const current = conflict.current ?? null;
    if (current !== null && !validItem(current)) return null;
    if (conflict.settings !== undefined && !validSettings(conflict.settings)) return null;
    if (current === null && conflict.settings === undefined) return null;
    entry.conflict = { fields: conflict.fields, current: current as never, ...(conflict.settings !== undefined ? { settings: conflict.settings } : {}) };
  } else if (value.state === 'rejected') {
    if (!isRecord(value.error) || !oneOf(value.error.kind, ERROR_KINDS)) return null;
    entry.error = value.error as never;
  }
  return entry;
}

function readUnconfirmed(value: unknown): DurableUnconfirmed | null {
  if (!isRecord(value)) return null;
  const write = readWrite(value.write, true);
  if (!write || !isText(value.requestId) || !isText(value.attemptedAt) || !isCount(value.baseVersion)) return null;
  if (!oneOf(value.state, ['unconfirmed', 'awaiting_decision', 'held'] as const) || !isStrings(value.possiblySavedIds)) return null;
  const entry: DurableUnconfirmed = {
    requestId: value.requestId, write, attemptedAt: value.attemptedAt, baseVersion: value.baseVersion, state: value.state,
    possiblySavedIds: value.possiblySavedIds, intent: readIntent(value.intent, value.requestId),
  };
  const { recovery } = value;
  if (recovery !== undefined) {
    if (!isRecord(recovery) || !isText(recovery.checkedAt)) return null;
    if (recovery.kind === 'not_applied') entry.recovery = { kind: 'not_applied', checkedAt: recovery.checkedAt };
    else if (recovery.kind === 'indeterminate' && oneOf(recovery.reason, ['evicted', 'no_baseline', 'unsupported', 'no_intent', 'store_changed'] as const)) {
      entry.recovery = { kind: 'indeterminate', reason: recovery.reason, checkedAt: recovery.checkedAt };
    } else return null;
  }
  return entry;
}

/** An unusable intent does not lose its write: the entry stays and a Check will report `no_intent`. */
function readIntent(value: unknown, requestId: string): RecoveryIntent | null {
  if (!isRecord(value) || value.v !== 1 || value.requestId !== requestId || !isCount(value.sentAfterVersion) || !('call' in value)) return null;
  return { v: 1, requestId, sentAfterVersion: value.sentAfterVersion, call: value.call };
}
