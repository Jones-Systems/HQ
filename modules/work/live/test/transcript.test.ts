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

  it('20-22: lookup proves not applied, apply applies now, and a repeat apply replays', async () => {
    const t = strictTransport([
      { exchange: exchange('01-version') }, { route: 'create', respond: LOST },
      { exchange: exchange('20-replay-not-applied') }, { exchange: exchange('21-replay-apply') }, { exchange: exchange('22-replay-apply-repeated') },
    ]);
    const { port, recovery } = createPlannerLive(t.transport);
    await port.version();
    await failure(port.create(fieldsOf(create) as never, 'contract-unseen'));
    expect(await recovery.check('contract-unseen')).toEqual({ outcome: 'not_applied' });
    expect(await recovery.apply('contract-unseen')).toMatchObject({ outcome: 'applied_now', result: { item: { id: '0000000000000004' }, stateVersion: 9, replayed: false } });
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

describe('the closed route list', () => {
  const WORK_PATHS = [
    /^GET \/api\/state$/u, /^GET \/api\/version$/u, /^GET \/api\/items\/[A-Za-z0-9_-]+$/u, /^GET \/api\/items\/[A-Za-z0-9_-]+\/history$/u,
    /^POST \/api\/items$/u, /^PATCH \/api\/items\/[A-Za-z0-9_-]+$/u, /^POST \/api\/items\/[A-Za-z0-9_-]+\/(move|archive|restore|reviewed)$/u,
    /^PUT \/api\/settings$/u, /^POST \/api\/requests\/replay$/u,
  ];
  const isWorkPath = (method: string, path: string) => WORK_PATHS.some((p) => p.test(`${method} ${path}`));
  const BATCH_OR_TRANSFER = ['15-batch-dry-run', '16-batch', '18-import-validation', '27-export'];

  it('has exactly the eleven Work routes plus replay', () => {
    expect(WORK_ROUTES).toEqual(['state', 'version', 'item', 'history', 'create', 'patch', 'move', 'archive', 'restore', 'reviewed', 'settings', 'replay']);
  });

  it('cannot reach batch, import or export, and covers every other recorded exchange', () => {
    for (const name of exchangeNames()) {
      const { method, path } = exchange(name).request;
      expect([name, isWorkPath(method, path)]).toEqual([name, !BATCH_OR_TRANSFER.includes(name)]);
    }
  });
});
