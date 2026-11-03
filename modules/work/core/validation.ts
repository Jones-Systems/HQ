import { parseReference, type ReferenceEnvelope } from '@hq/contracts';
import { isoWeekOf, isoWeekStart } from './upstream/manual-planner/dates.js';
import {
  DATE_KIND_IDS, EDITABLE_FIELDS, HORIZON_IDS, HQ_REFERENCES_FEATURE, KIND_IDS, LIMITS, MOTIVATION_IDS, PRECISION_IDS,
  PRIORITY_IDS, REF_KIND_IDS, STATUS_IDS,
  type FieldError, type Item, type ItemReference, type NextStep, type PlanningDate, type Precision, type Settings,
} from './types';

// Client-side mirror of the Planner's authoritative validation
// (planning/validation.py and planning/dates.py at the D-1 commit), written by
// hand from those rules for immediate feedback. The service, or the fixture
// standing in for it, remains the validator. Messages and field names match
// the service so either source can be shown unchanged.

export type Validated<T> = { ok: true; value: T } | { ok: false; errors: FieldError[] };

export interface NormalizeOptions {
  creating: boolean;
  /** Service features; `hq` references validate only with `hq-references-v1`. */
  features?: readonly string[];
  /** Id for entries that arrive without one (the service uses 16 random hex digits). */
  newId?: () => string;
}

export type NormalizedFields = Partial<Pick<Item, 'title' | 'kind' | 'status' | 'motivation' | 'horizon' | 'priority' | 'area' | 'notes' | 'next_steps' | 'references' | 'dates'>>;

const ENTRY_ID = /^[A-Za-z0-9_-]{6,40}$/u;
const TIME = /^([01][0-9]|2[0-3]):([0-5][0-9])$/u;
// Python str.split()/strip() whitespace, which includes \x1c-\x1f and \x85.
const PY_SPACE = '\t\n\v\f\r\x1c\x1d\x1e\x1f \x85\xa0                　';
const PY_SPLIT = new RegExp(`[${PY_SPACE}]+`, 'u');
const PY_STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, 'gu');

export function randomEntryId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const codePoints = (text: string) => [...text].length;
const pyStrip = (text: string) => text.replace(PY_STRIP, '');
const isNone = (value: unknown) => value === null || value === undefined;
// Python truthiness, for the service's `raw.get(key) or default` reads.
const orDefault = <T>(value: unknown, fallback: T): unknown => {
  const empty = isNone(value) || value === false || value === 0 || value === ''
    || (Array.isArray(value) && value.length === 0) || (isRecord(value) && Object.keys(value).length === 0);
  return empty ? fallback : value;
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
// JSON transport drops undefined members, so they are absent keys.
const present = (raw: Record<string, unknown>) => Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined));
const hasControl = (text: string, allowed = '') => [...text].some((ch) => {
  const code = ch.codePointAt(0)!;
  return (code < 32 || code === 127) && !allowed.includes(ch);
});

function singleLine(value: unknown, field: string, limit: number, errors: FieldError[], required = false): string | null {
  if (isNone(value)) {
    if (required) errors.push({ field, message: 'Required.' });
    return null;
  }
  if (typeof value !== 'string') {
    errors.push({ field, message: 'Must be text.' });
    return null;
  }
  const text = value.split(PY_SPLIT).filter(Boolean).join(' ');
  if (hasControl(text)) {
    errors.push({ field, message: 'Contains unsupported control characters.' });
    return null;
  }
  if (required && !text) {
    errors.push({ field, message: 'Required.' });
    return null;
  }
  if (codePoints(text) > limit) {
    errors.push({ field, message: `Limited to ${limit} characters.` });
    return null;
  }
  return text;
}

function multiline(value: unknown, field: string, limit: number, errors: FieldError[]): string | null {
  if (isNone(value)) return '';
  if (typeof value !== 'string') {
    errors.push({ field, message: 'Must be text.' });
    return null;
  }
  const text = value.replace(/\r\n/gu, '\n').replace(/\r/gu, '\n');
  if (codePoints(text) > limit) {
    errors.push({ field, message: `Limited to ${limit} characters.` });
    return null;
  }
  // The service rejects C0 controls other than newline and tab here; DEL is allowed.
  if ([...text].some((ch) => ch.codePointAt(0)! < 32 && ch !== '\n' && ch !== '\t')) {
    errors.push({ field, message: 'Contains unsupported control characters.' });
    return null;
  }
  return text;
}

function enumValue<T extends string>(value: unknown, field: string, options: readonly T[], errors: FieldError[], nullable: boolean): T | null {
  if (isNone(value) || value === '') {
    if (!nullable) errors.push({ field, message: 'Required.' });
    return null;
  }
  if (typeof value !== 'string' || !options.includes(value as T)) {
    errors.push({ field, message: `Choose one of: ${options.join(', ')}.` });
    return null;
  }
  return value as T;
}

function entryId(raw: Record<string, unknown>, newId: () => string): string | null {
  const id = raw.id;
  if (isNone(id) || id === '') return newId();
  return typeof id === 'string' && ENTRY_ID.test(id) ? id : null;
}

function onlyKeys(raw: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(raw).every((key) => allowed.includes(key));
}

function steps(value: unknown, errors: FieldError[], newId: () => string): NextStep[] | null {
  if (isNone(value)) return [];
  if (!Array.isArray(value)) {
    errors.push({ field: 'next_steps', message: 'Must be a list.' });
    return null;
  }
  if (value.length > LIMITS.steps) {
    errors.push({ field: 'next_steps', message: `Limited to ${LIMITS.steps} steps.` });
    return null;
  }
  const out: NextStep[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of value.entries()) {
    const malformed = { field: 'next_steps', message: `Step ${i + 1} is malformed.` };
    if (!isRecord(entry) || !onlyKeys(present(entry), ['id', 'text', 'done'])) {
      errors.push(malformed);
      return null;
    }
    const raw = present(entry);
    const id = entryId(raw, newId);
    const text = singleLine(raw.text, 'next_steps', LIMITS.stepText, errors, true);
    const done = 'done' in raw ? raw.done : false;
    if (text === null) return null;
    if (id === null || seen.has(id) || typeof done !== 'boolean') {
      errors.push(malformed);
      return null;
    }
    seen.add(id);
    out.push({ id, text, done });
  }
  return out;
}

/** The service's link rule: http(s), a host, and no character at or below space. */
export function isSafeUrl(url: string): boolean {
  if ([...url].some((ch) => ch.codePointAt(0)! < 33)) return false;
  const match = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#]*)/u.exec(url);
  if (!match || !['http', 'https'].includes(match[1]!.toLowerCase())) return false;
  const netloc = match[2]!;
  // urlsplit rejects unbalanced IPv6 brackets.
  if (netloc.includes('[') !== netloc.includes(']')) return false;
  return netloc.length > 0;
}

function hqReference(raw: Record<string, unknown>, i: number, errors: FieldError[], newId: () => string, targets: Set<string>): ItemReference | null {
  // Proposed D-4 schema (option B), labeled as such: no `url`, a validated envelope target.
  const malformed = { field: 'references', message: `Reference ${i + 1} is malformed.` };
  if (!onlyKeys(raw, ['id', 'kind', 'label', 'target'])) {
    errors.push(malformed);
    return null;
  }
  const id = entryId(raw, newId);
  const target: ReferenceEnvelope | null = parseReference(raw.target);
  if (!target) {
    errors.push({ field: 'references', message: `Reference ${i + 1} has an invalid HQ target.` });
    return null;
  }
  const label = isNone(raw.label) ? '' : singleLine(raw.label, 'references', LIMITS.referenceLabel, errors);
  if (label === null) return null;
  const shown = label || target.title;
  if (codePoints(shown) > LIMITS.referenceLabel) {
    errors.push({ field: 'references', message: `Limited to ${LIMITS.referenceLabel} characters.` });
    return null;
  }
  const key = `${target.domain}/${target.kind}/${target.entityId}`;
  if (targets.has(key)) {
    errors.push({ field: 'references', message: `Reference ${i + 1} duplicates another HQ link.` });
    return null;
  }
  if (id === null) {
    errors.push(malformed);
    return null;
  }
  targets.add(key);
  return { id, kind: 'hq', label: shown, target };
}

function references(value: unknown, errors: FieldError[], newId: () => string, features: readonly string[]): ItemReference[] | null {
  if (isNone(value)) return [];
  if (!Array.isArray(value)) {
    errors.push({ field: 'references', message: 'Must be a list.' });
    return null;
  }
  if (value.length > LIMITS.references) {
    errors.push({ field: 'references', message: `Limited to ${LIMITS.references} references.` });
    return null;
  }
  const hqEnabled = features.includes(HQ_REFERENCES_FEATURE);
  const out: ItemReference[] = [];
  const seen = new Set<string>();
  const targets = new Set<string>();
  for (const [i, entry] of value.entries()) {
    const malformed = { field: 'references', message: `Reference ${i + 1} is malformed.` };
    if (!isRecord(entry)) {
      errors.push(malformed);
      return null;
    }
    const raw = present(entry);
    if (hqEnabled && raw.kind === 'hq') {
      const ref = hqReference(raw, i, errors, newId, targets);
      if (!ref) return null;
      if (seen.has(ref.id)) {
        errors.push(malformed);
        return null;
      }
      seen.add(ref.id);
      out.push(ref);
      continue;
    }
    if (!onlyKeys(raw, ['id', 'kind', 'label', 'url'])) {
      errors.push(malformed);
      return null;
    }
    const id = entryId(raw, newId);
    const kind = orDefault(raw.kind, 'url');
    if (kind === 'hq' || typeof kind !== 'string' || !(REF_KIND_IDS as readonly string[]).includes(kind)) {
      errors.push({ field: 'references', message: `Reference ${i + 1} has an unknown kind.` });
      return null;
    }
    const label = isNone(raw.label) ? '' : singleLine(raw.label, 'references', LIMITS.referenceLabel, errors);
    if (label === null) return null;
    const rawUrl = orDefault(raw.url, '');
    if (typeof rawUrl !== 'string' || rawUrl.length > LIMITS.referenceUrl) {
      errors.push({ field: 'references', message: `Reference ${i + 1} link is too long or invalid.` });
      return null;
    }
    const url = pyStrip(rawUrl);
    if (url && !isSafeUrl(url)) {
      errors.push({ field: 'references', message: `Reference ${i + 1} link must be an http(s) address.` });
      return null;
    }
    if (!label && !url) {
      errors.push({ field: 'references', message: `Reference ${i + 1} needs a label or link.` });
      return null;
    }
    if (id === null || seen.has(id)) {
      errors.push(malformed);
      return null;
    }
    seen.add(id);
    out.push({ id, kind: kind as Exclude<ItemReference['kind'], 'hq'>, label: label || url, url });
  }
  return out;
}

// ------------------------------------------------------------------ dates

class DateError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
  }
}

const IANA_SHAPE = /^[A-Z][A-Za-z0-9+_-]*(?:\/[A-Z][A-Za-z0-9+_-]*)*$/u;
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function wallFormatter(zone: string): Intl.DateTimeFormat {
  let fmt = zoneFormatters.get(zone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    zoneFormatters.set(zone, fmt);
  }
  return fmt;
}

/**
 * An IANA zone name, matched case-sensitively, that this runtime's time zone
 * database knows. The service checks its own host database, which can differ
 * (aliases, `Factory`); it stays authoritative.
 */
export function isValidTimezone(name: unknown): name is string {
  if (typeof name !== 'string' || !name || name.length > 64 || !IANA_SHAPE.test(name)) return false;
  try {
    wallFormatter(name);
    return true;
  } catch {
    return false;
  }
}

function wallParts(ms: number, zone: string) {
  const p = Object.fromEntries(wallFormatter(zone).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) };
}

/**
 * The UTC instant (ms) of a wall time in `zone`, or null inside a clock-change
 * gap. An ambiguous wall time resolves to its first occurrence, as Python's
 * zoneinfo does with fold=0.
 */
export function wallTimeToInstant(day: string, hhmm: string, zone: string): number | null {
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (ms: number) => {
    const w = wallParts(ms, zone);
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
  };
  const candidates = [...new Set([offsetAt(guess - 43_200_000), offsetAt(guess), offsetAt(guess + 43_200_000)])]
    .map((offset) => guess - offset)
    .filter((ms) => {
      const w = wallParts(ms, zone);
      return w.y === y && w.mo === mo && w.d === d && w.h === h && w.mi === mi;
    });
  return candidates.length ? Math.min(...candidates) : null;
}

function checkYear(year: number) {
  if (year < LIMITS.minYear || year > LIMITS.maxYear) throw new DateError('value', `Year must be between ${LIMITS.minYear} and ${LIMITS.maxYear}.`);
}

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Validates a precision/value pair with the service's messages. */
export function checkPeriod(precision: Precision, value: string): void {
  let m: RegExpExecArray | null;
  switch (precision) {
    case 'day': {
      m = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/u.exec(value);
      if (!m) throw new DateError('value', 'Use a day like 2026-11-14.');
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      checkYear(y);
      if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) throw new DateError('value', 'That calendar day does not exist.');
      return;
    }
    case 'week': {
      m = /^([0-9]{4})-W([0-9]{2})$/u.exec(value);
      if (!m) throw new DateError('value', 'Use an ISO week like 2026-W46.');
      checkYear(Number(m[1]));
      if (Number(m[2]) < 1 || isoWeekOf(isoWeekStart(Number(m[1]), Number(m[2]))) !== value) throw new DateError('value', 'That ISO week does not exist.');
      return;
    }
    case 'month': {
      m = /^([0-9]{4})-([0-9]{2})$/u.exec(value);
      if (!m) throw new DateError('value', 'Use a month like 2026-11.');
      checkYear(Number(m[1]));
      if (Number(m[2]) < 1 || Number(m[2]) > 12) throw new DateError('value', 'Month must be 01 to 12.');
      return;
    }
    case 'quarter': {
      m = /^([0-9]{4})-Q([1-4])$/u.exec(value);
      if (!m) throw new DateError('value', 'Use a quarter like 2027-Q2.');
      checkYear(Number(m[1]));
      return;
    }
    case 'year': {
      m = /^([0-9]{4})$/u.exec(value);
      if (!m) throw new DateError('value', 'Use a year like 2027.');
      checkYear(Number(m[1]));
      return;
    }
    default:
      throw new DateError('precision', 'Unknown precision.');
  }
}

const DATE_KEYS = ['id', 'kind', 'precision', 'value', 'time', 'end_time', 'tz', 'note', 'instant', 'end_instant', 'tz_abbr'];

function normalizeDate(entry: unknown, index: number, newId: () => string): PlanningDate {
  if (!isRecord(entry)) throw new DateError('dates', `Date ${index + 1} must be an object.`);
  const raw = present(entry);
  const unknown = Object.keys(raw).filter((key) => !DATE_KEYS.includes(key)).sort();
  if (unknown.length) throw new DateError('dates', `Date ${index + 1} has unknown field(s): ${unknown.join(', ')}.`);
  const id = isNone(raw.id) || raw.id === '' ? newId() : raw.id;
  if (typeof id !== 'string' || !ENTRY_ID.test(id)) throw new DateError('id', 'Date id is malformed.');
  const kind = raw.kind;
  if (typeof kind !== 'string' || !(DATE_KIND_IDS as readonly string[]).includes(kind)) throw new DateError('kind', 'Choose target, deadline, start or event.');
  const precision = raw.precision;
  if (typeof precision !== 'string' || !(PRECISION_IDS as readonly string[]).includes(precision)) throw new DateError('precision', 'Choose day, week, month, quarter or year.');
  if (typeof raw.value !== 'string') throw new DateError('value', 'A date value is required.');
  const value = pyStrip(raw.value);
  checkPeriod(precision as Precision, value);

  const time = orDefault(raw.time, null);
  const endTime = orDefault(raw.end_time, null);
  let tz = orDefault(raw.tz, null);
  if (time !== null) {
    if (precision !== 'day') throw new DateError('time', 'Only a specific day can have a time.');
    if (typeof time !== 'string' || !TIME.test(time)) throw new DateError('time', 'Use a 24-hour time like 14:30.');
    if (!isValidTimezone(tz)) throw new DateError('tz', 'A timed date needs a valid time zone, such as America/New_York.');
    if (wallTimeToInstant(value, time, tz) === null) throw new DateError('time', `${time} does not exist on ${value} in ${tz} (clock change).`);
    if (endTime !== null) {
      if (typeof endTime !== 'string' || !TIME.test(endTime)) throw new DateError('end_time', 'Use a 24-hour end time like 15:30.');
      if (endTime <= time) throw new DateError('end_time', 'End time must be after the start time on the same day.');
      if (wallTimeToInstant(value, endTime, tz) === null) throw new DateError('end_time', `${endTime} does not exist on ${value} in ${tz} (clock change).`);
    }
  } else {
    if (endTime !== null) throw new DateError('end_time', 'An end time needs a start time.');
    // A zone without a time carries no meaning for a calendar date.
    tz = null;
  }

  const rawNote = orDefault(raw.note, '');
  if (typeof rawNote !== 'string') throw new DateError('note', 'Date note must be text.');
  const note = pyStrip(rawNote);
  if (codePoints(note) > LIMITS.dateNote) throw new DateError('note', `Date note is limited to ${LIMITS.dateNote} characters.`);
  if ([...note].some((ch) => ch.codePointAt(0)! < 32)) throw new DateError('note', 'Date note must be a single line.');

  return {
    id, kind: kind as PlanningDate['kind'], precision: precision as Precision, value,
    time: time as string | null, end_time: endTime as string | null, tz: tz as string | null, note,
  };
}

function dates(value: unknown, errors: FieldError[], newId: () => string): PlanningDate[] | null {
  if (isNone(value)) return [];
  if (!Array.isArray(value)) {
    errors.push({ field: 'dates', message: 'Must be a list.' });
    return null;
  }
  if (value.length > LIMITS.dates) {
    errors.push({ field: 'dates', message: `Limited to ${LIMITS.dates} dates.` });
    return null;
  }
  const out: PlanningDate[] = [];
  const seen = new Set<string>();
  for (const [i, entry] of value.entries()) {
    let normalized: PlanningDate;
    try {
      normalized = normalizeDate(entry, i, newId);
    } catch (error) {
      if (!(error instanceof DateError)) throw error;
      errors.push({ field: `dates.${error.field}`, message: error.message });
      return null;
    }
    if (seen.has(normalized.id)) {
      errors.push({ field: 'dates', message: 'Duplicate date id.' });
      return null;
    }
    seen.add(normalized.id);
    out.push(normalized);
  }
  return out;
}

/** Validates a create body or a patch. Only supplied keys are returned for patches. */
export function normalizeFields(input: unknown, options: NormalizeOptions): Validated<NormalizedFields> {
  const { creating, features = [], newId = randomEntryId } = options;
  if (!isRecord(input)) return { ok: false, errors: [{ field: 'body', message: 'Expected an object of fields.' }] };
  const raw = present(input);
  const errors: FieldError[] = [];
  const unknown = Object.keys(raw).filter((key) => !(EDITABLE_FIELDS as readonly string[]).includes(key)).sort();
  if (unknown.length) errors.push({ field: 'body', message: `Unknown field(s): ${unknown.join(', ')}.` });
  if (!creating && Object.keys(raw).length === 0) errors.push({ field: 'body', message: 'Nothing to change.' });

  const out: Record<string, unknown> = {};
  const has = (key: string) => creating || key in raw;
  if (has('title')) out.title = singleLine(raw.title, 'title', LIMITS.title, errors, true);
  if (has('kind')) out.kind = enumValue(creating && !('kind' in raw) ? 'idea' : raw.kind, 'kind', KIND_IDS, errors, false);
  if (has('status')) out.status = enumValue(creating && !('status' in raw) ? 'inbox' : raw.status, 'status', STATUS_IDS, errors, false);
  if (has('motivation')) out.motivation = enumValue(raw.motivation, 'motivation', MOTIVATION_IDS, errors, true);
  if (has('horizon')) out.horizon = enumValue(raw.horizon, 'horizon', HORIZON_IDS, errors, true);
  if (has('priority')) out.priority = enumValue(raw.priority, 'priority', PRIORITY_IDS, errors, true);
  if (has('area')) out.area = singleLine(raw.area, 'area', LIMITS.area, errors) || null;
  if (has('notes')) out.notes = multiline(raw.notes, 'notes', LIMITS.notes, errors);
  if (has('next_steps')) out.next_steps = steps(raw.next_steps, errors, newId);
  if (has('references')) out.references = references(raw.references, errors, newId, features);
  if (has('dates')) out.dates = dates(raw.dates, errors, newId);
  return errors.length ? { ok: false, errors } : { ok: true, value: out as NormalizedFields };
}

/** Validates a settings change and merges it over `current`. */
export function normalizeSettings(input: unknown, current: Settings): Validated<Settings> {
  if (!isRecord(input) || Object.keys(present(input)).length === 0) {
    return { ok: false, errors: [{ field: 'settings', message: 'Expected settings to change.' }] };
  }
  const errors: FieldError[] = [];
  const out: Settings = { ...current };
  for (const [key, value] of Object.entries(present(input))) {
    if (key === 'default_tz') {
      if (isValidTimezone(value)) out.default_tz = value;
      else errors.push({ field: key, message: 'Unknown time zone.' });
    } else if (key === 'week_start') {
      if (value === 'sun' || value === 'mon') out.week_start = value;
      else errors.push({ field: key, message: 'Choose sun or mon.' });
    } else if (key === 'stale_days') {
      if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 365) out.stale_days = value;
      else errors.push({ field: key, message: 'Use a whole number of days from 1 to 365.' });
    } else {
      errors.push({ field: key, message: 'Unknown setting.' });
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/** A date entry without the service-derived read-only fields. */
export function stripDerived(entry: PlanningDate): PlanningDate {
  const out = { ...entry };
  delete out.instant;
  delete out.end_instant;
  delete out.tz_abbr;
  return out;
}
