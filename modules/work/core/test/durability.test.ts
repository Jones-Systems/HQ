import { afterEach, describe, expect, it, vi } from 'vitest';
import { DURABLE_SCHEMA, durableDrafts, registerWorkDurability, resetWorkDurability } from '../durability';
import { createFixturePlanner } from '../fixtures/adapter';
import type { Item } from '../types';
import { createWorkStore, DURABLE_SCOPE_NOTE, UNCONFIRMED_SCOPE_NOTE, type QueuedWrite, type WorkStoreOptions } from '../store';
import { clock, counter, gate, memoryPersistence, network, setup, settled, type Harness, type SetupOptions } from './queue-support';

afterEach(() => resetWorkDurability());

const AT = '2026-10-21T15:00:00.000Z';

function queued(write: QueuedWrite['write'], base: QueuedWrite['base'], over: Partial<QueuedWrite> = {}): QueuedWrite {
  return { queueId: crypto.randomUUID(), requestId: `restored-${Math.random().toString(16).slice(2, 10)}`, write, base, queuedAt: AT, state: 'queued', ...over };
}

function unconfirmed(requestId: string, write: QueuedWrite['write'], over: Record<string, unknown> = {}) {
  return { requestId, write, attemptedAt: AT, baseVersion: 3, state: 'unconfirmed', possiblySavedIds: [], intent: null, ...over };
}

const intent = (requestId: string) => ({ v: 1, requestId, sentAfterVersion: 3, call: { route: 'patch', params: { requestId } } });

const document = (parts: { queued?: unknown[]; unconfirmed?: unknown[]; drafts?: unknown[] } = {}) => ({
  schema: DURABLE_SCHEMA, savedAt: AT, queued: [], unconfirmed: [], drafts: [], ...parts,
});

const noticeTexts = (h: Harness) => h.store.getState().notices.map((n) => n.text);
const durable = (h: Harness) => h.store.getState().durable;

/** A store over a persistence, not yet loaded. */
const open = (p: ReturnType<typeof memoryPersistence>, options: SetupOptions = {}) => setup({ load: false, recovery: true, ...options, store: { persistence: p.persistence, ...options.store } });

describe('what the store reports', () => {
  it('is off without a persistence and ok with one, and keeps the notes distinct', async () => {
    const plain = await setup();
    expect(durable(plain)).toBe('off');
    const p = memoryPersistence();
    const h = await open(p);
    expect(durable(h)).toBe('ok');
    expect(DURABLE_SCOPE_NOTE).toBe('Queued and unconfirmed changes are kept on this device until resolved.');
    expect(UNCONFIRMED_SCOPE_NOTE).toBe('Unconfirmed changes are kept for this session only.');
  });

  it('puts the queue on whenever a persistence is in effect', async () => {
    const p = memoryPersistence();
    const h = await open(p, { store: { offlineQueue: undefined } });
    await h.store.load();
    await h.goOffline();
    expect(await h.store.patch(h.byTitle('A').id, { notes: 'kept' })).toMatchObject({ queued: { queueId: expect.any(String) } });
  });

  it('uses the persistence registered for its port, and not after a reset', async () => {
    const p = memoryPersistence();
    const now = clock();
    const fixture = createFixturePlanner({ now });
    await fixture.port.create({ title: 'A' }, 'seed-00000001');
    const net = network(fixture.port);
    registerWorkDurability(net.port, p.persistence);
    const store = createWorkStore(net.port, { now });
    expect(store.getState().durable).toBe('ok');
    await store.load();
    net.down();
    await store.poll();
    await store.patch(store.getState().confirmed!.items[0]!.id, { notes: 'registered' });
    await vi.waitFor(() => expect(p.last()?.queued).toHaveLength(1));
    resetWorkDurability();
    expect(createWorkStore(net.port, { now }).getState().durable).toBe('off');
  });
});

describe('the durable hub', () => {
  it('loads once and waits for the load before the store reads or saves', async () => {
    const p = memoryPersistence();
    const open_ = gate();
    p.control.loadGate = open_.opened;
    const h = await open(p);
    const loading = h.store.load();
    await settled();
    expect(p.control.loads).toBe(1);
    expect(h.net.calls).toEqual([]); // load waits for the restore before its first read
    expect(p.control.started).toBe(0);
    open_.open();
    await loading;
    expect(h.net.calls.map((call) => call.method)).toEqual(['snapshot']);
    await h.store.load();
    await h.store.poll();
    expect(p.control.loads).toBe(1);
  });

  it('saves the whole document after every change to queued or unconfirmed, and only then', async () => {
    const p = memoryPersistence();
    const h = await open(p);
    await h.store.load();
    await h.store.poll();
    await settled();
    expect(p.control.started).toBe(0); // nothing changed
    await h.goOffline();
    await h.store.patch(h.byTitle('A').id, { notes: 'kept' });
    await vi.waitFor(() => expect(p.control.started).toBe(1));
    expect(p.last()).toEqual({ schema: DURABLE_SCHEMA, savedAt: expect.stringMatching(/^2026-/u), queued: [expect.objectContaining({ state: 'queued', write: expect.objectContaining({ op: 'patch' }) })], unconfirmed: [], drafts: [] });
    await h.store.poll(); // no change to the entries
    await settled();
    expect(p.control.started).toBe(1);
    await h.reconnect();
    await vi.waitFor(() => expect(p.last()!.queued).toEqual([]));
    expect(durable(h)).toBe('ok');
  });

  it('coalesces saves: one in flight, then one more with the latest aggregate', async () => {
    const p = memoryPersistence();
    const h = await open(p);
    await h.store.load();
    const a = h.byTitle('A');
    await h.goOffline();
    const release = gate();
    p.control.saveGate = release.opened;
    await h.store.patch(a.id, { notes: '1' });
    await vi.waitFor(() => expect(p.control.started).toBe(1));
    await h.store.patch(a.id, { notes: '2' });
    await h.store.patch(a.id, { notes: '3' });
    await h.store.patch(a.id, { notes: '4' });
    await settled();
    expect(p.control.started).toBe(1);
    release.open();
    await vi.waitFor(() => expect(p.control.started).toBe(2));
    await settled();
    expect(p.control.maxInFlight).toBe(1);
    expect(p.saves).toHaveLength(2);
    expect(p.last()!.queued).toHaveLength(4);
  });

  it('reports a failed save as failed, keeps the entries in memory, and recovers on the next good save', async () => {
    const p = memoryPersistence();
    const h = await open(p);
    await h.store.load();
    const [a, b] = [h.byTitle('A'), h.byTitle('B')];
    await h.goOffline();
    p.control.failSave = true;
    await h.store.patch(a.id, { notes: 'x' });
    await vi.waitFor(() => expect(durable(h)).toBe('failed'));
    expect(h.store.getState().queued).toHaveLength(1);
    p.control.failSave = false;
    await h.store.patch(b.id, { notes: 'y' });
    await vi.waitFor(() => expect(durable(h)).toBe('ok'));
    expect(p.last()!.queued).toHaveLength(2);
  });

  it.each([
    ['a load that rejects', undefined, true],
    ['another schema', { schema: 'something-else/v1', queued: [], unconfirmed: [], drafts: [] }, false],
    ['a wrong shape', { schema: DURABLE_SCHEMA, queued: 'nope', unconfirmed: [], drafts: [] }, false],
    ['a missing list', { schema: DURABLE_SCHEMA, queued: [], unconfirmed: [] }, false],
    ['a non-object', ['queued'], false],
  ])('never saves in a session whose stored document could not be read: %s', async (_name, stored, rejects) => {
    const p = memoryPersistence(stored);
    p.control.failLoad = rejects;
    const h = await open(p);
    await h.store.load();
    expect(durable(h)).toBe('failed');
    await h.goOffline();
    await h.store.patch(h.byTitle('A').id, { notes: 'still kept in memory' });
    await h.store.patch(h.byTitle('B').id, { notes: 'and this' });
    h.faults.next('lose-response');
    await h.store.create({ title: 'Unconfirmed too' });
    await settled();
    expect(p.control.started).toBe(0);
    expect(p.document()).toEqual(stored);
    expect(h.store.getState().queued).toHaveLength(2);
    expect(durable(h)).toBe('failed');
  });

  it.each([[null], [undefined]])('starts empty and saves when the load returns %s', async (stored) => {
    const p = memoryPersistence(stored);
    const h = await open(p);
    await h.store.load();
    expect(durable(h)).toBe('ok');
    expect(noticeTexts(h).some((text) => text.startsWith('Restored'))).toBe(false);
    await h.goOffline();
    await h.store.patch(h.byTitle('A').id, { notes: 'x' });
    await vi.waitFor(() => expect(p.last()!.queued).toHaveLength(1));
  });

  it('waits for the save to settle before it sends a queued write, whether it succeeds or fails', async () => {
    const p = memoryPersistence();
    const h = await open(p);
    await h.store.load();
    await h.goOffline();
    await h.store.patch(h.byTitle('A').id, { notes: 'x' });
    await vi.waitFor(() => expect(p.control.started).toBe(1));
    const release = gate();
    p.control.saveGate = release.opened;
    h.net.up();
    const flush = h.store.poll();
    await vi.waitFor(() => expect(p.control.started).toBe(2));
    await settled();
    expect(h.net.writes()).toEqual([]); // the `sending` state is not on this device yet
    release.open();
    await flush;
    expect(h.net.writes()).toHaveLength(1);
    expect(p.saves.map((doc) => (doc.queued as QueuedWrite[]).map((q) => q.state))).toContainEqual(['sending']);

    p.control.failSave = true;
    await h.goOffline();
    await h.store.patch(h.byTitle('A').id, { notes: 'y' });
    await h.reconnect();
    expect(h.net.writes()).toHaveLength(2); // a failed save does not stop the send
    expect(durable(h)).toBe('failed');
  });

  it('keeps the adapter intent of an unconfirmed write, taken when it became unconfirmed, off the public state', async () => {
    const p = memoryPersistence();
    const h = await open(p);
    await h.store.load();
    h.faults.next('lose-response');
    const outcome = await h.store.patch(h.byTitle('A').id, { notes: 'lost' });
    if (outcome.status !== 'unconfirmed') throw new Error('expected unconfirmed');
    const recorded = h.stub.held.get(outcome.requestId);
    expect(recorded).toBeDefined();
    await vi.waitFor(() => expect(p.last()!.unconfirmed).toHaveLength(1));
    expect(p.last()!.unconfirmed).toEqual([expect.objectContaining({ requestId: outcome.requestId, state: 'unconfirmed', intent: recorded })]);
    expect('intent' in h.store.getState().unconfirmed[0]!).toBe(false);
    h.stub.held.set(outcome.requestId, { ...recorded!, sentAfterVersion: 99 }); // later changes do not rewrite it
    await h.store.reconcile();
    await vi.waitFor(() => expect((p.last()!.unconfirmed as { state: string; intent: unknown }[])[0]).toMatchObject({ state: 'awaiting_decision', intent: recorded }));
  });

  it('stores an unconfirmed write without an intent when the recovery exports none', async () => {
    const p = memoryPersistence();
    const h = await setup({ load: false, store: { persistence: p.persistence } });
    await h.store.load();
    h.faults.next('drop');
    await h.store.create({ title: 'No recovery' });
    await vi.waitFor(() => expect(p.last()!.unconfirmed).toEqual([expect.objectContaining({ intent: null })]));
  });
});

describe('restore', () => {
  /** The stored document for the items of `h`: every state of queued entry and the unconfirmed variants. */
  function everything(h: Harness) {
    const [a, b, c] = ['A', 'B', 'C'].map((title) => h.fixture.control.stored().find((item) => item.title === title)! as Item);
    const settings = { default_tz: 'America/New_York', week_start: 'sun', stale_days: 21 } as const;
    const entries = {
      sending: queued({ op: 'patch', id: a.id, revision: 1, patch: { title: 'A, sending' } }, a, { state: 'sending', requestId: 'sent-before-restart' }),
      queued: queued({ op: 'patch', id: a.id, revision: 1, patch: { notes: 'queued' } }, a),
      conflict: queued({ op: 'patch', id: b.id, revision: 1, patch: { notes: 'mine' } }, b, { state: 'conflict', conflict: { fields: ['notes'], current: { ...b, notes: 'theirs', revision: 2 } } }),
      rejected: queued({ op: 'setArchived', id: c.id, revision: 1, archived: true }, c, { state: 'rejected', error: { kind: 'invalid', errors: [{ field: 'archived', message: 'No.' }] } }),
      settingsConflict: queued({ op: 'updateSettings', settings: { ...settings, stale_days: 30 } }, settings, { state: 'conflict', conflict: { fields: ['stale_days'], current: null, settings: { ...settings, stale_days: 9 } } }),
    };
    const records = {
      plain: unconfirmed('lost-plain', { op: 'patch', id: b.id, revision: 1, patch: { notes: 'lost' } }, { intent: intent('lost-plain') }),
      noIntent: unconfirmed('lost-no-intent', { op: 'create', fields: { title: 'Lost create' } }),
      notApplied: unconfirmed('lost-checked', { op: 'markReviewed', id: c.id, revision: 1 }, { state: 'awaiting_decision', recovery: { kind: 'not_applied', checkedAt: AT }, intent: intent('lost-checked') }),
      held: unconfirmed('lost-held', { op: 'setArchived', id: a.id, revision: 1, archived: true }, { state: 'held', intent: intent('lost-held') }),
      indeterminate: unconfirmed('lost-evicted', { op: 'move', id: c.id, revision: 1, status: 'done', anchor: { place: 'top' } }, { state: 'awaiting_decision', recovery: { kind: 'indeterminate', reason: 'evicted', checkedAt: AT }, intent: intent('lost-evicted') }),
    };
    return { entries, records, ids: { a, b, c } };
  }

  async function restored(options: { planner: 'up' | 'down' } = { planner: 'down' }) {
    const p = memoryPersistence();
    const h = await open(p);
    const stored = everything(h);
    p.set(document({ queued: Object.values(stored.entries), unconfirmed: Object.values(stored.records) }));
    if (options.planner === 'down') h.net.down();
    await h.store.load();
    return { p, h, ...stored };
  }

  it('keeps queued, conflicting and rejected entries as they were, and turns a sending one into an unconfirmed write', async () => {
    const { h, entries } = await restored();
    const { queued: list, unconfirmed: lost } = h.store.getState();
    expect(list).toEqual([entries.queued, entries.conflict, entries.rejected, entries.settingsConflict]);
    const sending = lost.find((u) => u.requestId === 'sent-before-restart');
    expect(sending).toMatchObject({ state: 'unconfirmed', write: entries.sending.write, possiblySavedIds: [] });
    expect(h.stub.held.has('sent-before-restart')).toBe(false);
  });

  it('calls adoptIntent for each unconfirmed write with an intent, and keeps the one without', async () => {
    const { h, records } = await restored();
    expect(h.stub.adopted).toEqual([records.plain.intent, records.notApplied.intent, records.held.intent, records.indeterminate.intent]);
    expect([...h.stub.held.keys()].sort()).toEqual(['lost-checked', 'lost-evicted', 'lost-held', 'lost-plain']);
    const ids = h.store.getState().unconfirmed.map((u) => u.requestId);
    expect(ids).toEqual(expect.arrayContaining(['lost-plain', 'lost-no-intent', 'lost-checked', 'lost-held', 'lost-evicted', 'sent-before-restart']));
  });

  it('keeps an entry whose intent is missing or not adopted, and a Check then reports no_intent', async () => {
    const p = memoryPersistence();
    const h = await open(p);
    const stored = everything(h);
    h.stub.recovery.adoptIntent = () => false; // not adopted
    p.set(document({ unconfirmed: [stored.records.plain, stored.records.noIntent] }));
    h.net.down();
    await h.store.load();
    expect(h.store.getState().unconfirmed.map((u) => u.requestId)).toEqual(['lost-plain', 'lost-no-intent']);
    h.net.up();
    await h.store.checkUnconfirmed('lost-plain');
    await h.store.checkUnconfirmed('lost-no-intent');
    expect(h.store.getState().unconfirmed.map((u) => u.recovery)).toEqual([
      { kind: 'indeterminate', reason: 'no_intent', checkedAt: expect.any(String) },
      { kind: 'indeterminate', reason: 'no_intent', checkedAt: expect.any(String) },
    ]);
    // The stored intent is kept in the next save even though the adapter did not adopt it.
    await h.store.dismissUnconfirmed('lost-no-intent');
    await vi.waitFor(() => expect(p.last()!.unconfirmed).toEqual([expect.objectContaining({ requestId: 'lost-plain', intent: stored.records.plain.intent })]));
  });

  it('does not offer an Apply that the adapter would refuse after a restart', async () => {
    const { h } = await restored();
    const states = Object.fromEntries(h.store.getState().unconfirmed.map((u) => [u.requestId, [u.state, u.recovery?.kind ?? null]]));
    expect(states['lost-checked']).toEqual(['unconfirmed', null]);
    expect(states['lost-held']).toEqual(['unconfirmed', null]);
    expect(states['lost-evicted']).toEqual(['awaiting_decision', 'indeterminate']);
    expect(h.store.canApply('lost-checked')).toBe(false);
    expect(h.store.getState().held).toBeNull();
  });

  it('shows one info notice with the number restored, and sends nothing for an unconfirmed write', async () => {
    const { h } = await restored({ planner: 'up' });
    expect(noticeTexts(h).filter((text) => text.startsWith('Restored'))).toEqual(['Restored 10 changes kept on this device.']);
    expect(h.store.getState().notices.find((n) => n.text.startsWith('Restored'))!.tone).toBe('info');
    const sent = h.net.writes().map((call) => String(call.args[call.args.length - 1]));
    for (const id of ['sent-before-restart', 'lost-plain', 'lost-no-intent', 'lost-checked', 'lost-held', 'lost-evicted']) expect(sent).not.toContain(id);
  });

  it('flushes the restored queued entries once the Planner answers, and not before', async () => {
    const p = memoryPersistence();
    const h = await open(p);
    const a = h.fixture.control.stored().find((item) => item.title === 'A')!;
    p.set(document({ queued: [queued({ op: 'patch', id: a.id, revision: 1, patch: { notes: 'from before the restart' } }, a)] }));
    h.net.down();
    await h.store.load();
    expect(h.store.getState().queued).toHaveLength(1);
    expect(h.store.getState().connection.status).toBe('offline');
    expect(h.net.writes()).toEqual([]);
    await h.reconnect();
    expect(h.store.getState().queued).toEqual([]);
    expect(h.fixture.control.stored().find((item) => item.title === 'A')!.notes).toBe('from before the restart');
    await vi.waitFor(() => expect(p.last()!.queued).toEqual([]));
  });

  it('flushes straight from load when the Planner answers the first read', async () => {
    const p = memoryPersistence();
    const h = await open(p);
    const a = h.fixture.control.stored().find((item) => item.title === 'A')!;
    p.set(document({ queued: [queued({ op: 'patch', id: a.id, revision: 1, patch: { notes: 'sent on load' } }, a)] }));
    await h.store.load();
    expect(h.store.getState().queued).toEqual([]);
    expect(h.fixture.control.stored().find((item) => item.title === 'A')!.notes).toBe('sent on load');
    expect(h.net.calls.filter((call) => call.method === 'snapshot')).toHaveLength(1);
  });

  it('compares a restored entry like any other: a Planner that moved on is a conflict', async () => {
    const p = memoryPersistence();
    const h = await open(p);
    const a = h.fixture.control.stored().find((item) => item.title === 'A')!;
    p.set(document({ queued: [queued({ op: 'patch', id: a.id, revision: 1, patch: { notes: 'mine' } }, a)] }));
    await h.device.patch(a.id, a.revision, { notes: 'theirs' }, h.otherRid());
    await h.store.load();
    expect(h.store.getState().queued[0]).toMatchObject({ state: 'conflict', conflict: { fields: ['notes'] } });
    expect(h.net.writes()).toEqual([]);
  });

  it('drops malformed entries and counts them in one warning', async () => {
    const p = memoryPersistence();
    const h = await open(p);
    const a = h.fixture.control.stored().find((item) => item.title === 'A')!;
    const good = queued({ op: 'patch', id: a.id, revision: 1, patch: { notes: 'good' } }, a);
    p.set(document({
      queued: [
        good, {}, { ...good, queueId: '' }, { ...good, queueId: crypto.randomUUID(), state: 'bogus' },
        { ...good, queueId: crypto.randomUUID(), write: { op: 'create', fields: { title: 'never queued' } } },
        { ...good, queueId: crypto.randomUUID(), state: 'conflict' }, // a conflict without its conflict
        { ...good }, // the same queue id twice
      ],
      unconfirmed: [unconfirmed('lost-ok', { op: 'markReviewed', id: a.id, revision: 1 }), { requestId: 'lost-bad' }, 'junk'],
    }));
    h.net.down();
    await h.store.load();
    expect(h.store.getState().queued).toEqual([good]);
    expect(h.store.getState().unconfirmed.map((u) => u.requestId)).toEqual(['lost-ok']);
    expect(noticeTexts(h).filter((text) => text.startsWith('Ignored'))).toEqual(['Ignored 8 unreadable changes kept on this device.']);
    expect(noticeTexts(h)).toContain('Restored 2 changes kept on this device.');
    expect(h.store.getState().notices.find((n) => n.text.startsWith('Ignored'))!.tone).toBe('warning');
  });

  it('keeps an unusable intent from losing its write', async () => {
    const p = memoryPersistence();
    const h = await open(p);
    const a = h.fixture.control.stored().find((item) => item.title === 'A')!;
    p.set(document({ unconfirmed: [unconfirmed('lost-odd', { op: 'markReviewed', id: a.id, revision: 1 }, { intent: { v: 2, nonsense: true } })] }));
    h.net.down();
    await h.store.load();
    expect(h.store.getState().unconfirmed.map((u) => u.requestId)).toEqual(['lost-odd']);
    expect(h.stub.adopted).toEqual([]);
    expect(noticeTexts(h).some((text) => text.startsWith('Ignored'))).toBe(false);
  });

  it('makes no notice when nothing is stored', async () => {
    const p = memoryPersistence(document());
    const h = await open(p);
    await h.store.load();
    expect(noticeTexts(h)).toEqual([]);
  });

  it('restores a sent write as unconfirmed even though the Planner applied it: it is never re-sent', async () => {
    const p = memoryPersistence();
    const h = await open(p);
    const a = h.fixture.control.stored().find((item) => item.title === 'A')!;
    p.set(document({ queued: [queued({ op: 'patch', id: a.id, revision: 1, patch: { notes: 'applied before the crash' } }, a, { state: 'sending', requestId: 'crashed-send' })] }));
    await h.device.patch(a.id, a.revision, { notes: 'applied before the crash' }, 'crashed-send');
    await h.store.load();
    await h.store.poll();
    await h.store.flushQueued();
    expect(h.net.writes()).toEqual([]);
    expect(h.store.getState().unconfirmed).toEqual([expect.objectContaining({ requestId: 'crashed-send', state: 'unconfirmed' })]);
    expect(h.store.getState().queued).toEqual([]);
    await vi.waitFor(() => expect(p.last()!.unconfirmed).toEqual([expect.objectContaining({ requestId: 'crashed-send', intent: null })]));
    expect(p.last()!.queued).toEqual([]);
  });
});

describe('several stores on one persistence', () => {
  /** A second store on the first harness's Planner connection and persistence. */
  function second(h: Harness, p: ReturnType<typeof memoryPersistence>, options: Partial<WorkStoreOptions> = {}) {
    return createWorkStore(h.net.port, { now: h.now, newRequestId: counter('two-', 8), persistence: p.persistence, ...options });
  }

  it('gives the stored entries to the first store that claims them, and later stores get none', async () => {
    const p = memoryPersistence();
    const h = await open(p);
    const a = h.fixture.control.stored().find((item) => item.title === 'A')!;
    const entry = queued({ op: 'patch', id: a.id, revision: 1, patch: { notes: 'stored' } }, a);
    p.set(document({ queued: [entry], unconfirmed: [unconfirmed('lost-one', { op: 'markReviewed', id: a.id, revision: 1 })] }));
    h.net.down();
    const other = second(h, p);
    await h.store.load();
    await other.load();
    expect(h.store.getState().queued).toEqual([entry]);
    expect(h.store.getState().unconfirmed.map((u) => u.requestId)).toEqual(['lost-one']);
    expect(other.getState().queued).toEqual([]);
    expect(other.getState().unconfirmed).toEqual([]);
    expect(other.getState().notices.some((n) => n.text.startsWith('Restored'))).toBe(false);
  });

  it('saves one document with every store entries, so one store never overwrites another', async () => {
    const p = memoryPersistence();
    const h = await open(p);
    await h.store.load();
    const other = second(h, p);
    await other.load();
    const [a, b] = [h.byTitle('A'), h.byTitle('B')];
    await h.goOffline();
    await other.poll();
    await h.store.patch(a.id, { notes: 'from one' });
    await other.patch(b.id, { notes: 'from two' });
    await vi.waitFor(() => expect(p.last()!.queued).toHaveLength(2));
    expect((p.last()!.queued as QueuedWrite[]).map((q) => q.write.op === 'patch' ? q.write.patch : null)).toEqual([{ notes: 'from one' }, { notes: 'from two' }]);
    await h.reconnect(); // the first store sends its entry; the second's stays
    await vi.waitFor(() => expect(p.last()!.queued).toHaveLength(1));
    expect((p.last()!.queued as QueuedWrite[])[0]!.write).toMatchObject({ patch: { notes: 'from two' } });
    h.faults.next('lose-response');
    await h.store.patch(a.id, { title: 'lost one' });
    await vi.waitFor(() => expect(p.last()!.unconfirmed).toHaveLength(1));
    expect(p.last()!.queued).toHaveLength(1);
  });

  it('keeps stored entries nobody has claimed yet when another store saves first', async () => {
    const p = memoryPersistence();
    const h = await open(p);
    const a = h.fixture.control.stored().find((item) => item.title === 'A')!;
    const entry = queued({ op: 'patch', id: a.id, revision: 1, patch: { notes: 'waiting for its store' } }, a);
    p.set(document({ queued: [entry], drafts: [{ text: 'a draft' }] }));
    h.faults.next('lose-response');
    await h.store.create({ title: 'Unconfirmed before any load' }); // saves without claiming
    await vi.waitFor(() => expect(p.last()!.unconfirmed).toHaveLength(1));
    expect(p.last()!.queued).toEqual([entry]);
    expect(p.last()!.drafts).toEqual([{ text: 'a draft' }]);
    h.net.down();
    await h.store.load(); // now it claims them
    expect(h.store.getState().queued).toEqual([entry]);
    expect(h.store.getState().unconfirmed).toHaveLength(1);
  });
});

describe('the drafts slot', () => {
  it('is absent without a registered persistence', () => {
    expect(durableDrafts(createFixturePlanner().port)).toBeNull();
  });

  it('gives the stored drafts to the first claimant only, and saves them with the queue intact', async () => {
    const p = memoryPersistence();
    const h = await open(p);
    const a = h.fixture.control.stored().find((item) => item.title === 'A')!;
    const entry = queued({ op: 'patch', id: a.id, revision: 1, patch: { notes: 'queued' } }, a);
    p.set(document({ queued: [entry], drafts: [{ id: 'd1', text: 'first' }, { id: 'd2', text: 'second' }] }));
    registerWorkDurability(h.net.port, p.persistence);
    const first = durableDrafts(h.net.port)!;
    const later = durableDrafts(h.net.port)!;
    expect(await first.claim()).toEqual([{ id: 'd1', text: 'first' }, { id: 'd2', text: 'second' }]);
    expect(await later.claim()).toEqual([]);
    first.save([{ id: 'd2', text: 'second, edited' }]);
    await vi.waitFor(() => expect(p.last()!.drafts).toEqual([{ id: 'd2', text: 'second, edited' }]));
    expect(p.last()!.queued).toEqual([entry]); // unclaimed entries are not lost
  });

  it('is not saved before its load settles, and not at all when the stored document is unreadable', async () => {
    const early = memoryPersistence(document({ drafts: [{ id: 'old' }] }));
    const opened = gate();
    early.control.loadGate = opened.opened;
    const port = network(createFixturePlanner().port).port;
    registerWorkDurability(port, early.persistence);
    const slot = durableDrafts(port)!;
    slot.save([{ id: 'new' }]);
    await settled();
    expect(early.control.started).toBe(0);
    opened.open();
    await vi.waitFor(() => expect(early.control.started).toBe(1));
    expect(early.last()!.drafts).toEqual([{ id: 'old' }, { id: 'new' }]);

    const broken = memoryPersistence({ schema: 'other' });
    const other = network(createFixturePlanner().port).port;
    registerWorkDurability(other, broken.persistence);
    const bad = durableDrafts(other)!;
    expect(await bad.claim()).toEqual([]);
    bad.save([{ id: 'x' }]);
    await settled();
    expect(broken.control.started).toBe(0);
    expect(broken.document()).toEqual({ schema: 'other' });
  });
});
