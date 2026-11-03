import { describe, expect, it, vi } from 'vitest';
import type { PlannerError, PlannerPort } from '../port';
import type { Settings } from '../types';
import { setup, settled, type Call, type Harness } from './queue-support';

const requestIdOf = (call: Call) => String(call.args[call.args.length - 1]);
const noticeTexts = (h: Harness) => h.store.getState().notices.map((n) => n.text);
const conflictsOf = (h: Harness) => h.store.getState().queued.filter((q) => q.state === 'conflict');

describe('flushing', () => {
  it('sends in queue order, one at a time, each at the revision the previous one left', async () => {
    const h = await setup();
    const [a, b, c] = [h.byTitle('A'), h.byTitle('B'), h.byTitle('C')];
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'a1' });
    await h.store.patch(b.id, { notes: 'b1' });
    await h.store.patch(a.id, { title: 'A2' });
    await h.store.markReviewed(c.id);
    expect(h.net.writes()).toEqual([]);
    await h.reconnect();
    expect(h.net.writes().map((call) => `${call.method}:${String(call.args[0])}`)).toEqual([`patch:${a.id}`, `patch:${b.id}`, `patch:${a.id}`, `markReviewed:${c.id}`]);
    expect(h.net.writes()[2]!.args.slice(0, 3)).toEqual([a.id, 2, { title: 'A2' }]);
    expect(new Set(h.net.writes().map(requestIdOf)).size).toBe(4);
    expect(h.store.getState().queued).toEqual([]);
    expect(h.stored('A2')).toMatchObject({ notes: 'a1', revision: 3 });
    expect(h.stored('C').reviewed_at).not.toBeNull();
    expect(h.store.getState().save.kind).toBe('saved');
    expect(h.store.getState().notices.at(-1)).toMatchObject({ tone: 'info', text: 'Sent 4 queued changes.' });
  });

  it('refreshes the snapshot before it sends anything', async () => {
    const h = await setup();
    await h.goOffline();
    await h.store.patch(h.byTitle('A').id, { notes: 'x' });
    h.net.up();
    await h.store.flushQueued();
    const methods = h.net.calls.map((call) => call.method);
    expect(methods.lastIndexOf('snapshot')).toBeLessThan(methods.indexOf('patch'));
    expect(h.store.getState().connection.status).toBe('online');
    expect(noticeTexts(h).at(-1)).toBe('Sent 1 queued change.');
  });

  it('holds a target whose head is conflicting while other targets keep flowing', async () => {
    const h = await setup();
    const [a, b] = [h.byTitle('A'), h.byTitle('B')];
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'mine' });
    await h.store.patch(a.id, { title: 'A2' });
    await h.store.patch(b.id, { notes: 'b1' });
    await h.device.patch(a.id, a.revision, { notes: 'theirs' }, h.otherRid());
    await h.reconnect();
    expect(h.net.writes().map((call) => String(call.args[0]))).toEqual([b.id]);
    expect(h.store.getState().queued.map((q) => q.state)).toEqual(['conflict', 'queued']);
    // Nothing more happens until the user resolves the head.
    await h.store.poll();
    await h.store.flushQueued();
    expect(h.net.writes()).toHaveLength(1);
    expect(h.stored('A').title).toBe('A');
  });

  it('is single-flight: a second call joins the flush in progress', async () => {
    const h = await setup();
    await h.goOffline();
    await h.store.patch(h.byTitle('A').id, { notes: 'a' });
    await h.store.patch(h.byTitle('B').id, { notes: 'b' });
    h.net.up();
    const snapshots = () => h.net.calls.filter((call) => call.method === 'snapshot').length;
    const before = snapshots();
    const first = h.store.flushQueued();
    const second = h.store.flushQueued();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(snapshots()).toBe(before + 1);
    expect(h.net.writes()).toHaveLength(2);
    expect(h.store.getState().queued).toEqual([]);
    // A later flush is a new one.
    await h.store.flushQueued();
    expect(snapshots()).toBe(before + 2);
  });

  it('stops when the snapshot cannot be read: still offline, nothing sent', async () => {
    const h = await setup();
    await h.goOffline('refused');
    await h.store.patch(h.byTitle('A').id, { notes: 'x' });
    await h.store.flushQueued();
    expect(h.net.writes()).toEqual([]);
    expect(h.store.getState().queued).toHaveLength(1);
    expect(h.store.getState().connection).toMatchObject({ status: 'offline', reason: 'refused' });
  });

  it('flushes after the first successful read that ends an offline period: poll and load await it', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'via poll' });
    await h.reconnect();
    expect(h.stored('A').notes).toBe('via poll');
    await h.goOffline();
    await h.store.patch(a.id, { title: 'A via load' });
    h.net.up();
    await h.store.load();
    expect(h.stored('A via load')).toBeDefined();
    expect(h.store.getState().queued).toEqual([]);
  });

  it('does not flush on a poll that was never offline', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'x' });
    await h.reconnect();
    const writes = h.net.writes().length;
    await h.store.poll();
    await h.store.poll();
    expect(h.net.writes()).toHaveLength(writes);
  });

  it('wakes the queue when a write that cannot be queued answers after an offline period', async () => {
    const h = await setup();
    await h.goOffline();
    await h.store.patch(h.byTitle('A').id, { notes: 'queued' });
    h.net.up();
    expect(await h.store.create({ title: 'Fresh' })).toMatchObject({ status: 'saved' });
    await vi.waitFor(() => expect(h.store.getState().queued).toEqual([]));
    expect(h.stored('A').notes).toBe('queued');
  });

  it('sends each write inside its target chain: a write made during a send waits behind it', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'a1' });
    const hold = h.net.hold('patch');
    h.net.up();
    const flush = h.store.poll();
    await hold.reached;
    let done = false;
    const second = h.store.patch(a.id, { title: 'A2' }).then((outcome) => {
      done = true;
      return outcome;
    });
    await settled();
    expect(done).toBe(false);
    hold.release();
    await flush;
    expect(await second).toMatchObject({ status: 'saved' });
    expect(h.net.writes().map((call) => call.args[2])).toEqual([{ notes: 'a1' }, { title: 'A2' }]);
    expect(h.stored('A2').notes).toBe('a1');
  });

  it('announces the sent changes once, singular or plural, and nothing when nothing was sent', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'one' });
    await h.reconnect();
    expect(noticeTexts(h).filter((text) => text.startsWith('Sent'))).toEqual(['Sent 1 queued change.']);
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'one' }); // already what the Planner holds: dropped as done
    await h.reconnect();
    expect(noticeTexts(h).filter((text) => text.startsWith('Sent'))).toEqual(['Sent 1 queued change.']);
  });
});

describe('compare and swap: patch', () => {
  it('rebases onto the current revision when the Planner changed other fields', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'mine' });
    await h.device.patch(a.id, a.revision, { priority: 'high' }, h.otherRid());
    await h.reconnect();
    expect(h.net.writes()[0]!.args.slice(0, 3)).toEqual([a.id, 2, { notes: 'mine' }]);
    expect(h.stored('A')).toMatchObject({ notes: 'mine', priority: 'high', revision: 3 });
    expect(h.store.getState().queued).toEqual([]);
  });

  it('conflicts when the Planner changed a patched field to another value: nothing is sent', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'mine' });
    await h.device.patch(a.id, a.revision, { notes: 'theirs' }, h.otherRid());
    await h.reconnect();
    const [entry] = h.store.getState().queued;
    expect(entry).toMatchObject({ state: 'conflict', conflict: { fields: ['notes'], current: { id: a.id, notes: 'theirs', revision: 2 } } });
    expect(entry!.conflict!.settings).toBeUndefined();
    expect(h.net.writes()).toEqual([]);
    expect(h.stored('A').notes).toBe('theirs');
    expect(h.store.getState().notices.filter((n) => n.tone === 'warning').at(-1)!.text).toContain('“A”');
  });

  it('names only the clashing field of a two-field patch', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'mine', priority: 'high' });
    await h.device.patch(a.id, a.revision, { notes: 'theirs' }, h.otherRid());
    await h.reconnect();
    expect(conflictsOf(h)[0]!.conflict!.fields).toEqual(['notes']);
    expect(h.net.writes()).toEqual([]);
  });

  it('drops the entry as done when the Planner already holds every patched field as mine', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'same', priority: 'high' });
    await h.device.patch(a.id, a.revision, { notes: 'same', priority: 'high' }, h.otherRid());
    await h.reconnect();
    expect(h.net.writes()).toEqual([]);
    expect(h.store.getState().queued).toEqual([]);
    expect(noticeTexts(h).some((text) => text.startsWith('Sent'))).toBe(false);
  });

  it('still sends when only some patched fields already equal mine', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'same', priority: 'high' });
    await h.device.patch(a.id, a.revision, { notes: 'same' }, h.otherRid());
    await h.reconnect();
    expect(h.net.writes()[0]!.args.slice(0, 3)).toEqual([a.id, 2, { notes: 'same', priority: 'high' }]);
    expect(h.stored('A')).toMatchObject({ notes: 'same', priority: 'high' });
  });
});

describe('compare and swap: move, archive, review', () => {
  it('conflicts a move when the Planner moved the item to another status', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.move(a.id, 'done', { place: 'top' });
    await h.device.move(a.id, a.revision, 'active', { place: 'top' }, h.otherRid());
    await h.reconnect();
    expect(conflictsOf(h)[0]).toMatchObject({ conflict: { fields: ['status'], current: { status: 'active' } } });
    expect(h.net.writes()).toEqual([]);
  });

  it('sends a move when the Planner already moved the item to my status, keeping the recorded anchor', async () => {
    const h = await setup();
    const [a, b] = [h.byTitle('A'), h.byTitle('B')];
    await h.goOffline();
    await h.store.move(a.id, 'done', { place: 'top' });
    await h.device.move(a.id, a.revision, 'done', { place: 'bottom' }, h.otherRid());
    await h.device.move(b.id, b.revision, 'done', { place: 'bottom' }, h.otherRid());
    await h.reconnect();
    expect(h.net.writes()[0]!.args.slice(0, 4)).toEqual([a.id, 2, 'done', { place: 'top' }]);
    expect(h.stored('A').status).toBe('done');
    expect(h.store.getState().queued).toEqual([]);
  });

  it('conflicts a move when the Planner archived the item, or restored it', async () => {
    const h = await setup();
    const [a, b] = [h.byTitle('A'), h.byTitle('B')];
    await h.device.setArchived(b.id, b.revision, true, h.otherRid());
    await h.store.load(); // the board now shows B archived
    await h.goOffline();
    await h.store.move(a.id, 'done', { place: 'top' });
    await h.store.move(b.id, 'done', { place: 'top' });
    await h.device.setArchived(a.id, a.revision, true, h.otherRid());
    await h.device.setArchived(b.id, b.revision + 1, false, h.otherRid());
    await h.reconnect();
    expect(conflictsOf(h).map((q) => [q.write.op === 'move' ? q.write.id : '', q.conflict!.fields])).toEqual([[a.id, ['archived']], [b.id, ['archived']]]);
    expect(h.net.writes()).toEqual([]);
  });

  it('names both status and archived when the Planner changed both', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.move(a.id, 'done', { place: 'top' });
    await h.device.move(a.id, a.revision, 'active', { place: 'top' }, h.otherRid());
    await h.device.setArchived(a.id, a.revision + 1, true, h.otherRid());
    await h.reconnect();
    expect(conflictsOf(h)[0]!.conflict!.fields).toEqual(['status', 'archived']);
  });

  it('rebases a move when the Planner changed other fields', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.move(a.id, 'done', { place: 'top' });
    await h.device.patch(a.id, a.revision, { notes: 'theirs' }, h.otherRid());
    await h.reconnect();
    expect(h.net.writes()[0]!.args.slice(0, 4)).toEqual([a.id, 2, 'done', { place: 'top' }]);
    expect(h.stored('A')).toMatchObject({ status: 'done', notes: 'theirs' });
  });

  it('drops an archive or restore the Planner already made, and rebases otherwise', async () => {
    const h = await setup();
    const [a, b, c] = [h.byTitle('A'), h.byTitle('B'), h.byTitle('C')];
    await h.device.setArchived(c.id, c.revision, true, h.otherRid());
    await h.store.load();
    await h.goOffline();
    await h.store.setArchived(a.id, true);
    await h.store.setArchived(b.id, true);
    await h.store.setArchived(c.id, false);
    await h.device.setArchived(a.id, a.revision, true, h.otherRid()); // already archived: done
    await h.device.patch(b.id, b.revision, { title: 'B, renamed' }, h.otherRid()); // another field: rebase
    await h.device.setArchived(c.id, c.revision + 1, false, h.otherRid()); // already restored: done
    await h.reconnect();
    expect(h.net.writes().map((call) => call.args.slice(0, 3))).toEqual([[b.id, 2, true]]);
    expect(h.stored('A').archived_at).not.toBeNull();
    expect(h.stored('B, renamed').archived_at).not.toBeNull();
    expect(h.stored('C').archived_at).toBeNull();
    expect(h.store.getState().queued).toEqual([]);
  });

  it('rebases a review mark onto the current revision', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.markReviewed(a.id);
    await h.device.patch(a.id, a.revision, { notes: 'theirs' }, h.otherRid());
    await h.reconnect();
    expect(h.net.writes()[0]!.args.slice(0, 2)).toEqual([a.id, 2]);
    expect(h.stored('A')).toMatchObject({ notes: 'theirs' });
    expect(h.stored('A').reviewed_at).not.toBeNull();
  });

  it('rejects a write whose item is missing from the snapshot as not_found', async () => {
    const hidden = new Set<string>();
    const wrap = (port: PlannerPort): PlannerPort => ({
      ...port,
      snapshot: async () => {
        const snapshot = await port.snapshot();
        return { ...snapshot, items: snapshot.items.filter((item) => !hidden.has(item.id)) };
      },
    });
    const h = await setup({ wrap });
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'x' });
    hidden.add(a.id);
    await h.reconnect();
    expect(h.store.getState().queued[0]).toMatchObject({ state: 'rejected', error: { kind: 'not_found' } });
    expect(h.net.writes()).toEqual([]);
    expect(noticeTexts(h).at(-1)).toMatch(/no longer in the Planner/u);
  });
});

describe('compare and swap: settings', () => {
  const settings = (h: Harness) => h.store.getState().confirmed!.settings;
  const change = (h: Harness, patch: Partial<Settings>) => h.device.updateSettings(patch as Settings, h.otherRid());

  it('sends the current settings with only my changed keys applied', async () => {
    const h = await setup();
    const base = settings(h);
    await h.goOffline();
    await h.store.updateSettings({ ...base, default_tz: 'Europe/Berlin' });
    await change(h, { stale_days: 14 });
    await h.reconnect();
    expect(h.net.writes()[0]!.args[0]).toEqual({ default_tz: 'Europe/Berlin', week_start: 'sun', stale_days: 14 });
    expect((await h.device.snapshot()).settings).toEqual({ default_tz: 'Europe/Berlin', week_start: 'sun', stale_days: 14 });
    expect(h.store.getState().queued).toEqual([]);
  });

  it('conflicts on a key the Planner also changed to another value, naming the keys and the current settings', async () => {
    const h = await setup();
    const base = settings(h);
    await h.goOffline();
    await h.store.updateSettings({ ...base, default_tz: 'Europe/Berlin', stale_days: 30 });
    await change(h, { default_tz: 'Europe/Paris' });
    await h.reconnect();
    const [entry] = h.store.getState().queued;
    expect(entry).toMatchObject({
      state: 'conflict',
      conflict: { fields: ['default_tz'], current: null, settings: { default_tz: 'Europe/Paris', week_start: 'sun', stale_days: 21 } },
    });
    expect(h.net.writes()).toEqual([]);
    expect(noticeTexts(h).at(-1)).toContain('Planner settings');
  });

  it('drops the entry when the Planner already holds my values, or when I changed nothing', async () => {
    const h = await setup();
    const base = settings(h);
    await h.goOffline();
    await h.store.updateSettings({ ...base, default_tz: 'Europe/Berlin' });
    await change(h, { default_tz: 'Europe/Berlin' });
    await h.reconnect();
    expect(h.net.writes()).toEqual([]);
    expect(h.store.getState().queued).toEqual([]);
    await h.goOffline();
    await h.store.updateSettings({ ...settings(h) });
    expect(h.store.getState().queued).toHaveLength(1);
    await h.reconnect();
    expect(h.net.writes()).toEqual([]);
    expect(h.store.getState().queued).toEqual([]);
  });

  it('queues settings behind settings, and compares the second against what the first left', async () => {
    const h = await setup();
    const base = settings(h);
    await h.goOffline();
    await h.store.updateSettings({ ...base, week_start: 'mon' });
    await h.store.updateSettings({ ...base, stale_days: 7 });
    await h.reconnect();
    expect(h.net.writes().map((call) => call.args[0])).toEqual([
      { default_tz: 'America/New_York', week_start: 'mon', stale_days: 21 },
      { default_tz: 'America/New_York', week_start: 'mon', stale_days: 7 },
    ]);
  });
});

describe('each answer to a queued send', () => {
  it('saved: removes the entry, absorbs the result and makes no undo entry', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'x' });
    await h.reconnect();
    expect(h.store.getState().queued).toEqual([]);
    expect(h.byTitle('A')).toMatchObject({ notes: 'x', revision: 2 });
    expect(h.store.getState().undo).toEqual([]);
    expect(h.store.getState().save.kind).toBe('saved');
  });

  it('unknown: leaves the queue, becomes an unconfirmed write with its intent, is never re-sent, and the flush goes on', async () => {
    const h = await setup({ recovery: true });
    const [a, b] = [h.byTitle('A'), h.byTitle('B')];
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'lost answer' });
    await h.store.patch(b.id, { notes: 'fine' });
    h.net.up();
    h.faults.next('lose-response');
    await h.store.poll();
    const { queued, unconfirmed } = h.store.getState();
    expect(queued).toEqual([]);
    expect(unconfirmed).toEqual([expect.objectContaining({ state: 'unconfirmed', write: { op: 'patch', id: a.id, revision: 1, patch: { notes: 'lost answer' } }, possiblySavedIds: [] })]);
    const sentId = requestIdOf(h.net.writes()[0]!);
    expect(unconfirmed[0]!.requestId).toBe(sentId);
    expect(h.stub.held.has(sentId)).toBe(true);
    expect(h.net.writes()).toHaveLength(2); // the second target was still sent
    await h.store.poll();
    await h.store.flushQueued();
    await h.store.reconcile();
    expect(h.net.writes()).toHaveLength(2);
    expect(h.store.getState().save.kind).toBe('unconfirmed');
    expect(noticeTexts(h).filter((text) => text.startsWith('Sent'))).toEqual(['Sent 1 queued change.']);
  });

  it('unavailable: goes back to queued under the id it was sent with, goes offline, stops the flush, never reuses an id', async () => {
    const h = await setup();
    const [a, b] = [h.byTitle('A'), h.byTitle('B')];
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'a' });
    await h.store.patch(b.id, { notes: 'b' });
    const reserved = h.store.getState().queued.map((q) => q.requestId);
    h.net.up();
    h.net.failNext('patch', { kind: 'unavailable', reason: 'server_error' });
    await h.store.poll();
    const sentId = requestIdOf(h.net.writes()[0]!);
    expect(h.net.writes()).toHaveLength(1);
    expect(h.store.getState().queued.map((q) => q.state)).toEqual(['queued', 'queued']);
    expect(h.store.getState().queued[0]!.requestId).toBe(sentId);
    expect(sentId).not.toBe(reserved[0]);
    expect(h.store.getState().connection).toMatchObject({ status: 'offline', reason: 'server_error' });
    expect(noticeTexts(h).some((text) => text.startsWith('Sent'))).toBe(false);
    await h.reconnect();
    expect(h.store.getState().queued).toEqual([]);
    const ids = h.net.writes().map(requestIdOf);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it('revision_conflict: takes the current item, runs the swap again once, and sends with a new request id', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'mine' });
    h.net.up();
    h.net.before('patch', async () => {
      await h.device.patch(a.id, a.revision, { priority: 'high' }, h.otherRid());
    });
    await h.store.poll();
    const patches = h.net.writes();
    expect(patches.map((call) => call.args[1])).toEqual([1, 2]);
    expect(new Set(patches.map(requestIdOf)).size).toBe(2);
    expect(h.stored('A')).toMatchObject({ notes: 'mine', priority: 'high' });
    expect(h.store.getState().queued).toEqual([]);
    expect(h.store.getState().conflicts).toEqual([]);
  });

  it('revision_conflict: becomes a conflict when the swap no longer passes, sending nothing more', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'mine' });
    h.net.up();
    h.net.before('patch', async () => {
      await h.device.patch(a.id, a.revision, { notes: 'theirs' }, h.otherRid());
    });
    await h.store.poll();
    expect(h.net.writes()).toHaveLength(1);
    expect(h.store.getState().queued[0]).toMatchObject({ state: 'conflict', conflict: { fields: ['notes'], current: { notes: 'theirs', revision: 2 } } });
  });

  it('revision_conflict: a second one in a row becomes a conflict rather than another send', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'mine' });
    h.net.up();
    h.net.before('patch', async () => {
      await h.device.patch(a.id, a.revision, { priority: 'high' }, h.otherRid());
      h.net.before('patch', async () => {
        await h.device.patch(a.id, 2, { priority: 'low' }, h.otherRid());
      });
    });
    await h.store.poll();
    expect(h.net.writes()).toHaveLength(2);
    expect(h.store.getState().queued[0]).toMatchObject({ state: 'conflict', conflict: { fields: ['notes'], current: { priority: 'low', revision: 3 } } });
    expect(h.stored('A').notes).toBe('');
  });

  it('order_conflict: rejected with the error, and the board is refreshed', async () => {
    const h = await setup();
    const [a, b] = [h.byTitle('A'), h.byTitle('B')];
    await h.goOffline();
    await h.store.move(a.id, 'next', { after_id: b.id });
    await h.device.move(b.id, b.revision, 'done', { place: 'top' }, h.otherRid());
    await h.reconnect();
    expect(h.store.getState().queued[0]).toMatchObject({ state: 'rejected', error: { kind: 'order_conflict' } });
    const methods = h.net.calls.map((call) => call.method);
    expect(methods.lastIndexOf('snapshot')).toBeGreaterThan(methods.indexOf('move'));
    expect(h.store.getState().connection.status).toBe('online');
  });

  it.each<[string, PlannerError]>([
    ['invalid', { kind: 'invalid', errors: [{ field: 'notes', message: 'Too long.' }] }],
    ['not_found', { kind: 'not_found' }],
  ])('%s: rejected with the Planner error, and the rest of the queue goes on', async (_name, error) => {
    const h = await setup();
    const [a, b] = [h.byTitle('A'), h.byTitle('B')];
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'a' });
    await h.store.patch(b.id, { notes: 'b' });
    h.net.up();
    h.net.failNext('patch', error);
    await h.store.poll();
    expect(h.store.getState().queued).toEqual([expect.objectContaining({ state: 'rejected', error, write: expect.objectContaining({ id: a.id }) })]);
    expect(h.stored('B').notes).toBe('b');
    expect(noticeTexts(h).filter((text) => text.startsWith('Sent'))).toEqual(['Sent 1 queued change.']);
  });

  it('request_id_reused: holds the store as today, rejects the entry and stops the flush', async () => {
    const h = await setup();
    const [a, b] = [h.byTitle('A'), h.byTitle('B')];
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'a' });
    await h.store.patch(b.id, { notes: 'b' });
    h.net.up();
    h.net.failNext('patch', { kind: 'request_id_reused' });
    await h.store.poll();
    const sentId = requestIdOf(h.net.writes()[0]!);
    expect(h.store.getState().held).toMatchObject({ requestId: sentId });
    expect(h.store.getState().queued.map((q) => q.state)).toEqual(['rejected', 'queued']);
    expect(h.net.writes()).toHaveLength(1);
    // Discarding the rejected write releases the hold it caused.
    h.store.discardQueued(h.store.getState().queued[0]!.queueId);
    expect(h.store.getState().held).toBeNull();
  });
});

describe('resolving queued writes', () => {
  async function conflicting(h: Harness) {
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'mine' });
    await h.device.patch(a.id, a.revision, { notes: 'theirs' }, h.otherRid());
    await h.reconnect();
    return { a, entry: h.store.getState().queued[0]! };
  }

  it('keep mine: rebases onto the Planner version, sends it and returns that entry outcome', async () => {
    const h = await setup();
    const { a, entry } = await conflicting(h);
    const outcome = await h.store.resolveQueued(entry.queueId, 'keep_mine');
    expect(outcome).toMatchObject({ status: 'saved', result: { item: { id: a.id, notes: 'mine', revision: 3 } } });
    expect(h.net.writes()[0]!.args.slice(0, 3)).toEqual([a.id, 2, { notes: 'mine' }]);
    expect(h.stored('A').notes).toBe('mine');
    expect(h.store.getState().queued).toEqual([]);
  });

  it('keep mine while offline: queued again on the Planner version, nothing sent, null', async () => {
    const h = await setup();
    const { entry } = await conflicting(h);
    await h.goOffline();
    expect(await h.store.resolveQueued(entry.queueId, 'keep_mine')).toBeNull();
    const [kept] = h.store.getState().queued;
    expect(kept).toMatchObject({ queueId: entry.queueId, state: 'queued', base: { notes: 'theirs', revision: 2 } });
    expect(kept!.conflict).toBeUndefined();
    expect(h.net.writes()).toEqual([]);
    await h.reconnect();
    expect(h.stored('A').notes).toBe('mine');
  });

  it('keep mine is compared again: a Planner that changed once more is a new conflict', async () => {
    const h = await setup();
    const { a, entry } = await conflicting(h);
    await h.device.patch(a.id, 2, { notes: 'theirs, again' }, h.otherRid());
    expect(await h.store.resolveQueued(entry.queueId, 'keep_mine')).toBeNull();
    expect(h.store.getState().queued[0]).toMatchObject({ state: 'conflict', conflict: { current: { notes: 'theirs, again' } } });
    expect(h.net.writes()).toEqual([]);
  });

  it('keep mine for settings sends the merged settings and returns the settings outcome', async () => {
    const h = await setup();
    const base = h.store.getState().confirmed!.settings;
    await h.goOffline();
    await h.store.updateSettings({ ...base, default_tz: 'Europe/Berlin' });
    await h.device.updateSettings({ default_tz: 'Europe/Paris' } as Settings, h.otherRid());
    await h.reconnect();
    const [entry] = h.store.getState().queued;
    expect(entry!.state).toBe('conflict');
    const outcome = await h.store.resolveQueued(entry!.queueId, 'keep_mine');
    expect(outcome).toMatchObject({ status: 'saved', result: { settings: { default_tz: 'Europe/Berlin' } } });
  });

  it('keep mine applies only to a conflict', async () => {
    const h = await setup();
    await h.goOffline();
    await h.store.patch(h.byTitle('A').id, { notes: 'queued' });
    const [entry] = h.store.getState().queued;
    const before = h.store.getState().queued;
    expect(await h.store.resolveQueued(entry!.queueId, 'keep_mine')).toBeNull();
    expect(h.store.getState().queued).toEqual(before);
    expect(await h.store.resolveQueued('no-such-entry', 'keep_mine')).toBeNull();
    expect(await h.store.resolveQueued('no-such-entry', 'discard')).toBeNull();
  });

  it('discard removes a queued, conflicting or rejected write and returns null', async () => {
    const h = await setup();
    const [a, b, c] = [h.byTitle('A'), h.byTitle('B'), h.byTitle('C')];
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'queued' });
    await h.store.patch(b.id, { notes: 'rejected' });
    await h.store.patch(c.id, { notes: 'conflicting' });
    await h.device.patch(c.id, c.revision, { notes: 'theirs' }, h.otherRid());
    h.net.up();
    h.net.failNext('patch', { kind: 'not_found' });
    await h.store.poll(); // A is rejected by the stub failure, B sends, C conflicts
    const states = h.store.getState().queued.map((q) => q.state);
    expect(states).toContain('rejected');
    expect(states).toContain('conflict');
    await h.goOffline();
    await h.store.patch(a.id, { title: 'A again' });
    for (const entry of [...h.store.getState().queued]) expect(await h.store.resolveQueued(entry.queueId, 'discard')).toBeNull();
    expect(h.store.getState().queued).toEqual([]);
    expect(h.shown('C').notes).toBe('theirs');
  });

  it('discard of a head sends what was queued behind it, while online', async () => {
    const h = await setup();
    const a = h.byTitle('A');
    await h.goOffline();
    await h.store.patch(a.id, { notes: 'mine' });
    await h.store.patch(a.id, { title: 'A2' });
    await h.device.patch(a.id, a.revision, { notes: 'theirs' }, h.otherRid());
    await h.reconnect();
    expect(h.store.getState().queued.map((q) => q.state)).toEqual(['conflict', 'queued']);
    h.store.discardQueued(h.store.getState().queued[0]!.queueId);
    expect(h.store.getState().queued).toHaveLength(1);
    await vi.waitFor(() => expect(h.store.getState().queued).toEqual([]));
    expect(h.stored('A2')).toMatchObject({ notes: 'theirs' });
  });

  it('discard while offline sends nothing', async () => {
    const h = await setup();
    await h.goOffline();
    await h.store.patch(h.byTitle('A').id, { notes: 'x' });
    await h.store.patch(h.byTitle('A').id, { title: 'y' });
    expect(await h.store.resolveQueued(h.store.getState().queued[0]!.queueId, 'discard')).toBeNull();
    await settled();
    expect(h.store.getState().queued).toHaveLength(1);
    expect(h.net.writes()).toEqual([]);
  });

  it('never discards a write that is being sent', async () => {
    const h = await setup();
    await h.goOffline();
    await h.store.patch(h.byTitle('A').id, { notes: 'x' });
    const hold = h.net.hold('patch');
    h.net.up();
    const flush = h.store.poll();
    await hold.reached;
    const [entry] = h.store.getState().queued;
    expect(entry!.state).toBe('sending');
    h.store.discardQueued(entry!.queueId);
    expect(await h.store.resolveQueued(entry!.queueId, 'discard')).toBeNull();
    expect(h.store.getState().queued).toHaveLength(1);
    hold.release();
    await flush;
    expect(h.store.getState().queued).toEqual([]);
    expect(h.stored('A').notes).toBe('x');
  });
});
