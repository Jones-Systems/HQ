import { DESIGN_NAV_IDS, type DesignNavId, type JsonValue, type RestoreResult, type SectionStateHandle, type UiStatePort } from '../contract.ts';
import { hasOnlyKeys, isJsonValue, isPlainRecord, isSectionId, jsonSize } from './json.ts';
import { isNavId } from './navigation.ts';
import { DEFAULT_LAYOUT, parseLayout, type PanelLayout } from './panels.ts';

/**
 * Design chrome session: panel layout, last section per area, and opaque
 * per-section state (draft text, canvas viewport, selection…). Kept in memory
 * across domain switches (keep-alive) and serialised to one key per project.
 * It is chrome state, not the authoritative workspace: sections keep their
 * own durable records in the Design store.
 */
export const SESSION_SCHEMA = 'hq.design.ui-session/v1';
const SESSION_PREFIX = 'hq.design.ui-session/';
export const MAX_SECTION_STATE = 64 * 1024;
export const MAX_SESSION_STATE = 512 * 1024;

export const sessionKey = (projectId: string): string => `hq.design.ui-session.v1:${encodeURIComponent(projectId)}`;

export interface SessionSnapshot {
  readonly schema: typeof SESSION_SCHEMA;
  readonly projectId: string;
  readonly panels: PanelLayout;
  readonly lastSection: Readonly<Partial<Record<DesignNavId, string>>>;
  /** Unknown section ids are preserved, never dropped: the section may simply not be installed here. */
  readonly sections: Readonly<Record<string, JsonValue>>;
}

export type Persistence =
  | { readonly status: 'ok' }
  /** Stored text is unreadable or from a newer version; it is left untouched until the user chooses to start fresh. */
  | { readonly status: 'held'; readonly reason: string }
  | { readonly status: 'unavailable'; readonly reason: string };

export type ParsedSession =
  | { readonly status: 'ok'; readonly snapshot: SessionSnapshot }
  | { readonly status: 'unsupported' | 'invalid'; readonly reason: string };

export function emptySession(projectId: string): SessionSnapshot {
  return { schema: SESSION_SCHEMA, projectId, panels: DEFAULT_LAYOUT, lastSection: {}, sections: {} };
}

export function parseSession(text: string, projectId: string): ParsedSession {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { status: 'invalid', reason: 'not JSON' }; }
  if (!isPlainRecord(value)) return { status: 'invalid', reason: 'not an object' };
  if (value.schema !== SESSION_SCHEMA) {
    return typeof value.schema === 'string' && value.schema.startsWith(SESSION_PREFIX)
      ? { status: 'unsupported', reason: `unsupported version ${value.schema}` }
      : { status: 'invalid', reason: 'unknown schema' };
  }
  if (!hasOnlyKeys(value, ['schema', 'projectId', 'panels', 'lastSection', 'sections'])) return { status: 'invalid', reason: 'unexpected fields' };
  if (value.projectId !== projectId) return { status: 'invalid', reason: 'belongs to another project' };
  const panels = parseLayout(value.panels);
  if (panels === null) return { status: 'invalid', reason: 'invalid panel layout' };
  const lastSection = value.lastSection;
  if (!isPlainRecord(lastSection) || !Object.entries(lastSection).every(([nav, id]) => isNavId(nav) && isSectionId(id))) {
    return { status: 'invalid', reason: 'invalid last-section map' };
  }
  const sections = value.sections;
  if (!isPlainRecord(sections) || !Object.entries(sections).every(([id, state]) => isSectionId(id) && isJsonValue(state)
    && jsonSize(state) <= MAX_SECTION_STATE)) return { status: 'invalid', reason: 'invalid section state' };
  if (text.length > MAX_SESSION_STATE) return { status: 'invalid', reason: 'session exceeds bound' };
  return {
    status: 'ok',
    snapshot: {
      schema: SESSION_SCHEMA, projectId, panels,
      lastSection: Object.fromEntries(DESIGN_NAV_IDS.filter((nav) => typeof lastSection[nav] === 'string').map((nav) => [nav, lastSection[nav] as string])),
      sections: sections as Record<string, JsonValue>,
    },
  };
}

export function serializeSession(snapshot: SessionSnapshot): string {
  return JSON.stringify({
    schema: snapshot.schema, projectId: snapshot.projectId, panels: snapshot.panels,
    lastSection: snapshot.lastSection, sections: snapshot.sections,
  });
}

interface Entry {
  snapshot: SessionSnapshot;
  persistence: Persistence;
  dirty: boolean;
}

export interface SessionStore {
  /** Increments on every observable change (snapshot or persistence status). */
  readonly version: () => number;
  readonly get: (projectId: string) => SessionSnapshot;
  readonly persistence: (projectId: string) => Persistence;
  readonly setPanels: (projectId: string, panels: PanelLayout) => void;
  readonly setLastSection: (projectId: string, nav: DesignNavId, sectionId: string) => void;
  readonly sectionHandle: (projectId: string, sectionId: string) => SectionStateHandle;
  /** Write every dirty, writable project to storage. Touches only session keys. */
  readonly flush: () => void;
  readonly serialize: (projectId: string) => string | null;
  readonly restore: (projectId: string, text: string) => RestoreResult;
  /** Explicit user choice to replace held (unreadable or newer) stored state. */
  readonly startFresh: (projectId: string) => void;
  readonly subscribe: (listener: () => void) => () => void;
}

export function createSessionStore(storage: UiStatePort | null): SessionStore {
  const entries = new Map<string, Entry>();
  const handles = new Map<string, SectionStateHandle>();
  const listeners = new Set<() => void>();
  let version = 0;
  const notify = () => { version += 1; for (const listener of [...listeners]) listener(); };

  function load(projectId: string): Entry {
    const existing = entries.get(projectId);
    if (existing) return existing;
    let entry: Entry = { snapshot: emptySession(projectId), persistence: { status: 'ok' }, dirty: false };
    if (storage === null) entry.persistence = { status: 'unavailable', reason: 'no storage port' };
    else {
      try {
        const text = storage.getItem(sessionKey(projectId));
        if (text !== null) {
          const parsed = parseSession(text, projectId);
          entry = parsed.status === 'ok' ? { snapshot: parsed.snapshot, persistence: { status: 'ok' }, dirty: false }
            : { snapshot: emptySession(projectId), persistence: { status: 'held', reason: parsed.reason }, dirty: false };
        }
      } catch { entry.persistence = { status: 'unavailable', reason: 'storage read failed' }; }
    }
    entries.set(projectId, entry);
    return entry;
  }

  function change(projectId: string, next: (snapshot: SessionSnapshot) => SessionSnapshot | null): boolean {
    const entry = load(projectId);
    const snapshot = next(entry.snapshot);
    if (snapshot === null) return false;
    entry.snapshot = snapshot;
    entry.dirty = true;
    notify();
    return true;
  }

  function write(projectId: string, entry: Entry): void {
    if (!entry.dirty || storage === null || entry.persistence.status === 'held') return;
    try {
      storage.setItem(sessionKey(projectId), serializeSession(entry.snapshot));
      entry.dirty = false;
      if (entry.persistence.status !== 'ok') { entry.persistence = { status: 'ok' }; notify(); }
    } catch {
      if (entry.persistence.status !== 'unavailable') { entry.persistence = { status: 'unavailable', reason: 'storage write failed' }; notify(); }
    }
  }

  return {
    version: () => version,
    get: (projectId) => load(projectId).snapshot,
    persistence: (projectId) => load(projectId).persistence,
    setPanels: (projectId, panels) => {
      change(projectId, (snapshot) => (snapshot.panels === panels ? null : { ...snapshot, panels }));
    },
    setLastSection: (projectId, nav, sectionId) => {
      if (!isSectionId(sectionId)) return;
      change(projectId, (snapshot) => (snapshot.lastSection[nav] === sectionId ? null
        : { ...snapshot, lastSection: { ...snapshot.lastSection, [nav]: sectionId } }));
    },
    sectionHandle: (projectId, sectionId) => {
      const cacheKey = `${projectId}\u0000${sectionId}`;
      const cached = handles.get(cacheKey);
      if (cached) return cached;
      const handle: SectionStateHandle = {
        read: () => load(projectId).snapshot.sections[sectionId],
        write: (value) => {
          if (!isSectionId(sectionId) || !isJsonValue(value) || jsonSize(value) > MAX_SECTION_STATE) return false;
          let accepted = true;
          change(projectId, (snapshot) => {
            const current = snapshot.sections[sectionId];
            if (current !== undefined && JSON.stringify(current) === JSON.stringify(value)) return null;
            const next = { ...snapshot, sections: { ...snapshot.sections, [sectionId]: value } };
            if (serializeSession(next).length > MAX_SESSION_STATE) { accepted = false; return null; }
            return next;
          });
          return accepted;
        },
      };
      handles.set(cacheKey, handle);
      return handle;
    },
    flush: () => { for (const [projectId, entry] of entries) write(projectId, entry); },
    serialize: (projectId) => (entries.has(projectId) ? serializeSession(load(projectId).snapshot) : null),
    restore: (projectId, text) => {
      const parsed = parseSession(text, projectId);
      if (parsed.status !== 'ok') return { status: 'rejected', reason: parsed.reason };
      const entry = load(projectId);
      entry.snapshot = parsed.snapshot;
      entry.dirty = true;
      notify();
      return { status: 'restored' };
    },
    startFresh: (projectId) => {
      const entry = load(projectId);
      if (entry.persistence.status !== 'held') return;
      entry.persistence = { status: 'ok' };
      entry.dirty = true;
      notify();
    },
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
