// Pure client logic: date formatting/placement and drop ordering. Runs with
// `node --test tests/` and touches no DOM, network or filesystem.

import assert from 'node:assert/strict';
import test from 'node:test';

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
