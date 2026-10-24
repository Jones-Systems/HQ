import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/cli.ts';
import { periodBounds } from '../src/dates.ts';
import { harness, state, item, date } from './fixtures.mjs';
import { info } from './write-fixtures.mjs';

test('now uses Planner timezone across UTC midnight and fall DST, maps full weekday names over 14 calendar days', async () => {
  const h = harness({ '/api/state': state() });
  const { result } = await run(['planner', 'now'], h.deps);
  assert.equal(result.data.today, '2026-10-31');
  assert.equal(result.data.tomorrow, '2026-11-01');
  assert.equal(result.data.tz, 'America/New_York');
  assert.equal(result.data.days.length, 14);
  assert.deepEqual(result.data.weekdays.Friday, ['2026-11-06', '2026-11-13']);
  const spring = harness({ '/api/state': state({ settings: { default_tz: 'Pacific/Auckland', week_start: 'mon', stale_days: 30 } }) }, { clock: () => new Date('2026-09-26T14:30:00Z') });
  const small = await run(['planner', 'now', '--days', '3'], spring.deps);
  assert.equal(small.result.data.today, '2026-09-27');
  assert.deepEqual(small.result.data.days.map(d => d.date), ['2026-09-27', '2026-09-28', '2026-09-29']);
});

test('create resolves planned today using --tz over the Planner timezone across UTC midnight', async () => {
  const h = harness({
    '/api/version': info,
    '/api/state': state(),
    '/api/items': { item: item({ dates: [date({ value: '2026-11-01' })] }), state_version: 9 },
  });
  const { exitCode, result } = await run(['planner', 'items', 'create', '--title', 'Synthetic task', '--planned', 'today', '--tz', 'UTC'], h.deps);
  assert.equal(exitCode, 0, JSON.stringify(result));
  assert.equal(result.effect, 'applied');
  const writes = h.calls.filter(call => call.options.method !== 'GET');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.method, 'POST');
  assert.equal(new URL(writes[0].url).pathname, '/api/items');
  assert.deepEqual(JSON.parse(writes[0].options.body).fields.dates, [
    { kind: 'target', precision: 'day', value: '2026-11-01', time: null, end_time: null, tz: null, note: '' },
  ]);
  assert.deepEqual(result.data.dates, [
    { input: 'today', resolved: '2026-11-01', tz: 'UTC', today: '2026-11-01' },
  ]);
});

test('board is single, fixed order, with actual areas and active/archive counts', async () => {
  const h = harness({ '/api/state': state({ items: [item({ area: 'Work', status: 'active' }), item({ id: 'item0002', area: 'Work', status: 'done', archived_at: '2026-10-20T14:00:00Z' }), item({ id: 'item0003', area: 'Home' })] }) });
  const { result } = await run(['planner', 'boards'], h.deps);
  assert.equal(result.data.multiple_boards, false);
  const [board] = result.data.boards;
  assert.equal(board.id, 'planner:main');
  assert.deepEqual(board.columns.map(c => c.id), ['inbox', 'considering', 'next', 'active', 'on_hold', 'done', 'dropped']);
  assert.deepEqual(board.counts, { total: 3, active: 2, archived: 1 });
  assert.deepEqual(board.areas, [{ name: 'Home', counts: { total: 1, active: 1, archived: 0 } }, { name: 'Work', counts: { total: 2, active: 1, archived: 1 } }]);
});

test('list combines exact metadata filters and default archive exclusion while preserving service order', async () => {
  const chosen = item({ id: 'chosen01', status: 'next', area: 'Work', kind: 'project', horizon: 'soon' });
  const h = harness({ '/api/state': state({ items: [item(), chosen, { ...chosen, id: 'archiv01', archived_at: '2026-10-20T12:00:00Z' }, { ...chosen, id: 'wrong001', area: 'Home' }] }) });
  const args = ['planner', 'items', 'list', '--status', 'next', '--area', 'Work', '--kind', 'project', '--horizon', 'soon', '--board', 'planner:main'];
  const result = await run(args, h.deps);
  assert.deepEqual(result.result.data.items.map(i => i.id), ['chosen01']);
  assert.deepEqual((await run([...args, '--archive', 'archived'], h.deps)).result.data.items.map(i => i.id), ['archiv01']);
  assert.equal((await run([...args, '--archive', 'all'], h.deps)).result.data.items.length, 2);
});

test('date filters match one qualifying date including period overlap and retain all original dates and precision', async () => {
  const dates = [date({ id: 'date0001', kind: 'target', precision: 'month', value: '2026-11' }), date({ id: 'date0002', kind: 'deadline', value: '2026-12-05' })];
  const h = harness({ '/api/state': state({ items: [item({ dates }), item({ id: 'item0002', dates: [date({ value: '2026-11-15', kind: 'deadline' })] }), item({ id: 'item0003' })] }) });
  const value = await run(['planner', 'items', 'list', '--date-kind', 'target', '--from', '2026-11-15', '--to', '2026-11-15'], h.deps);
  assert.equal(value.result.data.items.length, 1);
  assert.deepEqual(value.result.data.items[0].dates, dates);
  const negative = await run(['planner', 'items', 'list', '--date-kind', 'deadline', '--to', '2026-11-30'], h.deps);
  assert.deepEqual(negative.result.data.items.map(i => i.id), ['item0002']);
});

test('period bounds handle leap years, ISO week-year edges, quarter/year; reject nonexistent weeks and dates', () => {
  assert.deepEqual(periodBounds('month', '2024-02'), ['2024-02-01', '2024-02-29']);
  assert.deepEqual(periodBounds('week', '2020-W53'), ['2020-12-28', '2021-01-03']);
  assert.deepEqual(periodBounds('week', '2026-W01'), ['2025-12-29', '2026-01-04']);
  assert.deepEqual(periodBounds('quarter', '2026-Q4'), ['2026-10-01', '2026-12-31']);
  assert.deepEqual(periodBounds('year', '2026'), ['2026-01-01', '2026-12-31']);
  for (const [precision, value] of [['week', '2021-W53'], ['day', '2026-02-30'], ['quarter', '2026-Q5'], ['month', '2026-13'], ['year', '1899']]) assert.throws(() => periodBounds(precision, value));
});

test('local filter validation rejects invalid kinds, windows, dates and boards without a request', async () => {
  const h = harness({});
  for (const args of [['--date-kind', 'due'], ['--from', 'Friday'], ['--from', '2026-02-30'], ['--from', '2026-12-01', '--to', '2026-11-01'], ['--board', 'Work'], ['--status', 'todo'], ['--archive', 'false']]) assert.equal((await run(['planner', 'items', 'list', ...args], h.deps)).exitCode, 2);
  assert.equal(h.calls.length, 0);
});

test('settings and history use real service shapes and expected routes', async () => {
  const history = [{ at: '2026-10-20T12:00:00Z', action: 'updated', detail: { fields: ['dates'], changes: {}, dates: ['added target: November 2026'] } }];
  const h = harness({ '/api/state': state(), '/api/items/item0001/history': { history } });
  assert.deepEqual((await run(['planner', 'settings', 'get'], h.deps)).result.data, { settings: state().settings, state_version: 8 });
  assert.deepEqual((await run(['planner', 'items', 'history', 'item0001'], h.deps)).result.data, { item_id: 'item0001', history });
  assert.deepEqual(h.calls.map(c => new URL(c.url).pathname), ['/api/state', '/api/items/item0001/history']);
});

test('item get preserves IDs, revisions, normalized dates and derived timed fields', async () => {
  const value = item({ dates: [date({ time: '10:30', end_time: '11:30', tz: 'America/New_York', instant: '2026-11-01T15:30:00Z', end_instant: '2026-11-01T16:30:00Z', tz_abbr: 'EST' })] });
  const result = await run(['planner', 'items', 'get', value.id], harness({ '/api/items/item0001': { item: value } }).deps);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.result.data.item, value);
});

test('history preserves service-owned imported JSON detail without inventing field semantics', async () => {
  const history = [{ at: '2026-10-20T12:00:00Z', action: 'imported-note', detail: { custom: { entries: [null, true, 42, 'synthetic'] }, fields: 'legacy import metadata' } }];
  const value = await run(['planner', 'items', 'history', 'item0001'], harness({ '/api/items/item0001/history': { history } }).deps);
  assert.equal(value.exitCode, 0);
  assert.deepEqual(value.result.data.history, history);
});
