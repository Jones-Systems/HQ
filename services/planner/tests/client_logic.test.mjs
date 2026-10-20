// Client logic: date formatting/placement, drop ordering, the write/sync
// state machine, the fetch wrapper and drag gestures. Runs with
// `node --test tests/`; the DOM is the fake in fake_dom.mjs and every request
// goes to a stubbed fetch, so no browser, network or filesystem is touched.

import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import { installFakeDom } from './fake_dom.mjs';

const doc = installFakeDom();
const toasts = doc.createElement('div');
toasts.id = 'toasts';
doc.body.append(toasts);

import {
  dateState, formatValue, isoWeekOf, monthGrid, periodBounds, primaryDate, valueContaining,
} from '../public/js/dates.js';
import { matchesFilters, reviewBuckets } from '../public/js/model.js';
import { anchorsForDrop, anchorsToRestore, projectMove, stepAnchors } from '../public/js/ordering.js';

test('period bounds never invent a day for coarse precisions', () => {
  assert.deepEqual(periodBounds('month', '2027-02'), ['2027-02-01', '2027-02-28']);
  assert.deepEqual(periodBounds('quarter', '2027-Q2'), ['2027-04-01', '2027-06-30']);
  assert.deepEqual(periodBounds('year', '2028'), ['2028-01-01', '2028-12-31']);
  assert.deepEqual(periodBounds('week', '2026-W53'), ['2026-12-28', '2027-01-03']);
  assert.equal(periodBounds('week', '2025-W53'), null);
  assert.equal(periodBounds('day', '2026-02-30'), null);
  assert.equal(formatValue({ precision: 'quarter', value: '2027-Q2' }), 'Q2 2027');
  assert.equal(formatValue({ precision: 'month', value: '2026-11' }, '2026-10-10'), 'November');
});

test('ISO weeks and containing values', () => {
  assert.equal(isoWeekOf('2026-01-01'), '2026-W01');
  assert.equal(isoWeekOf('2027-01-01'), '2026-W53');
  assert.equal(valueContaining('quarter', '2026-11-14'), '2026-Q4');
  assert.equal(valueContaining('month', '2026-11-14'), '2026-11');
});

test('only open deadlines become overdue; targets just pass', () => {
  const today = '2026-10-10';
  assert.equal(dateState({ kind: 'deadline', precision: 'day', value: '2026-10-01' }, today, true), 'overdue');
  assert.equal(dateState({ kind: 'deadline', precision: 'day', value: '2026-10-01' }, today, false), 'passed');
  assert.equal(dateState({ kind: 'target', precision: 'day', value: '2026-10-01' }, today, true), 'passed');
  assert.equal(dateState({ kind: 'target', precision: 'month', value: '2026-10' }, today, true), 'current');
  assert.equal(dateState({ kind: 'event', precision: 'day', value: today }, today, true), 'today');
});

test('primary date prefers the earliest date that has not ended', () => {
  const dates = [
    { id: 'a', kind: 'target', precision: 'day', value: '2026-09-01' },
    { id: 'b', kind: 'target', precision: 'quarter', value: '2027-Q1' },
    { id: 'c', kind: 'deadline', precision: 'day', value: '2026-12-01' },
  ];
  assert.equal(primaryDate(dates, '2026-10-10').id, 'c');
  assert.equal(primaryDate([dates[0]], '2026-10-10').id, 'a');
});

test('month grid covers whole weeks starting on the chosen weekday', () => {
  const sun = monthGrid(2026, 11, 'sun');
  assert.equal(sun[0][0], '2026-11-01');
  assert.ok(sun.every((w) => w.length === 7));
  const mon = monthGrid(2026, 11, 'mon');
  assert.equal(mon[0][0], '2026-10-26');
  assert.equal(mon.at(-1).at(-1), '2026-12-06');
});

test('drop anchors follow the visible neighbour', () => {
  assert.deepEqual(anchorsForDrop(['a', 'd'], 1), { after_id: 'a' });
  assert.deepEqual(anchorsForDrop(['a', 'd'], 0), { before_id: 'a' });
  assert.deepEqual(anchorsForDrop([], 0), { place: 'top' });
  assert.deepEqual(stepAnchors(['a', 'b', 'c'], 'c', -1), { after_id: 'a' });
  assert.deepEqual(stepAnchors(['a', 'b', 'c'], 'a', 1), { after_id: 'b' });
  assert.equal(stepAnchors(['a', 'b'], 'a', -1), null);
  assert.deepEqual(anchorsToRestore(['a', 'b', 'c'], 'b'), { after_id: 'a' });
  assert.deepEqual(anchorsToRestore(['a', 'b'], 'a'), { before_id: 'b' });
});

test('projected move matches the server rule with hidden cards', () => {
  const mk = (id, status, position) => ({ id, status, position, created_at: '2026-01-01T00:00:00.000Z' });
  const items = [mk('a', 'next', 1), mk('b', 'next', 2), mk('c', 'next', 3), mk('d', 'next', 4), mk('x', 'inbox', 1)];
  const plan = projectMove(items, 'x', 'next', { after_id: 'a' });
  const order = [...plan.entries()].sort((p, q) => p[1].position - q[1].position).map(([id]) => id);
  assert.deepEqual(order, ['a', 'x', 'b', 'c', 'd']);
  assert.equal(projectMove(items, 'x', 'next', { after_id: 'zzz' }), null);
});

test('projected move without an anchor or place lands at the bottom, as on the server', () => {
  const mk = (id, status, position) => ({ id, status, position, created_at: '2026-01-01T00:00:00.000Z' });
  const items = [mk('a', 'next', 1), mk('b', 'next', 2), mk('x', 'inbox', 1)];
  const order = (plan) => [...plan.entries()].sort((p, q) => p[1].position - q[1].position).map(([id]) => id);
  assert.deepEqual(order(projectMove(items, 'x', 'next', {})), ['a', 'b', 'x']);
  assert.deepEqual(order(projectMove(items, 'x', 'next', { place: 'top' })), ['x', 'a', 'b']);
});

test('filters and review buckets', () => {
  const base = { notes: '', next_steps: [], references: [], dates: [], archived_at: null, area: null,
    motivation: null, horizon: null, kind: 'idea', priority: null, updated_at: '2026-01-01T00:00:00.000Z' };
  const items = [
    { ...base, id: '1', title: 'Garden', status: 'inbox', area: 'Home', position: 1 },
    { ...base, id: '2', title: 'Passport', status: 'active', motivation: 'need', position: 1,
      dates: [{ id: 'd', kind: 'deadline', precision: 'day', value: '2026-10-01' }] },
  ];
  assert.equal(items.filter((i) => matchesFilters(i, { q: 'garden', area: '', motivation: '', horizon: '', kind: '', priority: '' })).length, 1);
  assert.equal(items.filter((i) => matchesFilters(i, { q: '', area: '__none', motivation: '', horizon: '', kind: '', priority: '' })).length, 1);
  const b = reviewBuckets(items, '2026-10-10', { stale_days: 21 });
  assert.equal(b.inbox.length, 1);
  assert.equal(b.overdue.length, 1);
  assert.equal(b.stale.length, 1);
});

// ------------------------------------------------- writes, sync and fetch

const { api, ApiError, NetworkError } = await import('../public/js/api.js');
const st = await import('../public/js/state.js');

const flush = () => new Promise((r) => setImmediate(r));
const ok = (body) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) });
const SETTINGS = { default_tz: 'America/New_York', week_start: 'sun', stale_days: 21 };

/** Stub fetch; every call waits until the test resolves it. */
function heldFetch() {
  const calls = [];
  globalThis.fetch = (path, init) => new Promise((resolve, reject) => {
    calls.push({ path, init, resolve, reject, body: init.body ? JSON.parse(init.body) : null });
  });
  return calls;
}

function seed(items, version) {
  st.state.items = items;
  st.state.byId = new Map(items.map((it) => [it.id, it]));
  st.state.version = version;
  st.state.phase = 'ready';
  st.state.connection = 'online';
  st.state.inFlight = 0;
  st.state.unconfirmed = [];
  st.state.pendingIds.clear();
}

test('a snapshot that started before a confirmed write does not roll that write back', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    seed([{ id: 'a', revision: 3, title: 'old' }], 5);
    const calls = heldFetch();
    const loading = st.load({ quiet: true });
    const write = st.mutate({ method: 'PATCH', path: '/api/items/a', body: {} });
    await flush();
    assert.deepEqual(calls.map((c) => c.path), ['/api/state', '/api/items/a']);
    calls[1].resolve(ok({ item: { id: 'a', revision: 4, title: 'new' }, changed: ['title'], state_version: 6 }));
    await write;
    // The snapshot was read before the write committed.
    calls[0].resolve(ok({ items: [{ id: 'a', revision: 3, title: 'old' }], settings: SETTINGS, state_version: 5 }));
    await loading;
    assert.equal(st.getItem('a').title, 'new');
    assert.equal(st.state.version, 6);
    // A fresh snapshot is fetched once the client is idle.
    mock.timers.tick(300);
    await flush();
    assert.equal(calls.at(-1).path, '/api/state');
  } finally {
    mock.timers.reset();
  }
});

test('a refresh wanted while another write is in flight is retried, not dropped', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    seed([], 5);
    const calls = heldFetch();
    const first = st.mutate({ method: 'POST', path: '/api/items', body: {} });
    const second = st.mutate({ method: 'POST', path: '/api/items', body: {} });
    await flush();
    // Another device wrote version 6, so this write confirms as 7.
    calls[0].resolve(ok({ state_version: 7 }));
    await first;
    mock.timers.tick(300);
    await flush();
    calls[1].resolve(ok({ state_version: 8 }));
    await second;
    mock.timers.tick(300);
    await flush();
    assert.ok(calls.some((c) => c.path === '/api/state'), 'the other device’s change is loaded');
  } finally {
    mock.timers.reset();
  }
});

/** Answer every call as it arrives: replay envelopes, normal writes and snapshots. */
async function answerAll(calls, version, respond = null) {
  for (let i = 0; i < 12; i += 1) {
    await flush();
    for (const call of calls.filter((c) => !c.done)) {
      call.done = true;
      const custom = respond && respond(call);
      if (custom) call.resolve(custom);
      else if (call.path === '/api/state') call.resolve(ok({ items: [], settings: SETTINGS, state_version: version.value }));
      else if (call.path === '/api/requests/replay') {
        version.value += 1;
        call.resolve(ok({ outcome: 'applied_now', status: 200, response: { state_version: version.value } }));
      } else {
        version.value += 1;
        call.resolve(ok({ state_version: version.value }));
      }
    }
  }
}

const decode = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));

test('overlapping retries re-send every unconfirmed change once, in order', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    seed([], 5);
    st.state.connection = 'offline';
    const entry = (requestId) => ({ requestId, method: 'POST', path: '/api/items', bodyText: '{}', sentAfterVersion: 4, label: requestId });
    st.state.unconfirmed = [entry('r1'), entry('r2')];
    const calls = heldFetch();
    const runs = [st.retryUnconfirmed(), st.retryUnconfirmed()];
    await answerAll(calls, { value: 5 });
    await Promise.all(runs);
    const sent = calls.filter((c) => c.path === '/api/requests/replay').map((c) => c.body.request_id);
    assert.deepEqual(sent, ['r1', 'r2']);
    assert.equal(st.state.unconfirmed.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test('a lost write is re-sent only through replay, with its exact bytes and first-send version', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    seed([{ id: 'item000001', revision: 2, title: 'Trip “Ö”' }], 7);
    const calls = heldFetch();
    const write = st.mutate({ method: 'PATCH', path: '/api/items/item000001', body: { revision: 2, patch: { title: 'Trip “Ö”' } } });
    await flush();
    const first = calls[0];
    assert.equal(first.path, '/api/items/item000001');
    const requestId = first.init.headers['X-Request-Id'];
    first.reject(new TypeError('connection reset'));
    await assert.rejects(write, NetworkError);
    assert.ok(st.isPending('item000001'));
    assert.equal(st.isPending('item00000'), false, 'a prefix of the id is a different item');
    // Other writes landed meanwhile; the retry must still quote version 7.
    st.state.version = 9;
    const retry = st.retryUnconfirmed();
    await answerAll(calls, { value: 9 });
    await retry;
    const replay = calls.find((c) => c.path === '/api/requests/replay');
    assert.equal(replay.init.headers['X-Request-Id'], undefined, 'the id travels in the envelope');
    assert.deepEqual({ ...replay.body, body_b64: decode(replay.body.body_b64) }, {
      mode: 'resend', request_id: requestId, method: 'PATCH', path: '/api/items/item000001',
      body_b64: first.init.body, sent_after_version: 7,
    });
    assert.equal(calls.filter((c) => c.path === '/api/items/item000001').length, 1, 'never re-sent on the normal route');
  } finally {
    mock.timers.reset();
  }
});

test('routes without replay keep re-sending with the same request id', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    seed([], 3);
    const calls = heldFetch();
    const write = st.mutate({ method: 'POST', path: '/api/examples', body: {} });
    await flush();
    calls[0].reject(new TypeError('connection reset'));
    await assert.rejects(write, NetworkError);
    const retry = st.retryUnconfirmed();
    await answerAll(calls, { value: 3 });
    await retry;
    const sends = calls.filter((c) => c.path === '/api/examples');
    assert.equal(sends.length, 2);
    assert.equal(sends[1].init.headers['X-Request-Id'], sends[0].init.headers['X-Request-Id']);
    assert.equal(sends[1].init.body, sends[0].init.body);
  } finally {
    mock.timers.reset();
  }
});

test('an indeterminate replay rolls the projection back and is reported as unknown', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    seed([{ id: 'item000001', revision: 2, title: 'Trip', status: 'next' }], 7);
    const calls = heldFetch();
    const write = st.mutate({
      method: 'PATCH', path: '/api/items/item000001', body: { revision: 2, patch: { status: 'done' } },
      project: () => st.projectPatch('item000001', { status: 'done' }),
    });
    await flush();
    assert.equal(st.getItem('item000001').status, 'done');
    calls[0].reject(new TypeError('connection reset'));
    await assert.rejects(write, NetworkError);
    const retry = st.retryUnconfirmed();
    await answerAll(calls, { value: 7 }, (call) => (call.path === '/api/requests/replay'
      ? { ok: false, status: 409, json: async () => ({ error: 'replay_indeterminate', message: 'Read back before attempting another change.' }) }
      : null));
    const failures = await retry;
    assert.equal(failures.length, 1);
    assert.equal(failures[0].indeterminate, true);
    assert.equal(failures[0].message, st.INDETERMINATE_MESSAGE);
    assert.equal(st.isPending('item000001'), false);
  } finally {
    mock.timers.reset();
  }
});

test('a draft whose answer was lost is re-sent through replay, even after a reload', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    seed([], 4);
    st.state.drafts = [];
    st.addDraft({ title: 'Call the plumber' });
    const [draft] = st.state.drafts;
    const calls = heldFetch();
    const first = st.sendDraft(draft);
    await flush();
    calls[0].reject(new TypeError('connection reset'));
    await assert.rejects(first, NetworkError);
    // A reload loses the in-memory queue but keeps the stored draft and its send mark.
    st.state.unconfirmed = [];
    st.state.connection = 'online';
    const stored = JSON.parse(localStorage.getItem('planning.drafts.v1'));
    assert.deepEqual(stored[0].sent, { version: 4, body: calls[0].init.body });
    st.state.version = 6;
    const second = st.sendDraft(stored[0]);
    await answerAll(calls, { value: 6 });
    await second;
    const replay = calls.find((c) => c.path === '/api/requests/replay');
    assert.equal(replay.body.request_id, draft.requestId);
    assert.equal(replay.body.sent_after_version, 4);
    assert.equal(decode(replay.body.body_b64), calls[0].init.body);
    assert.equal(calls.filter((c) => c.path === '/api/items').length, 1);
    assert.equal(st.state.drafts.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test('a draft the server refused is sent normally next time', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    seed([], 4);
    st.state.drafts = [];
    st.addDraft({ title: '' });
    const calls = heldFetch();
    const first = st.sendDraft(st.state.drafts[0]);
    await flush();
    calls[0].resolve({ ok: false, status: 400, json: async () => ({ error: 'invalid', message: 'Title required.' }) });
    await assert.rejects(first, ApiError);
    assert.equal(st.state.drafts[0].sent, null);
  } finally {
    mock.timers.reset();
  }
});

test('the request timeout also covers a response body that never arrives', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    globalThis.fetch = async (path, init) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_, reject) => {
        init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
    });
    let outcome = 'pending';
    api.state().then(() => { outcome = 'resolved'; }, (err) => { outcome = err; });
    await flush();
    mock.timers.tick(15000);
    await flush();
    assert.ok(outcome instanceof NetworkError, `expected a NetworkError, got ${outcome}`);
    assert.match(outcome.message, /did not answer in time/);
  } finally {
    mock.timers.reset();
  }
});

test('imports and restores get a longer timeout than ordinary writes', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    globalThis.fetch = (path, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    const outcomes = {};
    for (const path of ['/api/import', '/api/backups/restore', '/api/settings']) {
      outcomes[path] = 'pending';
      api.send('POST', path, {}, 'request-0001').catch((err) => { outcomes[path] = err; });
    }
    mock.timers.tick(15000);
    await flush();
    assert.ok(outcomes['/api/settings'] instanceof NetworkError);
    assert.equal(outcomes['/api/import'], 'pending');
    assert.equal(outcomes['/api/backups/restore'], 'pending');
    mock.timers.tick(105000);
    await flush();
    assert.ok(outcomes['/api/import'] instanceof NetworkError);
    assert.ok(outcomes['/api/backups/restore'] instanceof NetworkError);
  } finally {
    mock.timers.reset();
  }
});
