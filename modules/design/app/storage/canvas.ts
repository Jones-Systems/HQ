/**
 * Narrow adapter for the canvas arrangement record (T3 `CanvasStoragePort`). T3's own conflict
 * check is advisory (read, compare, write); this adapter makes the write a real compare-and-swap.
 *
 * Each `readDocument` leaves a one-shot token holding the revision it saw. `writeDocument`
 * consumes the token and writes with that revision as `expectedRevision`, so a change between the
 * read and the write is rejected by the store. A write with no token (never read, or the token was
 * already used) is refused rather than guessed. Text is stored byte-for-byte in a small envelope.
 */
import { isStoreErrorCode, type WorkspaceDocuments } from './backing.ts';
import { TEXT_FORMAT } from './text-envelope.ts';

export const CANVAS_KEY_ROOT = 'design.canvas.arrangement.v1/';

/** Structurally T3's `CanvasStoragePort`. */
export interface CanvasDocumentPort {
  readDocument(namespace: 'workspace', key: string): Promise<string | null>;
  writeDocument(namespace: 'workspace', key: string, text: string): Promise<void>;
}

export class CanvasWriteConflictError extends Error {
  readonly reason: 'revision-changed' | 'no-read-token';
  constructor(reason: 'revision-changed' | 'no-read-token', message: string) {
    super(message);
    this.name = 'CanvasWriteConflictError';
    this.reason = reason;
  }
}

export class CanvasScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanvasScopeError';
  }
}

export function createCanvasStorage(workspace: WorkspaceDocuments): CanvasDocumentPort {
  if (workspace.kind !== 'workspace') throw new CanvasScopeError('Canvas documents live only in a workspace view');
  /** Revision last read per key: a number, or null when the key was absent. */
  const tokens = new Map<string, number | null>();
  const scoped = (namespace: string, key: string): string => {
    if (namespace !== 'workspace') throw new CanvasScopeError(`Namespace ${JSON.stringify(namespace)} is not available to the canvas adapter`);
    if (!key.startsWith(CANVAS_KEY_ROOT)) throw new CanvasScopeError(`Key ${JSON.stringify(key.slice(0, 60))} is outside ${CANVAS_KEY_ROOT}`);
    return key;
  };
  const port: CanvasDocumentPort = {
    async readDocument(namespace, key) {
      const id = scoped(namespace, key);
      const found = await workspace.getDocument(id);
      tokens.set(id, found ? found.revision : null);
      if (!found) return null;
      const value = found.value as { readonly format?: unknown; readonly text?: unknown } | null;
      if (typeof value !== 'object' || value === null || Array.isArray(value) || value.format !== TEXT_FORMAT || typeof value.text !== 'string') {
        throw new CanvasScopeError(`Stored canvas document ${key} is not a ${TEXT_FORMAT} envelope`);
      }
      return value.text;
    },
    async writeDocument(namespace, key, text) {
      const id = scoped(namespace, key);
      if (!tokens.has(id)) throw new CanvasWriteConflictError('no-read-token', `Read ${key} before writing it`);
      const expectedRevision = tokens.get(id) ?? null;
      tokens.delete(id);
      try {
        await workspace.putDocument(id, { format: TEXT_FORMAT, text }, { expectedRevision });
      } catch (error) {
        if (isStoreErrorCode(error, 'conflict')) throw new CanvasWriteConflictError('revision-changed', `${key} changed since it was read`);
        throw error;
      }
    },
  };
  return Object.freeze(port);
}
