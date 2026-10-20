import { randomUUID } from 'node:crypto';
import { conforms, project, object, enumeration, state, version, settings } from './schema.ts';
import type { Schema } from './schema.ts';
import type { Dependencies, Invocation } from './cli.ts';
import { CliError, PlannerClient, isWriteRoute, plannerURL, usage } from './transport.ts';
import { fields as fieldsShape, batchSpec, replayDocument, itemResponse, settingsResponse, batchResponse, dryResponse, serviceResponse, progress as progressShape } from './write-schema.ts';
import { dateToken, requireTimezone, resolveDates } from './write-dates.ts';
import { checkDates, periodBounds } from './dates.ts';
import { readJSON, atomicJSON, MAX_RESULT_FILE_BYTES } from './files.ts';
type Result = { exitCode: number; result: any };
type Replay = { schema: string; request_id: string; method: string; path: string; body_b64: string; sent_after_version: number; planner_url: string; created_at: string };
const guidance = 'Read back with planner items list and inspect titles/updated_at, then planner items get; for settings use planner settings get. Ask before a new request ID. Never blindly retry.';
const errorValue = (e: CliError) => ({ code: e.code, message: e.message, details: e.details });
const success = (command: string, data: any, effect = 'none', request_id?: string, replay?: Replay): Result => ({ exitCode: 0, result: { schema: 'hq.cli.result/v1', ok: true, command, effect, data, ...(request_id ? { request_id } : {}), ...(replay ? { replay } : {}) } });
const failure = (command: string, error: CliError, request_id?: string, replay?: Replay): Result => ({ exitCode: error.exitCode, result: { schema: 'hq.cli.result/v1', ok: false, command, effect: error.effect, error: errorValue(error), ...(request_id ? { request_id } : {}), ...(replay ? { replay } : {}) } });
function uncertain(code: string, message: string): CliError { const e = new CliError(code, message, 7, { hint: guidance }); e.effect = 'unknown'; return e; }
const bytes = (body: any) => { const text = JSON.stringify(body); if (Buffer.byteLength(text) > 256 * 1024) throw usage('Request body exceeds 256 KiB.'); return text; };
const withoutKey = (item: any) => Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'client_key'));
function validateFields(raw: any, creating: boolean): void {
  if (!conforms(fieldsShape, raw) || (creating && !Object.hasOwn(raw, 'title')) || (!creating && Object.keys(raw).length === 0)) throw usage('Fields do not match the editable-fields schema; create needs title and update needs a nonempty patch.', 'fields');
  const targets = new Set<string>();
  for (const ref of raw.references ?? []) if (ref.kind === 'hq') {
    const key = `${ref.target.domain}/${ref.target.kind}/${ref.target.entityId}`;
    if (targets.has(key)) throw usage('Duplicate HQ reference target.', 'references');
    targets.add(key);
  }
  if (raw.title !== undefined && !raw.title.trim()) throw usage('Title must not be blank.', 'title');
}
function validateBatch(raw: any): void {
  if (!conforms(batchSpec, raw)) throw usage('Batch spec requires schema hq.planner.batch-create/v1, board planner:main, and 1..50 items.', 'spec_file');
  const keys = new Set();
  for (const entry of raw.items) { validateFields(withoutKey(entry), true); if (entry.client_key) { if (keys.has(entry.client_key)) throw usage('Batch client_key values must be unique.'); keys.add(entry.client_key); } }
}
function requireReferences(info: any, inputs: any[]): void {
  if (inputs.some(input => input?.references?.some((ref: any) => ref.kind === 'hq')) && !(info.features ?? []).includes('hq-references-v1')) throw usage('HQ references require advertised hq-references-v1; no write was sent.', 'references');
}
async function preRead(client: PlannerClient): Promise<any> {
  try { return await client.read({ kind: 'version' }, version); }
  catch (error) { const e = error instanceof CliError ? error : new CliError('network_error', 'Version read failed.', 6); throw new CliError('version_unavailable', 'Planner version pre-read failed; no write was sent.', 6, { stage: 'version_pre_read', original_code: e.code }); }
}
function document(client: PlannerClient, method: string, path: string, body: string, request_id: string, V: number, now: Date): Replay {
  return { schema: 'hq.planner.replay/v1', request_id, method, path, body_b64: Buffer.from(body).toString('base64'), sent_after_version: V, planner_url: client.origin, created_at: now.toISOString() };
}
function responseShape(method: string, path: string, body: any): Schema {
  if (path === '/api/items/batch') return body.dry_run ? dryResponse : batchResponse;
  return path === '/api/settings' ? settingsResponse : itemResponse;
}
function validateReplay(raw: any): Replay {
  if (!conforms(replayDocument, raw) || !isWriteRoute(raw.method, raw.path) || plannerURL(raw.planner_url) !== raw.planner_url) throw usage('Request file is not a valid endpoint-bound replay document.', 'request_file');
  const bytes = Buffer.from(raw.body_b64, 'base64');
  if (bytes.toString('base64') !== raw.body_b64 || bytes.length > 256 * 1024) throw usage('Replay body must be canonical base64 of at most 256 KiB.', 'request_file');
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw usage('Replay body must be a UTF-8 JSON object.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw usage('Replay body must be an object.');
  if (raw.path === '/api/items') { if (Object.keys(body).join() !== 'fields') throw usage('Invalid create replay body.'); validateFields(body.fields, true); }
  else if (raw.path === '/api/items/batch') {
    if (Object.keys(body).some(k => !['items', 'dry_run'].includes(k)) || body.dry_run !== undefined && typeof body.dry_run !== 'boolean') throw usage('Invalid batch replay body.');
    validateBatch({ schema: 'hq.planner.batch-create/v1', board: 'planner:main', items: body.items });
  } else if (raw.path === '/api/settings') {
    if (Object.keys(body).join() !== 'settings' || !conforms(object(settings.properties!, []), body.settings) || !Object.keys(body.settings).length) throw usage('Invalid settings replay body.');
  } else {
    if (!Number.isSafeInteger(body.revision) || body.revision < 1) throw usage('Replay requires an explicit positive item revision.');
    if (raw.method === 'PATCH') { if (Object.keys(body).some(k => !['revision', 'patch'].includes(k))) throw usage('Invalid update replay body.'); validateFields(body.patch, false); }
    else if (raw.path.endsWith('/move')) {
      if (!conforms(object({ revision: { type: 'integer', minimum: 1 }, status: fieldsShape.properties!.status, after_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{6,40}$' }, before_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{6,40}$' }, place: enumeration(['top', 'bottom']) }, ['revision', 'status']), body) || body.after_id && body.before_id) throw usage('Invalid move replay body.');
    } else if (Object.keys(body).join() !== 'revision') throw usage('Invalid item action replay body.');
  }
  const inputItems = raw.path === '/api/items/batch' ? body.items : [body.fields ?? body.patch ?? {}];
  for (const input of inputItems) for (const date of input.dates ?? []) {
    try { periodBounds(date.precision, date.value); } catch { throw usage('Replay dates must already be frozen absolute dates.'); }
  }
  return raw;
}
function receipt(body: any, doc: Replay): void {
  try {
    if (body.item) {
      checkDates([body.item]);
      const match = /^\/api\/items\/([A-Za-z0-9_-]{6,40})/.exec(doc.path);
      if (match && match[1] !== 'batch' && body.item.id !== match[1]) throw Error();
    }
    if (body.dry_run && body.count !== JSON.parse(Buffer.from(doc.body_b64, 'base64').toString()).items.length) throw Error();
    if (body.items) { checkDates(body.items); const expected = JSON.parse(Buffer.from(doc.body_b64, 'base64').toString()).items.length; if (body.items.length !== expected || new Set(body.items.map((i: any) => i.id)).size !== expected) throw Error(); }
  } catch { throw uncertain('bad_response', 'Planner write receipt has inconsistent items or dates.'); }
}
async function send(client: PlannerClient, doc: Replay, noEffect = false): Promise<{ body: any; effect: string }> {
  const original = Buffer.from(doc.body_b64, 'base64').toString('utf8');
  const input = JSON.parse(original);
  const reply = await client.write(doc.method, doc.path, original, doc.request_id, responseShape(doc.method, doc.path, input), noEffect);
  try { receipt(reply.body, doc); } catch (error) { if (noEffect && error instanceof CliError) { error.exitCode = 6; error.effect = 'none'; } throw error; }
  return { body: reply.body, effect: noEffect ? 'none' : reply.replayed ? 'replayed' : 'applied' };
}
async function reconcile(client: PlannerClient, doc: Replay, info: any, check = false): Promise<{ body?: any; effect: string; outcome: string }> {
  const original = JSON.parse(Buffer.from(doc.body_b64, 'base64').toString('utf8'));
  if (!check) requireReferences(info, original.items ?? [original.fields ?? original.patch]);
  if (doc.sent_after_version > info.state_version) throw usage('Replay version is newer than this service state.');
  if ((info.features ?? []).includes('requests.replay')) {
    const { schema, planner_url, created_at, ...inner } = doc;
    const envelope = JSON.stringify({ mode: check ? 'lookup' : 'resend', ...inner });
    const shape = { anyOf: [object({ outcome: { const: 'not_applied' } }), object({ outcome: enumeration(['replayed', 'applied_now']), status: { type: 'integer', minimum: 200, maximum: 299 }, response: responseShape(doc.method, doc.path, JSON.parse(Buffer.from(doc.body_b64, 'base64').toString())) })] };
    const reply = await client.write('POST', '/api/requests/replay', envelope, undefined, shape, check);
    if (reply.body.outcome === 'not_applied') {
      if (!check) throw uncertain('bad_response', 'Resend returned a lookup-only outcome.');
      return { effect: 'none', outcome: 'not_applied' };
    }
    if (check && reply.body.outcome === 'applied_now') throw uncertain('bad_response', 'Lookup returned an unexpected applied outcome.');
    receipt(reply.body.response, doc);
    return { body: reply.body.response, effect: reply.body.outcome === 'replayed' ? 'replayed' : 'applied', outcome: reply.body.outcome };
  }
  const guarded = doc.method === 'PATCH' || /^\/api\/items\/[^/]+\/(move|archive|restore|reviewed)$/.test(doc.path);
  if (!guarded || check) throw uncertain('replay_unsupported', 'This service cannot safely reconcile this request with the requested operation.');
  try { const reply = await send(client, doc); return { ...reply, outcome: reply.effect === 'replayed' ? 'replayed' : 'applied_now' }; }
  catch (error) { if (error instanceof CliError && error.code === 'revision_conflict') { error.details.possibly_already_applied = true; error.details.hint = 'Possibly already applied; compare current item with the frozen patch before another change.'; } throw error; }
}
function persist(path: string | undefined, result: any): void { if (path) atomicJSON(path, result); }
function finishIntent(path: string | undefined, output: Result): Result {
  if (!path) return output;
  try { persist(path, output.result); }
  catch { const message = 'Outcome is shown here, but updating the intent file failed. Preserve this result before continuing.'; if (output.result.ok) output.result.data.intent_file_error = message; else output.result.error.details.intent_file_error = message; }
  return output;
}
async function resolveFields(raw: any, input: any, client: PlannerClient, deps: Dependencies, now: Date): Promise<{ fields: any; resolutions: any[] }> {
  if (raw.dates === undefined || raw.dates.length === 0) return { fields: raw, resolutions: [] };
  let tz = input.tz;
  if (!tz) { const snapshot = await client.read({ kind: 'state' }, state); tz = snapshot.settings.default_tz; }
  const resolved = resolveDates(raw.dates, tz, now);
  return { fields: { ...raw, dates: resolved.dates }, resolutions: resolved.resolutions };
}
function rawFields(input: any, creating: boolean): any {
  const raw = input.fields_file ? readJSON(input.fields_file, 256 * 1024) : {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw usage('Fields file must contain an object.');
  for (const key of ['title', 'kind', 'status', 'motivation', 'horizon', 'priority', 'area', 'notes']) if (input[key] !== undefined) {
    if (Object.hasOwn(raw, key)) throw usage('Field is supplied both in a file and a flag.', key);
    raw[key] = input[key];
  }
  const dates = [...(input.planned ? [dateToken(input.planned, 'target')] : []), ...(input.due ? [dateToken(input.due, 'deadline')] : []), ...(input.date ?? []).map((token: string) => dateToken(token))];
  if (dates.length) { if (Object.hasOwn(raw, 'dates')) throw usage('Dates are supplied both in a file and flags.'); raw.dates = dates; }
  validateFields(raw, creating);
  return raw;
}
function bindURL(input: any, deps: Dependencies, bound?: string): string | undefined {
  const configured = input.planner_url ?? (deps.env ?? process.env).HQ_PLANNER_URL;
  if (bound && configured && plannerURL(configured) !== bound) throw usage('Endpoint override differs from the replay or prior-result endpoint.');
  return bound ?? configured;
}
function priorBatch(raw: any): any {
  if (raw?.schema !== 'hq.cli.result/v1' || raw.command !== 'planner.items.create_batch') throw usage('Resume requires a prior create-batch CLI result.');
  const data = raw.ok ? raw.data : raw.error?.details?.batch;
  if (!conforms({ ...progressShape, $defs: { } }, data) || data.mode !== 'sequential') throw usage('Prior result does not contain a sequential batch state.');
  validateBatch(data.resolved_spec);
  if (data.request_id.length > 60 || plannerURL(data.planner_url) !== data.planner_url || data.results.length !== data.resolved_spec.items.length) throw usage('Invalid sequential result identity.');
  let stopped = false;
  for (let i = 0; i < data.results.length; i++) {
    const r = data.results[i];
    if (r.index !== i || r.client_key !== data.resolved_spec.items[i].client_key) throw usage('Prior result index/client-key mismatch.');
    if (['created', 'replayed'].includes(r.status)) { if (stopped || !r.item) throw usage('Completed items must form a prefix with recorded IDs.'); }
    else { if (stopped && r.status !== 'not_attempted') throw usage('Prior result must stop at its first failure or unknown.'); stopped = true; }
    if (r.replay) {
      validateReplay(r.replay);
      if (r.replay.request_id !== `${data.request_id}-${i}` || r.replay.planner_url !== data.planner_url || r.replay.sent_after_version !== data.sent_after_version || r.replay.method !== 'POST' || r.replay.path !== '/api/items' || r.replay.body_b64 !== Buffer.from(bytes({ fields: withoutKey(data.resolved_spec.items[i]) })).toString('base64')) throw usage('Prior replay does not match the frozen batch item.');
    }
    if (r.status === 'unknown' && !r.replay) throw usage('Unknown item lacks its frozen replay document.');
  }
  for (const item of data.resolved_spec.items) for (const date of item.dates ?? []) try { periodBounds(date.precision, date.value); } catch { throw usage('Resume dates must already be resolved.'); }
  return data;
}
async function batch(invocation: Invocation, deps: Dependencies, now: Date): Promise<Result> {
  const { input, command } = invocation;
  if (Boolean(input.spec_file) === Boolean(input.resume_from)) throw usage('Provide exactly one of --spec-file or --resume-from.');
  if (input.resume_from && (input.request_id || input.tz || input.dry_run || input.mode && input.mode !== 'sequential')) throw usage('Resume retains the prior request ID, timezone resolutions and sequential mode.');
  const prior = input.resume_from ? priorBatch(readJSON(input.resume_from, MAX_RESULT_FILE_BYTES)) : undefined;
  const spec = prior?.resolved_spec ?? readJSON(input.spec_file);
  validateBatch(spec);
  const mode = prior ? 'sequential' : input.mode ?? 'atomic';
  const rid = prior?.request_id ?? input.request_id ?? randomUUID();
  if (mode === 'sequential' && rid.length > 60) throw usage('Sequential request ID is limited to 60 characters.');
  const client = new PlannerClient(bindURL(input, deps, prior?.planner_url), deps.fetch ?? globalThis.fetch, input.timeout_ms);
  let info = await preRead(client);
  requireReferences(info, prior ? spec.items.filter((_: any, index: number) => !['created', 'replayed'].includes(prior.results[index].status)) : spec.items);
  const resolutions = prior?.dates ?? [];
  if (!prior) {
    let tz = input.tz;
    if (spec.items.some((i: any) => i.dates?.length) && !tz) tz = (await client.read({ kind: 'state' }, state)).settings.default_tz;
    for (const item of spec.items) if (item.dates?.length) { const resolved = resolveDates(item.dates, tz, now); item.dates = resolved.dates; resolutions.push(...resolved.resolutions); }
  }
  const V = prior?.sent_after_version ?? info.state_version;
  if (V > info.state_version) throw usage('Prior result version exceeds the service state.');
  const data = prior ?? { mode, resolved_spec: spec, request_id: rid, sent_after_version: V, planner_url: client.origin, results: spec.items.map((item: any, index: number) => ({ index, ...(item.client_key ? { client_key: item.client_key } : {}), status: 'not_attempted' })), dates: resolutions };
  if (input.dry_run && mode === 'sequential') return success(command.id, { ...data, validation: 'client_shape_only' }, 'none', rid);
  if (mode === 'atomic') {
    if (!(info.features ?? []).includes('items.batch_create')) throw new CliError('capability_missing', 'Atomic batch requires items.batch_create. Select --mode sequential explicitly for older services.', 6);
    const items = spec.items.map(withoutKey);
    const dryDoc = document(client, 'POST', '/api/items/batch', bytes({ items, dry_run: true }), rid, V, now);
    const dry = await send(client, dryDoc, true);
    if (dry.body.state_version < V) throw new CliError('bad_response', 'Dry-run returned a state version older than the pre-read.', 6);
    data.validation = 'server'; data.sent_after_version = dry.body.state_version;
    if (input.dry_run) return success(command.id, data, 'none', rid);
    const doc = document(client, 'POST', '/api/items/batch', bytes({ items }), rid, dry.body.state_version, now);
    persist(input.intent_file, doc);
    try {
      const response = await send(client, doc);
      data.results = response.body.items.map((item: any, index: number) => ({ index, ...(spec.items[index].client_key ? { client_key: spec.items[index].client_key } : {}), status: response.effect === 'replayed' ? 'replayed' : 'created', item }));
      return finishIntent(input.intent_file, success(command.id, data, response.effect, rid, doc));
    } catch (error) { const e = error instanceof CliError ? error : uncertain('write_unknown', 'Batch outcome could not be read.'); for (const entry of data.results) { entry.status = e.effect === 'unknown' ? 'unknown' : 'failed'; entry.error = errorValue(e); } e.details = { ...e.details, batch: data }; return finishIntent(input.intent_file, failure(command.id, e, rid, doc)); }
  }
  delete data.validation;
  let changed = false, replayed = false;
  let preparedBodies: string[] | undefined;
  for (let index = 0; index < data.results.length; index++) {
    const entry = data.results[index];
    if (['created', 'replayed'].includes(entry.status)) continue;
    let doc: Replay | undefined = entry.replay;
    let attempted = false;
    try {
      // Validate every request before the first send and reuse those frozen bytes.
      preparedBodies ??= spec.items.map((item: any) => bytes({ fields: withoutKey(item) }));
      doc ??= document(client, 'POST', '/api/items', preparedBodies![index], `${rid}-${index}`, V, now);
      if (index > 0) info = await preRead(client);
      requireReferences(info, [spec.items[index]]);
      const modern = (info.features ?? []).includes('requests.replay');
      if (prior && !modern && entry.status === 'unknown') throw uncertain('replay_unsupported', 'An old service cannot safely reconcile this unknown create.');
      if (prior && !modern && entry.status === 'failed') throw new CliError('resume_requires_edit', 'A rejected item needs an edited spec and a new run containing only unfinished work.', 3);
      const previousStatus = entry.status;
      entry.status = 'unknown'; entry.replay = doc; delete entry.error;
      try { persist(input.intent_file, failure(command.id, Object.assign(uncertain('write_unknown', 'An item may be in flight.'), { details: { batch: data } }), rid, doc).result); }
      catch (error) { entry.status = previousStatus; throw error; }
      attempted = true;
      const response = prior && modern ? await reconcile(client, doc, info) : await send(client, doc);
      entry.status = response.effect === 'replayed' ? 'replayed' : 'created'; entry.item = response.body.item;
      changed ||= response.effect === 'applied'; replayed ||= response.effect === 'replayed';
      persist(input.intent_file, success(command.id, data, changed ? 'applied' : replayed ? 'replayed' : 'none', rid).result);
    } catch (error) {
      const e = error instanceof CliError ? error : attempted ? uncertain('write_unknown', 'Sequential item outcome is unknown.') : new CliError('internal_error', 'Sequential item preparation failed; no write was sent for this item.', 1);
      if (attempted && !['created', 'replayed'].includes(entry.status)) { entry.status = e.effect === 'unknown' ? 'unknown' : 'failed'; entry.error = errorValue(e); entry.replay = doc; }
      const completed = data.results.some((r: any) => ['created', 'replayed'].includes(r.status));
      if (e.exitCode !== 7 && completed && !(e.code === 'version_unavailable' && !changed && !replayed)) { e.exitCode = 8; e.effect = 'partial'; }
      e.details = { ...e.details, batch: data };
      return finishIntent(input.intent_file, failure(command.id, e, rid, e.effect === 'unknown' ? doc : undefined));
    }
  }
  return finishIntent(input.intent_file, success(command.id, data, changed ? 'applied' : replayed ? 'replayed' : 'none', rid));
}
export async function executeWrite(invocation: Invocation, deps: Dependencies): Promise<Result> {
  const { command, input } = invocation;
  let rid: string | undefined;
  let doc: Replay | undefined;
  try {
    const now = (deps.clock ?? (() => new Date()))();
    if (input.tz) requireTimezone(input.tz);
    if (command.id === 'planner.items.create_batch') return await batch(invocation, deps, now);
    if (command.id === 'planner.replay') {
      const file = readJSON(input.request_file, MAX_RESULT_FILE_BYTES);
      if (!file || !['hq.planner.replay/v1', 'hq.cli.result/v1'].includes(file.schema)) throw usage('Request file requires a replay document or a CLI result containing replay.');
      doc = validateReplay(file.schema === 'hq.planner.replay/v1' ? file : file.replay);
      rid = doc.request_id;
      const client = new PlannerClient(bindURL(input, deps, doc.planner_url), deps.fetch ?? globalThis.fetch, input.timeout_ms);
      const info = await preRead(client);
      persist(input.intent_file, doc);
      const reply = await reconcile(client, doc, info, input.check ?? false);
      return finishIntent(input.intent_file, success(command.id, { outcome: reply.outcome, ...(reply.body ? { response: reply.body } : {}) }, reply.effect, rid, doc));
    }
    let method = 'POST', path = '/api/items', body: any, raw: any;
    if (command.id === 'planner.items.create' || command.id === 'planner.items.update') raw = rawFields(input, command.id.endsWith('.create'));
    else if (command.id === 'planner.settings.set') {
      const settingsPatch = Object.fromEntries(['default_tz', 'week_start', 'stale_days'].filter(key => input[key] !== undefined).map(key => [key, input[key]]));
      if (!Object.keys(settingsPatch).length) throw usage('Supply at least one setting.');
      if (settingsPatch.default_tz) requireTimezone(settingsPatch.default_tz);
      method = 'PUT'; path = '/api/settings'; body = { settings: settingsPatch };
    } else {
      path = `/api/items/${input.item_id}/${command.words.at(-1)}`; body = { revision: input.revision };
      if (command.id.endsWith('.move')) {
        if (input.before_id && input.after_id) throw usage('Choose only one before/after anchor.');
        body.status = input.status;
        for (const key of ['before_id', 'after_id', 'place']) if (input[key] !== undefined) body[key] = input[key];
      }
    }
    const client = new PlannerClient(bindURL(input, deps), deps.fetch ?? globalThis.fetch, input.timeout_ms);
    const info = await preRead(client);
    requireReferences(info, [raw]);
    let resolutions: any[] = [];
    if (raw) {
      const resolved = await resolveFields(raw, input, client, deps, now); resolutions = resolved.resolutions;
      if (command.id.endsWith('.update')) { method = 'PATCH'; path = `/api/items/${input.item_id}`; body = { revision: input.revision, patch: resolved.fields }; }
      else body = { fields: resolved.fields };
    }
    rid = input.request_id ?? randomUUID();
    doc = document(client, method, path, bytes(body), rid, info.state_version, now);
    persist(input.intent_file, doc);
    const reply = await send(client, doc);
    return finishIntent(input.intent_file, success(command.id, { ...reply.body, dates: resolutions }, reply.effect, rid, doc));
  } catch (error) {
    const e = error instanceof CliError ? error : new CliError('internal_error', 'HQ write preparation failed.', 1);
    if (e.effect === 'unknown') e.details.hint ??= guidance;
    return doc ? finishIntent(input.intent_file, failure(command.id, e, rid, doc)) : failure(command.id, e, rid);
  }
}
