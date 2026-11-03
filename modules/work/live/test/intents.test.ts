import { describe, expect, it } from 'vitest';
import { createFixturePlanner, HQ_REFERENCES_FEATURE, REPLAY_FEATURE, type Item, type PlannerPort } from '../../core';
import { clock, ids, rid } from '../../core/test/port-conformance';
import { createPlannerLive, SETTLED_LIMIT, UNRESOLVED_LIMIT } from '../adapter';
import type { PlannerTransport, ServiceResponse, WorkParams, WorkRoute } from '../transport';
import { failure, fixtureTransport } from './support';

// Exporting an unresolved intent and adopting it into a later session (a restart), over the fixture Planner. Adoption
// registers the intent and sends nothing; Check and Apply then work exactly as for an intent this session recorded.

type Fixture = ReturnType<typeof createFixturePlanner>;
const newFixture = (features: string[] = []): Fixture => createFixturePlanner({ now: clock(), newId: ids(), features: [REPLAY_FEATURE, ...features] });

/** A session on `fixture`, as one run of the app: the first read observes the Planner's features and version. */
async function open(fixture: Fixture) {
  const wire = fixtureTransport(fixture);
  const planner = createPlannerLive(wire.transport);
  await planner.port.snapshot();
  const { recovery } = planner;
  return { wire, planner, port: planner.port, exportIntent: recovery.exportIntent!, adoptIntent: recovery.adoptIntent!, recovery };
}

/** A session whose first write succeeded: `a` is the item the other writes in a test address. */
async function live() {
  const session = await open(newFixture());
  return { ...session, a: (await session.port.create({ title: 'A', status: 'next' }, rid())).item! as Item };
}

/** What a durable queue does between runs. */
const persisted = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const http = (status: number, body: unknown): ServiceResponse => ({ ok: true, status, body, replayed: false });
const CURRENT = {
  id: 'item00000001', revision: 3, title: 'Current', kind: 'idea', status: 'inbox', motivation: null, horizon: null, priority: null,
  area: null, notes: '', next_steps: [], references: [], dates: [], position: 1024, is_example: false,
  created_at: '2026-01-15T12:00:00Z', updated_at: '2026-01-15T12:00:00Z', archived_at: null, reviewed_at: null,
};
const TARGET = { version: 1 as const, domain: 'design' as const, projectId: 'project-example', kind: 'artifact', entityId: 'artifact-example', title: 'Example design', returnDestination: { domain: 'design' as const, destination: 'artifact/example' } };

/** A transport that fails the test if anything is sent: adoption must never reach the network. */
function silent() {
  const calls: { route: WorkRoute; params: unknown }[] = [];
  const transport: PlannerTransport = { async call(route, params) { calls.push({ route, params }); throw new Error('nothing may be sent'); } };
  return { transport, calls };
}

/** A hand-built intent in the shape `exportIntent` produces. */
const reviewed = (requestId: string, revision = 3, sentAfterVersion = 4) => ({
  v: 1, requestId, sentAfterVersion, call: { route: 'reviewed', params: { id: 'item00000001', requestId, revision } },
});
const patched = (requestId: string, patch: unknown = { title: 'New', notes: 'n' }) => ({
  v: 1, requestId, sentAfterVersion: 4, call: { route: 'patch', params: { id: 'item00000001', requestId, revision: 3, patch } },
});

describe('exportIntent', () => {
  it('exports an unresolved write as plain JSON: a copy of the recorded call and its baseline', async () => {
    const { wire, planner, port, exportIntent, a } = await live();
    wire.next('patch', 'drop');
    const requestId = rid();
    await failure(port.patch(a.id, a.revision, { notes: 'mine', title: 'Kept' }, requestId));
    const recorded = planner.ledger.intent(requestId)!;
    const exported = exportIntent(requestId)!;
    expect(exported).toEqual({ v: 1, requestId, sentAfterVersion: recorded.sentAfterVersion, call: recorded.call });
    expect(persisted(exported)).toEqual(exported);
    expect(JSON.stringify(exported.call)).toBe(JSON.stringify(recorded.call));
    // A copy: it is not the frozen ledger value, and changing it changes nothing recorded.
    expect(Object.isFrozen(exported.call)).toBe(false);
    ((exported.call as { params: { patch: { title: string } } }).params.patch).title = 'Changed';
    expect(exportIntent(requestId)).toEqual({ v: 1, requestId, sentAfterVersion: recorded.sentAfterVersion, call: recorded.call });
  });

  it('is null for an unknown, settled, released or definitively refused request', async () => {
    const { wire, planner, port, recovery, exportIntent, a } = await live();
    expect(exportIntent('req-never-sent')).toBeNull();
    expect(exportIntent('')).toBeNull();
    wire.next('reviewed', 'lose-response');
    const settled = rid();
    await failure(port.markReviewed(a.id, a.revision, settled));
    expect(exportIntent(settled)).not.toBeNull();
    expect(await recovery.check(settled)).toMatchObject({ outcome: 'replayed' });
    expect(exportIntent(settled)).toBeNull();
    wire.next('reviewed', 'drop');
    const released = rid();
    await failure(port.markReviewed(a.id, a.revision + 1, released));
    recovery.release(released);
    expect(exportIntent(released)).toBeNull();
    wire.next('reviewed', { instead: http(404, { error: 'not_found' }) });
    const refused = rid();
    await failure(port.markReviewed(a.id, a.revision + 1, refused));
    expect(planner.ledger.unresolved()).toEqual([]);
    expect(exportIntent(refused)).toBeNull();
  });

  it('is null for a request whose settled intent was dropped and its ID retired', async () => {
    const transport: PlannerTransport = {
      async call(route) {
        return route === 'version' ? http(200, { state_version: 4, features: [REPLAY_FEATURE] }) : http(200, { item: { ...CURRENT, revision: 4 }, changed: ['reviewed_at'], state_version: 5 });
      },
    };
    const planner = createPlannerLive(transport);
    const id = (i: number) => `req-retire-${String(i).padStart(5, '0')}`;
    for (let i = 0; i <= SETTLED_LIMIT; i += 1) await planner.port.markReviewed('item00000001', 3, id(i));
    expect(planner.ledger.intent(id(0))).toBeNull();
    expect(planner.recovery.exportIntent!(id(0))).toBeNull();
    // The ID is retired, not free: adopting an intent for it is refused, as an ordinary call with it would be.
    expect(planner.recovery.adoptIntent!(reviewed(id(0)))).toBe(false);
    expect(planner.recovery.adoptIntent!(reviewed(id(SETTLED_LIMIT)))).toBe(false);
    expect(planner.ledger.unresolved()).toEqual([]);
  });
});

/** One lost write per route, to export, persist, and adopt into a later run. */
const lost: [label: string, route: WorkRoute, send: (port: PlannerPort, a: Item, requestId: string) => Promise<unknown>][] = [
  ['create', 'create', (port, _a, requestId) => port.create({ title: 'Lost create', next_steps: [{ id: 'step0001', text: 'One', done: false }], dates: [{ id: 'date0001', kind: 'target', precision: 'day', value: '2026-11-14', time: null, end_time: null, tz: null, note: '' }] }, requestId)],
  ['patch', 'patch', (port, a, requestId) => port.patch(a.id, a.revision, { title: 'Renamed', notes: 'Notes', references: [{ id: 'ref00001', kind: 'url', label: 'Doc', url: 'https://example.test/doc' }] }, requestId)],
  ['move after', 'move', (port, a, requestId) => port.move(a.id, a.revision, 'active', { after_id: a.id }, requestId)],
  ['move before', 'move', (port, a, requestId) => port.move(a.id, a.revision, 'active', { before_id: a.id }, requestId)],
  ['move place', 'move', (port, a, requestId) => port.move(a.id, a.revision, 'active', { place: 'bottom' }, requestId)],
  ['move without an anchor', 'move', (port, a, requestId) => port.move(a.id, a.revision, 'active', {} as never, requestId)],
  ['archive', 'archive', (port, a, requestId) => port.setArchived(a.id, a.revision, true, requestId)],
  ['restore', 'restore', (port, a, requestId) => port.setArchived(a.id, a.revision, false, requestId)],
  ['reviewed', 'reviewed', (port, a, requestId) => port.markReviewed(a.id, a.revision, requestId)],
  ['settings', 'settings', (port, _a, requestId) => port.updateSettings({ default_tz: 'America/New_York', week_start: 'mon', stale_days: 30 }, requestId)],
];

describe('a restart: export, persist, adopt, then Check and Apply', () => {
  it.each(lost)('adopts a lost %s write as the intent this session recorded, and resolves it by an explicit Check', async (_label, route, send) => {
    const fixture = newFixture();
    const first = await open(fixture);
    const a = (await first.port.create({ title: 'A', status: 'next' }, rid())).item!;
    first.wire.next(route, 'drop');
    const requestId = rid();
    await failure(send(first.port, a, requestId));
    const saved = persisted(first.exportIntent(requestId)!);
    expect(saved.requestId).toBe(requestId);

    const second = await open(fixture);
    const before = second.wire.calls.length;
    expect(second.adoptIntent(saved)).toBe(true);
    expect(second.wire.calls.length).toBe(before);
    expect(second.planner.ledger.unresolved()).toEqual([requestId]);
    expect(second.exportIntent(requestId)).toEqual(saved);
    expect(second.planner.ledger.intent(requestId)).toMatchObject({ state: 'unresolved', sentAfterVersion: saved.sentAfterVersion });
    expect(second.planner.ledger.intent(requestId)!.call).toEqual(first.planner.ledger.intent(requestId)!.call);

    // The replay names exactly the exported original and baseline.
    expect(await second.recovery.check(requestId)).toEqual({ outcome: 'not_applied' });
    expect(second.wire.calls.at(-1)).toMatchObject({ route: 'replay', params: { mode: 'lookup', requestId, original: saved.call, sentAfterVersion: saved.sentAfterVersion } });
  });

  it('applies a write that never landed exactly once, and only after the Check', async () => {
    const fixture = newFixture();
    const first = await open(fixture);
    first.wire.next('create', 'drop');
    const requestId = rid();
    await failure(first.port.create({ title: 'Seed order' }, requestId));
    const saved = persisted(first.exportIntent(requestId)!);

    const second = await open(fixture);
    expect(second.adoptIntent(saved)).toBe(true);
    // An adopted intent authorizes no Apply: that needs this session's own not_applied Check.
    const before = second.wire.calls.length;
    expect(await failure(second.recovery.apply(requestId))).toEqual({ kind: 'unknown', requestId });
    expect(second.wire.calls.length).toBe(before);
    expect(await second.recovery.check(requestId)).toEqual({ outcome: 'not_applied' });
    expect(await second.recovery.apply(requestId)).toMatchObject({ outcome: 'applied_now', result: { item: { title: 'Seed order' }, replayed: false } });
    expect(await second.recovery.apply(requestId)).toMatchObject({ outcome: 'replayed' });
    expect(fixture.control.stored().filter((i) => i.title === 'Seed order')).toHaveLength(1);
    expect(second.wire.calls.filter((c) => c.route === 'create')).toHaveLength(0);
    expect(second.wire.calls.filter((c) => c.route === 'replay').map((c) => (c.params as WorkParams['replay']).mode)).toEqual(['lookup', 'resend', 'lookup']);
    expect(second.exportIntent(requestId)).toBeNull();
  });

  it('confirms a write that had landed by lookup alone, and a later adoption of it is refused', async () => {
    const fixture = newFixture();
    const first = await open(fixture);
    const a = (await first.port.create({ title: 'A', status: 'next' }, rid())).item!;
    first.wire.next('reviewed', 'lose-response');
    const requestId = rid();
    await failure(first.port.markReviewed(a.id, a.revision, requestId));
    const saved = persisted(first.exportIntent(requestId)!);

    const second = await open(fixture);
    expect(second.adoptIntent(saved)).toBe(true);
    expect(await second.recovery.check(requestId)).toMatchObject({ outcome: 'replayed', result: { item: { id: a.id, revision: a.revision + 1 }, replayed: true } });
    expect(second.planner.ledger.unresolved()).toEqual([]);
    expect(second.adoptIntent(saved)).toBe(false);
    expect(fixture.control.stateVersion()).toBe(saved.sentAfterVersion + 1);
  });

  it('never sends an adopted request through its ordinary route', async () => {
    const { transport, calls } = silent();
    const planner = createPlannerLive(transport);
    expect(planner.recovery.adoptIntent!(reviewed('req-adopted-01'))).toBe(true);
    expect(await failure(planner.port.markReviewed('item00000001', 3, 'req-adopted-01'))).toEqual({ kind: 'unknown', requestId: 'req-adopted-01' });
    expect(await failure(planner.port.markReviewed('item00000001', 4, 'req-adopted-01'))).toEqual({ kind: 'request_id_reused' });
    expect(await failure(planner.port.setArchived('item00000001', 3, true, 'req-adopted-01'))).toEqual({ kind: 'request_id_reused' });
    expect(calls).toEqual([]);
  });

  it('keeps the intent as adopted: frozen, and independent of the value that was passed in', () => {
    const planner = createPlannerLive(silent().transport);
    const intent = patched('req-isolated-1', { title: 'Mine', next_steps: [{ id: 'step0001', text: 'One', done: false }] });
    expect(planner.recovery.adoptIntent!(intent)).toBe(true);
    (intent.call.params.patch as { title: string; next_steps: { text: string }[] }).title = 'Changed';
    (intent.call.params.patch as { next_steps: { text: string }[] }).next_steps[0]!.text = 'Changed';
    const recorded = planner.ledger.intent('req-isolated-1')!.call as unknown as { params: { patch: { title: string; next_steps: { text: string }[] } } };
    expect(recorded.params.patch.title).toBe('Mine');
    expect(recorded.params.patch.next_steps[0]!.text).toBe('One');
    expect(Object.isFrozen(recorded)).toBe(true);
    expect(Object.isFrozen(recorded.params.patch.next_steps[0])).toBe(true);
  });

  it('does not move the replay baseline of later writes', async () => {
    const calls: WorkRoute[] = [];
    const planner = createPlannerLive({
      async call(route) {
        calls.push(route);
        return route === 'version' ? http(200, { state_version: 4, features: [REPLAY_FEATURE] }) : http(200, { item: { ...CURRENT, revision: 4 }, changed: ['reviewed_at'], state_version: 5 });
      },
    });
    expect(planner.recovery.adoptIntent!(reviewed('req-baseline-1', 3, 9_999))).toBe(true);
    expect(calls).toEqual([]);
    await planner.port.markReviewed('item00000001', 3, 'req-fresh-0001');
    // The new write's baseline is the Planner's own version, never the adopted one.
    expect(planner.ledger.intent('req-fresh-0001')!.sentAfterVersion).toBe(4);
    expect(planner.ledger.intent('req-baseline-1')!.sentAfterVersion).toBe(9_999);
  });
});

describe('adoptIntent accepts only what the adapter itself would have recorded', () => {
  const valid = () => patched('req-valid-0001');
  const clone = <T>(value: T): T => structuredClone(value);
  /** A valid patch intent with one thing changed. */
  const patchWith = (change: (intent: ReturnType<typeof valid>) => unknown) => change(clone(valid()));
  const cyclic = () => { const loop: unknown[] = []; loop.push(loop); return loop; };
  const deep = () => { let value: unknown = 'leaf'; for (let i = 0; i < 100; i += 1) value = [value]; return value; };
  const sparse = () => { const list = [1, 2]; delete list[0]; return list; };
  const settings = { default_tz: 'America/New_York', week_start: 'sun', stale_days: 21 };
  const settingsIntent = (value: unknown) => ({ v: 1, requestId: 'req-valid-0001', sentAfterVersion: 4, call: { route: 'settings', params: { requestId: 'req-valid-0001', settings: value } } });
  const createIntent = (fields: unknown, extra: Record<string, unknown> = {}) => ({ v: 1, requestId: 'req-valid-0001', sentAfterVersion: 4, call: { route: 'create', params: { requestId: 'req-valid-0001', fields, ...extra } } });
  const moveIntent = (change: Record<string, unknown>) => ({ v: 1, requestId: 'req-valid-0001', sentAfterVersion: 4, call: { route: 'move', params: { id: 'item00000001', requestId: 'req-valid-0001', revision: 3, status: 'active', ...change } } });

  const refused: [string, unknown][] = [
    ['a string', 'intent'], ['null', null], ['undefined', undefined], ['an array', []], ['a number', 7],
    ['a missing version', patchWith((i) => ({ requestId: i.requestId, sentAfterVersion: i.sentAfterVersion, call: i.call }))],
    ['version 2', patchWith((i) => ({ ...i, v: 2 }))], ['version "1"', patchWith((i) => ({ ...i, v: '1' }))],
    ['an extra member', patchWith((i) => ({ ...i, extra: true }))],
    ['a missing call', patchWith((i) => ({ v: i.v, requestId: i.requestId, sentAfterVersion: i.sentAfterVersion }))],
    ['a missing baseline', patchWith((i) => ({ v: i.v, requestId: i.requestId, call: i.call }))],
    ['a missing request ID', patchWith((i) => ({ v: i.v, sentAfterVersion: i.sentAfterVersion, call: i.call }))],
    ['a short request ID', patchWith((i) => ({ ...i, requestId: 'short' }))],
    ['a request ID with a space', patchWith((i) => ({ ...i, requestId: 'req valid 0001' }))],
    ['a 65-character request ID', patchWith((i) => ({ ...i, requestId: 'r'.repeat(65) }))],
    ['a numeric request ID', patchWith((i) => ({ ...i, requestId: 12_345_678 }))],
    ['a call for another request ID', patchWith((i) => ({ ...i, call: { ...i.call, params: { ...i.call.params, requestId: 'req-other-0001' } } }))],
    ...[-1, 1.5, '4', Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, null].map((value): [string, unknown] => [`a baseline of ${String(value)}`, patchWith((i) => ({ ...i, sentAfterVersion: value }))]),
    ['a call that is a string', patchWith((i) => ({ ...i, call: 'patch' }))],
    ['a call that is an array', patchWith((i) => ({ ...i, call: [] }))],
    ['a call with an extra member', patchWith((i) => ({ ...i, call: { ...i.call, extra: 1 } }))],
    ['a call without params', patchWith((i) => ({ ...i, call: { route: 'patch' } }))],
    ...['export', 'replay', 'state', 'version', 'item', 'history', 'nope', '', 7].map((route): [string, unknown] => [`the route ${JSON.stringify(route)}`, patchWith((i) => ({ ...i, call: { ...i.call, route } }))]),
    ['params with an extra member', patchWith((i) => ({ ...i, call: { ...i.call, params: { ...i.call.params, extra: 1 } } }))],
    ['params without a revision', patchWith((i) => ({ ...i, call: { ...i.call, params: { id: i.call.params.id, requestId: i.requestId, patch: i.call.params.patch } } }))],
    ['params in another order', patchWith((i) => ({ ...i, call: { ...i.call, params: { requestId: i.requestId, id: i.call.params.id, revision: 3, patch: i.call.params.patch } } }))],
    ['an item ID with a space', patchWith((i) => ({ ...i, call: { ...i.call, params: { ...i.call.params, id: 'bad id!' } } }))],
    ['a short item ID', patchWith((i) => ({ ...i, call: { ...i.call, params: { ...i.call.params, id: 'abc' } } }))],
    ['an item ID that is a number', patchWith((i) => ({ ...i, call: { ...i.call, params: { ...i.call.params, id: 123_456 } } }))],
    ...[-1, 1.5, '3', null, 2 ** 53].map((revision): [string, unknown] => [`a revision of ${String(revision)}`, patchWith((i) => ({ ...i, call: { ...i.call, params: { ...i.call.params, revision } } }))]),
    ['a patch that is an array', patched('req-valid-0001', [])], ['a patch that is a string', patched('req-valid-0001', 'title')],
    ['patch fields in another order', patched('req-valid-0001', { notes: 'n', title: 'New' })],
    ['a derived date field', patched('req-valid-0001', { dates: [{ id: 'date0001', kind: 'target', precision: 'day', value: '2026-11-14', time: null, end_time: null, tz: null, note: '', instant: 'derived' }] })],
    ['an hq reference with an invalid target', patched('req-valid-0001', { references: [{ id: 'ref00001', kind: 'hq', label: 'Design', target: { ...TARGET, version: 2 } }] })],
    ['an undefined value', patched('req-valid-0001', { title: undefined })],
    ['NaN', patched('req-valid-0001', { priority: Number.NaN })], ['Infinity', patched('req-valid-0001', { priority: Number.POSITIVE_INFINITY })],
    ['a function', patched('req-valid-0001', { title: () => 'x' })], ['a Date', patched('req-valid-0001', { title: new Date(0) })],
    ['a bigint', patched('req-valid-0001', { priority: 1n })],
    ['a class instance', patched('req-valid-0001', { notes: new (class Note { text = 'x'; })() })],
    ['a cycle', patched('req-valid-0001', { notes: cyclic() })], ['a value nested 100 deep', patched('req-valid-0001', { notes: deep() })],
    ['a sparse array', patched('req-valid-0001', { next_steps: sparse() })],
    ['fields that are not a record', createIntent([])], ['create with an extra param', createIntent({ title: 'x' }, { id: 'item00000001' })],
    ['a move to a status that does not exist', moveIntent({ status: 'later' })],
    ['a move with two anchors', moveIntent({ after_id: 'item00000002', place: 'top' })],
    ['a move to a place that is not top or bottom', moveIntent({ place: 'middle' })],
    ['a move after a malformed item ID', moveIntent({ after_id: 'x' })],
    ['a move with a nested anchor', moveIntent({ anchor: { place: 'top' } })],
    ['settings with an unknown key', settingsIntent({ ...settings, theme: 'dark' })],
    ['settings in another order', settingsIntent({ week_start: 'sun', default_tz: 'America/New_York', stale_days: 21 })],
    ['settings that are not a record', settingsIntent('sun')],
    ['an item write without an ID', { v: 1, requestId: 'req-valid-0001', sentAfterVersion: 4, call: { route: 'reviewed', params: { requestId: 'req-valid-0001', revision: 3 } } }],
  ];

  it.each(refused)('refuses %s, registers nothing and sends nothing', (_label, value) => {
    const { transport, calls } = silent();
    const planner = createPlannerLive(transport);
    expect(planner.recovery.adoptIntent!(value)).toBe(false);
    expect(planner.ledger.unresolved()).toEqual([]);
    expect(planner.recovery.exportIntent!('req-valid-0001')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('accepts the valid base intent, and every route in canonical form', () => {
    const accepted = [
      valid(), createIntent({ title: 'Created', notes: 'n' }), settingsIntent(settings), moveIntent({}), moveIntent({ place: 'top' }),
      moveIntent({ after_id: 'item00000002' }), moveIntent({ before_id: 'item00000002' }),
      ...['archive', 'restore', 'reviewed'].map((route) => ({ v: 1, requestId: 'req-valid-0001', sentAfterVersion: 0, call: { route, params: { id: 'item00000001', requestId: 'req-valid-0001', revision: 0 } } })),
    ];
    for (const intent of accepted) {
      const fresh = createPlannerLive(silent().transport);
      expect(fresh.recovery.adoptIntent!(intent)).toBe(true);
      expect(fresh.recovery.exportIntent!('req-valid-0001')).toEqual(intent);
    }
  });

  it('checks an hq reference for shape and target, but leaves the advertised feature to the later replay', async () => {
    const withFeature = newFixture([HQ_REFERENCES_FEATURE]);
    const first = await open(withFeature);
    first.wire.next('create', 'drop');
    const requestId = rid();
    await failure(first.port.create({ title: 'Linked', references: [{ kind: 'hq', label: 'Example design', target: TARGET }] }, requestId));
    const saved = persisted(first.exportIntent(requestId)!);
    // A session that has observed nothing yet, and one on a Planner without the feature, both keep the intent.
    expect(createPlannerLive(silent().transport).recovery.adoptIntent!(saved)).toBe(true);
    const without = await open(newFixture());
    expect(without.adoptIntent(saved)).toBe(true);
    expect(without.exportIntent(requestId)).toEqual(saved);
  });
});

describe('adoptIntent and the request IDs the ledger holds', () => {
  it('is idempotent for the same unresolved intent, and refuses another under its ID', () => {
    const planner = createPlannerLive(silent().transport);
    const { adoptIntent, exportIntent } = planner.recovery;
    const intent = patched('req-held-00001');
    expect(adoptIntent!(intent)).toBe(true);
    expect(adoptIntent!(structuredClone(intent))).toBe(true);
    expect(planner.ledger.unresolved()).toEqual(['req-held-00001']);
    // The recorded baseline is never changed or raised by a second adoption.
    expect(adoptIntent!({ ...structuredClone(intent), sentAfterVersion: 5 })).toBe(false);
    expect(adoptIntent!({ ...structuredClone(intent), sentAfterVersion: 3 })).toBe(false);
    expect(adoptIntent!(patched('req-held-00001', { notes: 'other' }))).toBe(false);
    expect(adoptIntent!(reviewed('req-held-00001'))).toBe(false);
    expect(exportIntent!('req-held-00001')).toEqual(intent);
    expect(planner.ledger.unresolved()).toEqual(['req-held-00001']);
  });

  it('is idempotent for an intent this session recorded, and refuses a different one under its ID', async () => {
    const { wire, planner, port, adoptIntent, exportIntent, a } = await live();
    wire.next('patch', 'drop');
    const requestId = rid();
    await failure(port.patch(a.id, a.revision, { notes: 'mine' }, requestId));
    const exported = exportIntent(requestId)!;
    const before = wire.calls.length;
    expect(adoptIntent(persisted(exported))).toBe(true);
    const other = persisted(exported);
    (other.call as { params: { revision: number } }).params.revision += 1;
    expect(adoptIntent(other)).toBe(false);
    expect(wire.calls.length).toBe(before);
    expect(planner.ledger.unresolved()).toEqual([requestId]);
  });

  it('refuses an ID whose intent is settled by a Check', async () => {
    const { wire, planner, port, recovery, adoptIntent, exportIntent, a } = await live();
    wire.next('reviewed', 'lose-response');
    const requestId = rid();
    await failure(port.markReviewed(a.id, a.revision, requestId));
    const saved = persisted(exportIntent(requestId)!);
    await recovery.check(requestId);
    expect(adoptIntent(saved)).toBe(false);
    expect(planner.ledger.unresolved()).toEqual([]);
  });

  it('refuses an ID whose intent was released', async () => {
    const { wire, planner, port, recovery, adoptIntent, exportIntent, a } = await live();
    wire.next('reviewed', 'drop');
    const requestId = rid();
    await failure(port.markReviewed(a.id, a.revision, requestId));
    const saved = persisted(exportIntent(requestId)!);
    recovery.release(requestId);
    expect(adoptIntent(saved)).toBe(false);
    expect(planner.ledger.unresolved()).toEqual([]);
  });

  it('stops at UNRESOLVED_LIMIT without forgetting an intent, and takes the next once one is released', () => {
    const planner = createPlannerLive(silent().transport);
    const { adoptIntent, release } = planner.recovery;
    const id = (i: number) => `req-limit-${String(i).padStart(4, '0')}`;
    for (let i = 0; i < UNRESOLVED_LIMIT; i += 1) expect(adoptIntent!(reviewed(id(i)))).toBe(true);
    expect(adoptIntent!(reviewed(id(UNRESOLVED_LIMIT)))).toBe(false);
    expect(planner.ledger.unresolved()).toHaveLength(UNRESOLVED_LIMIT);
    // An intent already held adds nothing, so it is still accepted at the limit.
    expect(adoptIntent!(reviewed(id(0)))).toBe(true);
    expect(planner.ledger.unresolved()).toEqual(Array.from({ length: UNRESOLVED_LIMIT }, (_, i) => id(i)));
    release(id(0));
    expect(adoptIntent!(reviewed(id(UNRESOLVED_LIMIT)))).toBe(true);
    expect(planner.ledger.unresolved()).toHaveLength(UNRESOLVED_LIMIT);
  });

  it('counts the intents this session recorded toward the limit, and leaves new writes refused at it', async () => {
    const { wire, planner, port, adoptIntent, a } = await live();
    const lostIds: string[] = [];
    for (let i = 0; i < UNRESOLVED_LIMIT - 1; i += 1) {
      wire.next('reviewed', 'drop');
      lostIds.push(rid());
      await failure(port.markReviewed(a.id, a.revision, lostIds.at(-1)!));
    }
    expect(adoptIntent(reviewed('req-adopted-last'))).toBe(true);
    expect(adoptIntent(reviewed('req-adopted-over'))).toBe(false);
    const before = wire.calls.length;
    expect(await failure(port.markReviewed(a.id, a.revision, rid()))).toMatchObject({ kind: 'invalid', errors: [{ field: 'body' }] });
    expect(wire.calls.length).toBe(before);
    expect(planner.ledger.unresolved()).toEqual([...lostIds, 'req-adopted-last']);
  });
});
