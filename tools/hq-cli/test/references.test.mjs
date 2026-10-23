import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { run } from '../src/cli.ts';
import { conforms, referenceEnvelope } from '../src/schema.ts';
import { schemas } from '../src/commands.ts';
import { server, scratch, info, json, item, batchSpec, replay } from './write-fixtures.mjs';
import { harness, state } from './fixtures.mjs';

export const target = { version: 1, domain: 'work', projectId: 'project-demo', kind: 'item', entityId: 'item0002', title: 'Synthetic linked item', returnDestination: { domain: 'work', destination: 'item/item0002' }, sourceRevision: '7', workspaceId: 'workspace-demo' };
const reference = { id: 'refer001', kind: 'hq', label: 'Related', target };
const modern = { ...info, features: [...info.features, 'hq-references-v1'] };
const shape = id => schemas().find(c => c.id === id);

test('reference envelopes retain optional fields and match parseReference text/destination semantics', () => {
  for (const value of [target, { ...target, domain: 'design', returnDestination: { domain: 'social', destination: '/entry' } }, { ...target, entityId: '😀'.repeat(80) }]) assert.equal(conforms(referenceEnvelope, value), true);
  for (const patch of [{ version: '1' }, { domain: 'planner' }, { projectId: ' x' }, { title: 'x\n' }, { kind: '' }, { entityId: '😀'.repeat(81) }, { workspaceId: null }, { sourceRevision: 'x'.repeat(301) }, { extra: true }, { title: 'x\u007f' }]) assert.equal(conforms(referenceEnvelope, { ...target, ...patch }), false, JSON.stringify(patch));
  for (const destination of ['https:example', 'HTTPS:example', '//host', '\\\\host', '/\\host', '\\/host', ' x', 'x ', '', 'x\u0000', 'x'.repeat(513)]) assert.equal(conforms(referenceEnvelope, { ...target, returnDestination: { domain: 'work', destination } }), false, destination);
  assert.equal(conforms(referenceEnvelope, { ...target, returnDestination: { ...target.returnDestination, extra: true } }), false);
});

test('discovered create/update/batch file schemas and read output preserve the complete HQ target', async t => {
  const dir = await scratch(t);
  const fields = { title: 'Linked', references: [reference] };
  for (const id of ['planner.items.create', 'planner.items.update']) assert.equal(conforms(shape(id).files.fields_file, fields), true);
  assert.equal(conforms(shape('planner.items.create_batch').files.spec_file, batchSpec([fields])), true);
  const file = await dir.write('fields.json', fields);
  for (const args of [['planner', 'items', 'create'], ['planner', 'items', 'update', 'item0001', '--revision', '3']]) {
    const h = server(call => json({ item: item(call.parsed.fields ?? call.parsed.patch), state_version: 9 }), modern);
    const output = await run([...args, '--fields-file', file], h.deps);
    assert.equal(output.exitCode, 0); assert.deepEqual(output.result.data.item.references, [reference]);
    assert.equal(conforms(shape(output.result.command).output, output.result), true);
    assert.deepEqual((h.writes()[0].parsed.fields ?? h.writes()[0].parsed.patch).references, [reference]);
  }
  const value = item({ references: [reference] });
  for (const args of [['planner', 'items', 'get', 'item0001'], ['planner', 'items', 'list']]) {
    const h = harness({ '/api/items/item0001': { item: value }, '/api/state': state({ items: [value] }) });
    const output = await run(args, h.deps);
    assert.equal(output.exitCode, 0); assert.equal(conforms(shape(output.result.command).output, output.result), true);
    assert.deepEqual((output.result.data.item ?? output.result.data.items[0]).references, [reference]);
  }
});

test('HQ reference writes require advertised feature before create/update/atomic/sequential mutations', async t => {
  const dir = await scratch(t), fields = { title: 'Linked', references: [reference] };
  const file = await dir.write('fields.json', fields), spec = await dir.write('batch.json', batchSpec([fields]));
  const requests = [ ['items', 'create', '--fields-file', file], ['items', 'update', 'item0001', '--revision', '3', '--fields-file', file], ...['atomic', 'sequential'].map(mode => ['items', 'create-batch', '--mode', mode, '--spec-file', spec]) ];
  for (const flags of requests) {
    const h = server(() => { throw Error('Must not write'); });
    const output = await run(['planner', ...flags], h.deps);
    assert.equal(output.exitCode, 2); assert.equal(output.result.effect, 'none'); assert.equal(h.writes().length, 0);
  }
});

test('HQ reference replay gates resends but allows lookup without mutation capability', async t => {
  const dir = await scratch(t);
  const file = await dir.write('intent.json', replay({ body_b64: Buffer.from(JSON.stringify({ fields: { title: 'Linked', references: [reference] } })).toString('base64') }));
  const h = server(() => json({ outcome: 'not_applied' }));
  assert.equal((await run(['planner', 'replay', '--request-file', file], h.deps)).exitCode, 2);
  assert.equal(h.writes().length, 0);
  const lookup = await run(['planner', 'replay', '--request-file', file, '--check'], h.deps);
  assert.equal(lookup.exitCode, 0); assert.equal(lookup.result.data.outcome, 'not_applied'); assert.equal(h.writes()[0].parsed.mode, 'lookup');
});

test('malformed, mixed URL/HQ and duplicate targets fail locally; legacy references remain accepted', async t => {
  const dir = await scratch(t);
  const invalid = [[{ ...reference, url: 'https://example.test' }], [{ ...reference, target: { ...target, extra: true } }], [{ ...reference, label: 'x'.repeat(201) }], [reference, { ...reference, id: 'refer002', target: { ...target, projectId: 'another-project' } }]];
  for (const references of invalid) {
    const h = server(() => { throw Error('Must not write'); }, modern);
    const file = await dir.write('invalid.json', { title: 'Linked', references });
    assert.equal((await run(['planner', 'items', 'create', '--fields-file', file], h.deps)).exitCode, 2);
    assert.equal(h.calls.length, 0);
  }
  const old = { id: 'refer003', kind: 'url', label: 'Example', url: 'https://example.test' };
  const h = server(call => json({ item: item(call.parsed.fields), state_version: 9 }));
  const file = await dir.write('legacy.json', { title: 'Legacy', references: [old] });
  const result = await run(['planner', 'items', 'create', '--fields-file', file], h.deps);
  assert.equal(result.exitCode, 0); assert.deepEqual(result.result.data.item.references, [old]);
});

test('read and write receipts reject malformed HQ envelopes instead of silently projecting them', async t => {
  const dir = await scratch(t);
  for (const bad of [{ ...reference, url: 'https://example.test' }, { ...reference, target: { ...target, extra: true } }]) {
    const value = item({ references: [bad] });
    assert.equal((await run(['planner', 'items', 'get', 'item0001'], harness({ '/api/items/item0001': { item: value } }).deps)).exitCode, 6);
    const file = await dir.write('simple.json', { title: 'Simple' });
    const h = server(() => json({ item: value, state_version: 9 }), modern);
    const output = await run(['planner', 'items', 'create', '--fields-file', file], h.deps);
    assert.equal(output.exitCode, 7); assert.equal(output.result.effect, 'unknown');
  }
});

test('completed sequential HQ items stay skipped when resume service lacks reference capability', async t => {
  const dir = await scratch(t);
  const spec = await dir.write('batch.json', batchSpec([{ title: 'Linked', references: [reference] }]));
  const h = server(call => json({ item: item(call.parsed.fields), state_version: 9 }), modern);
  const created = await run(['planner', 'items', 'create-batch', '--spec-file', spec, '--mode', 'sequential'], h.deps);
  assert.equal(created.exitCode, 0);
  const file = await dir.write('prior.json', created.result);
  const old = server(() => { throw Error('Completed item must not be sent'); }, { state_version: 20 });
  const resumed = await run(['planner', 'items', 'create-batch', '--resume-from', file], old.deps);
  assert.equal(resumed.exitCode, 0); assert.equal(resumed.result.effect, 'none'); assert.equal(old.writes().length, 0);
  assert.deepEqual(resumed.result.data.results[0].item.references, [reference]);
});

test('canonical backend vectors preserve exact ReferenceEnvelope accept/reject semantics', () => {
  const bytes = readFileSync(new URL('../../../services/planner/contract/reference-vectors.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '94f030e550d4c7d6bb823836dcfed75a7d86b1c1442dd3efc748dee2389ba5a1');
  const vectors = JSON.parse(bytes);
  assert.equal(vectors.schema, 'hq.planner.reference-vectors/v1');
  for (const vector of vectors.cases) {
    const targetRejected = vector.errors?.some(error => error.message.includes('invalid HQ target')) ?? false;
    for (const reference of vector.input.filter(ref => ref.kind === 'hq')) assert.equal(conforms(referenceEnvelope, reference.target), !targetRejected, vector.id);
  }
});

test('HQ duplicate identity retains Work slash-joined collision semantics', async t => {
  const dir = await scratch(t);
  const file = await dir.write('duplicate.json', { title: 'Linked', references: [
    { ...reference, target: { ...target, kind: 'a/b', entityId: 'c' } },
    { ...reference, id: 'refer002', target: { ...target, kind: 'a', entityId: 'b/c' } },
  ] });
  const h = server(() => { throw Error('Duplicate target must not be sent'); }, modern);
  const result = await run(['planner', 'items', 'create', '--fields-file', file], h.deps);
  assert.equal(result.exitCode, 2); assert.equal(h.calls.length, 0);
});
