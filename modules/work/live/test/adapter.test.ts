import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createFixturePlanner, HQ_REFERENCES_FEATURE, MAX_REMEMBERED_REQUESTS, PLANNER_PORT_KEYS, PLANNER_RECOVERY_KEYS, REPLAY_FEATURE,
  type Item,
} from '../../core';
import { clock, describePlannerPortConformance, ids, rid } from '../../core/test/port-conformance';
import { createLivePlanner, createPlannerLive, createPlannerLivePort, UNRESOLVED_LIMIT } from '../adapter';
import type { PlannerTransport, ServiceResponse, WorkMutationCall, WorkParams, WorkRoute } from '../transport';
import { encodeWrite, failure, fixtureTransport } from './support';

// The live adapter over a transport backed by the one fixture Planner, answering in the service's wire shapes. Every
// effect is in memory and synthetic.

async function live(options: { features?: string[]; replay?: boolean; items?: Item[] } = {}) {
  const features = [...(options.replay === false ? [] : [REPLAY_FEATURE]), ...(options.features ?? [])];
  const fixture = createFixturePlanner({ now: clock(), newId: ids(), features, ...(options.items ? { items: options.items } : {}) });
  const wire = fixtureTransport(fixture);
  const planner = createPlannerLive(wire.transport);
  await planner.port.snapshot();
  const a = (await planner.port.create({ title: 'A', status: 'next' }, rid())).item!;
  return { fixture, wire, planner, port: planner.port, recovery: planner.recovery, a, device: fixture.port };
}

describePlannerPortConformance('live adapter over the fixture transport (replay-aware)', async ({ features, now, newId }) => {
  const fixture = createFixturePlanner({ now, newId, features: [REPLAY_FEATURE, ...(features ?? [])] });
  const planner = createPlannerLive(fixtureTransport(fixture).transport);
  // As the store's first load does: observe the features and the replay baseline.
  await planner.port.snapshot();
  return { port: planner.port, control: fixture.control, semantics: 'replay-aware' };
});

/** A transport that answers every write with `response`, after serving reads from a small synthetic state. */
function answering(response: ServiceResponse | (() => Promise<ServiceResponse>)) {
  const calls: { route: WorkRoute; params: unknown }[] = [];
  const transport: PlannerTransport = {
    async call(route, params) {
      calls.push({ route, params });
      if (route === 'version') return { ok: true, status: 200, body: { state_version: 4, features: [REPLAY_FEATURE] }, replayed: false };
      return typeof response === 'function' ? response() : response;
    },
  };
  return { transport, calls };
}

const CURRENT = {
  id: 'item00000001', revision: 3, title: 'Current', kind: 'idea', status: 'inbox', motivation: null, horizon: null, priority: null,
  area: null, notes: '', next_steps: [], references: [], dates: [], position: 1024, is_example: false,
  created_at: '2026-01-15T12:00:00Z', updated_at: '2026-01-15T12:00:00Z', archived_at: null, reviewed_at: null,
};
const http = (status: number, body: unknown): ServiceResponse => ({ ok: true, status, body, replayed: false });

describe('the live port surface', () => {
  it('exposes exactly the Planner API keys, and a recovery with only check, apply and release', () => {
    const planner = createPlannerLive(answering(http(500, null)).transport);
    expect(Object.keys(planner.port).sort()).toEqual([...PLANNER_PORT_KEYS].sort());
    expect(Object.keys(planner.recovery).sort()).toEqual([...PLANNER_RECOVERY_KEYS].sort());
    expect(Object.keys(createPlannerLivePort(answering(http(500, null)).transport)).sort()).toEqual([...PLANNER_PORT_KEYS].sort());
    expect(createLivePlanner).toBe(createPlannerLive);
  });
});

describe('error mapping (every HTTP answer is ok: true; branch on status)', () => {
  const cases: [string, ServiceResponse, unknown, 'free' | 'unresolved'][] = [
    ['400 with field errors', http(400, { error: 'invalid', message: 'Some fields are invalid.', errors: [{ field: 'title', message: 'Required.' }] }), { kind: 'invalid', errors: [{ field: 'title', message: 'Required.' }] }, 'free'],
    ['400 without field errors', http(400, { error: 'bad_request_id', message: 'Bad request id.' }), { kind: 'invalid', errors: [{ field: 'body', message: 'Bad request id.' }] }, 'free'],
    ['413 too large', http(413, { error: 'too_large', message: 'Too large.' }), { kind: 'invalid', errors: [{ field: 'body', message: 'Too large.' }] }, 'free'],
    ['415 media type', http(415, null), { kind: 'invalid', errors: [{ field: 'body', message: 'The Planner refused the request (415).' }] }, 'free'],
    ['403 forbidden', http(403, { error: 'forbidden' }), { kind: 'unavailable' }, 'free'],
    ['421 bad host', http(421, { error: 'bad_host' }), { kind: 'unavailable' }, 'free'],
    ['404', http(404, { error: 'not_found' }), { kind: 'not_found' }, 'free'],
    ['409 revision with current', http(409, { error: 'revision_conflict', current: CURRENT }), { kind: 'revision_conflict', current: CURRENT }, 'free'],
    ['409 revision with a malformed current', http(409, { error: 'revision_conflict', current: { id: 'x' } }), { kind: 'unknown', requestId: 'req-error-0001' }, 'unresolved'],
    ['409 order', http(409, { error: 'order_conflict' }), { kind: 'order_conflict' }, 'free'],
    ['409 unrecognised', http(409, { error: 'something_new' }), { kind: 'unknown', requestId: 'req-error-0001' }, 'unresolved'],
    ['422 request_id_reused', http(422, { error: 'request_id_reused' }), { kind: 'request_id_reused' }, 'free'],
    ['422 with field errors', http(422, { error: 'invalid', errors: [{ field: 'dates.value', message: 'Bad.' }] }), { kind: 'invalid', errors: [{ field: 'dates.value', message: 'Bad.' }] }, 'free'],
    ['422 unrecognised', http(422, { error: 'invalid_import' }), { kind: 'unknown', requestId: 'req-error-0001' }, 'unresolved'],
    ['500', http(500, { error: 'internal' }), { kind: 'unknown', requestId: 'req-error-0001' }, 'unresolved'],
    ['503 empty', http(503, null), { kind: 'unknown', requestId: 'req-error-0001' }, 'unresolved'],
    ['302 redirect', http(302, null), { kind: 'unknown', requestId: 'req-error-0001' }, 'unresolved'],
    ['200 malformed body', http(200, { item: { id: 'x' }, state_version: 5 }), { kind: 'unknown', requestId: 'req-error-0001' }, 'unresolved'],
    ['transport unknown', { ok: false, kind: 'unknown' }, { kind: 'unknown', requestId: 'req-error-0001' }, 'unresolved'],
    ['transport unavailable', { ok: false, kind: 'unavailable' }, { kind: 'unavailable' }, 'free'],
    ['a malformed envelope', { ok: true } as unknown as ServiceResponse, { kind: 'unknown', requestId: 'req-error-0001' }, 'unresolved'],
  ];

  it.each(cases)('a write answered %s', async (_, response, expected, ledger) => {
    const { transport } = answering(response);
    const planner = createPlannerLive(transport);
    expect(await failure(planner.port.markReviewed('item00000001', 3, 'req-error-0001'))).toEqual(expected);
    expect(planner.ledger.unresolved()).toEqual(ledger === 'unresolved' ? ['req-error-0001'] : []);
  });

  it('a thrown transport is unknown for a write and unavailable for a read', async () => {
    const planner = createPlannerLive({ call: async (route) => { if (route === 'version') return http(200, { state_version: 1 }); throw new Error('bridge gone'); } });
    expect(await failure(planner.port.markReviewed('item00000001', 3, 'req-thrown-01'))).toEqual({ kind: 'unknown', requestId: 'req-thrown-01' });
    expect(await failure(planner.port.snapshot())).toEqual({ kind: 'unavailable' });
  });

  it.each([
    ['transport loss', { ok: false, kind: 'unknown' } as ServiceResponse, { kind: 'unavailable' }],
    ['500', http(500, null), { kind: 'unavailable' }],
    ['404', http(404, { error: 'not_found' }), { kind: 'not_found' }],
    ['a malformed body', http(200, { history: [{ at: 1 }] }), { kind: 'unavailable' }],
  ])('a read answered %s', async (_, response, expected) => {
    const planner = createPlannerLive(answering(response).transport);
    expect(await failure(planner.port.history('item00000001'))).toEqual(expected);
  });

  it('fails a snapshot closed on any malformed member, and defaults missing features to []', async () => {
    const state = { items: [CURRENT], settings: { default_tz: 'America/New_York', week_start: 'sun', stale_days: 21 }, state_version: 2, server_time: '2026-01-15T12:00:00Z' };
    const ok = createPlannerLive({ call: async () => http(200, state) });
    expect(await ok.port.snapshot()).toMatchObject({ stateVersion: 2, observedAt: '2026-01-15T12:00:00Z', features: [] });
    for (const broken of [{ ...state, state_version: '2' }, { ...state, items: [{ ...CURRENT, status: 'later' }] }, { ...state, server_time: undefined }, { ...state, items: [{ ...CURRENT, dates: [{ id: 'd1', kind: 'target' }] }] }]) {
      expect(await failure(createPlannerLive({ call: async () => http(200, broken) }).port.snapshot())).toEqual({ kind: 'unavailable' });
    }
  });
});

describe('local refusals send nothing', () => {
  it('refuses a malformed request ID or item ID before any call', async () => {
    const { transport, calls } = answering(http(200, null));
    const port = createPlannerLivePort(transport);
    expect(await failure(port.create({ title: 'x' }, 'short'))).toEqual({ kind: 'invalid', errors: [{ field: 'requestId', message: 'Malformed X-Request-Id.' }] });
    expect(await failure(port.markReviewed('bad id!', 1, 'req-local-0001'))).toEqual({ kind: 'invalid', errors: [{ field: 'id', message: 'Malformed item id.' }] });
    expect(await failure(port.history('no'))).toEqual({ kind: 'not_found' });
    expect(calls).toEqual([]);
  });

  it('gates hq references on the advertised feature and the unchanged parseReference', async () => {
    const target = { version: 1 as const, domain: 'design' as const, projectId: 'project-example', kind: 'artifact', entityId: 'artifact-example', title: 'Example design', returnDestination: { domain: 'design' as const, destination: 'artifact/example' } };
    const off = await live();
    const before = off.wire.calls.length;
    expect(await failure(off.port.create({ title: 'L', references: [{ kind: 'hq', target }] }, rid()))).toEqual({ kind: 'invalid', errors: [{ field: 'references', message: 'Reference 1 has an unknown kind.' }] });
    const on = await live({ features: [HQ_REFERENCES_FEATURE] });
    const onBefore = on.wire.calls.length;
    expect(await failure(on.port.create({ title: 'L', references: [{ kind: 'hq', target: { ...target, version: 2 } as never }] }, rid()))).toEqual({ kind: 'invalid', errors: [{ field: 'references', message: 'Reference 1 has an invalid HQ target.' }] });
    expect(off.wire.calls.length).toBe(before);
    expect(on.wire.calls.length).toBe(onBefore);
    const created = await on.port.create({ title: 'L', references: [{ kind: 'hq', label: 'Example design', target }] }, rid());
    expect(created.item!.references[0]).toMatchObject({ kind: 'hq', target });
  });

  it('strips derived date fields and keeps kind, value, time, tz and note', async () => {
    const { port, wire } = await live();
    await port.create({ title: 'Timed', dates: [{ id: 'date0001', kind: 'event', precision: 'day', value: '2026-11-14', time: '10:00', end_time: '11:00', tz: 'America/New_York', note: 'Hall', instant: 'X', end_instant: 'Y', tz_abbr: 'Z' }] }, rid());
    const sent = wire.calls.at(-1)!.params as WorkParams['create'];
    expect(sent.fields.dates).toEqual([{ id: 'date0001', kind: 'event', precision: 'day', value: '2026-11-14', time: '10:00', end_time: '11:00', tz: 'America/New_York', note: 'Hall' }]);
  });
});

describe('unknown writes: no automatic retry, recovery only through the replay route', () => {
  it('leaves an unknown write alone: later reads never re-send it', async () => {
    const { port, wire, planner, a } = await live();
    wire.next('reviewed', 'lose-response');
    const requestId = rid();
    expect(await failure(port.markReviewed(a.id, a.revision, requestId))).toEqual({ kind: 'unknown', requestId });
    await port.snapshot();
    await port.version();
    expect(wire.writes().filter((c) => (c.params as { requestId?: string }).requestId === requestId)).toHaveLength(1);
    expect(planner.ledger.unresolved()).toEqual([requestId]);
  });

  it('confirms a retained write by lookup alone, with the original typed intent and baseline', async () => {
    const { port, recovery, wire, planner, fixture, a } = await live();
    const baseline = fixture.control.stateVersion();
    wire.next('reviewed', 'lose-response');
    const requestId = rid();
    await failure(port.markReviewed(a.id, a.revision, requestId));
    await port.snapshot(); // later observations never raise the recorded baseline
    const answer = await recovery.check(requestId);
    expect(answer).toMatchObject({ outcome: 'replayed', result: { item: { id: a.id, revision: a.revision + 1 }, replayed: true } });
    const replay = wire.calls.at(-1)!;
    expect(replay.route).toBe('replay');
    const params = replay.params as WorkParams['replay'];
    expect(params).toEqual({ mode: 'lookup', requestId, original: { route: 'reviewed', params: { id: a.id, requestId, revision: a.revision } }, sentAfterVersion: baseline });
    expect(planner.ledger.intent(requestId)).toMatchObject({ sentAfterVersion: baseline, state: 'settled' });
    expect(fixture.control.stateVersion()).toBe(baseline + 1);
  });

  it('proves a dropped write not applied, and applies it once only on an explicit apply', async () => {
    const { port, recovery, wire, fixture } = await live();
    wire.next('create', 'drop');
    const requestId = rid();
    await failure(port.create({ title: 'Seed order' }, requestId));
    expect(await recovery.check(requestId)).toEqual({ outcome: 'not_applied' });
    expect(fixture.control.stored().filter((i) => i.title === 'Seed order')).toHaveLength(0);
    const applied = await recovery.apply(requestId);
    expect(applied).toMatchObject({ outcome: 'applied_now', result: { item: { title: 'Seed order' }, replayed: false } });
    expect(await recovery.apply(requestId)).toMatchObject({ outcome: 'replayed' });
    expect(fixture.control.stored().filter((i) => i.title === 'Seed order')).toHaveLength(1);
    // No ordinary create was ever sent twice; the apply went through the replay route.
    expect(wire.calls.filter((c) => c.route === 'create' && (c.params as { requestId: string }).requestId === requestId)).toHaveLength(1);
    expect(wire.calls.filter((c) => c.route === 'replay').map((c) => (c.params as WorkParams['replay']).mode)).toEqual(['lookup', 'resend', 'resend']);
  });

  it('is indeterminate and changes nothing once the record may be evicted (test eviction)', async () => {
    const { port, recovery, wire, fixture, device, a } = await live();
    wire.next('create', 'drop');
    const requestId = rid();
    await failure(port.create({ title: 'Book the hall' }, requestId));
    let item = fixture.control.stored().find((i) => i.id === a.id)!;
    for (let i = 0; i < MAX_REMEMBERED_REQUESTS + 1; i += 1) item = (await device.markReviewed(item.id, item.revision, rid())).item!;
    const version = fixture.control.stateVersion();
    expect(await failure(recovery.check(requestId))).toEqual({ kind: 'replay_indeterminate', requestId, reason: 'evicted' });
    expect(await failure(recovery.apply(requestId))).toEqual({ kind: 'replay_indeterminate', requestId, reason: 'evicted' });
    // Re-calling the port with the same intent goes to the replay route too, never the ordinary one.
    expect(await failure(port.create({ title: 'Book the hall' }, requestId))).toMatchObject({ kind: 'replay_indeterminate', reason: 'evicted' });
    expect(fixture.control.stored().filter((i) => i.title === 'Book the hall')).toHaveLength(0);
    expect(fixture.control.stateVersion()).toBe(version);
    expect(wire.calls.filter((c) => c.route === 'create' && (c.params as { requestId: string }).requestId === requestId)).toHaveLength(1);
  });

  it('refuses a differing body under a recorded ID locally, and maps the service saying so', async () => {
    const { port, recovery, wire, device, a } = await live();
    const requestId = rid();
    wire.next('patch', 'drop');
    await failure(port.patch(a.id, a.revision, { notes: 'mine' }, requestId));
    const before = wire.calls.length;
    expect(await failure(port.patch(a.id, a.revision, { notes: 'different' }, requestId))).toEqual({ kind: 'request_id_reused' });
    expect(wire.calls.length).toBe(before);
    await device.markReviewed(a.id, a.revision, requestId); // another client used the ID for something else
    expect(await failure(recovery.check(requestId))).toEqual({ kind: 'request_id_reused' });
  });

  it('sends nothing without requests.replay or a recorded intent', async () => {
    const old = await live({ replay: false });
    old.wire.next('reviewed', 'lose-response');
    const requestId = rid();
    await failure(old.port.markReviewed(old.a.id, old.a.revision, requestId));
    const before = old.wire.calls.length;
    expect(await failure(old.recovery.check(requestId))).toEqual({ kind: 'replay_indeterminate', requestId, reason: 'unsupported' });
    expect(await failure(old.recovery.apply(requestId))).toEqual({ kind: 'replay_indeterminate', requestId, reason: 'unsupported' });
    expect(await failure(old.recovery.check('req-never-sent'))).toEqual({ kind: 'replay_indeterminate', requestId: 'req-never-sent', reason: 'no_intent' });
    expect(old.wire.calls.length).toBe(before);
  });

  it('maps lost recovery answers: a lookup is unavailable, a resend unknown', async () => {
    const { port, recovery, wire, a } = await live();
    wire.next('reviewed', 'drop');
    const requestId = rid();
    await failure(port.markReviewed(a.id, a.revision, requestId));
    wire.next('replay', 'drop');
    expect(await failure(recovery.check(requestId))).toEqual({ kind: 'unavailable' });
    wire.next('replay', 'lose-response');
    expect(await failure(recovery.apply(requestId))).toEqual({ kind: 'unknown', requestId });
    wire.next('replay', { instead: http(503, null) });
    expect(await failure(recovery.check(requestId))).toEqual({ kind: 'unavailable' });
  });

  it('maps the service refusing a resend as no effect, and frees the ID', async () => {
    const { port, recovery, wire, planner, device, a } = await live();
    wire.next('patch', 'drop');
    const requestId = rid();
    await failure(port.patch(a.id, a.revision, { notes: 'mine' }, requestId));
    await device.patch(a.id, a.revision, { notes: 'theirs' }, rid());
    expect(await failure(recovery.apply(requestId))).toMatchObject({ kind: 'revision_conflict', current: { notes: 'theirs' } });
    expect(planner.ledger.unresolved()).toEqual([]);
  });

  it('keeps a confirmed write with a malformed answer unknown, then confirms it by lookup', async () => {
    const { port, recovery, wire, a } = await live();
    wire.next('reviewed', { after: http(200, { item: null }) });
    const requestId = rid();
    expect(await failure(port.markReviewed(a.id, a.revision, requestId))).toEqual({ kind: 'unknown', requestId });
    expect(await recovery.check(requestId)).toMatchObject({ outcome: 'replayed' });
  });
});

describe('the recorded intent and baseline', () => {
  it('freezes the typed intent as first sent; later changes to the caller value or observations do not reach it', async () => {
    const { port, recovery, wire, planner } = await live();
    const fields = { title: 'Frozen', next_steps: [{ id: 'step0001', text: 'One', done: false }] };
    wire.next('create', 'drop');
    const requestId = rid();
    await failure(port.create(fields, requestId));
    const intent = planner.ledger.intent(requestId)!;
    const sent = wire.calls.find((c) => c.route === 'create' && (c.params as { requestId: string }).requestId === requestId)!;
    fields.title = 'Changed';
    fields.next_steps[0]!.text = 'Changed';
    await port.snapshot();
    expect(Object.isFrozen(intent.call)).toBe(true);
    expect(Object.isFrozen((intent.call.params as WorkParams['create']).fields.next_steps![0])).toBe(true);
    await recovery.check(requestId);
    const replay = wire.calls.at(-1)!.params as WorkParams['replay'];
    expect(replay.original).toEqual({ route: 'create', params: sent.params });
    expect(replay.sentAfterVersion).toBe(intent.sentAfterVersion);
    // Typed-intent identity: the main process encodes both to the same bytes.
    expect(encodeWrite(replay.original).body).toBe(encodeWrite({ route: 'create', params: sent.params } as WorkMutationCall).body);
    expect(replay.original.params.requestId).toBe(replay.requestId);
  });

  it('reads the version first when nothing was observed, and sends nothing when it cannot', async () => {
    const calls: WorkRoute[] = [];
    const planner = createPlannerLive({ async call(route) { calls.push(route); return { ok: false, kind: 'unavailable' }; } });
    expect(await failure(planner.port.markReviewed('item00000001', 1, 'req-no-base-1'))).toEqual({ kind: 'unavailable' });
    expect(calls).toEqual(['version']);
  });

  it('bounds unresolved intents by refusing new writes, never by forgetting one', async () => {
    const { port, wire, planner, a } = await live();
    const lost: string[] = [];
    for (let i = 0; i < UNRESOLVED_LIMIT; i += 1) {
      wire.next('reviewed', 'drop');
      const requestId = rid();
      lost.push(requestId);
      await failure(port.markReviewed(a.id, a.revision, requestId));
    }
    const before = wire.calls.length;
    expect(await failure(port.markReviewed(a.id, a.revision, rid()))).toMatchObject({ kind: 'invalid', errors: [{ field: 'body' }] });
    expect(wire.calls.length).toBe(before);
    expect(planner.ledger.unresolved()).toEqual(lost);
    planner.recovery.release(lost[0]!);
    expect((await port.markReviewed(a.id, a.revision, rid())).item!.revision).toBe(a.revision + 1);
  });
});

describe('moves: renumbered neighbours and read-back', () => {
  it('reports every renumbered target neighbour as a full item, even for a no-op move', async () => {
    const fixtureItems = (['B', 'C'] as const).map((title, i) => ({
      ...CURRENT, id: `item0000000${i + 2}`, title, status: 'next', position: (i + 1) * 100, revision: 1,
    }) as Item);
    const { port, fixture, a } = await live({ items: fixtureItems });
    // A was created at the top of Next, so this changes nothing about A but renumbers the whole target status.
    const result = await port.move(a.id, a.revision, 'next', { place: 'top' }, rid());
    expect(result.item!.revision).toBe(a.revision);
    expect(result.changed.filter((i) => i.id !== a.id).every((i) => i.position !== fixtureItems.find((f) => f.id === i.id)!.position)).toBe(true);
    const stored = new Map(fixture.control.stored().map((i) => [i.id, i]));
    const nextIds = fixture.control.stored().filter((i) => i.status === 'next').map((i) => i.id).sort();
    expect(result.changed.map((i) => i.id).sort()).toEqual(nextIds);
    for (const changed of result.changed) expect(changed.position).toBe(stored.get(changed.id)!.position);
    expect(result.stale).toBeUndefined();
  });

  it('keeps a confirmed move confirmed when its read-back fails, marking it stale; nothing is re-sent', async () => {
    const { port, wire, planner, a } = await live();
    wire.next('state', 'unavailable');
    const requestId = rid();
    const result = await port.move(a.id, a.revision, 'active', { place: 'top' }, requestId);
    expect(result).toMatchObject({ item: { id: a.id, status: 'active' }, changed: [{ id: a.id }], stale: true, replayed: false });
    expect(planner.ledger.intent(requestId)!.state).toBe('settled');
    expect(planner.ledger.unresolved()).toEqual([]);
    expect(wire.calls.filter((c) => c.route === 'move')).toHaveLength(1);
  });
});

describe('no network capability in the renderer', () => {
  it('live production code has no fetch, XHR, socket, Node or CLI access', () => {
    for (const file of ['adapter.ts', 'transport.ts', 'wire.ts', 'index.ts']) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
      expect([file, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|require\(|from 'node:|hq-cli|child_process/u.test(source)]).toEqual([file, false]);
    }
  });
});
