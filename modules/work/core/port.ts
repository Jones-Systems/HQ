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
  /** The advertised Planner API version, when the service names one. */
  api?: number;
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

/** Why the Planner could not be used. An `unavailable` error without a reason means `unreachable`. */
export type UnavailableReason =
  /** Nothing answered: a refused connection, an unknown host, a timeout, or no Planner address in this window. */
  | 'unreachable'
  /** The Planner answered but refused this client (HTTP 403 or 421), for example a Host not in `--allowed-host`. */
  | 'refused'
  /** The Planner answered a read with a server error (HTTP 5xx). */
  | 'server_error'
  /** Something answered that is not a Planner this HQ can use: an unexpected status or a malformed body. */
  | 'incompatible';

export type PlannerError =
  | { kind: 'invalid'; errors: FieldError[] }
  | { kind: 'revision_conflict'; current: Item }
  | { kind: 'order_conflict' }
  | { kind: 'request_id_reused' }
  | { kind: 'not_found' }
  /** Known not delivered: no effect. */
  | { kind: 'unavailable'; reason?: UnavailableReason }
  /** Possibly delivered: resolve only through the replay-aware recovery, never by an ordinary re-send. */
  | { kind: 'unknown'; requestId: string };

/** A Planner capability this HQ uses that the connected Planner does not advertise. */
export type PlannerLimit =
  /** No `requests.replay`: an unconfirmed change cannot be checked or applied safely, only read back. */
  | 'no_replay'
  /** No `hq-references-v1`: HQ links cannot be saved on items. */
  | 'no_hq_references'
  /** No `items.batch_create`. HQ's Work views do not need it; agents using the CLI do. */
  | 'no_batch';

/** The answer of one explicit connection check. It reads only `GET /api/version` and never writes. */
export type PlannerHealth =
  | {
    /** `ready`: every capability HQ uses is advertised. `limited`: reachable, but see `limits`. */
    status: 'ready' | 'limited';
    checkedAt: string;
    /** The advertised Planner API version, or null when the service names none. */
    api: number | null;
    stateVersion: number;
    features: string[];
    limits: PlannerLimit[];
    /** The replay-record retention, when advertised. */
    retention: { max: number; evictedThroughVersion: number } | null;
  }
  | { status: 'unavailable'; checkedAt: string; reason: UnavailableReason; httpStatus?: number };

/** Why a possibly applied write cannot be resolved by replay. */
export type IndeterminateReason =
  /** The service may have evicted the replay record: its eviction floor is past the pre-send baseline. */
  | 'evicted'
  /** No pre-send state version is known, so "not applied" cannot be proved. */
  | 'no_baseline'
  /** The Planner does not advertise `requests.replay`. */
  | 'unsupported'
  /** This client holds no recorded intent for the request ID, for example after a restart. */
  | 'no_intent'
  /**
   * The Planner's state version is now older than the one recorded before the send, so the store at this address may
   * have been replaced or restored. Nothing can be proved about the write there.
   */
  | 'store_changed';

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
  /**
   * The recorded intent of an unresolved request, so a durable queue can keep it across a restart; null when none is
   * held or it is already settled. The value is plain JSON and opaque outside the adapter that produced it.
   */
  exportIntent?(requestId: string): RecoveryIntent | null;
  /**
   * Re-registers an exported intent after a restart, so Check and Apply work for it again. It sends nothing. False
   * when the value is malformed, or a different intent already holds that request ID; the outcome then stays unknown.
   */
  adoptIntent?(intent: unknown): boolean;
}

/** One unresolved write as the adapter recorded it before its first send. `call` is adapter-owned JSON. */
export interface RecoveryIntent {
  readonly v: 1;
  readonly requestId: string;
  /** The state version observed before the first send: the replay baseline, never raised afterwards. */
  readonly sentAfterVersion: number;
  readonly call: unknown;
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
