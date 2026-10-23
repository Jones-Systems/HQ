import type { FieldError, Item, ItemPatch, NewItemFields, Settings, Status } from './types';

// PlannerPort (iface.work-port.001): Planner API semantics only. It has no
// execution, export, import or backup members; the key set is asserted by test.

export interface Snapshot {
  items: Item[];
  settings: Settings;
  stateVersion: number;
  observedAt: string;
  /** Service capabilities; `[]` on today's Planner. */
  features: string[];
}

export interface WriteResult {
  item?: Item;
  /** Every item whose stored record changed, including neighbours renumbered by a move. */
  changed: Item[];
  stateVersion: number;
  replayed: boolean;
  /**
   * The write is confirmed, but reading back its renumbered neighbours failed, so `changed` may be incomplete.
   * The caller must refresh before trusting order; the write itself is not unknown and is never re-sent.
   */
  stale?: true;
}

export interface SettingsWriteResult { settings: Settings; stateVersion: number }

export type Anchor = { after_id: string } | { before_id: string } | { place: 'top' | 'bottom' };

export type PlannerError =
  | { kind: 'invalid'; errors: FieldError[] }
  | { kind: 'revision_conflict'; current: Item }
  | { kind: 'order_conflict' }
  | { kind: 'request_id_reused' }
  | { kind: 'not_found' }
  /** Known not delivered: no effect. */
  | { kind: 'unavailable' }
  /** Possibly delivered: resolve only through the replay-aware recovery, never by an ordinary re-send. */
  | { kind: 'unknown'; requestId: string };

/** Why a possibly applied write cannot be resolved by replay. */
export type IndeterminateReason =
  /** The service may have evicted the replay record: its eviction floor is past the pre-send baseline. */
  | 'evicted'
  /** No pre-send state version is known, so "not applied" cannot be proved. */
  | 'no_baseline'
  /** The Planner does not advertise `requests.replay`. */
  | 'unsupported'
  /** This client holds no recorded intent for the request ID, for example after a restart. */
  | 'no_intent';

/**
 * A recovery-only outcome: whether the write was applied cannot be determined. Nothing was changed by asking.
 * It is kept out of `PlannerError`, which ordinary write outcomes carry, and maps to `unknown` there.
 */
export interface ReplayIndeterminate { kind: 'replay_indeterminate'; requestId: string; reason: IndeterminateReason }

export type PlannerRecoveryError = PlannerError | ReplayIndeterminate;

export interface HistoryEntry { at: string; action: string; detail: unknown }

export interface PlannerPort {
  snapshot(): Promise<Snapshot>;
  version(): Promise<number>;
  /** Always places the new item at the top of its status. */
  create(fields: NewItemFields, requestId: string): Promise<WriteResult>;
  patch(id: string, revision: number, patch: ItemPatch, requestId: string): Promise<WriteResult>;
  /** Renumbers only the target status. */
  move(id: string, revision: number, status: Status, anchor: Anchor, requestId: string): Promise<WriteResult>;
  setArchived(id: string, revision: number, archived: boolean, requestId: string): Promise<WriteResult>;
  markReviewed(id: string, revision: number, requestId: string): Promise<WriteResult>;
  history(id: string): Promise<HistoryEntry[]>;
  updateSettings(s: Settings, requestId: string): Promise<SettingsWriteResult>;
}

export const PLANNER_PORT_KEYS = [
  'snapshot', 'version', 'create', 'patch', 'move', 'setArchived', 'markReviewed', 'history', 'updateSettings',
] as const satisfies readonly (keyof PlannerPort)[];

/** Advertised by a Planner with the retention-aware replay route. */
export const REPLAY_FEATURE = 'requests.replay';

export type CheckResult =
  /** The write had been applied; this is its originally recorded response. */
  | { outcome: 'replayed'; result: WriteResult | SettingsWriteResult }
  /** Provably not applied as of this check. Only an explicit apply may send it now. */
  | { outcome: 'not_applied' };

export type ApplyResult =
  | { outcome: 'replayed'; result: WriteResult | SettingsWriteResult }
  | { outcome: 'applied_now'; result: WriteResult | SettingsWriteResult };

/**
 * Replay-aware recovery for a write whose outcome is unknown. It is a sidecar to `PlannerPort`, which cannot tell a
 * check from an apply. Both use the recorded original intent and its pre-send baseline; neither invents an intent.
 * Rejections carry a `PlannerRecoveryError`.
 */
export interface PlannerRecovery {
  /** The explicit Check: a lookup. It never applies anything. Transport loss is `unavailable`. */
  check(requestId: string): Promise<CheckResult>;
  /** The explicit Apply: a resend that applies only when the service proves the write never landed. Transport loss is `unknown`. */
  apply(requestId: string): Promise<ApplyResult>;
  /** Stops tracking the request. Its effect stays unknown. */
  release(requestId: string): void;
}

export const PLANNER_RECOVERY_KEYS = ['check', 'apply', 'release'] as const satisfies readonly (keyof PlannerRecovery)[];

/** A port or recovery call rejects with this; `error` carries the Planner outcome. */
export class PlannerPortError extends Error {
  readonly error: PlannerRecoveryError;
  constructor(error: PlannerRecoveryError) {
    super(`Planner ${error.kind}`);
    this.name = 'PlannerPortError';
    this.error = error;
  }
}

/**
 * Maps any write or read rejection to a PlannerError. A non-Planner failure of a write is `unknown`, never
 * `unavailable`, and so is an indeterminate replay.
 */
export function plannerErrorOf(reason: unknown, requestId?: string): PlannerError {
  if (reason instanceof PlannerPortError) {
    const { error } = reason;
    return error.kind === 'replay_indeterminate' ? { kind: 'unknown', requestId: error.requestId } : error;
  }
  return requestId ? { kind: 'unknown', requestId } : { kind: 'unavailable' };
}

/** Maps a recovery rejection. Anything that is not a Planner outcome is `unavailable` for a check, `unknown` for an apply. */
export function recoveryErrorOf(reason: unknown, requestId: string, mode: 'check' | 'apply'): PlannerRecoveryError {
  if (reason instanceof PlannerPortError) return reason.error;
  return mode === 'apply' ? { kind: 'unknown', requestId } : { kind: 'unavailable' };
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/u;

/** The Planner's X-Request-Id shape. */
export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID.test(value);
}

export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}
