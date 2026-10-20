import { describe, expect, it, vi } from 'vitest';
import { createFixturePlanner, MAX_REMEMBERED_REQUESTS } from '../fixtures/adapter';
import { withFaults } from '../fixtures/faults';
import { PLANNER_PORT_KEYS, type PlannerPort } from '../port';
import { createWorkStore, saveLabel, sharedWorkStore, UNDO_LIMIT, type WorkStore } from '../store';

function clock(start = '2026-10-21T16:00:00.000Z') {
  let t = Date.parse(start);
  return () => new Date((t += 1000));
}
function counter(prefix: string, width = 12) {
  let n = 0;
  return () => `${prefix}${String((n += 1)).padStart(width, '0')}`;
}

/** Records every port call with its exact arguments. */
function recording(inner: PlannerPort) {
  const calls: { method: string; args: unknown[] }[] = [];
  const port = Object.fromEntries(PLANNER_PORT_KEYS.map((key) => [key, (...args: unknown[]) => {
    calls.push({ method: key, args: structuredClone(args) });
    return (inner[key] as (...a: unknown[]) => Promise<unknown>)(...args);
  }])) as unknown as PlannerPort;
  return { port, calls };
}

async function setup() {
  const now = clock();
  const fixture = createFixturePlanner({ now, newId: counter('item') });
  const device = fixture.port; // another device writing to the same Planner
  const otherRid = counter('other-', 8);
  for (const title of ['C', 'B', 'A']) await device.create({ title, status: 'next' }, otherRid());
  const faulty = withFaults(fixture.port);
  const rec = recording(faulty.port);
  const store = createWorkStore(rec.port, { now, newRequestId: counter('req-', 8) });
  await store.load();
  const byTitle = (title: string) => store.getState().confirmed!.items.find((i) => i.title === title)!;
  return { ...fixture, stored: fixture.control.stored, device, otherRid, faults: faulty.faults, calls: rec.calls, store, byTitle };
}
const order = (store: WorkStore, status: string) => store.getState().items.filter((i) => i.status === status).sort((a, b) => a.position - b.position).map((i) => i.title);
const writesFor = (calls: { method: string; args: unknown[] }[], requestId: string) => calls.filter((c) => c.args[c.args.length - 1] === requestId);

describe('save states and projection', () => {
  it('shows Saving… while a write is in flight, then Saved · time in the display zone', async () => {
    const { store, byTitle } = await setup();
    expect(store.getState().load).toBe('ready');
    const pending = store.patch(byTitle('A').id, { notes: 'draft' });
    await Promise.resolve();
    expect(store.getState().save.kind).toBe('saving');
    expect(store.getState().items.find((i) => i.title === 'A')!.notes).toBe('draft');
    await pending;
    const { save, confirmed } = store.getState();
    expect(save.kind).toBe('saved');
    expect(saveLabel(save, confirmed!.settings)).toMatch(/^Saved · 12:00 PM EDT$/u);
  });

  it('rolls back an optimistic move on order_conflict and refreshes', async () => {
    const { store, byTitle, device, otherRid } = await setup();
    const b = byTitle('B');
    await device.setArchived(b.id, b.revision, true, otherRid());
    await device.move(b.id, b.revision + 1, 'done', { place: 'top' }, otherRid());
    const outcome = await store.move(byTitle('A').id, 'next', { after_id: b.id });
    expect(outcome).toEqual({ status: 'failed', error: { kind: 'order_conflict' } });
    expect(store.getState().notices.at(-1)!.text).toMatch(/nothing moved/u);
  });

  it('reports a revision conflict truthfully with the current item', async () => {
    const { store, byTitle, device, otherRid } = await setup();
    const a = byTitle('A');
    await device.patch(a.id, a.revision, { notes: 'theirs' }, otherRid());
    const outcome = await store.patch(a.id, { notes: 'mine' });
    expect(outcome).toMatchObject({ status: 'failed', error: { kind: 'revision_conflict', current: { notes: 'theirs' } } });
    expect(store.getState().conflicts).toEqual([expect.objectContaining({ itemId: a.id, current: expect.objectContaining({ notes: 'theirs' }) })]);
    expect(store.getState().items.find((i) => i.id === a.id)!.notes).toBe('theirs');
  });

  it('is Offline · not saving when the Planner is known unreachable, and rolls back', async () => {
    const { store, byTitle, faults } = await setup();
    faults.next('unavailable');
    const outcome = await store.patch(byTitle('A').id, { notes: 'lost?' });
    expect(outcome).toEqual({ status: 'failed', error: { kind: 'unavailable' } });
    expect(saveLabel(store.getState().save, null)).toBe('Offline · not saving');
    expect(store.getState().items.find((i) => i.title === 'A')!.notes).toBe('');
    await store.poll();
    expect(store.getState().save.kind).not.toBe('offline');
  });

  it('sends every status change as a move; a status patch never reaches the port', async () => {
    const { store, byTitle, calls } = await setup();
    const before = calls.length;
    const outcome = await store.patch(byTitle('A').id, { status: 'done' } as never);
    expect(outcome).toEqual({ status: 'failed', error: { kind: 'invalid', errors: [{ field: 'status', message: 'Status changes use move.' }] } });
    expect(calls.length).toBe(before);
    await store.move(byTitle('A').id, 'done', { place: 'top' });
    expect(calls.at(-1)!.method).toBe('move');
  });

  it('validates locally first, mirroring the service messages', async () => {
    const { store, calls } = await setup();
    const before = calls.length;
    expect(await store.create({ title: '' })).toEqual({ status: 'failed', error: { kind: 'invalid', errors: [{ field: 'title', message: 'Required.' }] } });
    expect(calls.length).toBe(before);
  });
});

describe('unknown writes reconcile only by the same request ID and body (RW-9)', () => {
  it('keeps a lost response unconfirmed, then confirms it by replay', async () => {
    const { store, byTitle, faults, calls, stored } = await setup();
    faults.next('lose-response');
    const outcome = await store.patch(byTitle('A').id, { notes: 'kept' });
    expect(outcome.status).toBe('unconfirmed');
    const requestId = outcome.status === 'unconfirmed' ? outcome.requestId : '';
    expect(saveLabel(store.getState().save, null)).toBe('1 unconfirmed');
    expect(store.getState().items.find((i) => i.title === 'A')!.notes).toBe('kept');
    await store.poll();
    const sends = writesFor(calls, requestId);
    expect(sends).toHaveLength(2);
    expect(sends[1]).toEqual(sends[0]);
    expect(store.getState().unconfirmed).toEqual([]);
    expect(store.getState().notices.at(-1)!.text).toMatch(/already saved; confirmed/u);
    expect(stored().find((i) => i.title === 'A')!.revision).toBe(2);
  });

  it('never infers non-existence from an unchanged snapshot; a dropped create is re-sent, not discarded', async () => {
    const { store, faults, calls, stored, control } = await setup();
    faults.next('drop');
    const outcome = await store.create({ title: 'Seed order' });
    const requestId = outcome.status === 'unconfirmed' ? outcome.requestId : '';
    const version = control.stateVersion();
    faults.readsUnavailable(true);
    await store.poll();
    faults.readsUnavailable(false);
    await store.load();
    expect(store.getState().confirmed!.stateVersion).toBe(version);
    expect(store.getState().unconfirmed.map((u) => [u.requestId, u.state])).toEqual([[requestId, 'unconfirmed']]);
    await store.reconcile();
    const sends = writesFor(calls, requestId);
    expect(sends).toHaveLength(2);
    expect(sends[1]).toEqual(sends[0]);
    expect(stored().filter((i) => i.title === 'Seed order')).toHaveLength(1);
    expect(store.getState().unconfirmed).toEqual([]);
  });

  it('a late original after reconciliation replays instead of duplicating', async () => {
    const { store, faults, stored } = await setup();
    faults.next('defer');
    await store.create({ title: 'Late' });
    await store.reconcile();
    const [late] = await faults.deliverDeferred();
    expect(late).toMatchObject({ status: 'fulfilled', value: { replayed: true } });
    expect(stored().filter((i) => i.title === 'Late')).toHaveLength(1);
  });

  it('flags a same-title item as possibly saved, never as proof', async () => {
    const { store, faults, device, otherRid } = await setup();
    faults.next('drop');
    await store.create({ title: 'Water the ferns' });
    faults.readsUnavailable(true);
    await store.poll();
    faults.readsUnavailable(false);
    await device.create({ title: 'Water the ferns' }, otherRid());
    await store.load();
    const [entry] = store.getState().unconfirmed;
    expect(entry!.possiblySavedIds).toHaveLength(1);
    expect(entry!.state).toBe('unconfirmed');
    expect(store.getState().save).toEqual({ kind: 'unconfirmed', count: 1 });
  });

  it('after a possible replay-record expiry, never auto-resends a create; the user decides', async () => {
    const { store, faults, calls, device, otherRid, stored } = await setup();
    faults.next('lose-response');
    const outcome = await store.create({ title: 'Book the hall' });
    const requestId = outcome.status === 'unconfirmed' ? outcome.requestId : '';
    let item = stored().find((i) => i.title === 'C')!;
    for (let i = 0; i < MAX_REMEMBERED_REQUESTS; i += 1) item = (await device.markReviewed(item.id, item.revision, otherRid())).item!;
    await store.poll();
    const [entry] = store.getState().unconfirmed;
    expect(entry).toMatchObject({ requestId, state: 'awaiting_decision' });
    expect(entry!.possiblySavedIds).toHaveLength(1);
    expect(writesFor(calls, requestId)).toHaveLength(1);
    await store.reconcile();
    expect(writesFor(calls, requestId)).toHaveLength(1);
    // The user explicitly re-sends: the expired record no longer protects it.
    expect(await store.retryUnconfirmed(requestId)).toBe('confirmed');
    expect(writesFor(calls, requestId)).toHaveLength(2);
    expect(stored().filter((i) => i.title === 'Book the hall')).toHaveLength(2);
  });

  it('holds the queue on request_id_reused and resends nothing after it', async () => {
    const { store, byTitle, faults, calls, device } = await setup();
    faults.next('drop');
    const first = await store.patch(byTitle('A').id, { notes: 'one' });
    faults.next('drop');
    const second = await store.patch(byTitle('B').id, { notes: 'two' });
    const heldId = first.status === 'unconfirmed' ? first.requestId : '';
    const laterId = second.status === 'unconfirmed' ? second.requestId : '';
    const c = byTitle('C');
    await device.markReviewed(c.id, c.revision, heldId); // a defective client reused the ID
    await store.reconcile();
    expect(store.getState().held).toMatchObject({ requestId: heldId });
    expect(store.getState().unconfirmed.map((u) => u.state)).toEqual(['held', 'unconfirmed']);
    expect(writesFor(calls, laterId)).toHaveLength(1);
    await store.reconcile();
    expect(writesFor(calls, laterId)).toHaveLength(1);
    store.dismissUnconfirmed(heldId);
    expect(store.getState().held).toBeNull();
    await store.reconcile();
    expect(writesFor(calls, laterId)).toHaveLength(2);
  });

  it('shows a conflict on reconciliation truthfully, without claiming the outcome', async () => {
    const { store, byTitle, faults, device, otherRid } = await setup();
    faults.next('drop');
    await store.patch(byTitle('A').id, { notes: 'mine' });
    const a = byTitle('A');
    await device.patch(a.id, a.revision, { notes: 'theirs' }, otherRid());
    await store.reconcile();
    expect(store.getState().unconfirmed).toEqual([]);
    expect(store.getState().conflicts[0]!.current.notes).toBe('theirs');
    expect(store.getState().notices.at(-1)!.text).toMatch(/may or may not include your change/u);
  });
});

describe('undo (RW-7, RW-8)', () => {
  it('restores a move to its exact neighbour anchor', async () => {
    const { store, byTitle } = await setup();
    expect(order(store, 'next')).toEqual(['A', 'B', 'C']);
    await store.move(byTitle('B').id, 'done', { place: 'top' });
    expect(order(store, 'next')).toEqual(['A', 'C']);
    expect(await store.undo()).toEqual({ status: 'undone' });
    await store.load();
    expect(order(store, 'next')).toEqual(['A', 'B', 'C']);
  });

  it('consumes each entry once across the toast action and Ctrl/⌘+Z', async () => {
    const { store, byTitle } = await setup();
    await store.patch(byTitle('A').id, { notes: 'one' });
    const second = await store.patch(byTitle('B').id, { notes: 'two' });
    const toastId = second.status === 'saved' ? second.undoId! : '';
    expect(await store.undo()).toEqual({ status: 'undone' });
    expect(await store.undoEntry(toastId)).toEqual({ status: 'empty' });
    expect(store.getState().undo).toHaveLength(1);
    expect(await store.undo()).toEqual({ status: 'undone' });
    expect(await store.undo()).toEqual({ status: 'empty' });
    expect(store.getState().confirmed!.items.map((i) => i.notes)).toEqual(['', '', '']);
  });

  it('refuses after a concurrent same-field change and keeps the newer value', async () => {
    const { store, byTitle, device, otherRid, control } = await setup();
    await store.patch(byTitle('A').id, { title: 'A, revised' });
    const a = byTitle('A, revised');
    await device.patch(a.id, a.revision, { title: 'A, theirs' }, otherRid());
    const version = control.stateVersion();
    expect(await store.undo()).toEqual({ status: 'refused', message: 'Not undone: Title was changed again since; the newer value was kept.' });
    expect(control.stateVersion()).toBe(version);
    expect(control.stored().find((i) => i.id === a.id)!.title).toBe('A, theirs');
  });

  it('succeeds after a different-field change, preserving it', async () => {
    const { store, byTitle, device, otherRid, control } = await setup();
    await store.patch(byTitle('A').id, { title: 'A, revised' });
    const a = byTitle('A, revised');
    await device.patch(a.id, a.revision, { notes: 'their note' }, otherRid());
    expect(await store.undo()).toEqual({ status: 'undone' });
    expect(control.stored().find((i) => i.id === a.id)).toMatchObject({ title: 'A', notes: 'their note' });
  });

  it('refuses to undo a move after the card moved again', async () => {
    const { store, byTitle, device, otherRid } = await setup();
    await store.move(byTitle('B').id, 'active', { place: 'top' });
    const b = byTitle('B');
    await device.move(b.id, b.revision, 'on_hold', { place: 'top' }, otherRid());
    await store.load();
    expect(await store.undo()).toEqual({ status: 'refused', message: 'Not undone: Status was changed again since; the newer value was kept.' });
  });

  it('undoes a create by archiving it', async () => {
    const { store, control } = await setup();
    await store.create({ title: 'Oops' });
    expect(await store.undo()).toEqual({ status: 'undone' });
    expect(control.stored().find((i) => i.title === 'Oops')!.archived_at).not.toBeNull();
  });

  it('keeps at most 40 entries', async () => {
    const { store, byTitle } = await setup();
    for (let i = 0; i < UNDO_LIMIT + 5; i += 1) await store.patch(byTitle('A').id, { notes: `n${i}` });
    expect(store.getState().undo).toHaveLength(UNDO_LIMIT);
  });
});

describe('save responses arriving out of order', () => {
  it('keeps an older response for another card instead of dropping it', async () => {
    const now = clock();
    const fixture = createFixturePlanner({ now, newId: counter('item') });
    const otherRid = counter('other-', 8);
    for (const title of ['B', 'A']) await fixture.port.create({ title, status: 'next' }, otherRid());
    const faulty = withFaults(fixture.port);
    // Each patch is applied by the Planner at once; its response is held until released.
    const held: (() => void)[] = [];
    const port: PlannerPort = {
      ...faulty.port,
      patch: async (...args: Parameters<PlannerPort['patch']>) => {
        const result = await faulty.port.patch(...args);
        await new Promise<void>((resolve) => held.push(resolve));
        return result;
      },
    };
    const store = createWorkStore(port, { now, newRequestId: counter('req-', 8) });
    await store.load();
    const byTitle = (title: string) => store.getState().confirmed!.items.find((i) => i.title === title)!;
    const start = store.getState().confirmed!.stateVersion;
    // No snapshot can repair the held state behind the store's back.
    faulty.faults.readsUnavailable(true);

    const savingA = store.patch(byTitle('A').id, { notes: 'A notes' });
    await vi.waitFor(() => expect(held).toHaveLength(1));
    const savingB = store.patch(byTitle('B').id, { notes: 'B notes' });
    await vi.waitFor(() => expect(held).toHaveLength(2));
    held[1]!();
    expect(await savingB).toMatchObject({ status: 'saved' });
    held[0]!();
    expect(await savingA).toMatchObject({ status: 'saved' });

    expect(byTitle('A')).toMatchObject({ notes: 'A notes', revision: 2 });
    expect(byTitle('B')).toMatchObject({ notes: 'B notes', revision: 2 });
    expect(store.getState().confirmed!.stateVersion).toBe(start + 2);

    faulty.faults.readsUnavailable(false);
    const again = store.patch(byTitle('A').id, { notes: 'A again' });
    await vi.waitFor(() => expect(held).toHaveLength(3));
    held[2]!();
    expect(await again).toMatchObject({ status: 'saved' });
    expect(byTitle('A')).toMatchObject({ notes: 'A again', revision: 3 });
  });
});

describe('settings', () => {
  it('saves settings and exposes the new display zone and week start', async () => {
    const { store } = await setup();
    const outcome = await store.updateSettings({ default_tz: 'Europe/Berlin', week_start: 'mon', stale_days: 14 });
    expect(outcome).toMatchObject({ status: 'saved', result: { settings: { default_tz: 'Europe/Berlin', week_start: 'mon' } } });
    expect(store.getState().confirmed!.settings).toEqual({ default_tz: 'Europe/Berlin', week_start: 'mon', stale_days: 14 });
    expect(await store.updateSettings({ default_tz: 'Nowhere/Land', week_start: 'mon', stale_days: 14 })).toMatchObject({ status: 'failed', error: { kind: 'invalid' } });
  });
});

describe('module-level state and zero execution', () => {
  it('returns the same store for the session key, so remounts keep queue and undo', async () => {
    const { port } = createFixturePlanner();
    let created = 0;
    const make = () => {
      created += 1;
      return createWorkStore(port);
    };
    const first = sharedWorkStore('test-remount-key', make);
    expect(sharedWorkStore('test-remount-key', make)).toBe(first);
    expect(created).toBe(1);
  });

  it('exposes no execution member', () => {
    const store = createWorkStore(createFixturePlanner().port);
    expect(Object.keys(store).filter((key) => /run|exec|dispatch|launch|job|thread|agent|submit/iu.test(key))).toEqual([]);
  });

  it('makes only Planner API calls for moves, edits and undo', async () => {
    const { store, byTitle, calls } = await setup();
    await store.move(byTitle('A').id, 'active', { place: 'top' });
    await store.undo();
    expect(new Set(calls.map((c) => c.method))).toEqual(new Set(['snapshot', 'move']));
  });
});

