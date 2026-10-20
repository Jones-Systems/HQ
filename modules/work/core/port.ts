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
}

export type Anchor = { after_id: string } | { before_id: string } | { place: 'top' | 'bottom' };

export type PlannerError =
  | { kind: 'invalid'; errors: FieldError[] }
  | { kind: 'revision_conflict'; current: Item }
  | { kind: 'order_conflict' }
  | { kind: 'request_id_reused' }
  | { kind: 'not_found' }
  /** Known not delivered: no effect. */
  | { kind: 'unavailable' }
  /** Possibly delivered: reconcile only by re-sending the same request ID and body. */
  | { kind: 'unknown'; requestId: string };

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
  updateSettings(s: Settings, requestId: string): Promise<{ settings: Settings; stateVersion: number }>;
}

export const PLANNER_PORT_KEYS = [
  'snapshot', 'version', 'create', 'patch', 'move', 'setArchived', 'markReviewed', 'history', 'updateSettings',
] as const satisfies readonly (keyof PlannerPort)[];

/** A port call rejects with this; `error` carries the Planner outcome. */
export class PlannerPortError extends Error {
  readonly error: PlannerError;
  constructor(error: PlannerError) {
    super(`Planner ${error.kind}`);
    this.name = 'PlannerPortError';
    this.error = error;
  }
}

/** Maps any rejection to a PlannerError. A non-Planner failure of a write is `unknown`, never `unavailable`. */
export function plannerErrorOf(reason: unknown, requestId?: string): PlannerError {
  if (reason instanceof PlannerPortError) return reason.error;
  return requestId ? { kind: 'unknown', requestId } : { kind: 'unavailable' };
}

const REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/u;

/** The Planner's X-Request-Id shape. */
export function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID.test(value);
}

export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}
