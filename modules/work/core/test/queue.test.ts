import { describe, expect, it } from 'vitest';
import { createFixturePlanner } from '../fixtures/adapter';
import { PlannerPortError, REPLAY_FEATURE, type PlannerPort, type UnavailableReason } from '../port';
import { createWorkStore, QUEUE_LIMIT, saveLabel } from '../store';
import { HQ_REFERENCES_FEATURE } from '../types';
import { clock, network, setup } from './queue-support';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const KEPT = /kept on this device and sent/u;

describe('connection', () => {
  it('is connecting until the first read answers, then online with the snapshot time', async () => {
    const now = clock();
    const store = createWorkStore(createFixturePlanner({ now }).port, { now });
    expect(store.getState().connection).toEqual({ status: 'connecting' });
    await store.load();
    const { connection, lastSyncedAt } = store.getState();
    expect(connection).toMatchObject({ status: 'online', checkedAt: lastSyncedAt });
  });

  it.each<[string[], string[]]>([
    [[], ['no_replay', 'no_hq_references', 'no_batch']],
    [[REPLAY_FEATURE], ['no_hq_references', 'no_batch']],
    [[REPLAY_FEATURE, HQ_REFERENCES_FEATURE], ['no_batch']],
    [[HQ_REFERENCES_FEATURE, 'items.batch_create'], ['no_replay']],
    [[REPLAY_FEATURE, HQ_REFERENCES_FEATURE, 'items.batch_create'], []],
  ])('derives the limits from the confirmed features %j', async (features, limits) => {
    const now = clock();
    const store = createWorkStore(createFixturePlanner({ now, features }).port, { now });
    await store.load();
    expect(store.getState().connection).toMatchObject({ status: 'online', limits });
  });

  it('goes offline with the reason of a failed read, and unreachable when it names none', async () => {
    const now = clock();
    const net = network(createFixturePlanner({ now }).port);
    const store = createWorkStore(net.port, { now });
    net.down();
    await store.load();
    const { connection } = store.getState();
    expect(connection).toMatchObject({ status: 'offline', reason: 'unreachable' });
    expect(connection.status === 'offline' && connection.since === connection.checkedAt).toBe(true);
    expect(store.getState().load).toBe('unavailable');
  });

  it.each<UnavailableReason>(['unreachable', 'refused', 'server_error', 'incompatible'])('reports the reason %s of a failed read', async (reason) => {
    const h = await setup();
    await h.goOffline(reason);
    expect(h.store.getState().connection).toMatchObject({ status: 'offline', reason });
  });

  it('treats a read that fails without a Planner outcome as unreachable and any other Planner error as incompatible', async () => {
    const now = clock();
    const fixture = createFixturePlanner({ now });
    const broken: PlannerPort = { ...fixture.port, snapshot: () => Promise.reject(new Error('socket hang up')) };
    const plain = createWorkStore(broken, { now });
    await plain.load();
    expect(plain.getState().connection).toMatchObject({ status: 'offline', reason: 'unreachable' });

    const odd: PlannerPort = { ...fixture.port, snapshot: () => Promise.reject(new PlannerPortError({ kind: 'not_found' })) };
    const other = createWorkStore(odd, { now });
    await other.load();
    expect(other.getState().connection).toMatchObject({ status: 'offline', reason: 'incompatible' });
  });

  it('keeps `since` at the first failure until the Planner answers again', async () => {
    const h = await setup();
    await h.goOffline('refused');
    const first = h.store.getState().connection;
    await h.goOffline('server_error');
    const second = h.store.getState().connection;
    expect(first.status === 'offline' && second.status === 'offline' && second.since === first.since).toBe(true);
    expect(second).toMatchObject({ reason: 'server_error' });
    expect(second.status === 'offline' && first.status === 'offline' && second.checkedAt > first.checkedAt).toBe(true);
    await h.reconnect();
    expect(h.store.getState().connection.status).toBe('online');
    await h.goOffline();
    const third = h.store.getState().connection;
    expect(third.status === 'offline' && third.since > (first.status === 'offline' ? first.since : '')).toBe(true);
  });

  it('goes offline when a write fails unavailable, with its reason', async () => {
    const h = await setup();
    h.net.down('refused');
    await h.store.patch(h.byTitle('A').id, { notes: 'x' });
    expect(h.store.getState().connection).toMatchObject({ status: 'offline', reason: 'refused' });
    h.net.up();
    await h.store.poll();
    h.faults.next('unavailable');
    await h.store.patch(h.byTitle('B').id, { notes: 'y' });
    expect(h.store.getState().connection).toMatchObject({ status: 'offline', reason: 'unreachable' });
  });

  it('goes offline when a Check fails unavailable, and online again when one answers', async () => {
    const h = await setup({ recovery: true });
    h.faults.next('lose-response');
    const outcome = await h.store.patch(h.byTitle('A').id, { notes: 'lost' });
    expect(outcome.status).toBe('unconfirmed');
    h.stub.recovery.check = () => Promise.reject(new PlannerPortError({ kind: 'unavailable', reason: 'server_error' }));
    await h.store.reconcile();
    expect(h.store.getState().connection).toMatchObject({ status: 'offline', reason: 'server_error' });
    expect(h.store.getState().save.kind).toBe('offline');
    h.stub.recovery.check = () => Promise.resolve({ outcome: 'not_applied' });
    await h.store.reconcile();
    expect(h.store.getState().connection.status).toBe('online');
  });

  it('agrees with the offline save state', async () => {
    const h = await setup();
    expect(h.store.getState().save.kind).not.toBe('offline');
    await h.goOffline();
    expect(h.store.getState().connection.status).toBe('offline');
    expect(h.store.getState().save).toEqual({ kind: 'offline' });
    await h.reconnect();
    expect(h.store.getState().connection.status).toBe('online');
    expect(h.store.getState().save.kind).not.toBe('offline');
  });

  it('is tracked with the queue off too', async () => {
    const h = await setup({ store: { offlineQueue: false } });
    await h.goOffline('refused');
    expect(h.store.getState().connection).toMatchObject({ status: 'offline', reason: 'refused' });
    expect(h.store.getState().save).toEqual({ kind: 'offline' });
  });
});

describe('with the queue off', () => {
  it('fails an unavailable write as it always did: rolled back, never queued, never carrying a count', async () => {
    const h = await setup({ store: { offlineQueue: false } });
    h.net.down();
    const outcome = await h.store.patch(h.byTitle('A').id, { notes: 'lost?' });
    expect(outcome).toEqual({ status: 'failed', error: { kind: 'unavailable' } });
    expect(h.store.getState().queued).toEqual([]);
    expect(h.store.getState().save).toEqual({ kind: 'offline' });
    expect('queued' in h.store.getState().save).toBe(false);
    expect(h.shown('A').notes).toBe('');
    expect(h.store.getState().notices.at(-1)!.text).toBe('The Planner is unavailable; nothing was saved.');
    expect(h.store.getState().durable).toBe('off');
    const calls = h.net.calls.length;
    await h.store.flushQueued();
    expect(h.net.calls).toHaveLength(calls);
  });
});

describe('queueing', () => {
  it('queues a write without sending it while the Planner is offline', async () => {
    const h = await setup();
    await h.goOffline('refused');
    const a = h.byTitle('A');
    const writes = h.net.writes().length;
    const outcome = await h.store.patch(a.id, { notes: 'offline edit' });
    expect(outcome).toEqual({ status: 'failed', error: { kind: 'unavailable', reason: 'refused' }, queued: { queueId: expect.stringMatching(UUID) } });
    expect(h.net.writes()).toHaveLength(writes);
    const [entry] = h.store.getState().queued;
    expect(entry).toMatchObject({
      queueId: (outcome as { queued: { queueId: string } }).queued.queueId, state: 'queued',
      write: { op: 'patch', id: a.id, revision: a.revision, patch: { notes: 'offline edit' } }, base: a,
    });
    expect(entry!.requestId).toMatch(/^req-\d{8}$/u);
    expect(entry!.queuedAt).toMatch(/^2026-10-21T/u);
    expect(h.byTitle('A').notes).toBe('');
  });

  it('queues a move, archive, restore, review mark and settings write, in the order made', async () => {
    const h = await setup();
    await h.goOffline();
    const [a, b, c] = [h.byTitle('A'), h.byTitle('B'), h.byTitle('C')];
    const settings = h.store.getState().confirmed!.settings;
    const outcomes = [
      await h.store.move(a.id, 'done', { place: 'top' }),
      await h.store.setArchived(b.id, true),
      await h.store.setArchived(b.id, false),
      await h.store.markReviewed(c.id),
      await h.store.updateSettings({ ...settings, stale_days: 30 }),
    ];
    for (const outcome of outcomes) expect(outcome).toMatchObject({ status: 'failed', error: { kind: 'unavailable', reason: 'unreachable' }, queued: { queueId: expect.stringMatching(UUID) } });
    expect(h.net.writes()).toEqual([]);
    const { queued } = h.store.getState();
    expect(queued.map((q) => q.write.op)).toEqual(['move', 'setArchived', 'setArchived', 'markReviewed', 'updateSettings']);
    expect(new Set(queued.map((q) => q.queueId)).size).toBe(5);
    expect(queued[0]).toMatchObject({ write: { op: 'move', id: a.id, status: 'done', anchor: { place: 'top' } }, base: a });
    expect(queued[3]).toMatchObject({ write: { op: 'markReviewed', id: c.id }, base: c });
    expect(queued[4]).toMatchObject({ write: { op: 'updateSettings', settings: { stale_days: 30 } }, base: settings });
  });

  it('queues a write behind the entries of its target even while online, so per-target order holds', async () => {
    const h = await setup();
    const [a, b] = [h.byTitle('A'), h.byTitle('B')];
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'mine' });
    await h.device.patch(a.id, a.revision, { notes: 'theirs' }, h.otherRid());
    await h.reconnect(); // the head conflicts, so the target stays blocked while the Planner is online
    expect(h.store.getState().queued[0]).toMatchObject({ state: 'conflict' });
    expect(h.store.getState().connection.status).toBe('online');
    const writes = h.net.writes().length;
    const behind = await h.store.patch(a.id, { title: 'A, again' });
    expect(behind).toEqual({ status: 'failed', error: { kind: 'unavailable', reason: 'unreachable' }, queued: { queueId: expect.stringMatching(UUID) } });
    expect(h.net.writes()).toHaveLength(writes);
    expect(h.store.getState().queued.map((q) => q.state)).toEqual(['conflict', 'queued']);
    // Another target is unaffected.
    expect(await h.store.patch(b.id, { notes: 'b' })).toMatchObject({ status: 'saved' });
    expect(h.net.writes()).toHaveLength(writes + 1);
  });

  it('queues a write whose send fails unavailable, instead of failing it', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    h.faults.next('unavailable');
    const outcome = await h.store.patch(a.id, { notes: 'x' });
    expect(outcome).toEqual({ status: 'failed', error: { kind: 'unavailable', reason: 'unreachable' }, queued: { queueId: expect.stringMatching(UUID) } });
    const [entry] = h.store.getState().queued;
    expect(entry).toMatchObject({ requestId: 'req-00000001', state: 'queued', base: a });
    expect(h.store.getState().connection).toMatchObject({ status: 'offline' });
    expect(h.store.getState().pending).toEqual([]);
    expect(h.store.getState().notices.map((n) => n.text)).not.toContain('The Planner is unavailable; nothing was saved.');
    expect(h.shown('A').notes).toBe('x');
  });

  it('keeps the reason of the failed send on the queued outcome', async () => {
    const h = await setup();
    h.net.down('server_error');
    const outcome = await h.store.patch(h.byTitle('A').id, { notes: 'x' });
    expect(outcome).toMatchObject({ status: 'failed', error: { kind: 'unavailable', reason: 'server_error' }, queued: { queueId: expect.any(String) } });
  });

  it('never queues a create', async () => {
    const h = await setup();
    await h.goOffline('refused');
    const outcome = await h.store.create({ title: 'New idea' });
    expect(outcome).toEqual({ status: 'failed', error: { kind: 'unavailable', reason: 'refused' } });
    expect(h.store.getState().queued).toEqual([]);
    expect(h.store.getState().notices.at(-1)!.text).toBe('The Planner is unavailable; nothing was saved.');
  });

  it('does not queue a write the store rejects locally', async () => {
    const h = await setup();
    await h.goOffline();
    expect(await h.store.patch(h.byTitle('A').id, { title: '' })).toMatchObject({ status: 'failed', error: { kind: 'invalid' } });
    expect(await h.store.patch('missing-item', { notes: 'x' })).toEqual({ status: 'failed', error: { kind: 'not_found' } });
    expect(h.store.getState().queued).toEqual([]);
  });

  it('never queues an undo write: undo that finds the Planner down fails as before', async () => {
    const h = await setup();
    const [a, b] = [h.byTitle('A'), h.byTitle('B')];
    await h.store.patch(a.id, { notes: 'one' });
    await h.goOffline();
    await h.store.patch(b.id, { notes: 'queued' });
    const writes = h.net.writes().length;
    expect(await h.store.undo()).toMatchObject({ status: 'failed', error: { kind: 'unavailable' } });
    expect(h.net.writes().length).toBe(writes + 1);
    expect(h.store.getState().queued.map((q) => q.write)).toEqual([expect.objectContaining({ op: 'patch', id: b.id })]);
  });

  it('refuses an undo while its item has queued entries, without sending', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.store.patch(a.id, { notes: 'one' });
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'two' });
    const calls = h.net.calls.length;
    expect(await h.store.undo()).toEqual({ status: 'refused', message: 'Not undone: this item has changes queued on this device.' });
    expect(h.net.calls).toHaveLength(calls);
  });

  it('gives a queued write no undo entry', async () => {
    const h = await setup();
    await h.goOffline();
    await h.store.patch(h.byTitle('A').id, { notes: 'x' });
    expect(h.store.getState().undo).toEqual([]);
    await h.reconnect();
    expect(h.store.getState().queued).toEqual([]);
    expect(h.store.getState().undo).toEqual([]);
  });
});

describe('queue limit and notices', () => {
  it('fails a write past the limit as today, with a danger notice that it was not kept', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    for (let i = 0; i < QUEUE_LIMIT; i += 1) {
      expect(await h.store.patch(a.id, { notes: `n${i}` })).toMatchObject({ queued: { queueId: expect.any(String) } });
    }
    expect(h.store.getState().queued).toHaveLength(QUEUE_LIMIT);
    const outcome = await h.store.patch(a.id, { notes: 'one too many' });
    expect(outcome).toEqual({ status: 'failed', error: { kind: 'unavailable', reason: 'unreachable' } });
    expect(h.store.getState().queued).toHaveLength(QUEUE_LIMIT);
    expect(h.store.getState().notices.at(-1)).toMatchObject({ tone: 'danger', text: expect.stringMatching(/not kept/u) });
    expect(h.shown('A').notes).toBe(`n${QUEUE_LIMIT - 1}`);
  });

  it('notifies once per offline period that changes are kept, not once per write', async () => {
    const h = await setup();
    const [a, b] = [h.byTitle('A'), h.byTitle('B')];
    await h.goOffline();
    await h.store.patch(a.id, { notes: '1' });
    await h.store.patch(b.id, { notes: '2' });
    await h.store.patch(a.id, { title: 'A3' });
    expect(h.store.getState().notices.filter((n) => KEPT.test(n.text))).toHaveLength(1);
    expect(h.store.getState().notices.find((n) => KEPT.test(n.text))).toMatchObject({ tone: 'info' });
    await h.reconnect();
    await h.goOffline();
    await h.store.patch(a.id, { notes: '4' });
    await h.store.patch(a.id, { notes: '5' });
    expect(h.store.getState().notices.filter((n) => KEPT.test(n.text))).toHaveLength(2);
    expect(h.store.getState().notices.length).toBeLessThanOrEqual(10);
  });

  it('does not repeat the notice for a write queued behind others while online', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    h.faults.next('unavailable');
    await h.store.patch(a.id, { notes: '1' });
    await h.store.patch(a.id, { notes: '2' });
    expect(h.store.getState().notices.filter((n) => KEPT.test(n.text))).toHaveLength(1);
  });
});

describe('projection', () => {
  it('projects queued entries on items while the board keeps the Planner confirmed version', async () => {
    const h = await setup();
    await h.goOffline();
    await h.store.patch(h.byTitle('A').id, { notes: 'offline note' });
    expect(h.shown('A').notes).toBe('offline note');
    expect(h.byTitle('A').notes).toBe('');
    expect(h.store.getState().pending).toEqual([]);
  });

  it('projects a queued move and archive, stamping the archive with the time it was queued', async () => {
    const h = await setup();
    await h.goOffline();
    await h.store.move(h.byTitle('B').id, 'done', { place: 'top' });
    await h.store.setArchived(h.byTitle('C').id, true);
    expect(h.shown('B').status).toBe('done');
    const [, archive] = h.store.getState().queued;
    expect(h.shown('C').archived_at).toBe(archive!.queuedAt);
    await h.store.patch(h.byTitle('A').id, { notes: 'later render' });
    expect(h.shown('C').archived_at).toBe(archive!.queuedAt);
  });

  it('projects queued entries after unconfirmed writes', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    h.faults.next('lose-response');
    expect(await h.store.patch(a.id, { title: 'A one', notes: 'unconfirmed note' })).toMatchObject({ status: 'unconfirmed' });
    await h.goOffline();
    await h.store.patch(a.id, { title: 'A two' });
    expect(h.shown('A two')).toMatchObject({ title: 'A two', notes: 'unconfirmed note' });
    // The base is the projected item: what the user saw, unconfirmed write included.
    expect(h.store.getState().queued[0]!.base).toMatchObject({ title: 'A one', notes: 'unconfirmed note' });
  });

  it('projects a sending entry', async () => {
    const h = await setup();
    await h.goOffline();
    await h.store.patch(h.byTitle('A').id, { notes: 'on its way' });
    const hold = h.net.hold('patch');
    h.net.up();
    const flush = h.store.poll();
    await hold.reached;
    expect(h.store.getState().queued[0]).toMatchObject({ state: 'sending' });
    expect(h.shown('A').notes).toBe('on its way');
    hold.release();
    await flush;
    expect(h.store.getState().queued).toEqual([]);
    expect(h.shown('A').notes).toBe('on its way');
  });

  it('does not project a conflicting or a rejected entry: the board shows the Planner version', async () => {
    const h = await setup();
    const [a, b] = [h.byTitle('A'), h.byTitle('B')];
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'mine' });
    await h.store.patch(b.id, { notes: 'refused' });
    await h.device.patch(a.id, a.revision, { notes: 'theirs' }, h.otherRid());
    h.net.up();
    h.net.failNext('patch', { kind: 'invalid', errors: [{ field: 'notes', message: 'No.' }] });
    await h.store.poll();
    expect(h.store.getState().queued.map((q) => q.state)).toEqual(['conflict', 'rejected']);
    expect(h.shown('A').notes).toBe('theirs');
    expect(h.shown('B').notes).toBe('');
  });
});

describe('save precedence and labels', () => {
  it('is offline with the queued count, in any state, and offline alone when nothing is queued', async () => {
    const h = await setup();
    await h.goOffline();
    expect(h.store.getState().save).toEqual({ kind: 'offline' });
    expect(saveLabel(h.store.getState().save, null)).toBe('Offline · not saving');
    await h.store.patch(h.byTitle('A').id, { notes: '1' });
    await h.store.patch(h.byTitle('B').id, { notes: '2' });
    expect(h.store.getState().save).toEqual({ kind: 'offline', queued: 2 });
    expect(saveLabel(h.store.getState().save, null)).toBe('Offline · 2 queued');
  });

  it('shows N queued when online with queued entries, counting a conflicting one', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'mine' });
    await h.device.patch(a.id, a.revision, { notes: 'theirs' }, h.otherRid());
    await h.reconnect();
    expect(h.store.getState().save).toEqual({ kind: 'queued', count: 1 });
    expect(saveLabel(h.store.getState().save, null)).toBe('1 queued');
    await h.store.patch(a.id, { title: 'A2' });
    expect(h.store.getState().save).toEqual({ kind: 'queued', count: 2 });
    expect(saveLabel(h.store.getState().save, null)).toBe('2 queued');
  });

  it('puts offline before unconfirmed before queued before saving', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'mine' });
    await h.device.patch(a.id, a.revision, { notes: 'theirs' }, h.otherRid());
    await h.reconnect(); // online, one conflicting entry
    h.faults.next('lose-response');
    await h.store.create({ title: 'Lost create' });
    expect(h.store.getState().save).toEqual({ kind: 'unconfirmed', count: 1 });
    await h.goOffline();
    expect(h.store.getState().save).toEqual({ kind: 'offline', queued: 1 });
    expect(saveLabel(h.store.getState().save, null)).toBe('Offline · 1 queued');
  });

  it('keeps every existing label', () => {
    expect(saveLabel({ kind: 'saving', count: 1 }, null)).toBe('Saving…');
    expect(saveLabel({ kind: 'unconfirmed', count: 3 }, null)).toBe('3 unconfirmed');
    expect(saveLabel({ kind: 'offline' }, null)).toBe('Offline · not saving');
    expect(saveLabel({ kind: 'idle' }, null)).toBe('');
  });
});
