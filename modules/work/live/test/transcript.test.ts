import { describe, expect, it } from 'vitest';
import type { Settings } from '../../core';
import { createPlannerLive } from '../adapter';
import { WORK_ROUTES, type WorkMutationCall } from '../transport';
import { decodeItemBody } from '../wire';
import { answer, encodeCall, exchange, exchangeNames, failure, strictTransport, type Exchange } from './support';

// A strict transcript against the pinned synthetic Planner exchanges: each adapter call must reproduce the recorded
// route, method, path, exact body bytes and request-ID header, and each recorded status, body and X-Replayed answer
// must map to the port's result. The encoding is the reference the main process must reproduce.

const ID = '0000000000000001';
const fieldsOf = (ex: Exchange) => (JSON.parse(ex.request.body_utf8) as { fields: Record<string, unknown> }).fields;
const LOST = { ok: false, kind: 'unknown' } as const;

describe('reads', () => {
  it('maps version and state names: state_version, server_time, features', async () => {
    const t = strictTransport([{ exchange: exchange('01-version') }, { exchange: exchange('02-state-empty') }, { exchange: exchange('25-state') }, { exchange: exchange('26-version') }]);
    const { port } = createPlannerLive(t.transport);
    expect(await port.version()).toBe(0);
    expect(await port.snapshot()).toEqual({
      items: [], settings: { default_tz: 'America/New_York', week_start: 'sun', stale_days: 21 }, stateVersion: 0,
      observedAt: '2026-01-15T12:00:00Z', features: ['items.batch_create', 'requests.replay', 'hq-references-v1'],
    });
    const state = await port.snapshot();
    expect(state.stateVersion).toBe(9);
    expect(state.items.map((i) => i.id)).toEqual(['0000000000000002', '0000000000000004', ID, '0000000000000003']);
    expect(state.items[1]!.references[0]).toMatchObject({ kind: 'hq', target: { domain: 'design', entityId: 'artifact-example' } });
    expect(await port.version()).toBe(9);
    expect(t.remaining()).toBe(0);
  });

  it('decodes an item read and encodes its route as recorded', () => {
    const ex = exchange('06-get');
    expect(encodeCall('item', { id: ID })).toMatchObject({ method: ex.request.method, path: ex.request.path, body: '' });
    expect(decodeItemBody(ex.response.body)).toMatchObject({ id: ID, revision: 1, dates: [{ id: 'date001', kind: 'target', precision: 'quarter', value: '2027-Q2' }, { id: 'date002' }] });
  });
});

describe('writes reproduce the recorded bytes and map their answers', () => {
  it('create, refusals, patch, conflicts, move with read-back, archive, restore, review, settings, validation and history', async () => {
    const t = strictTransport([
      { exchange: exchange('01-version') },
      { exchange: exchange('03-create') },
      { exchange: exchange('07-patch') },
      { exchange: exchange('08-revision-conflict') },
      { exchange: exchange('09-order-conflict') },
      { exchange: exchange('10-move') },
      { exchange: exchange('25-state') }, // the move's read-back of renumbered neighbours
      { exchange: exchange('11-archive') },
      { exchange: exchange('12-restore') },
      { exchange: exchange('13-reviewed') },
      { exchange: exchange('14-settings') },
      { exchange: exchange('17-field-validation') },
      { exchange: exchange('24-history') },
    ]);
    const { port, ledger } = createPlannerLive(t.transport);
    await port.version();

    const created = await port.create(fieldsOf(exchange('03-create')) as never, 'contract-create');
    expect(created).toMatchObject({ item: { id: ID, revision: 1, position: 1024 }, stateVersion: 1, replayed: false });
    expect(created.changed).toEqual([created.item]);
    // The same ID with a different body is refused locally; nothing is sent.
    expect(await failure(port.create({ title: 'Different' }, 'contract-create'))).toEqual({ kind: 'request_id_reused' });

    const patched = await port.patch(ID, 1, { notes: 'Synthetic note' }, 'contract-patch');
    expect(patched).toMatchObject({ item: { revision: 2, notes: 'Synthetic note' }, stateVersion: 2 });
    expect(patched.changed).toEqual([patched.item]);
    expect(await failure(port.patch(ID, 1, { title: 'Stale' }, 'contract-stale'))).toMatchObject({ kind: 'revision_conflict', current: { id: ID, revision: 2 } });
    expect(await failure(port.move(ID, 2, 'next', { after_id: 'missing001' }, 'contract-order'))).toEqual({ kind: 'order_conflict' });

    const moved = await port.move(ID, 2, 'next', { place: 'top' }, 'contract-move');
    expect(moved).toMatchObject({ item: { id: ID, status: 'next', revision: 3 }, stateVersion: 3 });
    expect(moved.stale).toBeUndefined();
    expect(moved.changed.map((i) => i.id)).toEqual([ID, '0000000000000002']);

    expect((await port.setArchived(ID, 3, true, 'contract-archive')).item!.archived_at).toBe('2026-01-15T12:00:00Z');
    expect((await port.setArchived(ID, 4, false, 'contract-restore')).item!.archived_at).toBeNull();
    expect((await port.markReviewed(ID, 5, 'contract-reviewed')).item!.reviewed_at).toBe('2026-01-15T12:00:00Z');
    expect(await port.updateSettings({ week_start: 'mon' } as Settings, 'contract-settings')).toEqual({ settings: { default_tz: 'America/New_York', week_start: 'mon', stale_days: 21 }, stateVersion: 7 });

    expect(await failure(port.create(fieldsOf(exchange('17-field-validation')) as never, 'contract-invalid'))).toEqual({ kind: 'invalid', errors: [{ field: 'references', message: 'Reference 1 is malformed.' }] });
    expect((await port.history(ID)).map((h) => h.action)).toEqual(['reviewed', 'restored', 'archived', 'moved', 'updated', 'created']);

    expect(t.remaining()).toBe(0);
    // Rejected requests freed their IDs; confirmed ones are settled; nothing is unresolved.
    expect(ledger.unresolved()).toEqual([]);
  });

  it('maps X-Replayed to replayed', async () => {
    const t = strictTransport([{ exchange: exchange('01-version') }, { exchange: exchange('04-create-repeated') }]);
    const { port } = createPlannerLive(t.transport);
    await port.version();
    expect(await port.create(fieldsOf(exchange('04-create-repeated')) as never, 'contract-create')).toMatchObject({ replayed: true, stateVersion: 1 });
  });

  it('maps the service reporting request_id_reused as a stable defect with no effect', async () => {
    const t = strictTransport([{ exchange: exchange('01-version') }, { exchange: exchange('05-id-reuse') }]);
    const { port, ledger } = createPlannerLive(t.transport);
    await port.version();
    expect(await failure(port.create({ title: 'Different' }, 'contract-create'))).toEqual({ kind: 'request_id_reused' });
    expect(ledger.unresolved()).toEqual([]);
  });
});

describe('golden recovery mapping through the replay route', () => {
  const create = exchange('03-create');

  it('19: a lookup of a retained create confirms it with its recorded response', async () => {
    const t = strictTransport([{ exchange: exchange('01-version') }, { route: 'create', respond: LOST }, { exchange: exchange('19-replay-retained') }]);
    const { port, recovery } = createPlannerLive(t.transport);
    await port.version();
    expect(await failure(port.create(fieldsOf(create) as never, 'contract-create'))).toEqual({ kind: 'unknown', requestId: 'contract-create' });
    expect(await recovery.check('contract-create')).toMatchObject({ outcome: 'replayed', result: { item: { id: ID }, stateVersion: 1, replayed: true } });
    expect(t.remaining()).toBe(0);
  });

  it('20-21: lookup proves not applied, an explicit apply applies now, and asking again is a read-only lookup', async () => {
    const t = strictTransport([
      { exchange: exchange('01-version') }, { route: 'create', respond: LOST },
      { exchange: exchange('20-replay-not-applied') }, { exchange: exchange('21-replay-apply') },
      // Once settled, a repeated Apply is answered by a lookup, never a second resend.
      { route: 'replay', respond: answer(exchange('22-replay-apply-repeated')) },
    ]);
    const { port, recovery } = createPlannerLive(t.transport);
    await port.version();
    await failure(port.create(fieldsOf(create) as never, 'contract-unseen'));
    // No Apply before the Check: nothing is sent.
    expect(await failure(recovery.apply('contract-unseen'))).toEqual({ kind: 'unknown', requestId: 'contract-unseen' });
    expect(await recovery.check('contract-unseen')).toEqual({ outcome: 'not_applied' });
    expect(await recovery.apply('contract-unseen')).toMatchObject({ outcome: 'applied_now', result: { item: { id: '0000000000000004' }, stateVersion: 9, replayed: false } });
    const sent = t.calls.length;
    expect(await recovery.apply('contract-unseen')).toMatchObject({ outcome: 'replayed', result: { item: { id: '0000000000000004' }, replayed: true } });
    expect((t.calls[sent]!.params as { mode: string }).mode).toBe('lookup');
    expect(t.remaining()).toBe(0);
  });

  it('22: an authorized apply the service answers as already applied is confirmed as replayed', async () => {
    const t = strictTransport([
      { exchange: exchange('01-version') }, { route: 'create', respond: LOST },
      { exchange: exchange('20-replay-not-applied') }, { exchange: exchange('22-replay-apply-repeated') },
    ]);
    const { port, recovery } = createPlannerLive(t.transport);
    await port.version();
    await failure(port.create(fieldsOf(create) as never, 'contract-unseen'));
    expect(await recovery.check('contract-unseen')).toEqual({ outcome: 'not_applied' });
    expect(await recovery.apply('contract-unseen')).toMatchObject({ outcome: 'replayed', result: { item: { id: '0000000000000004' }, replayed: true } });
    expect(t.remaining()).toBe(0);
  });

  it('23: without a baseline the service answers indeterminate, which maps to replay_indeterminate', async () => {
    const ex = exchange('23-replay-indeterminate');
    const original = { route: 'create', params: { requestId: 'contract-unknown', fields: fieldsOf(create) } } as unknown as WorkMutationCall;
    // Encoder identity: a replay without sentAfterVersion is exactly the recorded envelope, with no X-Request-Id.
    expect(encodeCall('replay', { mode: 'lookup', requestId: 'contract-unknown', original })).toEqual({ method: 'POST', path: '/api/requests/replay', body: ex.request.body_utf8, requestIdHeader: null });
    expect(ex.request.headers['X-Request-Id']).toBeUndefined();
    const t = strictTransport([{ exchange: exchange('01-version') }, { route: 'create', respond: LOST }, { route: 'replay', respond: answer(ex) }]);
    const { port, recovery } = createPlannerLive(t.transport);
    await port.version();
    await failure(port.create(fieldsOf(create) as never, 'contract-unknown'));
    expect(await failure(recovery.check('contract-unknown'))).toEqual({ kind: 'replay_indeterminate', requestId: 'contract-unknown', reason: 'no_baseline' });
  });
});

describe('refusals and edge answers (exchanges 28-38)', () => {
  const create = exchange('03-create');
  const errorsOf = (ex: Exchange) => (ex.response.body as { errors: unknown }).errors;
  /** A lost create under `contract-create`, then the one recovery answer. */
  async function recovered(answerEx: Exchange) {
    const t = strictTransport([{ exchange: exchange('01-version') }, { route: 'create', respond: LOST }, { route: 'replay', respond: answer(answerEx) }]);
    const { port, recovery } = createPlannerLive(t.transport);
    await port.version();
    await failure(port.create(fieldsOf(create) as never, 'contract-create'));
    return failure(recovery.check('contract-create'));
  }

  it('28-29: a missing item is the recorded 404; a write maps it to not_found and frees its ID', async () => {
    const read = exchange('28-item-not-found');
    expect(encodeCall('item', { id: 'missing001' })).toEqual({ method: read.request.method, path: read.request.path, body: '', requestIdHeader: null });
    expect(read.response.status).toBe(404);
    expect(decodeItemBody(read.response.body)).toBeNull();
    const t = strictTransport([{ exchange: exchange('01-version') }, { exchange: exchange('29-mutation-not-found') }]);
    const { port, ledger } = createPlannerLive(t.transport);
    await port.version();
    expect(await failure(port.setArchived('missing001', 1, true, 'contract-missing'))).toEqual({ kind: 'not_found' });
    expect(ledger.unresolved()).toEqual([]);
    expect(t.remaining()).toBe(0);
  });

  it('30: Work refuses the invalid HQ target locally with the service\'s own errors, and maps the service saying so', async () => {
    const ex = exchange('30-reference-target-validation');
    // parseReference rejects a version-2 target before anything is sent, so the recorded request bytes are not reproduced.
    const local = strictTransport([{ exchange: exchange('01-version') }]);
    const refusing = createPlannerLive(local.transport);
    await refusing.port.version();
    expect(await failure(refusing.port.create(fieldsOf(ex) as never, 'contract-target'))).toEqual({ kind: 'invalid', errors: errorsOf(ex) });
    expect(local.remaining()).toBe(0);
    const t = strictTransport([{ exchange: exchange('01-version') }, { route: 'create', respond: answer(ex) }]);
    const { port, ledger } = createPlannerLive(t.transport);
    await port.version();
    expect(await failure(port.create(fieldsOf(create) as never, 'contract-target'))).toEqual({ kind: 'invalid', errors: errorsOf(ex) });
    expect(ledger.unresolved()).toEqual([]);
  });

  it('31: a settings value out of range is sent as recorded and the 400 maps to invalid', async () => {
    const ex = exchange('31-settings-validation');
    const t = strictTransport([{ exchange: exchange('01-version') }, { exchange: ex }]);
    const { port, ledger } = createPlannerLive(t.transport);
    await port.version();
    expect(await failure(port.updateSettings({ stale_days: 0 } as Settings, 'contract-bad-settings'))).toEqual({ kind: 'invalid', errors: errorsOf(ex) });
    expect(ledger.unresolved()).toEqual([]);
    expect(t.remaining()).toBe(0);
  });

  // Exchanges 32 and 33 refuse the same patch, for a missing X-Planning-Request header and a wrong content type. The
  // recorded bytes and X-Request-Id are reproduced; the headers a bridge adds are not part of the typed call.
  it.each([
    ['32-missing-planning-header', { kind: 'unavailable' }],
    ['33-unsupported-media-type', { kind: 'invalid', errors: [{ field: 'body', message: 'Send application/json.' }] }],
  ])('%s: a refused patch is a no-effect failure and frees its ID', async (name, expected) => {
    const t = strictTransport([{ exchange: exchange('01-version') }, { exchange: exchange(name) }]);
    const { port, ledger } = createPlannerLive(t.transport);
    await port.version();
    expect(await failure(port.patch(ID, 6, { title: 'Refused' }, 'contract-refused'))).toEqual(expected);
    expect(ledger.unresolved()).toEqual([]);
    expect(t.remaining()).toBe(0);
  });

  it('34: a refused Host on a read is unavailable', async () => {
    const t = strictTransport([{ exchange: exchange('34-bad-host') }]);
    const { port } = createPlannerLive(t.transport);
    expect(await failure(port.version())).toEqual({ kind: 'unavailable' });
    expect(t.remaining()).toBe(0);
  });

  it('35: a body over the limit maps to invalid with no effect', async () => {
    // The recorded request declares a length without sending a body, which a typed create cannot produce.
    const t = strictTransport([{ exchange: exchange('01-version') }, { route: 'create', respond: answer(exchange('35-body-too-large')) }]);
    const { port, ledger } = createPlannerLive(t.transport);
    await port.version();
    expect(await failure(port.create(fieldsOf(create) as never, 'contract-large'))).toEqual({ kind: 'invalid', errors: [{ field: 'body', message: 'Request body is too large.' }] });
    expect(ledger.unresolved()).toEqual([]);
  });

  it('36-38: replay refusals map without sending anything else, and the encoder reproduces the recorded envelopes', async () => {
    const original = { route: 'create', params: { requestId: 'contract-create', fields: fieldsOf(create) } } as unknown as WorkMutationCall;
    const different = { route: 'create', params: { requestId: 'contract-create', fields: { title: 'Different' } } } as unknown as WorkMutationCall;
    expect(encodeCall('replay', { mode: 'lookup', requestId: 'contract-create', original, sentAfterVersion: 99 }).body).toBe(exchange('37-replay-unobserved-version').request.body_utf8);
    expect(encodeCall('replay', { mode: 'lookup', requestId: 'contract-create', original: different, sentAfterVersion: 0 }).body).toBe(exchange('38-replay-id-reuse').request.body_utf8);
    // Work only replays its own mutations, so a GET target (36) cannot be sent; the answer still maps as a refused lookup.
    expect(await recovered(exchange('36-replay-not-replayable'))).toEqual({ kind: 'unavailable' });
    expect(await recovered(exchange('37-replay-unobserved-version'))).toEqual({ kind: 'unavailable' });
    expect(await recovered(exchange('38-replay-id-reuse'))).toEqual({ kind: 'request_id_reused' });
  });
});

describe('the closed route list', () => {
  const WORK_PATHS = [
    /^GET \/api\/state$/u, /^GET \/api\/version$/u, /^GET \/api\/items\/[A-Za-z0-9_-]+$/u, /^GET \/api\/items\/[A-Za-z0-9_-]+\/history$/u,
    /^POST \/api\/items$/u, /^PATCH \/api\/items\/[A-Za-z0-9_-]+$/u, /^POST \/api\/items\/[A-Za-z0-9_-]+\/(move|archive|restore|reviewed)$/u,
    /^PUT \/api\/settings$/u, /^POST \/api\/requests\/replay$/u,
  ];
  const isWorkPath = (method: string, path: string) => WORK_PATHS.some((p) => p.test(`${method} ${path}`));
  const BATCH_OR_TRANSFER = [
    '15-batch-dry-run', '16-batch', '18-import-validation', '27-export',
    '39-import-confirmation-required', '40-import-merge', '41-examples', '42-examples-present',
  ];

  it('has exactly the eleven Work routes plus replay', () => {
    expect(WORK_ROUTES).toEqual(['state', 'version', 'item', 'history', 'create', 'patch', 'move', 'archive', 'restore', 'reviewed', 'settings', 'replay']);
  });

  it('cannot reach batch, import, export or examples, and covers every other recorded exchange', () => {
    for (const name of exchangeNames()) {
      const { method, path } = exchange(name).request;
      expect([name, isWorkPath(method, path)]).toEqual([name, !BATCH_OR_TRANSFER.includes(name)]);
    }
  });
});
