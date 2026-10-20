export type Schema = {
  type?: string; const?: unknown; enum?: readonly unknown[]; anyOf?: Schema[];
  properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean | Schema;
  items?: Schema; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number;
  pattern?: string; minimum?: number; maximum?: number; description?: string; $ref?: string;
  $defs?: Record<string, Schema>; $schema?: string;
};
export const text: Schema = { type: 'string' };
export const integer: Schema = { type: 'integer' };
export const bool: Schema = { type: 'boolean' };
export const enumeration = (values: readonly string[]): Schema => ({ type: 'string', enum: values });
export const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
export const array = (items: Schema, maxItems?: number): Schema => ({ type: 'array', items, ...(maxItems === undefined ? {} : { maxItems }) });
export const object = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: 'object', properties, required, additionalProperties: false });
export const STATUSES = ['inbox', 'considering', 'next', 'active', 'on_hold', 'done', 'dropped'] as const;
export const KINDS = ['project', 'idea', 'goal', 'chore'] as const;
export const HORIZONS = ['now', 'soon', 'later', 'someday'] as const;
export const DATE_KINDS = ['target', 'deadline', 'start', 'event'] as const;
export const PRECISIONS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export const itemId: Schema = { type: 'string', pattern: '^[A-Za-z0-9_-]{6,40}$' };
export const day: Schema = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
export const timestamp: Schema = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,6})?Z$' };
export const settings = object({ default_tz: { type: 'string', minLength: 1, maxLength: 64 }, week_start: enumeration(['sun', 'mon']), stale_days: { type: 'integer', minimum: 1, maximum: 365 } });
const dateBase = {
  id: itemId, kind: enumeration(DATE_KINDS), precision: enumeration(PRECISIONS), value: text,
  time: nullable({ type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
  end_time: nullable({ type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }),
  tz: nullable(text), note: { type: 'string', maxLength: 120 }, instant: timestamp, end_instant: timestamp, tz_abbr: text,
};
export const planningDate = object(dateBase, ['id', 'kind', 'precision', 'value', 'time', 'end_time', 'tz', 'note']);
// The length lookahead preserves parseReference’s UTF-16 limits, including astral text.
const referenceText = (max = 160): Schema => ({ type: 'string', minLength: 1, maxLength: max, pattern: `^(?=[\\s\\S]{1,${max}}$)(?!\\s)(?![\\s\\S]*\\s$)[^\\u0000-\\u001f\\u007f]+$` });
const referenceDomain = enumeration(['design', 'social', 'work']);
export const referenceEnvelope = object({
  version: { const: 1 }, domain: referenceDomain, projectId: referenceText(), kind: referenceText(), entityId: referenceText(), title: referenceText(300),
  returnDestination: object({ domain: referenceDomain, destination: { ...referenceText(512), pattern: `^(?![a-zA-ZſK][a-zA-Z0-9ſK+.-]*:|[/\\\\]{2})${referenceText(512).pattern!.slice(1)}` } }),
  sourceRevision: referenceText(300), workspaceId: referenceText(),
}, ['version', 'domain', 'projectId', 'kind', 'entityId', 'title', 'returnDestination']);
const legacyReferenceProperties = { id: itemId, kind: enumeration(['url', 'doc', 'repo', 'pr', 'project', 'workstream', 'other']), label: text, url: text };
const hqReferenceProperties = { id: itemId, kind: { const: 'hq' }, label: { type: 'string', maxLength: 200 }, target: referenceEnvelope } satisfies Record<string, Schema>;
export const reference: Schema = { anyOf: [object(legacyReferenceProperties), object(hqReferenceProperties)] };
export const referenceInput: Schema = { anyOf: [object(legacyReferenceProperties, []), object(hqReferenceProperties, ['kind', 'target'])] };
export const item = object({
  id: itemId, revision: { type: 'integer', minimum: 1 }, title: { type: 'string', minLength: 1, maxLength: 200 },
  kind: enumeration(KINDS), status: enumeration(STATUSES), motivation: nullable(enumeration(['need', 'want', 'exploring'])),
  horizon: nullable(enumeration(HORIZONS)), priority: nullable(enumeration(['high', 'normal', 'low'])),
  area: nullable({ type: 'string', maxLength: 40 }), notes: { type: 'string', maxLength: 20000 },
  next_steps: array(object({ id: itemId, text: { type: 'string', minLength: 1, maxLength: 300 }, done: bool }), 100),
  references: array(reference, 30),
  dates: array(planningDate, 20), position: integer, is_example: bool,
  created_at: timestamp, updated_at: timestamp, archived_at: nullable(timestamp), reviewed_at: nullable(timestamp),
});
export const jsonValue: Schema = { anyOf: [{ type: 'null' }, text, { type: 'number' }, bool, { type: 'array', items: { $ref: '#/$defs/jsonValue' } }, { type: 'object', additionalProperties: { $ref: '#/$defs/jsonValue' } }] };
export const historyEntry = object({ at: timestamp, action: text, detail: { type: 'object', additionalProperties: { $ref: '#/$defs/jsonValue' }, description: 'Service-owned history detail. Imports permit arbitrary JSON object fields; preserved without reinterpretation.' } });
export const historyResponse: Schema = { ...object({ history: array(historyEntry, 100) }), $defs: { jsonValue } };
export const version = object({ state_version: { type: 'integer', minimum: 0 }, api: { type: 'integer', minimum: 1 }, features: array(text), request_retention: object({ max: { type: 'integer', minimum: 1 }, evicted_through_version: { type: 'integer', minimum: 0 } }) }, ['state_version']);
export const state = object({ ...version.properties, items: array(item), settings, server_time: timestamp }, ['state_version', 'items', 'settings', 'server_time']);
export const ERROR_CODES = ['usage_error', 'internal_error', 'unconfigured', 'connection_refused', 'dns_failure', 'network_error', 'timeout', 'access_refused', 'redirect_refused', 'response_too_large', 'bad_response', 'validation_error', 'revision_conflict', 'order_conflict', 'request_id_reused', 'not_found', 'service_unavailable', 'capability_missing', 'replay_unsupported', 'replay_indeterminate', 'batch_partial', 'write_unknown', 'version_unavailable', 'intent_file_error', 'resume_requires_edit'] as const;
export const errorSchema = object({ code: enumeration(ERROR_CODES), message: text, details: object({ hint: text, field: text, http_status: integer, errors: array(object({ field: text, message: text })), current: item, original_code: text, stage: text, sent_after_version: { type: 'integer', minimum: 0 }, evicted_through_version: { type: 'integer', minimum: 0 }, possibly_already_applied: bool }, []) });
export const failure = (command: string) => object({ schema: { const: 'hq.cli.result/v1' }, ok: { const: false }, command: { const: command }, effect: { const: 'none' }, error: errorSchema });
export const resultSchema = (command: string, data: Schema): Schema => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: { jsonValue }, anyOf: [object({ schema: { const: 'hq.cli.result/v1' }, ok: { const: true }, command: { const: command }, effect: { const: 'none' }, data }), failure(command)] });

export function conforms(schema: Schema, value: unknown, allowExtras = false, root = schema): boolean {
  // HQ reference envelopes are closed even when projecting additive service fields.
  if (schema === referenceEnvelope || ((schema === reference || schema === referenceInput) && (value as any)?.kind === 'hq')) allowExtras = false;
  if (schema === referenceEnvelope && (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) return false;
  if (schema === referenceEnvelope && ![Object.prototype, null].includes(Object.getPrototypeOf((value as any).returnDestination ?? {}))) return false;
  if (schema.$ref) { const ref = root.$defs?.[schema.$ref.replace('#/$defs/', '')]; return ref !== undefined && conforms(ref, value, allowExtras, root); }
  if (schema.anyOf) return schema.anyOf.some(s => conforms(s, value, allowExtras, root));
  if ('const' in schema && schema.const !== value) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'null') return value === null;
  if (schema.type === 'string') return typeof value === 'string' && (schema.minLength === undefined || [...value].length >= schema.minLength) && (schema.maxLength === undefined || [...value].length <= schema.maxLength) && (!schema.pattern || new RegExp(schema.pattern).test(value));
  if (schema.type === 'boolean') return typeof value === 'boolean';
  if (schema.type === 'integer' || schema.type === 'number') return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isSafeInteger(value)) && (schema.minimum === undefined || value >= schema.minimum) && (schema.maximum === undefined || value <= schema.maximum);
  if (schema.type === 'array') return Array.isArray(value) && (schema.minItems === undefined || value.length >= schema.minItems) && (schema.maxItems === undefined || value.length <= schema.maxItems) && value.every(v => conforms(schema.items!, v, allowExtras, root));
  if (schema.type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    if (schema.required?.some(key => !Object.hasOwn(record, key))) return false;
    return Object.entries(record).every(([key, v]) => Object.hasOwn(schema.properties ?? {}, key) ? conforms(schema.properties![key], v, allowExtras, root) : allowExtras || schema.additionalProperties === true || (typeof schema.additionalProperties === 'object' && conforms(schema.additionalProperties, v, allowExtras, root)));
  }
  return true;
}

export function project(schema: Schema, value: any, root = schema): any {
  if (schema.$ref) return project(root.$defs![schema.$ref.replace('#/$defs/', '')], value, root);
  if (schema.anyOf) return project(schema.anyOf.find(s => conforms(s, value, true, root))!, value, root);
  if (schema.type === 'array') return value.map((v: unknown) => project(schema.items!, v, root));
  if (schema.type === 'object') return Object.fromEntries(Object.entries(value).flatMap(([key, v]) => {
    const child = Object.hasOwn(schema.properties ?? {}, key) ? schema.properties![key] : schema.additionalProperties;
    return typeof child === 'object' ? [[key, project(child, v, root)]] : [];
  }));
  return value;
}
