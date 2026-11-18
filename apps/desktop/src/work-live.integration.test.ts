import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServiceResponse } from '@hq/contracts/services';
import { createServices, sendHttp, type HttpCall, type Transport } from '../electron/services';
import { openServiceConfig } from '../electron/service-config';
import { bridgeTransport, createPlannerLive, type PlannerLive } from '../../../modules/work/live';
import { createWorkStore, REPLAY_FEATURE, type Item, type Settings, type WorkStore, type WriteOutcome, type WorkPersistence } from '../../../modules/work/core';
import { createWorkLocal } from '../electron/work-local';
import type { WorkLocalTransport } from '../../../modules/work/live/transport';
import { workLocalPersistence } from '../../../modules/work/live/durable';
import { startPlanner, type PlannerOptions, type TestPlanner } from './test/planner';

// The Work live path against a real disposable Planner, through the real stack: endpoint settings, the main-process
// HTTP layer (`createServices`, `sendHttp`), the Work live adapter and the Work store. Nothing is mocked except
// where a test drops a write on purpose, at the transport main would see fail. Each test starts its own Planner and
// every Planner, user-data directory and client it makes is disposed in `afterEach`. New scenarios add an `it` that
// starts from `planner()` and `connect()`.

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try { await cleanup(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Planner test cleanup failed');
});

async function planner(options?: PlannerOptions): Promise<TestPlanner> {
  const started = await startPlanner(options);
  cleanups.push(() => started.dispose());
  return started;
}

/** One request that crossed the main-process HTTP layer. `response` is absent when a fault dropped it before sending. */
interface Exchange { call: HttpCall; response?: ServiceResponse }
type Match = (call: HttpCall) => boolean;
const isCreate: Match = c => c.method === 'POST' && c.path === '/api/items';
const replayMode = (mode: 'lookup' | 'resend'): Match => c => c.path === '/api/requests/replay' && JSON.parse(c.body!).mode === mode;
const isState: Match = c => c.method === 'GET' && c.path === '/api/state';
const isVersion: Match = c => c.method === 'GET' && c.path === '/api/version';

interface Client {
  store: WorkStore;
  live: PlannerLive;
  exchanges: Exchange[];
  /** The next call matching `match` is dropped: `request` before it is sent, `answer` after the Planner applied it. */
  lose(where: 'request' | 'answer', match: Match): void;
  /** Calls that matched `match`, and how many of them reached the Planner. */
  sent(match: Match): number;
}

/** A client as the desktop wires it: its own endpoint settings, bridge, adapter and store. */
async function connect(target: TestPlanner, persistence?: WorkPersistence, http: Transport = sendHttp): Promise<Client> {
  const userData = await mkdtemp(join(tmpdir(), 'hq-work-live-'));
  cleanups.push(() => rm(userData, { recursive: true, force: true }));
  const config = await openServiceConfig(userData);
  expect(await config.set({ domain: 'work', baseUrl: target.url.origin })).toMatchObject({ configured: true, policy: 'ok' });
  const exchanges: Exchange[] = [];
  const faults: { where: 'request' | 'answer'; match: Match }[] = [];
  const transport: Transport = async (endpoint, call) => {
    const index = faults.findIndex(f => f.match(call));
    const fault = index < 0 ? null : faults.splice(index, 1)[0]!;
    const exchange: Exchange = { call };
    exchanges.push(exchange);
    if (fault?.where === 'request') return { ok: false, kind: 'unknown' };
    const response = await http(endpoint, call);
    exchange.response = response;
    return fault ? { ok: false, kind: 'unknown' } : response;
  };
  const live = createPlannerLive(bridgeTransport({ call: createServices(config, transport).work }));
  const store = createWorkStore(live.port, { recovery: live.recovery, persistence });
  return {
    store, live, exchanges,
    lose: (where, match) => { faults.push({ where, match }); },
    sent: match => exchanges.filter(e => match(e.call) && e.response).length,
  };
}

/** The Planner read directly, bypassing HQ, so each effect is checked against what the service holds. */
function raw<T = unknown>(target: TestPlanner, method: string, path: string): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const req = request(new URL(path, target.url), { method, agent: false }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) as T }));
    });
    req.on('error', reject);
    req.end();
  });
}
interface RawState { items: Item[]; settings: Settings; state_version: number }
const rawState = async (target: TestPlanner): Promise<RawState> => (await raw<RawState>(target, 'GET', '/api/state')).body;
const rawItems = async (target: TestPlanner): Promise<Item[]> => (await rawState(target)).items;

const titled = (items: Item[], title: string): Item[] => items.filter(item => item.title === title);
const one = (items: Item[], title: string): Item => {
  const found = titled(items, title);
  expect(found).toHaveLength(1);
  return found[0]!;
};
const order = (items: Item[], status: string): string[] => items.filter(i => i.status === status).sort((a, b) => a.position - b.position).map(i => i.title);

/** The store item the Planner holds for this title, once the store has caught up. */
function stored(client: Client, title: string): Item {
  return one(client.store.getState().confirmed!.items, title);
}
function saved<R>(outcome: WriteOutcome<R>): R {
  if (outcome.status !== 'saved') throw new Error(`expected a saved write, got ${JSON.stringify(outcome)}`);
  return outcome.result;
}
/** A loaded client over `titles`, created oldest first so the last title is on top of Inbox. */
async function seeded(target: TestPlanner, titles: string[] = []): Promise<Client> {
  const client = await connect(target);
  await client.store.load();
  expect(client.store.getState().load).toBe('ready');
  for (const title of titles) saved(await client.store.create({ title }));
  await client.store.load();
  return client;
}
/** Removes the Planner's database files (not its directory), so the next start opens an empty store. */
async function wipe(target: TestPlanner): Promise<void> {
  for (const name of await readdir(target.root)) if (name.startsWith('planning.sqlite3')) await rm(join(target.root, name), { recursive: true, force: true });
}

describe('every Work port route against the real Planner', () => {
  it('reads the snapshot and version the Planner advertises', async () => {
    const target = await planner();
    const client = await connect(target);
    const snapshot = await client.live.port.snapshot();
    const direct = await rawState(target);
    expect(snapshot).toMatchObject({ items: [], stateVersion: direct.state_version, settings: direct.settings });
    expect(snapshot.features).toEqual(expect.arrayContaining([REPLAY_FEATURE, 'hq-references-v1']));
    expect(await client.live.port.version()).toBe(direct.state_version);
    await client.store.load();
    expect(client.store.getState()).toMatchObject({ load: 'ready', items: [], save: { kind: 'idle' } });
    expect(client.store.canWriteHqReferences()).toBe(true);
  });

  it('creates an item at the top of its status and reads it back', async () => {
    const target = await planner();
    const client = await seeded(target);
    const first = saved(await client.store.create({ title: 'First', kind: 'project', priority: 'high', notes: 'Why this matters' })).item!;
    const second = saved(await client.store.create({ title: 'Second', status: 'next' })).item!;
    saved(await client.store.create({ title: 'Third' }));
    await client.store.load();
    const items = await rawItems(target);
    expect(items).toHaveLength(3);
    expect(one(items, 'First')).toMatchObject({ id: first.id, revision: 1, status: 'inbox', kind: 'project', priority: 'high', notes: 'Why this matters' });
    expect(one(items, 'Second')).toMatchObject({ id: second.id, status: 'next' });
    expect(order(items, 'inbox')).toEqual(['Third', 'First']);
    expect(client.store.getState().items.map(i => i.id).sort()).toEqual(items.map(i => i.id).sort());
    expect(client.store.getState().confirmed!.stateVersion).toBe((await rawState(target)).state_version);
  });

  it('patches text, enum, checklist, link and date fields, including a timed date and an HQ reference', async () => {
    const target = await planner();
    const client = await seeded(target, ['Patch me']);
    const envelope = { version: 1 as const, domain: 'design' as const, projectId: 'project-example', kind: 'artifact', entityId: 'artifact-example', title: 'Example design', returnDestination: { domain: 'design' as const, destination: 'artifact/example' } };
    const id = stored(client, 'Patch me').id;
    saved(await client.store.patch(id, { title: 'Patched', kind: 'goal', motivation: 'need', horizon: 'soon', priority: 'low', area: 'Home', notes: 'Edited notes' }));
    saved(await client.store.patch(id, { next_steps: [{ text: 'Draft the plan' }, { text: 'Send it', done: true }] }));
    saved(await client.store.patch(id, { references: [{ kind: 'url', label: 'Spec', url: 'https://example.com/spec' }, { kind: 'hq', label: 'Example design', target: envelope }] }));
    saved(await client.store.patch(id, { dates: [
      { kind: 'deadline', precision: 'day', value: '2026-12-01' },
      { kind: 'event', precision: 'day', value: '2026-12-02', time: '09:30', end_time: '10:15', tz: 'America/New_York', note: 'Kickoff' },
      { kind: 'target', precision: 'quarter', value: '2027-Q2' },
    ] }));
    await client.store.load();
    const direct = one(await rawItems(target), 'Patched');
    expect(direct).toMatchObject({ id, revision: 5, kind: 'goal', motivation: 'need', horizon: 'soon', priority: 'low', area: 'Home', notes: 'Edited notes' });
    expect(direct.next_steps).toMatchObject([{ text: 'Draft the plan', done: false }, { text: 'Send it', done: true }]);
    expect(direct.references).toMatchObject([{ kind: 'url', label: 'Spec', url: 'https://example.com/spec' }, { kind: 'hq', label: 'Example design', target: envelope }]);
    expect(direct.dates).toMatchObject([
      { kind: 'deadline', precision: 'day', value: '2026-12-01', time: null },
      { kind: 'event', value: '2026-12-02', time: '09:30', end_time: '10:15', tz: 'America/New_York', note: 'Kickoff', instant: '2026-12-02T14:30:00Z', tz_abbr: 'EST' },
      { kind: 'target', precision: 'quarter', value: '2027-Q2' },
    ]);
    expect(client.store.getState().confirmed!.items.find(i => i.id === id)).toEqual(direct);
  });

  it('moves to the top, the bottom, after an anchor and before an anchor', async () => {
    const target = await planner();
    const client = await seeded(target, ['A', 'B', 'C', 'D']);
    const id = (title: string) => stored(client, title).id;
    const move = async (title: string, anchor: Parameters<WorkStore['move']>[2]) => {
      saved(await client.store.move(id(title), 'active', anchor));
      await client.store.load();
      return order(await rawItems(target), 'active');
    };
    expect(await move('A', { place: 'top' })).toEqual(['A']);
    expect(await move('B', { place: 'bottom' })).toEqual(['A', 'B']);
    expect(await move('C', { after_id: id('A') })).toEqual(['A', 'C', 'B']);
    expect(await move('D', { before_id: id('A') })).toEqual(['D', 'A', 'C', 'B']);
    expect(order(client.store.getState().items, 'active')).toEqual(['D', 'A', 'C', 'B']);
    expect(order(await rawItems(target), 'inbox')).toEqual([]);
    expect(await move('B', { place: 'top' })).toEqual(['B', 'D', 'A', 'C']);
  });

  it('archives and restores, reading each back', async () => {
    const target = await planner();
    const client = await seeded(target, ['Keep']);
    const id = stored(client, 'Keep').id;
    saved(await client.store.setArchived(id, true));
    await client.store.load();
    expect(one(await rawItems(target), 'Keep')).toMatchObject({ id, revision: 2, archived_at: expect.any(String) });
    expect(stored(client, 'Keep').archived_at).not.toBeNull();
    saved(await client.store.setArchived(id, false));
    await client.store.load();
    expect(one(await rawItems(target), 'Keep')).toMatchObject({ id, revision: 3, archived_at: null });
    expect(stored(client, 'Keep').archived_at).toBeNull();
  });

  it('marks an item reviewed', async () => {
    const target = await planner();
    const client = await seeded(target, ['Review me']);
    const id = stored(client, 'Review me').id;
    expect(stored(client, 'Review me').reviewed_at).toBeNull();
    saved(await client.store.markReviewed(id));
    await client.store.load();
    expect(one(await rawItems(target), 'Review me')).toMatchObject({ id, revision: 2, reviewed_at: expect.any(String) });
    expect(stored(client, 'Review me').reviewed_at).not.toBeNull();
  });

  it('reads an item history, newest first', async () => {
    const target = await planner();
    const client = await seeded(target, ['Tracked']);
    const id = stored(client, 'Tracked').id;
    saved(await client.store.patch(id, { notes: 'x' }));
    saved(await client.store.move(id, 'next', { place: 'top' }));
    saved(await client.store.setArchived(id, true));
    saved(await client.store.setArchived(id, false));
    saved(await client.store.markReviewed(id));
    const history = await client.store.history(id);
    expect(history.map(entry => entry.action)).toEqual(['reviewed', 'restored', 'archived', 'moved', 'updated', 'created']);
    const direct = (await raw<{ history: { at: string; action: string }[] }>(target, 'GET', `/api/items/${id}/history`)).body.history;
    expect(history.map(({ at, action }) => ({ at, action }))).toEqual(direct.map(({ at, action }) => ({ at, action })));
    await expect(client.store.history('missing-item-id')).rejects.toMatchObject({ error: { kind: 'not_found' } });
  });

  it('updates the Planner settings and reads them back', async () => {
    const target = await planner();
    const client = await seeded(target);
    const before = client.store.getState().confirmed!.settings;
    const next = { default_tz: 'Europe/London', week_start: 'mon' as const, stale_days: before.stale_days + 9 };
    expect(saved(await client.store.updateSettings(next)).settings).toEqual(next);
    await client.store.load();
    expect((await rawState(target)).settings).toEqual(next);
    expect(client.store.getState().confirmed!.settings).toEqual(next);
  });
});

describe('a second client changing the same Planner', () => {
  it('answers a stale write with revision_conflict and the current item in conflicts', async () => {
    const target = await planner();
    const mine = await seeded(target, ['Shared']);
    const theirs = await connect(target);
    await theirs.store.load();
    const id = stored(mine, 'Shared').id;
    saved(await theirs.store.patch(id, { title: 'Theirs' }));
    const outcome = await mine.store.patch(id, { notes: 'Mine' });
    expect(outcome).toMatchObject({ status: 'failed', error: { kind: 'revision_conflict', current: { id, title: 'Theirs', revision: 2 } } });
    expect(mine.store.getState().conflicts).toMatchObject([{ itemId: id, current: { title: 'Theirs', revision: 2 }, attempted: { op: 'patch', id, revision: 1, patch: { notes: 'Mine' } } }]);
    expect(one(await rawItems(target), 'Theirs').notes).toBe('');
    expect(mine.store.getState().items.find(i => i.id === id)).toMatchObject({ title: 'Theirs', revision: 2, notes: '' });
  });

  it('answers a move beside an anchor the other client moved with order_conflict, a notice and a refresh', async () => {
    const target = await planner();
    const mine = await seeded(target, ['Q', 'P']);
    const theirs = await connect(target);
    await theirs.store.load();
    const [p, q] = [stored(mine, 'P').id, stored(mine, 'Q').id];
    saved(await mine.store.move(p, 'next', { place: 'top' }));
    saved(await mine.store.move(q, 'next', { place: 'bottom' }));
    await mine.store.load(); await theirs.store.load();
    saved(await theirs.store.move(q, 'active', { place: 'top' }));
    const outcome = await mine.store.move(p, 'next', { after_id: q });
    expect(outcome).toMatchObject({ status: 'failed', error: { kind: 'order_conflict' } });
    expect(mine.store.getState().notices.map(n => n.text)).toContain('The board changed since it was loaded, so nothing moved. It has been refreshed.');
    await vi.waitFor(() => expect(mine.store.getState().confirmed!.items.find(i => i.id === q)!.status).toBe('active'));
    expect(order(await rawItems(target), 'next')).toEqual(['P']);
    expect(order(mine.store.getState().items, 'next')).toEqual(['P']);
  });
});

describe('polling', () => {
  it('picks up an item another client created, and does not refetch an unchanged version', async () => {
    const target = await planner();
    const mine = await seeded(target, ['Existing']);
    const theirs = await connect(target);
    await theirs.store.load();
    const states = () => mine.sent(isState);
    const before = states();
    await mine.store.poll();
    await mine.store.poll();
    expect(states()).toBe(before);
    expect(mine.sent(isVersion)).toBeGreaterThanOrEqual(2);
    saved(await theirs.store.create({ title: 'From elsewhere' }));
    await mine.store.poll();
    expect(states()).toBe(before + 1);
    expect(titled(mine.store.getState().items, 'From elsewhere')).toHaveLength(1);
    expect(mine.store.getState().confirmed!.stateVersion).toBe((await rawState(target)).state_version);
    await mine.store.poll();
    expect(states()).toBe(before + 1);
  });
});

describe('the Planner stopped and started again', () => {
  it('leaves the board loaded and offline, refuses a write without changing anything, and recovers on the same data', async () => {
    const target = await planner();
    const client = await seeded(target, ['One', 'Two']);
    const loaded = client.store.getState().items;
    const id = stored(client, 'One').id;
    await target.stop();
    await client.store.poll();
    expect(client.store.getState()).toMatchObject({ load: 'ready', save: { kind: 'offline' } });
    expect(client.store.getState().items).toEqual(loaded);
    const outcome = await client.store.patch(id, { title: 'Edited offline' });
    expect(outcome).toMatchObject({ status: 'failed', error: { kind: 'unavailable' } });
    expect(client.store.getState().items).toEqual(loaded);
    expect(client.store.getState()).toMatchObject({ pending: [], unconfirmed: [], save: { kind: 'offline' } });
    expect(client.live.ledger.unresolved()).toEqual([]);
    await target.start();
    await client.store.poll();
    expect(client.store.getState().save.kind).not.toBe('offline');
    expect(client.store.getState().load).toBe('ready');
    const direct = await rawItems(target);
    expect(direct.map(i => i.title).sort()).toEqual(['One', 'Two']);
    expect(client.store.getState().items).toEqual(direct);
    saved(await client.store.patch(id, { title: 'Edited online' }));
    expect(one(await rawItems(target), 'Edited online').id).toBe(id);
  });
});

describe('a write whose answer or request is lost', () => {
  it('after the Planner applied it: unconfirmed, then Check confirms it from the replay record, once', async () => {
    const target = await planner();
    const client = await seeded(target, ['Before']);
    client.lose('answer', isCreate);
    const outcome = await client.store.create({ title: 'Lost answer' });
    expect(outcome).toMatchObject({ status: 'unconfirmed' });
    const requestId = (outcome as { requestId: string }).requestId;
    expect(client.store.getState().unconfirmed).toMatchObject([{ requestId, state: 'unconfirmed', write: { op: 'create', fields: { title: 'Lost answer' } } }]);
    expect(client.store.getState().save).toEqual({ kind: 'unconfirmed', count: 1 });
    expect(titled(await rawItems(target), 'Lost answer')).toHaveLength(1);
    // Repeating the unconfirmed write sends nothing: only an explicit Check touches it.
    expect(client.live.ledger.unresolved()).toEqual([requestId]);
    const created = client.sent(isCreate);
    expect(await client.store.checkUnconfirmed(requestId)).toBe('confirmed');
    expect(client.sent(isCreate)).toBe(created);
    expect(client.sent(replayMode('lookup'))).toBe(1);
    expect(client.sent(replayMode('resend'))).toBe(0);
    expect(client.store.getState().unconfirmed).toEqual([]);
    await vi.waitFor(() => expect(titled(client.store.getState().items, 'Lost answer')).toHaveLength(1));
    expect(titled(await rawItems(target), 'Lost answer')).toHaveLength(1);
    expect(client.live.ledger.unresolved()).toEqual([]);
    const lookup = client.exchanges.find(e => replayMode('lookup')(e.call))!;
    expect(lookup.response).toMatchObject({ ok: true, status: 200, replayed: true, body: { outcome: 'replayed', status: 201 } });
  });

  it('before it reached the Planner: Check says not_applied, Apply applies it once, and a second Apply sends nothing', async () => {
    const target = await planner();
    const client = await seeded(target, ['Before']);
    const created = client.sent(isCreate);
    client.lose('request', isCreate);
    const outcome = await client.store.create({ title: 'Lost request' });
    expect(outcome).toMatchObject({ status: 'unconfirmed' });
    const requestId = (outcome as { requestId: string }).requestId;
    expect(client.sent(isCreate)).toBe(created);
    expect(titled(await rawItems(target), 'Lost request')).toHaveLength(0);
    expect(await client.store.checkUnconfirmed(requestId)).toBe('not_applied');
    expect(client.store.getState().unconfirmed).toMatchObject([{ requestId, state: 'awaiting_decision', recovery: { kind: 'not_applied' } }]);
    expect(client.store.canApply(requestId)).toBe(true);
    expect(titled(await rawItems(target), 'Lost request')).toHaveLength(0);
    expect(await client.store.retryUnconfirmed(requestId)).toBe('confirmed');
    expect(client.sent(replayMode('resend'))).toBe(1);
    expect(client.sent(isCreate)).toBe(created);
    expect(client.store.getState().unconfirmed).toEqual([]);
    expect(titled(await rawItems(target), 'Lost request')).toHaveLength(1);
    // The write is settled: Apply again sends no second mutation, here or through the adapter.
    expect(await client.store.retryUnconfirmed(requestId)).toBe('missing');
    await expect(client.live.recovery.apply(requestId)).resolves.toMatchObject({ outcome: 'replayed' });
    expect(client.sent(replayMode('resend'))).toBe(1);
    expect(client.sent(isCreate)).toBe(created);
    await client.store.load();
    expect(titled(client.store.getState().items, 'Lost request')).toHaveLength(1);
    expect(titled(await rawItems(target), 'Lost request')).toHaveLength(1);
  });

  it('an Apply whose answer is lost needs a new Check; a second Apply is refused and sends nothing, and Check then confirms it once', async () => {
    const target = await planner();
    const client = await seeded(target);
    client.lose('request', isCreate);
    const { requestId } = await client.store.create({ title: 'Apply lost' }) as { requestId: string };
    expect(await client.store.checkUnconfirmed(requestId)).toBe('not_applied');
    client.lose('answer', replayMode('resend'));
    expect(await client.store.retryUnconfirmed(requestId)).toBe('still_unknown');
    expect(titled(await rawItems(target), 'Apply lost')).toHaveLength(1);
    expect(client.store.getState().unconfirmed).toMatchObject([{ requestId, state: 'unconfirmed' }]);
    expect(client.store.canApply(requestId)).toBe(false);
    expect(await client.store.retryUnconfirmed(requestId)).toBe('refused');
    expect(client.sent(replayMode('resend'))).toBe(1);
    expect(await client.store.checkUnconfirmed(requestId)).toBe('confirmed');
    expect(client.sent(replayMode('resend'))).toBe(1);
    expect(client.store.getState().unconfirmed).toEqual([]);
    await client.store.load();
    expect(titled(client.store.getState().items, 'Apply lost')).toHaveLength(1);
    expect(titled(await rawItems(target), 'Apply lost')).toHaveLength(1);
  });

  it('a Planner restarted on an empty data file at the same port: Check reports store_changed without resending', async () => {
    const target = await planner();
    const client = await seeded(target, ['One', 'Two', 'Three']);
    client.lose('answer', isCreate);
    const { requestId } = await client.store.create({ title: 'Lost across a restart' }) as { requestId: string };
    const intent = client.live.ledger.intent(requestId)!;
    const port = target.port;
    await target.stop();
    await wipe(target);
    await target.start();
    expect(target.port).toBe(port);
    expect((await rawState(target)).state_version).toBeLessThan(intent.sentAfterVersion);
    expect(await rawItems(target)).toEqual([]);
    expect(await client.store.checkUnconfirmed(requestId)).toBe('indeterminate');
    const lookup = client.exchanges.filter(e => replayMode('lookup')(e.call)).at(-1)!;
    expect(lookup.response).toMatchObject({ ok: true, status: 400, body: { error: 'invalid' } });
    expect(client.store.getState().unconfirmed).toMatchObject([{ requestId, state: 'awaiting_decision', recovery: { kind: 'indeterminate', reason: 'store_changed' } }]);
    expect(client.store.canApply(requestId)).toBe(false);
    expect(client.sent(replayMode('resend'))).toBe(0);
    expect(await rawItems(target)).toEqual([]);
  });
});


/** Fresh main/renderer adapters over the same device directory model a renderer restart. */
async function devicePersistence(target: TestPlanner) {
  const root = await mkdtemp(join(tmpdir(), 'hq-work-device-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return () => workLocalPersistence(createWorkLocal({ root, endpoint: () => target.url }) as WorkLocalTransport);
}

describe('durable queue against the real Planner', () => {
  it('restores an offline edit and flushes it exactly once after reconnect', async () => {
    const target = await planner();
    const disk = await devicePersistence(target);
    const first = await connect(target, disk());
    await first.store.load();
    saved(await first.store.create({ title: 'Before' }));
    const id = stored(first, 'Before').id;
    await target.stop();
    await first.store.poll();
    expect(await first.store.patch(id, { title: 'Kept offline' })).toMatchObject({ queued: { queueId: expect.any(String) } });
    // Wait for the coalesced device save before opening a fresh adapter.
    await vi.waitFor(async () => expect(await disk().load()).toMatchObject({ queued: [{ state: 'queued' }] }));
    const restarted = await connect(target, disk());
    await restarted.store.load();
    expect(restarted.store.getState().queued).toHaveLength(1);
    await target.start();
    await restarted.store.poll();
    expect(restarted.store.getState().queued).toEqual([]);
    expect(one(await rawItems(target), 'Kept offline')).toMatchObject({ id, revision: 2 });
    const patches = restarted.sent(c => c.method === 'PATCH');
    expect(patches).toBe(1);
    await restarted.store.poll();
    expect(restarted.sent(c => c.method === 'PATCH')).toBe(patches);
  });

  it('holds an offline edit when another client changed the same field', async () => {
    const target = await planner();
    const disk = await devicePersistence(target);
    const mine = await connect(target, disk());
    await mine.store.load();
    saved(await mine.store.create({ title: 'Shared' }));
    const id = stored(mine, 'Shared').id;
    const theirs = await connect(target);
    await theirs.store.load();
    await target.stop();
    await mine.store.poll();
    await mine.store.patch(id, { title: 'Mine' });
    await target.start();
    saved(await theirs.store.patch(id, { title: 'Theirs' }));
    await mine.store.poll();
    expect(mine.store.getState().queued).toMatchObject([{ state: 'conflict', conflict: { fields: ['title'] } }]);
    expect(mine.sent(c => c.method === 'PATCH')).toBe(0);
    expect(one(await rawItems(target), 'Theirs').revision).toBe(2);
    const queueId = mine.store.getState().queued[0]!.queueId;
    expect(await mine.store.resolveQueued(queueId, 'keep_mine')).toMatchObject({ status: 'saved' });
    expect(one(await rawItems(target), 'Mine').revision).toBe(3);
    expect(mine.sent(c => c.method === 'PATCH')).toBe(1);
  });

  it.each(['request', 'answer'] as const)('restores a lost %s and requires Check before any Apply', async where => {
    const target = await planner();
    const disk = await devicePersistence(target);
    const first = await connect(target, disk());
    await first.store.load();
    first.lose(where, isCreate);
    const result = await first.store.create({ title: 'Uncertain capture' });
    expect(result.status).toBe('unconfirmed');
    if (result.status !== 'unconfirmed') throw new Error('Expected unknown outcome');
    const { requestId } = result;
    await vi.waitFor(async () => expect(await disk().load()).toMatchObject({ unconfirmed: [{ requestId, intent: { requestId } }] }));
    const restarted = await connect(target, disk());
    await restarted.store.load();
    await restarted.store.poll();
    expect(restarted.store.getState().unconfirmed).toHaveLength(1);
    expect(restarted.sent(isCreate)).toBe(0);
    expect(await restarted.store.retryUnconfirmed(requestId)).toBe('refused');
    expect(restarted.sent(replayMode('resend'))).toBe(0);
    expect(await restarted.store.checkUnconfirmed(requestId)).toBe(where === 'answer' ? 'confirmed' : 'not_applied');
    if (where === 'request') expect(await restarted.store.retryUnconfirmed(requestId)).toBe('confirmed');
    expect(titled(await rawItems(target), 'Uncertain capture')).toHaveLength(1);
    expect(await restarted.store.retryUnconfirmed(requestId)).toBe('missing');
    expect(restarted.sent(replayMode('resend'))).toBe(where === 'request' ? 1 : 0);
  });
});

describe('explicit Planner health through main HTTP', () => {
  it('reports ready and then unreachable without sending writes', async () => {
    const target = await planner();
    const client = await connect(target);
    expect(await client.live.health()).toMatchObject({ status: 'ready', api: 2 });
    await target.stop();
    expect(await client.live.health()).toMatchObject({ status: 'unavailable', reason: 'unreachable' });
    expect(client.exchanges.every(e => isVersion(e.call))).toBe(true);
  });

  it('reports the Planner Host refusal', async () => {
    const target = await planner();
    const client = await connect(target, undefined, (endpoint, call) => sendHttp(endpoint, { ...call, headers: { ...call.headers, Host: 'unapproved.example' } }));
    expect(await client.live.health()).toMatchObject({ status: 'unavailable', reason: 'refused', httpStatus: 421 });
    expect(client.exchanges.every(e => isVersion(e.call))).toBe(true);
  });
});
