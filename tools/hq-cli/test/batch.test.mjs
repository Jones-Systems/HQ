import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { run } from '../src/cli.ts';
import { conforms } from '../src/schema.ts';
import { schemas, commands } from '../src/commands.ts';
import { server, json, item, scratch, batchSpec, info } from './write-fixtures.mjs';
const command = commands.find(c => c.id === 'planner.items.create_batch');
const schema = schemas([command])[0].output;
const three = () => batchSpec([{ client_key: 'a', title: 'First', dates: [{ kind: 'target', value: 'today' }] }, { client_key: 'b', title: 'Second' }, { client_key: 'c', title: 'Third' }]);
const frozenItem = (fields, index) => item({ ...fields, id: `item000${index}`, dates: (fields.dates ?? []).map((d, i) => ({ ...d, id: `date000${i}` })) });

test('atomic batch preflights, commits once, preserves client keys/order and freezes resolved dates', async t => {
  const f = await scratch(t); const file = await f.write('batch.json', three());
  const h = server(call => call.parsed.dry_run ? json({ valid: true, count: 3, dry_run: true, state_version: 10 }) : json({ items: call.parsed.items.map(frozenItem), state_version: 11 }));
  const r = await run(['planner', 'items', 'create-batch', '--spec-file', file, '--request-id', 'request-1234'], h.deps);
  assert.equal(r.exitCode, 0, JSON.stringify(r)); assert.equal(r.result.effect, 'applied'); assert.equal(h.writes().length, 2);
  assert.equal(h.writes()[0].parsed.dry_run, true); assert.equal(h.writes()[1].parsed.dry_run, undefined); assert.equal(h.writes()[1].parsed.items[0].client_key, undefined);
  assert.equal(r.result.replay.sent_after_version, 10); assert.deepEqual(r.result.data.results.map(r => r.client_key), ['a', 'b', 'c']);
  assert.equal(r.result.data.resolved_spec.items[0].dates[0].value, '2026-10-31'); assert.equal(conforms(schema, r.result), true);
});

test('atomic dry-run sends no commit; indexed rejection stops before commit; capability fallback is explicit', async t => {
  const f = await scratch(t); const file = await f.write('batch.json', three());
  const dry = server(() => json({ valid: true, count: 3, dry_run: true, state_version: 8 }));
  const r = await run(['planner', 'items', 'create-batch', '--spec-file', file, '--dry-run'], dry.deps);
  assert.equal(r.exitCode, 0); assert.equal(r.result.effect, 'none'); assert.equal(r.result.data.validation, 'server'); assert.equal(dry.writes().length, 1);
  const invalid = server(() => json({ error: 'invalid', message: 'Bad item', errors: [{ field: 'items[2].dates.value', message: 'Bad value' }] }, 422));
  const bad = await run(['planner', 'items', 'create-batch', '--spec-file', file], invalid.deps);
  assert.equal(bad.exitCode, 3); assert.equal(bad.result.error.details.errors[0].field, 'items[2].dates.value'); assert.equal(invalid.writes().length, 1);
  const old = server(() => assert.fail('No implicit sequential'), { state_version: 8 });
  assert.equal((await run(['planner', 'items', 'create-batch', '--spec-file', file], old.deps)).result.error.code, 'capability_missing'); assert.equal(old.writes().length, 0);
});

test('batch accepts 50 and rejects zero/51, duplicate client keys and oversized body before write', async t => {
  const f = await scratch(t);
  for (const items of [[], Array.from({ length: 51 }, () => ({ title: 'X' })), [{ title: 'A', client_key: 'same' }, { title: 'B', client_key: 'same' }], Array.from({ length: 50 }, () => ({ title: 'X', notes: 'n'.repeat(20000) }))]) {
    const file = await f.write('batch.json', batchSpec(items)); const h = server(() => assert.fail('Must not write'));
    assert.equal((await run(['planner', 'items', 'create-batch', '--spec-file', file], h.deps)).exitCode, 2); assert.equal(h.writes().length, 0);
  }
  const file = await f.write('batch.json', batchSpec(Array.from({ length: 50 }, (_, i) => ({ title: `Synthetic ${i}` }))));
  const h = server(() => json({ valid: true, count: 50, dry_run: true, state_version: 8 }));
  assert.equal((await run(['planner', 'items', 'create-batch', '--spec-file', file, '--dry-run'], h.deps)).exitCode, 0);
});

test('sequential dry-run sends no mutation and clearly says client_shape_only', async t => {
  const f = await scratch(t); const file = await f.write('batch.json', three()); const h = server(() => assert.fail('Must not mutate'));
  const r = await run(['planner', 'items', 'create-batch', '--spec-file', file, '--mode', 'sequential', '--dry-run'], h.deps);
  assert.equal(r.exitCode, 0); assert.equal(r.result.data.validation, 'client_shape_only'); assert.equal(h.writes().length, 0);
});

test('sequential known failure stops with partial progress, a version read per send and stable per-item IDs', async t => {
  const f = await scratch(t); const file = await f.write('batch.json', three());
  const h = server(call => call.headers['X-Request-Id'].endsWith('-0') ? json({ item: frozenItem(call.parsed.fields, 0), state_version: 9 }) : json({ error: 'invalid', message: 'Rejected' }, 422));
  const r = await run(['planner', 'items', 'create-batch', '--spec-file', file, '--mode', 'sequential', '--request-id', 'request-1234'], h.deps);
  assert.equal(r.exitCode, 8, JSON.stringify(r)); assert.equal(r.result.effect, 'partial'); assert.equal(h.writes().length, 2);
  assert.deepEqual(r.result.error.details.batch.results.map(r => r.status), ['created', 'failed', 'not_attempted']);
  assert.deepEqual(h.writes().map(c => c.headers['X-Request-Id']), ['request-1234-0', 'request-1234-1']);
  assert.equal(h.calls.filter(c => c.path === '/api/version').length, 2); assert.equal(conforms(schema, r.result), true);
});

test('new-service resume skips completed prefix and uses original V0 through replay for every remaining item', async t => {
  const f = await scratch(t); const file = await f.write('batch.json', three());
  const first = server(call => call.headers['X-Request-Id'].endsWith('-0') ? json({ item: frozenItem(call.parsed.fields, 0), state_version: 9 }) : Promise.reject(new Error('Lost')));
  const unknown = await run(['planner', 'items', 'create-batch', '--spec-file', file, '--mode', 'sequential', '--request-id', 'request-1234'], first.deps);
  assert.equal(unknown.exitCode, 7); assert.deepEqual(unknown.result.error.details.batch.results.map(r => r.status), ['created', 'unknown', 'not_attempted']);
  const previous = await f.write('prior.json', unknown.result);
  const resume = server(call => {
    assert.equal(call.path, '/api/requests/replay'); assert.equal(call.headers['X-Request-Id'], undefined); assert.equal(call.parsed.sent_after_version, 8);
    const index = Number(call.parsed.request_id.at(-1)); const fields = JSON.parse(Buffer.from(call.parsed.body_b64, 'base64')).fields;
    return json({ outcome: index === 1 ? 'replayed' : 'applied_now', status: 201, response: { item: frozenItem(fields, index), state_version: 10 + index } });
  }, { ...info, state_version: 50, request_retention: { max: 2000, evicted_through_version: 10 } });
  const r = await run(['planner', 'items', 'create-batch', '--resume-from', previous], resume.deps);
  assert.equal(r.exitCode, 0, JSON.stringify(r)); assert.deepEqual(r.result.data.results.map(r => r.status), ['created', 'replayed', 'created']); assert.equal(resume.writes().length, 2);
  assert.deepEqual(resume.writes().map(c => c.parsed.request_id), ['request-1234-1', 'request-1234-2']);
  assert.equal(r.result.data.results[0].item.id, unknown.result.error.details.batch.results[0].item.id); assert.equal(conforms(schema, r.result), true);
});

test('resume stops at replay_indeterminate, without trying subsequent items', async t => {
  const f = await scratch(t); const file = await f.write('batch.json', three());
  const unknown = await run(['planner', 'items', 'create-batch', '--spec-file', file, '--mode', 'sequential'], server(() => Promise.reject(new Error('Lost'))).deps);
  const previous = await f.write('prior.json', unknown.result);
  const h = server(() => json({ error: 'replay_indeterminate', message: 'Expired', sent_after_version: 8, evicted_through_version: 20 }, 409), { ...info, state_version: 25 });
  const r = await run(['planner', 'items', 'create-batch', '--resume-from', previous], h.deps);
  assert.equal(r.exitCode, 7, JSON.stringify(r)); assert.equal(r.result.error.code, 'replay_indeterminate'); assert.equal(h.writes().length, 1);
});

test('legacy resume refuses unknown and failed items; never-attempted items can continue', async t => {
  const f = await scratch(t); const file = await f.write('batch.json', three());
  for (const handler of [() => Promise.reject(new Error('Lost')), () => json({ error: 'invalid', message: 'Rejected' }, 422)]) {
    const first = await run(['planner', 'items', 'create-batch', '--spec-file', file, '--mode', 'sequential'], server(handler, { state_version: 8 }).deps);
    const previous = await f.write('prior.json', first.result);
    const h = server(() => assert.fail('Must not resume unknown/rejected create'), { state_version: 8 });
    const r = await run(['planner', 'items', 'create-batch', '--resume-from', previous], h.deps);
    assert.ok([3, 7].includes(r.exitCode), JSON.stringify(r)); assert.equal(h.writes().length, 0);
  }
  const dry = await run(['planner', 'items', 'create-batch', '--spec-file', file, '--mode', 'sequential', '--dry-run'], server(() => assert.fail('Dry'), { state_version: 8 }).deps);
  const previous = await f.write('prior.json', dry.result);
  const h = server(call => json({ item: frozenItem(call.parsed.fields, Number(call.headers['X-Request-Id'].at(-1))), state_version: 9 }), { state_version: 8 });
  const r = await run(['planner', 'items', 'create-batch', '--resume-from', previous], h.deps);
  assert.equal(r.exitCode, 0, JSON.stringify(r)); assert.equal(h.writes().length, 3); assert.ok(h.writes().every(c => c.path === '/api/items'));
});

test('sequential intent marks the in-flight item unknown before each send and records completion afterwards', async t => {
  const f = await scratch(t); const file = await f.write('batch.json', three()); const intent = f.path('intent.json');
  const h = server(call => {
    const saved = JSON.parse(readFileSync(intent, 'utf8')); const index = Number(call.headers['X-Request-Id'].at(-1));
    assert.equal(saved.error.details.batch.results[index].status, 'unknown');
    assert.ok(saved.error.details.batch.results.slice(0, index).every(r => r.status === 'created'));
    return json({ item: frozenItem(call.parsed.fields, index), state_version: 9 });
  });
  const r = await run(['planner', 'items', 'create-batch', '--spec-file', file, '--mode', 'sequential', '--intent-file', intent], h.deps);
  assert.equal(r.exitCode, 0, JSON.stringify(r)); assert.deepEqual(await f.read('intent.json'), r.result);
});

test('resume refuses endpoint override, refrozen/edited bytes and new request IDs', async t => {
  const f = await scratch(t); const file = await f.write('batch.json', three());
  const unknown = await run(['planner', 'items', 'create-batch', '--spec-file', file, '--mode', 'sequential'], server(() => Promise.reject(new Error('Lost'))).deps);
  const previous = await f.write('prior.json', unknown.result); const h = server(() => assert.fail('Must not write'));
  for (const args of [['--planner-url', 'https://other.example'], ['--request-id', 'request-9999'], ['--tz', 'UTC']]) assert.equal((await run(['planner', 'items', 'create-batch', '--resume-from', previous, ...args], h.deps)).exitCode, 2);
  unknown.result.error.details.batch.resolved_spec.items[0].title = 'Edited';
  const edited = await f.write('edited.json', unknown.result);
  assert.equal((await run(['planner', 'items', 'create-batch', '--resume-from', edited], h.deps)).exitCode, 2); assert.equal(h.writes().length, 0);
});

test('sequential IDs allow 60 base characters and reject 61 before any send', async t => {
  const f = await scratch(t); const file = await f.write('batch.json', batchSpec([{ title: 'Synthetic' }]));
  const h = server(call => json({ item: frozenItem(call.parsed.fields, 0), state_version: 9 }));
  assert.equal((await run(['planner', 'items', 'create-batch', '--spec-file', file, '--mode', 'sequential', '--request-id', 'a'.repeat(60)], h.deps)).exitCode, 0);
  assert.equal((await run(['planner', 'items', 'create-batch', '--spec-file', file, '--mode', 'sequential', '--request-id', 'a'.repeat(61)], h.deps)).exitCode, 2); assert.equal(h.writes().length, 1);
});

test('failed resume pre-read preserves the original unknown item instead of downgrading its status', async t => {
  const f = await scratch(t); const file = await f.write('batch.json', three());
  const original = server(call => call.headers['X-Request-Id'].endsWith('-0') ? json({ item: frozenItem(call.parsed.fields, 0), state_version: 9 }) : Promise.reject(new Error('Lost')));
  const previous = await run(['planner', 'items', 'create-batch', '--spec-file', file, '--mode', 'sequential'], original.deps);
  const prior = await f.write('prior.json', previous.result);
  let reads = 0;
  const h = server(() => assert.fail('Resume must not send'), () => { if (++reads === 1) return json({ ...info, state_version: 9 }); throw new Error('Offline before replay'); });
  const r = await run(['planner', 'items', 'create-batch', '--resume-from', prior], h.deps);
  assert.equal(r.result.error.details.batch.results[1].status, 'unknown');
  assert.equal(r.result.error.details.batch.results[1].error.code, 'network_error');
  assert.equal(r.exitCode, 6); assert.equal(r.result.effect, 'none'); assert.equal(h.writes().length, 0);
});

test('inconsistent dry-run count/version cannot authorize an atomic commit', async t => {
  const f = await scratch(t); const file = await f.write('batch.json', three());
  for (const body of [{ valid: true, count: 2, dry_run: true, state_version: 8 }, { valid: true, count: 3, dry_run: true, state_version: 7 }]) {
    const h = server(() => json(body));
    const r = await run(['planner', 'items', 'create-batch', '--spec-file', file], h.deps);
    assert.equal(r.exitCode, 6); assert.equal(r.result.effect, 'none'); assert.equal(h.writes().length, 1);
  }
});

test('rich sequential results larger than the spec-file bound remain resumable without recreating completed items', async t => {
  const f = await scratch(t);
  const steps = Array.from({ length: 100 }, (_, i) => ({ id: `step${String(i).padStart(4, '0')}`, text: 's'.repeat(300), done: false }));
  const spec = batchSpec(Array.from({ length: 30 }, (_, i) => ({ title: `Synthetic ${i}`, notes: 'n'.repeat(20000), next_steps: steps })));
  const file = await f.write('batch.json', spec);
  const h = server(call => json({ item: frozenItem(call.parsed.fields, Number(call.headers['X-Request-Id'].split('-').at(-1))), state_version: 9 }));
  const first = await run(['planner', 'items', 'create-batch', '--spec-file', file, '--mode', 'sequential'], h.deps);
  assert.equal(first.exitCode, 0);
  assert.ok(Buffer.byteLength(JSON.stringify(first.result)) > 4 * 1024 * 1024);
  const prior = await f.write('prior.json', first.result);
  const resumed = server(() => assert.fail('Completed items must never be resent'), { ...info, state_version: 9 });
  const result = await run(['planner', 'items', 'create-batch', '--resume-from', prior], resumed.deps);
  assert.equal(result.exitCode, 0, JSON.stringify(result));
  assert.equal(result.result.data.results.length, 30); assert.equal(resumed.writes().length, 0);
});

test('sequential preflight rejects an oversized later request before any commit or duplicate on corrected retry', async t => {
  const f = await scratch(t);
  const spec = batchSpec([{ client_key: 'first', title: 'First' }, { title: 'Second', references: [{ id: 'ref00001', kind: 'url', url: 'https://example.com', label: 'x'.repeat(270 * 1024) }] }]);
  const file = await f.write('batch.json', spec);
  assert.ok(Buffer.byteLength(JSON.stringify(spec)) < 4 * 1024 * 1024);
  const committed = [];
  const h = server(call => { committed.push(call.parsed.fields.title); return json({ item: frozenItem(call.parsed.fields, committed.length), state_version: 9 }); });
  const rejected = await run(['planner', 'items', 'create-batch', '--spec-file', file, '--mode', 'sequential'], h.deps);
  assert.equal(rejected.exitCode, 2, JSON.stringify(rejected));
  assert.match(rejected.result.error.message, /256 KiB/);
  assert.equal(rejected.result.effect, 'none');
  assert.equal(h.writes().length, 0, 'No-effect rejection must precede every write');
  spec.items[1].references[0].label = 'Corrected';
  await f.write('batch.json', spec);
  const corrected = await run(['planner', 'items', 'create-batch', '--spec-file', file, '--mode', 'sequential'], h.deps);
  assert.equal(corrected.exitCode, 0, JSON.stringify(corrected));
  assert.deepEqual(committed, ['First', 'Second']);
  assert.equal(conforms(schema, corrected.result), true);
});

test('sequential later document preparation failure preserves receipts and resumes without duplicating the prefix', async t => {
  const f = await scratch(t);
  const file = await f.write('batch.json', batchSpec([{ title: 'First' }, { title: 'Second' }]));
  const h = server(call => json({ item: frozenItem(call.parsed.fields, 0), state_version: 9 }));
  const now = new Date('2026-11-01T03:30:00Z'); let documents = 0;
  now.toISOString = () => { if (++documents === 2) throw new Error('Synthetic document preparation failure'); return '2026-11-01T03:30:00.000Z'; };
  const failed = await run(['planner', 'items', 'create-batch', '--spec-file', file, '--mode', 'sequential', '--request-id', 'request-1234'], { ...h.deps, clock: () => now });
  assert.equal(failed.exitCode, 8, JSON.stringify(failed)); assert.equal(failed.result.effect, 'partial');
  assert.equal(failed.result.request_id, 'request-1234'); assert.equal(h.writes().length, 1);
  const progress = failed.result.error.details.batch;
  assert.deepEqual(progress.results.map(r => r.status), ['created', 'not_attempted']);
  assert.equal(progress.results[0].item.id, 'item0000'); assert.equal(progress.sent_after_version, 8);
  assert.equal(progress.results[0].replay.request_id, 'request-1234-0');
  assert.equal(conforms(schema, failed.result), true);
  const prior = await f.write('prior.json', failed.result);
  const resumed = server(call => {
    assert.equal(call.path, '/api/requests/replay'); assert.equal(call.parsed.request_id, 'request-1234-1');
    assert.equal(call.parsed.sent_after_version, 8);
    assert.equal(Buffer.from(call.parsed.body_b64, 'base64').toString(), '{"fields":{"title":"Second"}}');
    return json({ outcome: 'applied_now', status: 201, response: { item: frozenItem({ title: 'Second' }, 1), state_version: 10 } });
  }, { ...info, state_version: 9 });
  const result = await run(['planner', 'items', 'create-batch', '--resume-from', prior], resumed.deps);
  assert.equal(result.exitCode, 0, JSON.stringify(result)); assert.equal(resumed.writes().length, 1);
  assert.deepEqual(result.result.data.results.map(r => r.item.id), ['item0000', 'item0001']);
});
