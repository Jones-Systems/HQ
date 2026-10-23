import { describe, expect, it, vi } from 'vitest';
import { createPlannerLive } from '../../live';
import { fixtureTransport } from '../../live/test/support';
import { createFixturePlanner, MAX_REMEMBERED_REQUESTS } from '../fixtures/adapter';
import { withFaults } from '../fixtures/faults';
import { PLANNER_PORT_KEYS, REPLAY_FEATURE, type PlannerPort } from '../port';
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

describe('unknown writes: no automatic retry; Check looks up, Apply is explicit (RW-9)', () => {
  /** The store over the live adapter over the fixture Planner, with the replay-aware recovery. */
  async function liveSetup(options: { replay?: boolean } = {}) {
    const now = clock();
    const fixture = createFixturePlanner({ now, newId: counter('item'), features: options.replay === false ? [] : [REPLAY_FEATURE] });
    const device = fixture.port;
    const otherRid = counter('other-', 8);
    for (const title of ['C', 'B', 'A']) await device.create({ title, status: 'next' }, otherRid());
    const wire = fixtureTransport(fixture);
    const planner = createPlannerLive(wire.transport);
    const store = createWorkStore(planner.port, { now, newRequestId: counter('req-', 8), recovery: planner.recovery });
    await store.load();
    const byTitle = (title: string) => store.getState().confirmed!.items.find((i) => i.title === title)!;
    /** Everything sent for one request ID, in order: its write route, then `replay:<mode>` for each recovery call. */
    const sent = (requestId: string) => wire.calls
      .filter((c) => (c.params as { requestId?: string }).requestId === requestId)
      .map((c) => (c.route === 'replay' ? `replay:${(c.params as { mode: string }).mode}` : c.route));
    const idOf = (outcome: { status: string; requestId?: string }) => (outcome.status === 'unconfirmed' ? outcome.requestId! : '');
    return { fixture, device, otherRid, wire, planner, store, byTitle, sent, idOf, stored: fixture.control.stored };
  }

  it('keeps a lost response unconfirmed; polling never sends it again; Check confirms it by lookup alone', async () => {
    const { store, byTitle, wire, sent, idOf, stored } = await liveSetup();
    wire.next('patch', 'lose-response');
    const requestId = idOf(await store.patch(byTitle('A').id, { notes: 'kept' }));
    expect(saveLabel(store.getState().save, null)).toBe('1 unconfirmed');
    expect(store.getState().items.find((i) => i.title === 'A')!.notes).toBe('kept');
    await store.poll();
    await store.poll();
    expect(sent(requestId)).toEqual(['patch']);
    await store.reconcile();
    expect(sent(requestId)).toEqual(['patch', 'replay:lookup']);
    expect(store.getState().unconfirmed).toEqual([]);
    expect(store.getState().notices.at(-1)!.text).toMatch(/already saved; confirmed/u);
    expect(stored().find((i) => i.title === 'A')!.revision).toBe(2);
  });

  it('a dropped create: Check proves it not applied; only the explicit Apply saves it, once', async () => {
    const { store, sent, idOf, stored, wire } = await liveSetup();
    wire.next('create', 'drop');
    const requestId = idOf(await store.create({ title: 'Seed order' }));
    expect(await store.retryUnconfirmed(requestId)).toBe('refused');
    expect(store.canApply(requestId)).toBe(false);
    expect(sent(requestId)).toEqual(['create']);
    await store.reconcile();
    expect(store.getState().unconfirmed[0]).toMatchObject({ requestId, state: 'awaiting_decision', recovery: { kind: 'not_applied' } });
    expect(store.canApply(requestId)).toBe(true);
    expect(stored().filter((i) => i.title === 'Seed order')).toHaveLength(0);
    expect(await store.retryUnconfirmed(requestId)).toBe('confirmed');
    expect(sent(requestId)).toEqual(['create', 'replay:lookup', 'replay:resend']);
    expect(stored().filter((i) => i.title === 'Seed order')).toHaveLength(1);
    expect(store.getState().notices.at(-1)!.text).toBe('An unconfirmed change is now saved.');
  });

  it('after the record may be evicted, Check is indeterminate: nothing is applied, guessed or stored', async () => {
    const { store, device, otherRid, sent, idOf, stored, wire } = await liveSetup();
    wire.next('create', 'drop');
    const requestId = idOf(await store.create({ title: 'Book the hall' }));
    let item = stored().find((i) => i.title === 'C')!;
    for (let i = 0; i < MAX_REMEMBERED_REQUESTS + 1; i += 1) item = (await device.markReviewed(item.id, item.revision, otherRid())).item!;
    await device.create({ title: 'Book the hall' }, otherRid()); // a look-alike, never proof
    await store.load();
    await store.reconcile();
    const [entry] = store.getState().unconfirmed;
    expect(entry).toMatchObject({ requestId, state: 'awaiting_decision', recovery: { kind: 'indeterminate', reason: 'evicted' } });
    expect(entry!.possiblySavedIds).toHaveLength(1);
    expect(store.canApply(requestId)).toBe(false);
    expect(await store.retryUnconfirmed(requestId)).toBe('refused');
    await store.reconcile();
    expect(sent(requestId)).toEqual(['create', 'replay:lookup']);
    expect(stored().filter((i) => i.title === 'Book the hall')).toHaveLength(1);
  });

  it('without a recovery, Check sends nothing and asks for a read-back', async () => {
    const { store, faults, calls } = await setup();
    faults.next('lose-response');
    const outcome = await store.create({ title: 'Oil the gate' });
    const requestId = outcome.status === 'unconfirmed' ? outcome.requestId : '';
    await store.reconcile();
    expect(store.getState().unconfirmed[0]).toMatchObject({ requestId, state: 'awaiting_decision', recovery: { kind: 'indeterminate', reason: 'unsupported' } });
    expect(store.canApply(requestId)).toBe(false);
    expect(await store.retryUnconfirmed(requestId)).toBe('refused');
    expect(writesFor(calls, requestId)).toHaveLength(1);
  });

  it('on a Planner without requests.replay, Check sends nothing', async () => {
    const { store, wire, sent, idOf } = await liveSetup({ replay: false });
    wire.next('create', 'lose-response');
    const requestId = idOf(await store.create({ title: 'Old service' }));
    await store.reconcile();
    expect(store.getState().unconfirmed[0]!.recovery).toMatchObject({ kind: 'indeterminate', reason: 'unsupported' });
    expect(sent(requestId)).toEqual(['create']);
  });

  it('holds the queue on request_id_reused and checks nothing after it', async () => {
    const { store, byTitle, device, wire, sent, idOf } = await liveSetup();
    wire.next('patch', 'drop');
    const heldId = idOf(await store.patch(byTitle('A').id, { notes: 'one' }));
    wire.next('patch', 'drop');
    const laterId = idOf(await store.patch(byTitle('B').id, { notes: 'two' }));
    const c = byTitle('C');
    await device.markReviewed(c.id, c.revision, heldId); // a defective client reused the ID
    await store.reconcile();
    expect(store.getState().held).toMatchObject({ requestId: heldId });
    expect(store.getState().unconfirmed.map((u) => u.state)).toEqual(['held', 'unconfirmed']);
    await store.reconcile();
    expect(sent(laterId)).toEqual(['patch']);
    store.dismissUnconfirmed(heldId);
    expect(store.getState().held).toBeNull();
    await store.reconcile();
    expect(sent(laterId)).toEqual(['patch', 'replay:lookup']);
  });

  it('shows an Apply the Planner refuses truthfully, as not applied', async () => {
    const { store, byTitle, device, otherRid, wire, idOf } = await liveSetup();
    wire.next('patch', 'drop');
    const requestId = idOf(await store.patch(byTitle('A').id, { notes: 'mine' }));
    await store.reconcile();
    const a = byTitle('A');
    await device.patch(a.id, a.revision, { notes: 'theirs' }, otherRid());
    expect(await store.retryUnconfirmed(requestId)).toBe('resolved');
    expect(store.getState().unconfirmed).toEqual([]);
    expect(store.getState().conflicts[0]!.current.notes).toBe('theirs');
    expect(store.getState().notices.at(-1)!.text).toMatch(/was not applied: the item changed since/u);
  });

  it('an Apply whose answer is lost is unconfirmed again, and Apply needs a fresh Check', async () => {
    const { store, wire, sent, idOf, stored } = await liveSetup();
    wire.next('create', 'drop');
    const requestId = idOf(await store.create({ title: 'Lost twice' }));
    await store.reconcile();
    wire.next('replay', 'lose-response');
    expect(await store.retryUnconfirmed(requestId)).toBe('still_unknown');
    const [entry] = store.getState().unconfirmed;
    expect(entry!.state).toBe('unconfirmed');
    expect(entry!.recovery).toBeUndefined();
    expect(store.canApply(requestId)).toBe(false);
    await store.reconcile();
    expect(store.getState().unconfirmed).toEqual([]);
    expect(sent(requestId)).toEqual(['create', 'replay:lookup', 'replay:resend', 'replay:lookup']);
    expect(stored().filter((i) => i.title === 'Lost twice')).toHaveLength(1);
  });

  it('a Check or Apply that cannot reach the Planner withdraws Apply: nothing is offered that the adapter would refuse', async () => {
    const { store, wire, sent, idOf, stored } = await liveSetup();
    wire.next('create', 'drop');
    const requestId = idOf(await store.create({ title: 'Recheck offline' }));
    await store.reconcile();
    expect(store.canApply(requestId)).toBe(true);
    // A second Check that cannot reach the Planner consumes the adapter's Apply authorization.
    wire.next('replay', 'unavailable');
    expect(await store.checkUnconfirmed(requestId)).toBe('stopped');
    expect(store.getState().unconfirmed[0]).toMatchObject({ requestId, state: 'unconfirmed' });
    expect(store.getState().unconfirmed[0]!.recovery).toBeUndefined();
    expect(store.canApply(requestId)).toBe(false);
    expect(await store.retryUnconfirmed(requestId)).toBe('refused');
    // An Apply that cannot reach the Planner also needs a fresh Check.
    await store.reconcile();
    expect(store.canApply(requestId)).toBe(true);
    wire.next('replay', 'unavailable');
    expect(await store.retryUnconfirmed(requestId)).toBe('stopped');
    expect(store.canApply(requestId)).toBe(false);
    expect(store.getState().unconfirmed[0]!.recovery).toBeUndefined();
    await store.reconcile();
    expect(await store.retryUnconfirmed(requestId)).toBe('confirmed');
    expect(sent(requestId)).toEqual(['create', 'replay:lookup', 'replay:lookup', 'replay:lookup', 'replay:resend', 'replay:lookup', 'replay:resend']);
    expect(stored().filter((i) => i.title === 'Recheck offline')).toHaveLength(1);
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
});

describe('a confirmed write whose read-back fails', () => {
  it('stays saved, is never re-sent, and the next poll refreshes even at the same version', async () => {
    const now = clock();
    const fixture = createFixturePlanner({ now, newId: counter('item'), features: [REPLAY_FEATURE] });
    const seedRid = counter('seed-', 8);
    for (const title of ['C', 'B', 'A']) await fixture.port.create({ title, status: 'next' }, seedRid());
    const wire = fixtureTransport(fixture);
    const planner = createPlannerLive(wire.transport);
    const store = createWorkStore(planner.port, { now, newRequestId: counter('req-', 8), recovery: planner.recovery });
    await store.load();
    const c = store.getState().confirmed!.items.find((i) => i.title === 'C')!;
    wire.next('state', 'unavailable'); // the adapter's read-back
    wire.next('state', 'unavailable'); // the store's own refresh straight after
    const outcome = await store.move(c.id, 'next', { place: 'top' });
    expect(outcome.status).toBe('saved');
    await Promise.resolve();
    expect(store.getState().unconfirmed).toEqual([]);
    expect(store.getState().refreshDue).toBe(true);
    expect(wire.calls.filter((call) => call.route === 'move')).toHaveLength(1);
    await store.poll();
    expect(store.getState().refreshDue).toBe(false);
    const positions = new Map(fixture.control.stored().map((i) => [i.id, i.position]));
    for (const item of store.getState().confirmed!.items) expect(item.position).toBe(positions.get(item.id));
    expect(order(store, 'next')).toEqual(['C', 'A', 'B']);
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

