import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/cli.ts';
import { resolveDates, dateToken } from '../src/write-dates.ts';
import { server, itemReply, clock } from './write-fixtures.mjs';

test('planned and due create separate target/deadline dates resolved in service timezone, with an explicit echo', async () => {
  const h = server(call => itemReply(call, { dates: call.parsed.fields.dates.map((d, index) => ({ ...d, id: `date000${index}` })) }));
  const r = await run(['planner', 'items', 'create', '--title', 'Synthetic', '--planned', 'today', '--due', 'tomorrow', '--date', 'start:2026-W45', '--date', 'event:2026-Q4'], h.deps);
  assert.equal(r.exitCode, 0, JSON.stringify(r));
  assert.deepEqual(h.writes()[0].parsed.fields.dates.map(d => [d.kind, d.precision, d.value]), [['target', 'day', '2026-10-31'], ['deadline', 'day', '2026-11-01'], ['start', 'week', '2026-W45'], ['event', 'quarter', '2026-Q4']]);
  assert.deepEqual(r.result.data.dates[0], { input: 'today', resolved: '2026-10-31', tz: 'America/New_York', today: '2026-10-31' });
});

test('explicit timezone overrides service settings; frozen day remains stable across DST', () => {
  const r = resolveDates([dateToken('target:+2d'), dateToken('deadline:tomorrow')], 'America/New_York', new Date('2026-10-31T12:00:00Z'));
  assert.deepEqual(r.dates.map(d => d.value), ['2026-11-02', '2026-11-01']);
  assert.equal(resolveDates([dateToken('target:today')], 'Pacific/Auckland', clock()).dates[0].value, '2026-11-01');
});

test('general date values preserve day/week/month/quarter/year precision', () => {
  const entries = ['target:2026-11-01', 'target:2026-W45', 'target:2026-11', 'target:2026-Q4', 'target:2026'].map(v => dateToken(v));
  assert.deepEqual(resolveDates(entries, 'UTC', clock()).dates.map(d => d.precision), ['day', 'week', 'month', 'quarter', 'year']);
});

test('timed dates reject DST gaps and reversed ranges; accept fold and explicit zone', () => {
  for (const token of ['event:2026-03-08@02:30~America/New_York', 'event:2026-11-01@12:30-11:30~America/New_York', 'target:2026-Q4@10:00~UTC', 'event:2026-11-01@25:00~UTC']) assert.throws(() => resolveDates([dateToken(token)], 'UTC', clock()));
  const r = resolveDates([dateToken('event:2026-11-01@01:30-02:30~America/New_York')], 'UTC', clock());
  assert.equal(r.dates[0].time, '01:30'); assert.equal(r.dates[0].tz, 'America/New_York');
});

test('weekday names and invalid periods never send a write', async () => {
  const h = server(() => assert.fail('Must not write'));
  for (const date of ['Friday', '2026-02-30', '2021-W53', '+999999999d']) {
    const r = await run(['planner', 'items', 'create', '--title', 'Synthetic', '--planned', date], h.deps);
    assert.equal(r.exitCode, 2); if (date === 'Friday') assert.match(r.result.error.message, /planner now/);
  }
  assert.equal(h.writes().length, 0);
});

test('resolution echo names the timezone that resolved the relative token, not the entry wall-time zone', () => {
  const r = resolveDates([dateToken('event:today@10:00~Pacific/Auckland')], 'America/New_York', clock());
  assert.deepEqual(r.resolutions[0], { input: 'today', resolved: '2026-10-31', tz: 'America/New_York', today: '2026-10-31' });
  assert.equal(r.dates[0].tz, 'Pacific/Auckland');
});

test('empty time, end_time and tz strings mean untimed, matching the service', () => {
  assert.deepEqual(resolveDates([{ kind: 'target', value: '2026-11-01', time: '', end_time: '', tz: '' }], 'UTC', clock()).dates, [{ kind: 'target', precision: 'day', value: '2026-11-01', time: null, end_time: null, tz: null, note: '' }]);
});
