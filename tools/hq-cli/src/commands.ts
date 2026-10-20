import { array, bool, day, enumeration, errorSchema, failure, HORIZONS, integer, item, itemId, KINDS, object, resultSchema, settings, STATUSES, text, timestamp, DATE_KINDS, historyEntry, jsonValue } from './schema.ts';
import type { Schema } from './schema.ts';
import { WEEKDAYS } from './dates.ts';
export type Command = { id: string; words: string[]; description: string; positional?: string; input: Schema; data: Schema };
const globals = { planner_url: { ...text, description: 'Optional explicit service origin; CLI --planner-url overrides HQ_PLANNER_URL. HTTPS or loopback HTTP only.' }, timeout_ms: { type: 'integer', minimum: 1, maximum: 60000, description: 'Per-read timeout in milliseconds; --timeout-ms, default 10000.' } } satisfies Record<string, Schema>;
const input = (properties: Record<string, Schema> = {}, required: string[] = []) => object({ ...globals, ...properties }, required);
export const filters = {
  board: { const: 'planner:main', description: '--board; only one board exists.' },
  status: enumeration(STATUSES), area: { type: 'string', maxLength: 40 }, kind: enumeration(KINDS), horizon: enumeration(HORIZONS),
  archive: { ...enumeration(['active', 'archived', 'all']), description: '--archive defaults to active (unarchived).' },
  date_kind: { ...enumeration(DATE_KINDS), description: '--date-kind; matches any date of this kind.' },
  from: { ...day, description: '--from inclusive calendar window start. YYYY-MM-DD.' },
  to: { ...day, description: '--to inclusive calendar window end. YYYY-MM-DD.' },
};
const availability = enumeration(['live', 'unconfigured', 'unreachable', 'unavailable', 'not_exposed']);
const domain = object({ id: enumeration(['planner', 'design', 'social', 'work', 'wiki', 'inspiration']), availability, reason: text, features: array(text) });
const count = { type: 'integer', minimum: 0 } satisfies Schema;
const summary = object({ total: count, active: count, archived: count });
const statusData = object({ availability: { const: 'live' }, api: { type: 'integer', minimum: 1 }, features: array(text), state_version: count });
const commandSummary = object({ id: text, invocation: text, description: text });
const schemaDocument: Schema = object({
  type: enumeration(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']), const: { $ref: '#/$defs/jsonValue' }, enum: array({ $ref: '#/$defs/jsonValue' }),
  anyOf: array({ $ref: '#/$defs/schemaDocument' }), properties: { type: 'object', additionalProperties: { $ref: '#/$defs/schemaDocument' } }, required: array(text),
  additionalProperties: { anyOf: [bool, { $ref: '#/$defs/schemaDocument' }] }, items: { $ref: '#/$defs/schemaDocument' },
  minItems: integer, maxItems: integer, minLength: integer, maxLength: integer, pattern: text, minimum: { type: 'number' }, maximum: { type: 'number' }, description: text,
  $ref: text, $schema: text, $defs: { type: 'object', additionalProperties: { $ref: '#/$defs/schemaDocument' } },
}, []);
const schemaData = object({ commands: array(object({ id: text, invocation: text, description: text, input: { $ref: '#/$defs/schemaDocument' }, output: { $ref: '#/$defs/schemaDocument' }, errors: { $ref: '#/$defs/schemaDocument' } })) });
export const commands: Command[] = [
  { id: 'hq.capabilities', words: ['capabilities'], description: 'Discover actual Planner availability and unavailable HQ domains.', input: input(), data: object({ domains: array(domain), multiple_boards: { const: false } }) },
  { id: 'hq.commands', words: ['commands'], description: 'List implemented command IDs and invocations. --help also returns this list.', input: input(), data: object({ commands: array(commandSummary) }) },
  { id: 'hq.schema', words: ['schema'], description: 'Get closed JSON Schemas. Input property names map to --hyphenated flags; item_id and command_id are positional.', positional: 'command_id', input: input({ command_id: text }), data: schemaData },
  { id: 'planner.status', words: ['planner', 'status'], description: 'Read service availability, API level, features and state version. Legacy services without metadata are API 1.', input: input(), data: statusData },
  { id: 'planner.now', words: ['planner', 'now'], description: 'Resolve today, tomorrow and full weekday names in service default_tz. --days defaults to 14; includes today.', input: input({ days: { type: 'integer', minimum: 1, maximum: 31 } }), data: object({ tz: text, today: day, tomorrow: day, observed_at: timestamp, days: array(object({ date: day, weekday: enumeration(WEEKDAYS) }), 31), weekdays: object(Object.fromEntries(WEEKDAYS.map(w => [w, array(day)]))) }) },
  { id: 'planner.boards', words: ['planner', 'boards'], description: 'Read the single Planner board, fixed columns, and actual areas/counts. Counts include archived items separately.', input: input(), data: object({ multiple_boards: { const: false }, state_version: count, boards: { ...array(object({ id: { const: 'planner:main' }, name: { const: 'Planner' }, counts: summary, columns: { ...array(object({ id: enumeration(STATUSES), name: text, counts: summary }), 7), minItems: 7 }, areas: array(object({ name: text, counts: summary })) }), 1), minItems: 1 } }) },
  { id: 'planner.items.list', words: ['planner', 'items', 'list'], description: 'Filter a snapshot; date windows match any qualifying date by inclusive period overlap and retain every original date/precision.', input: input(filters), data: object({ board: { const: 'planner:main' }, state_version: count, filters: object(filters, []), date_match: { const: 'any qualifying date; inclusive calendar-period overlap; original precision retained' }, items: array(item) }) },
  { id: 'planner.items.get', words: ['planner', 'items', 'get'], description: 'Get one canonical item and optimistic revision.', positional: 'item_id', input: input({ item_id: itemId }, ['item_id']), data: object({ item }) },
  { id: 'planner.items.history', words: ['planner', 'items', 'history'], description: 'Get up to 100 most recent history entries in service order.', positional: 'item_id', input: input({ item_id: itemId }, ['item_id']), data: object({ item_id: itemId, history: array(historyEntry, 100) }) },
  { id: 'planner.settings.get', words: ['planner', 'settings', 'get'], description: 'Get authoritative Planner timezone, week start and stale-day settings.', input: input(), data: object({ settings, state_version: count }) },
];
export const invocation = (c: Command) => `hq ${c.words.join(' ')}${c.positional ? (c.id === 'hq.schema' ? ' [command-id]' : ' <item-id>') : ''}`;
export const summaries = () => commands.map(c => ({ id: c.id, invocation: invocation(c), description: c.description }));
export const schemas = (selected = commands) => selected.map(c => ({ id: c.id, invocation: invocation(c), description: c.description, input: { $schema: 'https://json-schema.org/draft/2020-12/schema', ...c.input }, output: { ...resultSchema(c.id, c.data), ...(c.id === 'hq.schema' ? { $defs: { schemaDocument, jsonValue } } : {}) }, errors: failure(c.id) }));
