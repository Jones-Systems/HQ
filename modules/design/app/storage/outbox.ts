/**
 * Narrow adapter for the connector's dispatch outbox (T12 `OutboxStorePort`): one document per
 * dispatch in the authoritative workspace namespace under `design/connector/outbox/`.
 *
 * `put` is a real compare-and-swap on the store's document revision (`expectedRevision: null`
 * means create-only). A conflict returns the current stored dispatch. There is no delete.
 * A resolved `put` is the store's fsync-then-rename write; if the process dies mid-write the
 * caller sees no result, and T12's own unknown-outcome rules apply.
 */
import { toJson } from './canonical.ts';
import { isStoreErrorCode, type WorkspaceDocuments } from './backing.ts';

export const OUTBOX_KEY_ROOT = 'design/connector/outbox/';

export interface OutboxRecordShape {
  readonly dispatchId: string;
}

export interface StoredOutboxRecord<R> {
  readonly revision: number;
  readonly record: R;
}

export type OutboxPutResult<R> =
  | { readonly ok: true; readonly revision: number }
  | { readonly ok: false; readonly reason: 'conflict'; readonly current: StoredOutboxRecord<R> | null };

/** Structurally T12's `OutboxStorePort`. */
export interface OutboxAdapter<R extends OutboxRecordShape, I extends string = string> {
  get(dispatchId: I): Promise<StoredOutboxRecord<R> | null>;
  put(record: R, expectedRevision: number | null): Promise<OutboxPutResult<R>>;
  list(): Promise<readonly StoredOutboxRecord<R>[]>;
}

export class OutboxRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OutboxRecordError';
  }
}

export interface OutboxAdapterOptions<R> {
  /** Validates a stored value on read. Defaults to a shape check only; T12 should pass its own parser. */
  readonly parse?: (value: unknown) => R;
}

function keyOf(dispatchId: string): string {
  if (typeof dispatchId !== 'string' || dispatchId.length === 0) throw new OutboxRecordError('dispatchId must be a non-empty string');
  return `${OUTBOX_KEY_ROOT}${dispatchId}`;
}

export function createOutboxAdapter<R extends OutboxRecordShape, I extends string = string>(
  workspace: WorkspaceDocuments,
  options: OutboxAdapterOptions<R> = {},
): OutboxAdapter<R, I> {
  if (workspace.kind !== 'workspace') throw new OutboxRecordError('The outbox lives only in a workspace view');
  const parse = options.parse ?? ((value: unknown): R => {
    if (typeof value !== 'object' || value === null || typeof (value as { dispatchId?: unknown }).dispatchId !== 'string') {
      throw new OutboxRecordError('Stored outbox document has no dispatchId');
    }
    return value as R;
  });
  const read = async (dispatchId: string): Promise<StoredOutboxRecord<R> | null> => {
    const found = await workspace.getDocument(keyOf(dispatchId));
    if (!found) return null;
    const record = parse(found.value);
    if (record.dispatchId !== dispatchId) throw new OutboxRecordError(`Outbox document ${dispatchId} holds dispatch ${record.dispatchId}`);
    return { revision: found.revision, record };
  };
  return Object.freeze({
    get: (dispatchId: I) => read(dispatchId),
    async put(record: R, expectedRevision: number | null) {
      const key = keyOf(record.dispatchId);
      try {
        const written = await workspace.putDocument(key, toJson(record), { expectedRevision });
        return { ok: true as const, revision: written.revision };
      } catch (error) {
        if (!isStoreErrorCode(error, 'conflict')) throw error;
        return { ok: false as const, reason: 'conflict' as const, current: await read(record.dispatchId) };
      }
    },
    async list() {
      const out: StoredOutboxRecord<R>[] = [];
      for (const key of await workspace.listDocuments(OUTBOX_KEY_ROOT)) {
        const stored = await read(key.slice(OUTBOX_KEY_ROOT.length));
        if (stored) out.push(stored);
      }
      return out;
    },
  });
}
