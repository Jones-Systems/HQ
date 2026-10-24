import { parseReference } from '@hq/contracts';
import type { HistoryEntry, PlannerError, Snapshot } from '../core/port';
import {
  DATE_KIND_IDS, EDITABLE_FIELDS, HORIZON_IDS, HQ_REFERENCES_FEATURE, KIND_IDS, MOTIVATION_IDS, PRECISION_IDS,
  PRIORITY_IDS, REF_KIND_IDS, STATUS_IDS,
  type DateInput, type FieldError, type Item, type ItemReference, type NewItemFields, type NextStep, type PlanningDate,
  type ReferenceInput, type Settings, type StepInput,
} from '../core/types';

// Work-local wire decoders for Planner response bodies, and the canonical typed write parameters. Decoders fail
// closed: a missing or mistyped member makes the whole body malformed (`null`), never a guessed value. Unknown extra
// members are dropped, so an additive service field cannot leak into an Item. Parameters are built in one fixed key
// order with derived date fields stripped, so the same intent is always the same value.

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string';
const isNullableText = (value: unknown): value is string | null => value === null || typeof value === 'string';
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;
const oneOf = <T extends string>(ids: readonly T[], value: unknown): value is T => typeof value === 'string' && (ids as readonly string[]).includes(value);
const nullableOneOf = <T extends string>(ids: readonly T[], value: unknown): value is T | null => value === null || oneOf(ids, value);

class Malformed extends Error {}
function need<T>(ok: boolean, value: T): T {
  if (!ok) throw new Malformed();
  return value;
}
/** Runs a decoder; any failure is a malformed body. */
function decode<T>(run: () => T): T | null {
  try {
    return run();
  } catch (error) {
    if (error instanceof Malformed) return null;
    throw error;
  }
}

function step(raw: unknown): NextStep {
  need(isRecord(raw), raw);
  const { id, text, done } = raw as Json;
  return { id: need(isText(id), id as string), text: need(isText(text), text as string), done: need(typeof done === 'boolean', done as boolean) };
}

function reference(raw: unknown): ItemReference {
  need(isRecord(raw), raw);
  const r = raw as Json;
  const id = need(isText(r.id), r.id as string);
  const label = need(isText(r.label), r.label as string);
  if (r.kind === 'hq') {
    const target = parseReference(r.target);
    return { id, kind: 'hq', label, target: need(target !== null, target!) };
  }
  need(oneOf(REF_KIND_IDS, r.kind) && r.kind !== 'hq', r.kind);
  return { id, kind: r.kind as Exclude<ItemReference['kind'], 'hq'>, label, url: need(isText(r.url), r.url as string) };
}

function planningDate(raw: unknown): PlanningDate {
  need(isRecord(raw), raw);
  const d = raw as Json;
  const out: PlanningDate = {
    id: need(isText(d.id), d.id as string),
    kind: need(oneOf(DATE_KIND_IDS, d.kind), d.kind as PlanningDate['kind']),
    precision: need(oneOf(PRECISION_IDS, d.precision), d.precision as PlanningDate['precision']),
    value: need(isText(d.value), d.value as string),
    time: need(isNullableText(d.time), d.time as string | null),
    end_time: need(isNullableText(d.end_time), d.end_time as string | null),
    tz: need(isNullableText(d.tz), d.tz as string | null),
    note: need(isText(d.note), d.note as string),
  };
  // Derived by the service for timed entries; kept for display, stripped before any write.
  for (const key of ['instant', 'end_instant', 'tz_abbr'] as const) {
    if (d[key] !== undefined) out[key] = need(isText(d[key]), d[key] as string);
  }
  return out;
}

function list<T>(value: unknown, each: (raw: unknown) => T): T[] {
  return need(Array.isArray(value), value as unknown[]).map(each);
}

function item(raw: unknown): Item {
  need(isRecord(raw), raw);
  const r = raw as Json;
  return {
    id: need(isText(r.id) && r.id.length > 0, r.id as string),
    revision: need(Number.isInteger(r.revision) && (r.revision as number) >= 1, r.revision as number),
    title: need(isText(r.title), r.title as string),
    kind: need(oneOf(KIND_IDS, r.kind), r.kind as Item['kind']),
    status: need(oneOf(STATUS_IDS, r.status), r.status as Item['status']),
    motivation: need(nullableOneOf(MOTIVATION_IDS, r.motivation), r.motivation as Item['motivation']),
    horizon: need(nullableOneOf(HORIZON_IDS, r.horizon), r.horizon as Item['horizon']),
    priority: need(nullableOneOf(PRIORITY_IDS, r.priority), r.priority as Item['priority']),
    area: need(isNullableText(r.area), r.area as string | null),
    notes: need(isText(r.notes), r.notes as string),
    next_steps: list(r.next_steps, step),
    references: list(r.references, reference),
    dates: list(r.dates, planningDate),
    position: need(typeof r.position === 'number' && Number.isFinite(r.position), r.position as number),
    is_example: need(typeof r.is_example === 'boolean', r.is_example as boolean),
    created_at: need(isText(r.created_at), r.created_at as string),
    updated_at: need(isText(r.updated_at), r.updated_at as string),
    archived_at: need(isNullableText(r.archived_at), r.archived_at as string | null),
    reviewed_at: need(isNullableText(r.reviewed_at), r.reviewed_at as string | null),
  };
}

function settings(raw: unknown): Settings {
  need(isRecord(raw), raw);
  const s = raw as Json;
  return {
    default_tz: need(isText(s.default_tz) && s.default_tz.length > 0, s.default_tz as string),
    week_start: need(s.week_start === 'sun' || s.week_start === 'mon', s.week_start as Settings['week_start']),
    stale_days: need(Number.isInteger(s.stale_days), s.stale_days as number),
  };
}

/** Service capabilities; `[]` when the service names none. */
function features(raw: Json): string[] {
  if (raw.features === undefined) return [];
  return list(raw.features, (f) => need(isText(f), f as string));
}

export interface Observed { stateVersion: number; features: string[] }

/** `GET /api/state` → Snapshot: `state_version` → `stateVersion`, `server_time` → `observedAt`, missing `features` → `[]`. */
export function decodeSnapshot(body: unknown): Snapshot | null {
  return decode(() => {
    need(isRecord(body), body);
    const b = body as Json;
    return {
      items: list(b.items, item),
      settings: settings(b.settings),
      stateVersion: need(isCount(b.state_version), b.state_version as number),
      observedAt: need(isText(b.server_time) && b.server_time.length > 0, b.server_time as string),
      features: features(b),
    };
  });
}

/** `GET /api/version`. */
export function decodeVersion(body: unknown): Observed | null {
  return decode(() => {
    need(isRecord(body), body);
    const b = body as Json;
    return { stateVersion: need(isCount(b.state_version), b.state_version as number), features: features(b) };
  });
}

export function decodeItemBody(body: unknown): Item | null {
  return decode(() => item(need(isRecord(body), body as Json).item));
}

export function decodeHistory(body: unknown): HistoryEntry[] | null {
  return decode(() => list(need(isRecord(body), body as Json).history, (raw) => {
    need(isRecord(raw), raw);
    const h = raw as Json;
    return { at: need(isText(h.at), h.at as string), action: need(isText(h.action), h.action as string), detail: h.detail ?? null };
  }));
}

/**
 * A write response: `{item, changed?, state_version}`. The service's `changed` lists field names, not items; it is
 * absent on create, which always changes the new item.
 */
export interface DecodedWrite { item: Item; changedFields: string[] | null; stateVersion: number }

export function decodeWrite(body: unknown): DecodedWrite | null {
  return decode(() => {
    need(isRecord(body), body);
    const b = body as Json;
    return {
      item: item(b.item),
      changedFields: b.changed === undefined ? null : list(b.changed, (f) => need(isText(f), f as string)),
      stateVersion: need(isCount(b.state_version), b.state_version as number),
    };
  });
}

export function decodeSettingsWrite(body: unknown): { settings: Settings; stateVersion: number } | null {
  return decode(() => {
    need(isRecord(body), body);
    const b = body as Json;
    return { settings: settings(b.settings), stateVersion: need(isCount(b.state_version), b.state_version as number) };
  });
}

/** The replay route's success body. */
export type DecodedReplay =
  | { outcome: 'replayed' | 'applied_now'; status: number; response: unknown }
  | { outcome: 'not_applied' };

export function decodeReplay(body: unknown): DecodedReplay | null {
  return decode(() => {
    need(isRecord(body), body);
    const b = body as Json;
    if (b.outcome === 'not_applied') return { outcome: 'not_applied' };
    need(b.outcome === 'replayed' || b.outcome === 'applied_now', b.outcome);
    need(Number.isInteger(b.status) && (b.status as number) >= 200 && (b.status as number) < 300, b.status);
    return { outcome: b.outcome as 'replayed' | 'applied_now', status: b.status as number, response: b.response };
  });
}

/** An error body: `{error, message?, errors?, current?, ...}`. */
export interface DecodedError { error: string; message: string | null; body: Json }

export function decodeError(body: unknown): DecodedError | null {
  if (!isRecord(body) || !isText(body.error)) return null;
  return { error: body.error, message: isText(body.message) ? body.message : null, body };
}

/** `[{field, message}]`, or null when absent or malformed. */
export function fieldErrors(body: Json): FieldError[] | null {
  return decode(() => {
    const errors = list(body.errors, (raw) => {
      need(isRecord(raw), raw);
      const e = raw as Json;
      return { field: need(isText(e.field), e.field as string), message: need(isText(e.message), e.message as string) };
    });
    return need(errors.length > 0, errors);
  });
}

export function decodeCurrent(body: Json): Item | null {
  return decode(() => item(body.current));
}

// ---------------------------------------------------------------- parameters

const present = <T extends object>(value: T): Partial<T> =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
const pick = (raw: Json, keys: readonly string[]): Json => {
  const out: Json = {};
  for (const key of keys) if (raw[key] !== undefined) out[key] = structuredClone(raw[key]);
  return out;
};

const STEP_KEYS = ['id', 'text', 'done'] as const;
const URL_REFERENCE_KEYS = ['id', 'kind', 'label', 'url'] as const;
/** Kind, precision, value, time, tz and note are kept; the derived `instant`, `end_instant` and `tz_abbr` are not. */
const DATE_KEYS = ['id', 'kind', 'precision', 'value', 'time', 'end_time', 'tz', 'note'] as const;
const SETTINGS_KEYS = ['default_tz', 'week_start', 'stale_days'] as const;

export type ParamsCheck<T> = { ok: true; value: T } | { ok: false; error: PlannerError };

/**
 * Canonical create or patch fields: editable keys in a fixed order, entries in a fixed key order, derived date fields
 * stripped. `hq` references are writable only when the Planner advertises `hq-references-v1`, and only with a target
 * the unchanged `parseReference` accepts; otherwise nothing is sent. Unknown keys pass through after the known ones
 * so the service, the authority, still sees and rejects them.
 */
export function canonicalFields<T extends NewItemFields | Record<string, unknown>>(fields: T, features: readonly string[]): ParamsCheck<T> {
  const raw = present(fields as Json) as Json;
  const out: Json = {};
  const ordered = [...EDITABLE_FIELDS, ...Object.keys(raw).filter((k) => !(EDITABLE_FIELDS as readonly string[]).includes(k))];
  const hqEnabled = features.includes(HQ_REFERENCES_FEATURE);
  for (const key of ordered) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (key === 'next_steps' && Array.isArray(value)) {
      out[key] = value.map((s: StepInput) => (isRecord(s) ? pick(s as unknown as Json, STEP_KEYS) : structuredClone(s)));
    } else if (key === 'dates' && Array.isArray(value)) {
      out[key] = value.map((d: DateInput) => (isRecord(d) ? pick(d as unknown as Json, DATE_KEYS) : structuredClone(d)));
    } else if (key === 'references' && Array.isArray(value)) {
      const refs: unknown[] = [];
      for (const [i, ref] of (value as ReferenceInput[]).entries()) {
        if (!isRecord(ref) || ref.kind !== 'hq') {
          refs.push(isRecord(ref) ? pick(ref as Json, URL_REFERENCE_KEYS) : structuredClone(ref));
          continue;
        }
        if (!hqEnabled) return { ok: false, error: { kind: 'invalid', errors: [{ field: 'references', message: `Reference ${i + 1} has an unknown kind.` }] } };
        const target = parseReference((ref as Json).target);
        if (!target) return { ok: false, error: { kind: 'invalid', errors: [{ field: 'references', message: `Reference ${i + 1} has an invalid HQ target.` }] } };
        // Unexpected members stay so the service rejects them as malformed, as Work validation does.
        const extra = pick(ref as Json, Object.keys(ref).filter((k) => !['id', 'kind', 'label', 'target'].includes(k)));
        refs.push({ ...pick(ref as Json, ['id', 'kind', 'label']), target, ...extra });
      }
      out[key] = refs;
    } else {
      out[key] = structuredClone(value);
    }
  }
  return { ok: true, value: out as T };
}

export function canonicalSettings(value: Partial<Settings>): Partial<Settings> {
  return pick(value as Json, SETTINGS_KEYS) as Partial<Settings>;
}

/** Deep-freezes a recorded intent so nothing can change it after it is first sent. */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** A stable identity for a typed intent: key order is already canonical, so JSON text compares exactly. */
export const intentKey = (value: unknown): string => JSON.stringify(value);
