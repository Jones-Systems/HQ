import { sortByPosition } from '../upstream/manual-planner/ordering.js';
import { isRequestId, PlannerPortError, type Anchor, type HistoryEntry, type PlannerError, type PlannerPort, type Snapshot, type WriteResult } from '../port';
import { DEFAULT_SETTINGS, STATUS_IDS, type Item, type PlanningDate, type Settings, type Status } from '../types';
import { normalizeFields, normalizeSettings, randomEntryId, stripDerived, wallTimeToInstant, type NormalizedFields } from '../validation';

// In-memory PlannerPort standing in for the Planner service (RW-4). It mirrors
// planning/store.py: revision guards, 409 revision/order conflicts, top-of-status
// creates, target-only renumbering, and request-ID idempotency with a bounded
// 2,000-entry replay record (same ID and body replays; a different body is
// `request_id_reused`). A failed call records nothing and changes nothing.

export const MAX_REMEMBERED_REQUESTS = 2_000;
export const POSITION_STEP = 1024;
const MAX_HISTORY_PER_ITEM = 200;

export interface FixtureOptions {
  items?: Item[];
  settings?: Settings;
  features?: string[];
  stateVersion?: number;
  now?: () => Date;
  newId?: () => string;
}

/** Test and preview controls; deliberately not part of the port. */
export interface FixtureControl {
  /** Stored records, as the service holds them (no derived date fields). */
  stored(): Item[];
  requestRecordCount(): number;
  hasRequestRecord(requestId: string): boolean;
  stateVersion(): number;
}

type Recorded = { fingerprint: string; response: unknown };

function fail(error: PlannerError): never {
  throw new PlannerPortError(error);
}
const ENUM_FIELDS = ['title', 'kind', 'status', 'motivation', 'horizon', 'priority', 'area'];
const clone = <T>(value: T): T => structuredClone(value);

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => k in b && equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

const abbrFormatters = new Map<string, Intl.DateTimeFormat>();
function zoneAbbr(ms: number, zone: string): string {
  let fmt = abbrFormatters.get(zone);
  if (!fmt) abbrFormatters.set(zone, fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }));
  return fmt.formatToParts(new Date(ms)).find((p) => p.type === 'timeZoneName')?.value ?? '';
}
const utcSeconds = (ms: number) => `${new Date(ms).toISOString().slice(0, 19)}Z`;

/** Read-only derived fields for a timed entry, as the service adds them on read. */
export function withDerived(entry: PlanningDate): PlanningDate {
  if (!entry.time || !entry.tz) return { ...entry };
  const start = wallTimeToInstant(entry.value, entry.time, entry.tz);
  if (start === null) return { ...entry };
  const out: PlanningDate = { ...entry, instant: utcSeconds(start), tz_abbr: zoneAbbr(start, entry.tz) };
  const end = entry.end_time ? wallTimeToInstant(entry.value, entry.end_time, entry.tz) : null;
  if (end !== null) out.end_instant = utcSeconds(end);
  return out;
}

export function createFixturePlanner(options: FixtureOptions = {}): { port: PlannerPort; control: FixtureControl } {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomEntryId;
  const features = [...(options.features ?? [])];
  let settings: Settings = { ...(options.settings ?? DEFAULT_SETTINGS) };
  let version = options.stateVersion ?? 0;
  const items = new Map<string, Item>();
  for (const raw of options.items ?? []) items.set(raw.id, { ...clone(raw), dates: raw.dates.map(stripDerived) });
  const requests = new Map<string, Recorded>();
  const history = new Map<string, HistoryEntry[]>();

  const stamp = () => now().toISOString();
  const read = (stored: Item): Item => ({ ...clone(stored), dates: stored.dates.map(withDerived) });
  const ordered = (list: Iterable<Item>) => sortByPosition([...list]);

  function log(itemId: string, action: string, detail: unknown) {
    const entries = history.get(itemId) ?? [];
    entries.push({ at: stamp(), action, detail });
    history.set(itemId, entries.slice(-MAX_HISTORY_PER_ITEM));
  }

  function edgePosition(status: Status): number {
    const positions = [...items.values()].filter((i) => i.status === status).map((i) => i.position);
    return positions.length ? Math.min(...positions) - POSITION_STEP : POSITION_STEP;
  }

  function guard(id: string, revision: unknown): Item {
    if (typeof revision !== 'number' || !Number.isInteger(revision)) fail({ kind: 'invalid', errors: [{ field: 'revision', message: 'A numeric base revision is required.' }] });
    const current = items.get(id);
    if (!current) return fail({ kind: 'not_found' });
    if (current.revision !== revision) fail({ kind: 'revision_conflict', current: read(current) });
    return current;
  }

  function checkRequestId(requestId: string) {
    if (!isRequestId(requestId)) fail({ kind: 'invalid', errors: [{ field: 'requestId', message: 'Malformed X-Request-Id.' }] });
  }

  function validated(raw: unknown, creating: boolean): NormalizedFields {
    const result = normalizeFields(raw, { creating, features, newId });
    return result.ok ? result.value : fail({ kind: 'invalid', errors: result.errors });
  }

  /** Replay, or apply atomically and record. `apply` must validate before it changes anything. */
  function mutate<R extends { stateVersion: number }>(requestId: string, fingerprint: string, apply: () => Omit<R, 'stateVersion'>, replayed?: (response: R) => R): R {
    const record = requests.get(requestId);
    if (record) {
      if (record.fingerprint !== fingerprint) fail({ kind: 'request_id_reused' });
      const response = clone(record.response) as R;
      return replayed ? replayed(response) : response;
    }
    const payload = apply();
    version += 1;
    const response = { ...payload, stateVersion: version } as R;
    requests.set(requestId, { fingerprint, response: clone(response) });
    while (requests.size > MAX_REMEMBERED_REQUESTS) requests.delete(requests.keys().next().value!);
    return response;
  }

  const write = (requestId: string, fingerprint: string, apply: () => Omit<WriteResult, 'stateVersion' | 'replayed'>): WriteResult =>
    mutate<WriteResult>(requestId, fingerprint, () => ({ ...apply(), replayed: false }), (response) => ({ ...response, replayed: true }));

  // The service fingerprints method, path and body bytes; this keys on the same parts.
  const fingerprintOf = (route: string, body: unknown) => `${route}\n${JSON.stringify(body)}`;

  const port: PlannerPort = {
    async snapshot(): Promise<Snapshot> {
      return { items: ordered(items.values()).map(read), settings: { ...settings }, stateVersion: version, observedAt: stamp(), features: [...features] };
    },

    async version() {
      return version;
    },

    async create(fields, requestId) {
      checkRequestId(requestId);
      const values = validated(fields, true);
      return write(requestId, fingerprintOf('POST /api/items', { fields }), () => {
        const at = stamp();
        const status = values.status!;
        const created: Item = {
          id: newId(), revision: 1, title: values.title!, kind: values.kind!, status,
          motivation: values.motivation ?? null, horizon: values.horizon ?? null, priority: values.priority ?? null,
          area: values.area ?? null, notes: values.notes ?? '', next_steps: values.next_steps ?? [],
          references: values.references ?? [], dates: values.dates ?? [], position: edgePosition(status),
          is_example: false, created_at: at, updated_at: at, archived_at: null, reviewed_at: null,
        };
        items.set(created.id, created);
        log(created.id, 'created', { fields: [], changes: { status: [null, status] } });
        return { item: read(created), changed: [read(created)] };
      });
    },

    async patch(id, revision, patch, requestId) {
      checkRequestId(requestId);
      const values = validated(patch, false);
      return write(requestId, fingerprintOf(`PATCH /api/items/${id}`, { revision, patch }), () => {
        const stored = guard(id, revision);
        // The service compares against the item as read, so a supplied timed
        // date list always counts as changed (its derived fields differ).
        const current = read(stored);
        const fields = (Object.keys(values) as (keyof NormalizedFields)[]).filter((key) => !equal(current[key], values[key]));
        if (!fields.length) return { item: current, changed: [] };
        const next: Item = { ...stored, ...clone(values) };
        if (fields.includes('status')) next.position = edgePosition(values.status!);
        next.revision += 1;
        next.updated_at = stamp();
        items.set(id, next);
        const changes = Object.fromEntries(fields.filter((key) => ENUM_FIELDS.includes(key)).map((key) => [key, [current[key], values[key]]]));
        log(id, 'updated', { fields, changes });
        return { item: read(next), changed: [read(next)] };
      });
    },

    async move(id, revision, status, anchor: Anchor, requestId) {
      checkRequestId(requestId);
      if (!(STATUS_IDS as readonly string[]).includes(status)) fail({ kind: 'invalid', errors: [{ field: 'status', message: 'Unknown status.' }] });
      const body = { revision, status, ...anchor };
      const a = anchor as { after_id?: string; before_id?: string; place?: string };
      if (a.after_id != null && a.before_id != null) fail({ kind: 'invalid', errors: [{ field: 'body', message: 'Give either after_id or before_id, not both.' }] });
      if (a.place !== undefined && a.place !== 'top' && a.place !== 'bottom') fail({ kind: 'invalid', errors: [{ field: 'body', message: 'place must be top or bottom.' }] });
      return write(requestId, fingerprintOf(`POST /api/items/${id}/move`, body), () => {
        const stored = guard(id, revision);
        const ids = ordered([...items.values()].filter((i) => i.status === status && i.id !== id)).map((i) => i.id);
        const target = a.after_id ?? a.before_id;
        let index: number;
        if (target != null) {
          if (!ids.includes(target)) fail({ kind: 'order_conflict' });
          index = ids.indexOf(target) + (a.after_id != null ? 1 : 0);
        } else {
          index = (a.place ?? 'bottom') === 'top' ? 0 : ids.length;
        }
        const oldIds = ordered([...items.values()].filter((i) => i.status === stored.status)).map((i) => i.id);
        ids.splice(index, 0, id);
        const renumbered = new Set<string>();
        ids.forEach((other, i) => {
          const entry = items.get(other)!;
          const position = (i + 1) * POSITION_STEP;
          if (entry.position !== position) renumbered.add(other);
          items.set(other, { ...entry, position });
        });
        if (status === stored.status && equal(oldIds, ids)) {
          return { item: read(items.get(id)!), changed: [...renumbered].map((other) => read(items.get(other)!)) };
        }
        const moved = { ...items.get(id)!, status, revision: stored.revision + 1, updated_at: stamp() };
        items.set(id, moved);
        renumbered.add(id);
        log(id, status !== stored.status ? 'moved' : 'reordered', status !== stored.status
          ? { fields: ['status'], changes: { status: [stored.status, status] } } : { fields: ['position'], changes: {} });
        return { item: read(moved), changed: [...renumbered].map((other) => read(items.get(other)!)) };
      });
    },

    async setArchived(id, revision, archived, requestId) {
      checkRequestId(requestId);
      return write(requestId, fingerprintOf(`POST /api/items/${id}/${archived ? 'archive' : 'restore'}`, { revision }), () => {
        const stored = guard(id, revision);
        if (Boolean(stored.archived_at) === archived) return { item: read(stored), changed: [] };
        const at = stamp();
        const next = { ...stored, archived_at: archived ? at : null, revision: stored.revision + 1, updated_at: at };
        items.set(id, next);
        log(id, archived ? 'archived' : 'restored', { fields: ['archived'], changes: {} });
        return { item: read(next), changed: [read(next)] };
      });
    },

    async markReviewed(id, revision, requestId) {
      checkRequestId(requestId);
      return write(requestId, fingerprintOf(`POST /api/items/${id}/reviewed`, { revision }), () => {
        const stored = guard(id, revision);
        const next = { ...stored, reviewed_at: stamp(), revision: stored.revision + 1 };
        items.set(id, next);
        log(id, 'reviewed', { fields: [], changes: {} });
        return { item: read(next), changed: [read(next)] };
      });
    },

    async history(id) {
      if (!items.has(id)) fail({ kind: 'not_found' });
      return clone([...(history.get(id) ?? [])].reverse().slice(0, 100));
    },

    async updateSettings(next, requestId) {
      checkRequestId(requestId);
      return mutate(requestId, fingerprintOf('PUT /api/settings', { settings: next }), () => {
        const result = normalizeSettings(next, settings);
        if (!result.ok) fail({ kind: 'invalid', errors: result.errors });
        else settings = result.value;
        return { settings: { ...settings } };
      });
    },
  };

  const control: FixtureControl = {
    stored: () => ordered(items.values()).map(clone),
    requestRecordCount: () => requests.size,
    hasRequestRecord: (requestId) => requests.has(requestId),
    stateVersion: () => version,
  };
  return { port, control };
}
