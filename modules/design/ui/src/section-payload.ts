import type { JsonValue, SectionStateHandle } from '../contract.ts';
import { hasOnlyKeys, isJsonValue, isPlainRecord, jsonSize } from './json.ts';
import { MAX_SECTION_STATE, type SessionStore } from './session.ts';

/**
 * The one owner of a section's slot in the chrome session (`sections[sectionId]`).
 *
 * A section that declares sub-routes keeps two things there, the view the user last chose and the
 * section's own state, in one envelope `{ v: 1, view, data }`. Every read and write of that slot goes
 * through this module, so neither half can overwrite the other:
 *
 * - A value that is not an envelope is legacy section state. It is read as `data` with no view, and
 *   wrapped (never discarded) the first time a view is remembered.
 * - Writes are read-modify-write on the whole envelope.
 * - An envelope with `v` above 1 comes from a newer build. It is read-only here: the section still reads
 *   its data, writes are refused, and a chosen view is kept in memory for this session only.
 *
 * The session schema, its storage key and the held/unavailable behaviour of the store are unchanged: this
 * module only changes what is inside one section's slot. A section that declares no sub-routes keeps the
 * raw slot, untouched. A section that stores a bare `null` as its data reads `undefined` back from the
 * derived handle, because the envelope uses null for "no data".
 */
export const PAYLOAD_VERSION = 1;
/** A remembered view (`swipe`, `item/<encoded id>`) is at most this long, the same bound as a destination. */
export const MAX_VIEW = 512;
/** Views kept in memory because their stored payload is newer than this build; bounds that map. */
export const MAX_MEMORY_VIEWS = 256;

export type PayloadSlot =
  | { readonly kind: 'empty' }
  | { readonly kind: 'legacy'; readonly data: JsonValue }
  | { readonly kind: 'envelope'; readonly view: string | null; readonly data: JsonValue | null }
  | { readonly kind: 'future'; readonly version: number; readonly data: JsonValue | null };

const isView = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && value.length > 0 && value.length <= MAX_VIEW);

/** Classify a raw slot value. Never throws and never alters the value. */
export function readPayload(raw: JsonValue | undefined): PayloadSlot {
  if (raw === undefined) return { kind: 'empty' };
  if (isPlainRecord(raw) && typeof raw.v === 'number' && Number.isInteger(raw.v) && ('view' in raw || 'data' in raw)) {
    const data = isJsonValue(raw.data) ? raw.data : null;
    if (raw.v > PAYLOAD_VERSION) return { kind: 'future', version: raw.v, data };
    if (raw.v === PAYLOAD_VERSION && hasOnlyKeys(raw, ['v', 'view', 'data']) && 'view' in raw && 'data' in raw && isView(raw.view)) {
      return { kind: 'envelope', view: raw.view, data };
    }
  }
  return { kind: 'legacy', data: raw };
}

export interface SectionPayloads {
  /** The remembered view (or the in-memory one for a newer payload); null when none. Never the default. */
  readonly view: (projectId: string, sectionId: string) => string | null;
  /** Remember a view. False when it is not a valid view string or nothing could be kept. Null forgets it. */
  readonly setView: (projectId: string, sectionId: string, view: string | null) => boolean;
  /** What the section sees as its state: `data` only, never the view. Stable per project and section. */
  readonly dataHandle: (projectId: string, sectionId: string) => SectionStateHandle;
}

type SessionSlots = Pick<SessionStore, 'sectionHandle'>;

export function createSectionPayloads(sessions: SessionSlots): SectionPayloads {
  const memory = new Map<string, string | null>();
  const handles = new Map<string, SectionStateHandle>();
  const keyOf = (projectId: string, sectionId: string) => `${projectId}\u0000${sectionId}`;

  const view = (projectId: string, sectionId: string): string | null => {
    const slot = readPayload(sessions.sectionHandle(projectId, sectionId).read());
    if (slot.kind === 'envelope') return slot.view;
    if (slot.kind === 'future') return memory.get(keyOf(projectId, sectionId)) ?? null;
    return null;
  };

  const setView = (projectId: string, sectionId: string, next: string | null): boolean => {
    if (!isView(next)) return false;
    const raw = sessions.sectionHandle(projectId, sectionId);
    const slot = readPayload(raw.read());
    if (slot.kind === 'future') {
      const key = keyOf(projectId, sectionId);
      if (!memory.has(key) && memory.size >= MAX_MEMORY_VIEWS) return false;
      memory.set(key, next);
      return true;
    }
    if (slot.kind === 'empty') return next === null ? true : raw.write({ v: PAYLOAD_VERSION, view: next, data: null });
    if (slot.kind === 'envelope' && slot.view === next) return true;
    return raw.write({ v: PAYLOAD_VERSION, view: next, data: slot.data });
  };

  const dataHandle = (projectId: string, sectionId: string): SectionStateHandle => {
    const key = keyOf(projectId, sectionId);
    const cached = handles.get(key);
    if (cached) return cached;
    const raw = sessions.sectionHandle(projectId, sectionId);
    const handle: SectionStateHandle = {
      read: () => {
        const slot = readPayload(raw.read());
        if (slot.kind === 'empty') return undefined;
        if (slot.kind === 'legacy') return slot.data;
        return slot.data === null ? undefined : slot.data;
      },
      write: (value) => {
        if (!isJsonValue(value) || jsonSize(value) > MAX_SECTION_STATE) return false;
        const slot = readPayload(raw.read());
        if (slot.kind === 'future') return false;
        return raw.write({ v: PAYLOAD_VERSION, view: slot.kind === 'envelope' ? slot.view : null, data: value });
      },
    };
    handles.set(key, handle);
    return handle;
  };

  return { view, setView, dataHandle };
}

const owners = new WeakMap<object, SectionPayloads>();

/**
 * The payload owner of one session store. The chrome and the navigation source of a composition share
 * it, so a view kept in memory for a newer payload is seen by both.
 */
export function sectionPayloadsFor(sessions: SessionSlots): SectionPayloads {
  const existing = owners.get(sessions);
  if (existing) return existing;
  const created = createSectionPayloads(sessions);
  owners.set(sessions, created);
  return created;
}
