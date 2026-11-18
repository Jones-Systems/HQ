import type { WorkLocalJson, WorkLocalParams, WorkLocalRoute, WorkLocalTransport } from './transport';

// The renderer end of Work's durable device state (`hqServices.workLocal`, backend-assessment-planner-20261103, "Offline
// queue semantics"). The Work store loads one document when it starts and saves it whole after each change; this keeps
// the binding and revision that main's compare-and-swap needs, so a save can never overwrite a document it did not
// load or another writer has since changed. Nothing here reads a path or an address: main owns both.

/** The persistence the store consumes, stated structurally so Work core owns no dependency on this module. */
export interface WorkLocalPersistence {
  /** The stored value, or null when nothing is stored yet. Rejects on any failure. */
  load(): Promise<unknown>;
  /** Replaces the stored value. Rejects on any failure, a stale revision included. */
  save(value: unknown): Promise<void>;
}

/** What main refused (`conflict`, `invalid`, `too_large`, `unavailable`), or what this side could not accept. */
export type WorkLocalFailure =
  | 'conflict' | 'invalid' | 'too_large' | 'unavailable'
  /** An answer the bridge should never give. */
  | 'malformed'
  /** A save with no successful load behind it. */
  | 'not_loaded';

export class WorkLocalError extends Error {
  readonly kind: WorkLocalFailure;
  constructor(kind: WorkLocalFailure) {
    super(`Work local ${kind}`);
    this.name = 'WorkLocalError';
    this.kind = kind;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isRevision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const REFUSALS: readonly unknown[] = ['conflict', 'invalid', 'too_large', 'unavailable'];

/** The bridge the preload exposes, read structurally so Work needs no shell type. */
export function isWorkLocalBridge(value: unknown): value is WorkLocalTransport {
  return isRecord(value) && typeof value.call === 'function';
}

/**
 * Persistence over the device document. Loads and saves run one at a time, in call order. A save needs a successful
 * load first and sends that load's binding and the revision after the last accepted save; any refusal rejects with a
 * `WorkLocalError` and the document is left as it was. A conflict is never retried or merged here.
 */
export function workLocalPersistence(transport: WorkLocalTransport): WorkLocalPersistence {
  /** Set by a successful load and advanced by each accepted save; null when nothing can be trusted as the base. */
  let base: { binding: string; revision: number } | null = null;
  let tail: Promise<unknown> = Promise.resolve();

  function queued<T>(task: () => Promise<T>): Promise<T> {
    const run = tail.then(task);
    tail = run.catch(() => undefined);
    return run;
  }

  /** The `value` of an ok answer. Anything else rejects, naming only the kind. */
  async function ask<R extends WorkLocalRoute>(route: R, params: WorkLocalParams[R]): Promise<unknown> {
    let answer: unknown;
    try {
      answer = await transport.call(route, params);
    } catch {
      throw new WorkLocalError('unavailable');
    }
    if (isRecord(answer) && answer.ok === true && 'value' in answer) return answer.value;
    const refused = isRecord(answer) && answer.ok === false && REFUSALS.includes(answer.kind);
    throw new WorkLocalError(refused ? (answer as { kind: WorkLocalFailure }).kind : 'malformed');
  }

  return {
    load: () => queued(async () => {
      try {
        const loaded = await ask('load', {});
        if (!isRecord(loaded) || typeof loaded.binding !== 'string' || loaded.binding === '' || !isRevision(loaded.revision) || !('value' in loaded)) {
          throw new WorkLocalError('malformed');
        }
        base = { binding: loaded.binding, revision: loaded.revision };
        return loaded.value;
      } catch (error) {
        // A document that cannot be read is no base for a save, whatever an earlier load said.
        base = null;
        throw error;
      }
    }),
    async save(value) {
      // Decided when called, so a save made while the first load is still running does not wait for it.
      if (!base) throw new WorkLocalError('not_loaded');
      await queued(async () => {
        if (!base) throw new WorkLocalError('not_loaded');
        const sent = base;
        try {
          const saved = await ask('save', { binding: sent.binding, expectedRevision: sent.revision, value: value as WorkLocalJson });
          if (!isRecord(saved) || !isRevision(saved.revision) || saved.revision <= sent.revision) throw new WorkLocalError('malformed');
          base = { binding: sent.binding, revision: saved.revision };
        } catch (error) {
          // The write may have landed under a revision this side cannot read: only a fresh load can say.
          if (error instanceof WorkLocalError && error.kind === 'malformed') base = null;
          throw error;
        }
      });
    },
  };
}
