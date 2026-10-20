import { array, referenceInput, bool, day, enumeration, errorSchema, item, itemId, jsonValue, nullable, object, settings, text, timestamp, DATE_KINDS, PRECISIONS, ERROR_CODES } from './schema.ts';
import type { Schema } from './schema.ts';
export const requestId: Schema = { type: 'string', pattern: '^[A-Za-z0-9-]{8,64}$' };
export const versionNumber: Schema = { type: 'integer', minimum: 0 };
export const revision: Schema = { type: 'integer', minimum: 1 };
// instant/end_instant/tz_abbr are read-only derived fields from items get; accepted so dates round-trip, then dropped.
export const dateInput = object({ id: itemId, kind: enumeration(DATE_KINDS), precision: enumeration(PRECISIONS), value: text, time: nullable(text), end_time: nullable(text), tz: nullable(text), note: { type: 'string', maxLength: 120 }, instant: timestamp, end_instant: timestamp, tz_abbr: text }, ['kind', 'value']);
export const fields = object({ ...Object.fromEntries(['title', 'kind', 'status', 'motivation', 'horizon', 'priority', 'area', 'notes'].map(key => [key, item.properties![key]])), next_steps: array(object({ id: itemId, text: item.properties!.next_steps.items!.properties!.text, done: bool }, ['text']), 100), references: array(referenceInput, 30), dates: array(dateInput, 20) }, []);
export const batchSpec = object({ schema: { const: 'hq.planner.batch-create/v1' }, board: { const: 'planner:main' }, items: { ...array(object({ ...fields.properties, client_key: { type: 'string', minLength: 1, maxLength: 200 } }, ['title']), 50), minItems: 1 } }, ['schema', 'board', 'items']);
export const replayDocument = object({ schema: { const: 'hq.planner.replay/v1' }, request_id: requestId, method: enumeration(['POST', 'PATCH', 'PUT']), path: text, body_b64: { type: 'string', maxLength: 349528 }, sent_after_version: versionNumber, planner_url: text, created_at: timestamp });
export const dateResolution = object({ input: text, resolved: text, tz: text, today: day });
export const itemResponse = object({ item, changed: array(text), state_version: versionNumber }, ['item', 'state_version']);
export const settingsResponse = object({ settings, state_version: versionNumber });
export const batchResponse = object({ items: array(item, 50), state_version: versionNumber });
export const dryResponse = object({ valid: { const: true }, count: { type: 'integer', minimum: 1, maximum: 50 }, dry_run: { const: true }, state_version: versionNumber });
export const serviceResponse: Schema = { anyOf: [itemResponse, settingsResponse, batchResponse, dryResponse] };
export const progressItem = object({ index: { type: 'integer', minimum: 0, maximum: 49 }, client_key: text, status: enumeration(['created', 'replayed', 'failed', 'unknown', 'not_attempted']), item, error: errorSchema, replay: replayDocument }, ['index', 'status']);
export const progress = object({ mode: enumeration(['atomic', 'sequential']), resolved_spec: batchSpec, request_id: requestId, sent_after_version: versionNumber, planner_url: text, results: array(progressItem, 50), dates: array(dateResolution), validation: enumeration(['server', 'client_shape_only']), intent_file_error: text }, ['mode', 'resolved_spec', 'request_id', 'sent_after_version', 'planner_url', 'results', 'dates']);
export const singleData = object({ ...itemResponse.properties, settings, dates: array(dateResolution), intent_file_error: text }, ['state_version', 'dates']);
export const replayData = object({ outcome: enumeration(['not_applied', 'replayed', 'applied_now']), response: serviceResponse, intent_file_error: text }, ['outcome']);
export const writeData: Schema = { anyOf: [singleData, progress, replayData] };
export const writeError = object({ code: enumeration(ERROR_CODES), message: text, details: object({ ...errorSchema.properties!.details.properties, batch: progress, receipt: singleData, stage: text, original_code: text, sent_after_version: versionNumber, evicted_through_version: versionNumber, intent_file_error: text, possibly_already_applied: bool }, []) });
export const writeEnvelope = (command: string): Schema => {
  const shared = { schema: { const: 'hq.cli.result/v1' }, command: { const: command }, effect: enumeration(['none', 'applied', 'replayed', 'unknown', 'partial']), request_id: requestId, replay: replayDocument };
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', $defs: { jsonValue }, anyOf: [object({ ...shared, ok: { const: true }, data: writeData }, ['schema', 'command', 'effect', 'ok', 'data']), object({ ...shared, ok: { const: false }, error: writeError }, ['schema', 'command', 'effect', 'ok', 'error'])] };
};
