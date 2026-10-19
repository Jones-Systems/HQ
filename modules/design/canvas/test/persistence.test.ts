import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canvasId, type CanvasArrangement } from '../src/contract.ts';
import {
  arrangementKey, canonicalJson, decodeArrangement, encodeArrangement, loadArrangement, saveArrangement,
} from '../src/codec.ts';
import { committedArrangement, createCanvasState, reduceCanvas, type CanvasAction } from '../src/controller.ts';
import { createProviderRegistry } from '../src/providers.ts';
import { inspect } from '../src/inspector.ts';
import { createFakeStorage, FAKE_LABEL } from '../src/fakes.ts';
import { B, C, CANVAS, sampleArrangement, sampleProvider } from './fixtures.ts';

const digest = (bytes: Uint8Array | undefined) => createHash('sha256').update(bytes ?? new Uint8Array()).digest('hex');

test('arrangement round-trips through the StoragePort unchanged (record and bytes)', async () => {
  const storage = createFakeStorage();
  assert.equal(storage.label, FAKE_LABEL);
  const arrangement = sampleArrangement();
  const saved = await saveArrangement(storage, arrangement, null);
  assert.equal(saved.status, 'saved');
  const loaded = await loadArrangement(storage, CANVAS);
  assert.equal(loaded.status, 'loaded');
  if (loaded.status !== 'loaded') return;
  assert.deepEqual(loaded.arrangement, arrangement);
  assert.equal(encodeArrangement(loaded.arrangement), storage.documents.get(`workspace:${arrangementKey(CANVAS)}`));
  const again = await saveArrangement(storage, loaded.arrangement, loaded.baseText);
  assert.equal(again.status, 'unchanged');
  assert.equal(storage.writes.length, 1, 'an unchanged arrangement is not rewritten');
});

test('moving items writes only the arrangement record; versions and source bytes are untouched', async () => {
  const storage = createFakeStorage();
  const provider = sampleProvider();
  const registry = createProviderRegistry();
  registry.register(provider);
  const sourceBefore = provider.items.map((item) => `${item.entityId}@${item.revision}:${digest(item.bytes)}`);
  let state = createCanvasState(sampleArrangement());
  const refsBefore = canonicalJson(committedArrangement(state).items.map((item) => item.ref));
  const first = await saveArrangement(storage, committedArrangement(state), null);
  assert.equal(first.status, 'saved');
  const actions: CanvasAction[] = [
    { type: 'select', ids: [B, C] },
    { type: 'pointer-down', point: { x: 1250, y: 100 }, target: B, toggle: false, pan: false },
    { type: 'pointer-move', point: { x: 1320, y: 180 } }, { type: 'pointer-up' },
    { type: 'edit', edit: { kind: 'set-frame', id: C, frame: { width: 200 } } },
    { type: 'undo' }, { type: 'redo' },
  ];
  state = actions.reduce(reduceCanvas, state);
  inspect(committedArrangement(state), [B], registry);
  const second = await saveArrangement(storage, committedArrangement(state), first.status === 'saved' ? first.baseText : null);
  assert.equal(second.status, 'saved');
  assert.deepEqual(new Set(storage.writes.map((write) => `${write.namespace}:${write.key}`)), new Set([`workspace:${arrangementKey(CANVAS)}`]));
  assert.equal(canonicalJson(committedArrangement(state).items.map((item) => item.ref)), refsBefore, 'every placement keeps its exact revision');
  assert.deepEqual(provider.items.map((item) => `${item.entityId}@${item.revision}:${digest(item.bytes)}`), sourceBefore);
  assert.deepEqual(new Set(provider.calls.map((call) => call.method)), new Set(['subscribe', 'describe']), 'canvas only reads from providers');
});

test('a stale base is reported as a conflict and nothing is written', async () => {
  const storage = createFakeStorage();
  const saved = await saveArrangement(storage, sampleArrangement(), null);
  assert.equal(saved.status, 'saved');
  const elsewhere: CanvasArrangement = { ...sampleArrangement(), grid: { size: 16, snap: true } };
  await storage.writeDocument('workspace', arrangementKey(CANVAS), encodeArrangement(elsewhere));
  const before = storage.writes.length;
  const result = await saveArrangement(storage, { ...sampleArrangement(), grid: { size: 4, snap: false } }, saved.status === 'saved' ? saved.baseText : null);
  assert.equal(result.status, 'conflict');
  assert.equal(storage.writes.length, before);
});

test('a future schema opens read-only, is never rewritten, and the canvas refuses edits', async () => {
  const future = JSON.stringify({ schema: 'hq.design.canvas-arrangement/v2', canvasId: CANVAS, futureField: true });
  const storage = createFakeStorage({ [arrangementKey(CANVAS)]: future });
  const loaded = await loadArrangement(storage, CANVAS);
  assert.equal(loaded.status, 'read-only');
  if (loaded.status !== 'read-only') return;
  assert.equal(loaded.reason, 'future-schema');
  assert.equal(loaded.text, future);
  const conflict = await saveArrangement(storage, sampleArrangement(), null);
  assert.equal(conflict.status, 'conflict');
  assert.equal(storage.writes.length, 0);
  assert.equal(storage.documents.get(`workspace:${arrangementKey(CANVAS)}`), future);
});

test('strict decode rejects unknown fields, dangling artboards, duplicates and non-finite geometry without repair', () => {
  const good = JSON.parse(encodeArrangement(sampleArrangement()));
  const cases: [string, (value: any) => void][] = [
    ['unknown field', (value) => { value.extra = 1; }],
    ['unknown item field', (value) => { value.items[0].latest = true; }],
    ['dangling artboard', (value) => { value.items[0].artboardId = 'missing'; }],
    ['duplicate id', (value) => { value.items[1].id = value.items[0].id; }],
    ['zero size', (value) => { value.items[0].frame.width = 0; }],
    ['missing revision', (value) => { delete value.items[0].ref.revision; }],
    ['empty revision', (value) => { value.items[0].ref.revision = ''; }],
    ['bad grid', (value) => { value.grid.size = 0.5; }],
    ['old schema', (value) => { value.schema = 'hq.design.canvas-arrangement/v0'; }],
  ];
  for (const [name, mutate] of cases) {
    const copy = structuredClone(good);
    mutate(copy);
    const result = decodeArrangement(JSON.stringify(copy));
    assert.equal(result.ok, false, name);
    if (!result.ok) assert.equal(result.reason, 'invalid', name);
  }
  assert.equal(decodeArrangement('{"x":1e999}').ok, false);
  assert.equal(decodeArrangement('not json').ok, false);
  assert.throws(() => canonicalJson({ x: Number.POSITIVE_INFINITY }));
  assert.throws(() => canonicalJson({ x: undefined }));
});

test('canonical JSON sorts keys deterministically regardless of insertion order', () => {
  assert.equal(canonicalJson({ b: 1, a: [true, null, 'é'], c: { z: 0, y: -0 } }), '{"a":[true,null,"é"],"b":1,"c":{"y":0,"z":0}}');
  const arrangement = sampleArrangement();
  const reordered = JSON.parse(JSON.stringify(arrangement, Object.keys(arrangement).reverse().concat(['x', 'y', 'width', 'height', 'id', 'ref', 'providerId', 'entityId', 'revision', 'frame', 'artboardId', 'locked', 'hidden', 'name', 'size', 'snap'])));
  assert.equal(encodeArrangement(reordered), encodeArrangement(arrangement));
});

test('a record stored under another canvas id is not loaded as this canvas', async () => {
  const other = { ...sampleArrangement(), canvasId: canvasId('other-canvas') };
  const storage = createFakeStorage({ [arrangementKey(CANVAS)]: encodeArrangement(other) });
  const loaded = await loadArrangement(storage, CANVAS);
  assert.equal(loaded.status, 'read-only');
  assert.equal(loaded.status === 'read-only' && loaded.reason, 'mismatch');
});
