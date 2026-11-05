import { HQ_REFERENCES_FEATURE, STATUS_IDS, type Settings } from '../core/types';
import {
  ENTITY_ID_PATTERN, REQUEST_ID_PATTERN, WORK_WRITE_ROUTES, type WorkMutationCall, type WorkServiceParams,
} from './transport';
import { canonicalFields, canonicalSettings, intentKey } from './wire';

// Recovery intents (`PlannerRecovery.exportIntent` and `adoptIntent`). A recorded write leaves the adapter as plain
// JSON so a durable queue can keep it across a restart, and is accepted back only when it is exactly what this adapter
// would have recorded: the same members in the same order, canonical fields, valid IDs. Anything else is refused, so
// a damaged or foreign document can never become a replay original.

/** Deep enough for any Planner write; also what stops a cyclic value. */
const MAX_DEPTH = 64;
const ANCHORS = ['after_id', 'before_id', 'place'] as const;

type Json = Record<string, unknown>;

/** A plain object, from any realm: its prototype is null or a root prototype. */
function isPlain(value: unknown): value is Json {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === null || Object.getPrototypeOf(proto) === null;
}

/** A value `JSON.stringify` keeps whole: finite numbers, plain objects, dense arrays, bounded depth. */
function isJson(value: unknown, depth = 0): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth >= MAX_DEPTH) return false;
  if (Array.isArray(value)) return Object.keys(value).length === value.length && value.every((entry) => isJson(entry, depth + 1));
  return isPlain(value) && Object.values(value).every((entry) => isJson(entry, depth + 1));
}

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
const hasKeys = (value: Json, required: readonly string[], optional: readonly string[] = []) =>
  required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));

/**
 * The call as the adapter records it (members in its order, fields canonical), or null when `raw` is not a valid
 * mutation call for `requestId`. `hq` references are checked for shape and target but not for the advertised feature:
 * that gates a send, adoption sends nothing, and the service stays the authority on a later replay.
 */
function rebuild(raw: unknown, requestId: string): WorkMutationCall | null {
  if (!isPlain(raw) || !hasKeys(raw, ['route', 'params']) || !isPlain(raw.params)) return null;
  const route = raw.route as WorkMutationCall['route'];
  const p = raw.params;
  if (!(WORK_WRITE_ROUTES as readonly unknown[]).includes(route) || p.requestId !== requestId) return null;
  if (route === 'create') {
    if (!hasKeys(p, ['requestId', 'fields']) || !isPlain(p.fields)) return null;
    const fields = canonicalFields(p.fields, [HQ_REFERENCES_FEATURE]);
    return fields.ok ? { route, params: { requestId, fields: fields.value } } : null;
  }
  if (route === 'settings') {
    if (!hasKeys(p, ['requestId', 'settings']) || !isPlain(p.settings)) return null;
    return { route, params: { requestId, settings: canonicalSettings(p.settings as Partial<Settings>) as Readonly<Json> } };
  }
  // Every other route addresses one item at a revision.
  if (typeof p.id !== 'string' || !ENTITY_ID_PATTERN.test(p.id) || !isCount(p.revision)) return null;
  const { id, revision } = p;
  if (route === 'patch') {
    if (!hasKeys(p, ['id', 'requestId', 'revision', 'patch']) || !isPlain(p.patch)) return null;
    const patch = canonicalFields(p.patch, [HQ_REFERENCES_FEATURE]);
    return patch.ok ? { route, params: { id, requestId, revision, patch: patch.value } } : null;
  }
  if (route === 'move') {
    if (!hasKeys(p, ['id', 'requestId', 'revision', 'status'], ANCHORS)) return null;
    if (typeof p.status !== 'string' || !(STATUS_IDS as readonly string[]).includes(p.status)) return null;
    const present = ANCHORS.filter((key) => Object.hasOwn(p, key));
    if (present.length > 1) return null;
    const anchor = present[0];
    const sound = anchor === undefined
      || (anchor === 'place' ? p.place === 'top' || p.place === 'bottom' : typeof p[anchor] === 'string' && ENTITY_ID_PATTERN.test(p[anchor]));
    return sound ? { route, params: { id, requestId, revision, status: p.status, ...(anchor ? { [anchor]: p[anchor] } : {}) } as WorkServiceParams['move'] } : null;
  }
  return hasKeys(p, ['id', 'requestId', 'revision']) ? { route, params: { id, requestId, revision } } : null;
}

export interface ParsedIntent {
  readonly requestId: string;
  readonly sentAfterVersion: number;
  /** A fresh copy that shares nothing with the parsed value. */
  readonly call: WorkMutationCall;
  /** `intentKey(call)`: the identity the ledger compares. */
  readonly key: string;
}

/** Validates an exported intent; null when anything about it is off. Never throws and never sends. */
export function parseIntent(value: unknown): ParsedIntent | null {
  if (!isPlain(value) || !hasKeys(value, ['v', 'requestId', 'sentAfterVersion', 'call']) || value.v !== 1) return null;
  const { requestId, sentAfterVersion } = value;
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId) || !isCount(sentAfterVersion) || !isJson(value.call)) return null;
  const call = rebuild(value.call, requestId);
  if (!call) return null;
  const key = intentKey(call);
  return key === JSON.stringify(value.call) ? { requestId, sentAfterVersion, call, key } : null;
}
