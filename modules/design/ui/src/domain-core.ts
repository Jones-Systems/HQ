import type { RestoreResult, UiStatePort } from '../contract.ts';
import { createSessionStore, type SessionStore } from './session.ts';

/**
 * Framework-free half of the DesignDomain descriptor. It outlives every mount
 * of the Design view, so leaving Design (the shell unmounts or hides it) and
 * returning finds the same in-memory session: keep-alive without relying on
 * the shell keeping the React tree mounted. `deactivate` serialises chrome
 * state only; it never submits drafts or starts work.
 */
export interface DesignCore {
  readonly sessions: SessionStore;
  readonly serialize: (projectId: string) => string | null;
  readonly restore: (projectId: string, text: string) => RestoreResult;
  readonly deactivate: () => void;
}

export function createDesignCore(storage: UiStatePort | null): DesignCore {
  const sessions = createSessionStore(storage);
  return {
    sessions,
    serialize: sessions.serialize,
    restore: sessions.restore,
    deactivate: () => sessions.flush(),
  };
}
