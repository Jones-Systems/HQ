import { describe, expect, it } from 'vitest';
import { exampleItems } from '../fixtures/examples';
import {
  activeFilterCount, anchorsForDrop, byDateGroup, EMPTY_FILTERS, groupByDate, isoWeekOf, matchesFilters, periodBounds,
  plannerMonthGrid, plannerToday, projectMove, restoreAnchor, reviewBucketsFor, statusOrder, stepAnchors, weekBounds,
} from '../planning';
import { DEFAULT_SETTINGS, type Item, type PlanningDate, type Settings } from '../types';

// Fixed clock: Wednesday 2026-10-21, noon in New York.
const NOW = new Date('2026-10-21T16:00:00Z');
const TODAY = '2026-10-21';
const SUN: Settings = { ...DEFAULT_SETTINGS, week_start: 'sun' };
const MON: Settings = { ...DEFAULT_SETTINGS, week_start: 'mon' };

function card(id: string, fields: Partial<Item> = {}): Item {
  return {
    id, revision: 1, title: id, kind: 'idea', status: 'next', motivation: 'want', horizon: null, priority: null, area: null,
    notes: '', next_steps: [], references: [], dates: [], position: 1024, is_example: true,
    created_at: '2026-10-01T00:00:00.000Z', updated_at: '2026-10-20T00:00:00.000Z', archived_at: null, reviewed_at: null, ...fields,
  };
}
const d = (kind: PlanningDate['kind'], precision: PlanningDate['precision'], value: string): PlanningDate =>
  ({ id: `d-${value}`, kind, precision, value, time: null, end_time: null, tz: null, note: '' });

describe('display zone and week start come from Planner settings', () => {
  it('computes today in settings.default_tz, not the host zone', () => {
    const lateNight = new Date('2026-10-21T03:30:00Z');
    expect(plannerToday({ default_tz: 'America/New_York' }, lateNight)).toBe('2026-10-20');
    expect(plannerToday({ default_tz: 'Europe/Berlin' }, lateNight)).toBe('2026-10-21');
  });

  it('bounds a week by week_start', () => {
    expect(weekBounds(TODAY, 'sun')).toEqual(['2026-10-18', '2026-10-24']);
    expect(weekBounds(TODAY, 'mon')).toEqual(['2026-10-19', '2026-10-25']);
    expect(weekBounds('2026-10-18', 'mon')).toEqual(['2026-10-12', '2026-10-18']);
  });

  it('starts month grid rows on week_start', () => {
    expect(plannerMonthGrid(2026, 10, SUN)[0]![0]).toBe('2026-09-27');
    expect(plannerMonthGrid(2026, 10, MON)[0]![0]).toBe('2026-09-28');
  });
});

describe('periods and ISO weeks', () => {
  it('covers every precision', () => {
    expect(periodBounds('day', '2026-10-21')).toEqual(['2026-10-21', '2026-10-21']);
    expect(periodBounds('week', '2026-W43')).toEqual(['2026-10-19', '2026-10-25']);
    expect(periodBounds('week', '2026-W53')).toEqual(['2026-12-28', '2027-01-03']);
    expect(periodBounds('month', '2028-02')).toEqual(['2028-02-01', '2028-02-29']);
    expect(periodBounds('quarter', '2027-Q4')).toEqual(['2027-10-01', '2027-12-31']);
    expect(periodBounds('year', '2027')).toEqual(['2027-01-01', '2027-12-31']);
    expect(periodBounds('week', '2027-W53')).toBeNull();
    expect(isoWeekOf('2027-01-01')).toBe('2026-W53');
  });
});

describe('ordering and anchors', () => {
  const items = [
    card('a', { status: 'next', position: 1024 }), card('b', { status: 'next', position: 2048 }),
    card('c', { status: 'next', position: 3072, archived_at: '2026-10-02T00:00:00.000Z' }), card('x', { status: 'active', position: 1024 }),
  ];

  it('describes drops by a visible neighbour', () => {
    expect(anchorsForDrop(['a', 'b'], 0)).toEqual({ before_id: 'a' });
    expect(anchorsForDrop(['a', 'b'], 2)).toEqual({ after_id: 'b' });
    expect(anchorsForDrop([], 0)).toEqual({ place: 'top' });
    expect(stepAnchors(['a', 'b'], 'b', -1)).toEqual({ before_id: 'a' });
    expect(stepAnchors(['a', 'b'], 'a', -1)).toBeNull();
  });

  it('orders a status as the service does, archived items included', () => {
    expect(statusOrder(items, 'next')).toEqual(['a', 'b', 'c']);
    expect(restoreAnchor(items, 'b')).toEqual({ after_id: 'a' });
    expect(restoreAnchor(items, 'a')).toEqual({ before_id: 'b' });
    expect(restoreAnchor(items, 'x')).toEqual({ place: 'top' });
    expect(restoreAnchor(items, 'missing')).toBeNull();
  });

  it('projects a cross-status move renumbering only the target status', () => {
    const placed = projectMove(items, 'x', 'next', { after_id: 'a' })!;
    expect([...placed.keys()]).toEqual(['a', 'x', 'b', 'c']);
    expect(placed.get('x')).toEqual({ status: 'next', position: 2048 });
    expect(projectMove(items, 'x', 'next', { after_id: 'gone' })).toBeNull();
  });
});

describe('By date grouping at fixed dates (conformance case 7)', () => {
  const cases: [string, PlanningDate[], 'today' | 'week' | 'later' | 'undated', 'today' | 'week' | 'later' | 'undated'][] = [
    ['a day date today', [d('event', 'day', TODAY)], 'today', 'today'],
    ['an overdue deadline', [d('deadline', 'day', '2026-10-15')], 'today', 'today'],
    ['a passed target only', [d('target', 'day', '2026-10-15')], 'undated', 'undated'],
    ['a later day this week', [d('target', 'day', '2026-10-23')], 'week', 'week'],
    ['Sunday after a Sunday-start week', [d('target', 'day', '2026-10-25')], 'later', 'week'],
    ['the current ISO week', [d('target', 'week', '2026-W43')], 'later', 'week'],
    ['a coarse month period', [d('target', 'month', '2026-10')], 'later', 'later'],
    ['a quarter', [d('start', 'quarter', '2027-Q1')], 'later', 'later'],
    ['no dates', [], 'undated', 'undated'],
  ];

  it.each(cases)('%s', (_name, dates, sun, mon) => {
    expect(byDateGroup(card('i', { dates }), TODAY, 'sun')).toBe(sun);
    expect(byDateGroup(card('i', { dates }), TODAY, 'mon')).toBe(mon);
  });

  it('does not treat a closed item’s past deadline as overdue', () => {
    expect(byDateGroup(card('i', { status: 'done', dates: [d('deadline', 'day', '2026-10-15')] }), TODAY, 'sun')).toBe('undated');
  });

  it('hides Done, Dropped and archived items and orders by status then position', () => {
    const groups = groupByDate([
      card('late', { status: 'active', position: 2048, dates: [d('event', 'day', TODAY)] }),
      card('early', { status: 'active', position: 1024, dates: [d('event', 'day', TODAY)] }),
      card('inbox', { status: 'inbox', position: 9000, dates: [d('event', 'day', TODAY)] }),
      card('done', { status: 'done', dates: [d('event', 'day', TODAY)] }),
      card('dropped', { status: 'dropped' }),
      card('archived', { archived_at: '2026-10-02T00:00:00.000Z', dates: [d('event', 'day', TODAY)] }),
    ], SUN, NOW);
    expect(groups.today.map((i) => i.id)).toEqual(['inbox', 'early', 'late']);
    expect(groups.undated).toEqual([]);
  });

  it('never writes or relabels anything', () => {
    const items = exampleItems(TODAY);
    const before = structuredClone(items);
    groupByDate(items, SUN, NOW);
    expect(items).toEqual(before);
  });
});

describe('review buckets', () => {
  it('collects overdue, passed targets, stale, mismatched, unsorted and inbox items', () => {
    const items = [
      card('overdue', { dates: [d('deadline', 'day', '2026-10-01')] }),
      card('passed', { dates: [d('target', 'month', '2026-09')] }),
      card('stale', { status: 'active', updated_at: '2026-09-01T12:00:00.000Z' }),
      card('reviewed', { status: 'active', updated_at: '2026-09-01T12:00:00.000Z', reviewed_at: '2026-10-19T12:00:00.000Z' }),
      card('far', { horizon: 'now', dates: [d('target', 'day', '2027-06-01')] }),
      card('soon-deadline', { horizon: 'someday', dates: [d('deadline', 'day', '2026-11-01')] }),
      card('unsorted', { motivation: null }),
      card('inbox', { status: 'inbox', motivation: null }),
      card('closed', { status: 'done', dates: [d('deadline', 'day', '2026-10-01')] }),
      card('archived', { archived_at: '2026-10-02T00:00:00.000Z', dates: [d('deadline', 'day', '2026-10-01')] }),
    ];
    const b = reviewBucketsFor(items, SUN, NOW);
    expect(b.overdue.map((x) => x.item.id)).toEqual(['overdue']);
    expect(b.passedTargets.map((x) => x.item.id)).toEqual(['passed']);
    expect(b.stale.map((i) => i.id)).toEqual(['stale']);
    expect(b.mismatched.map((x) => x.item.id)).toEqual(['far', 'soon-deadline']);
    expect(b.unsorted.map((i) => i.id)).toEqual(['unsorted']);
    expect(b.inbox.map((i) => i.id)).toEqual(['inbox']);
  });

  it('honors stale_days', () => {
    const stale = card('stale', { status: 'active', updated_at: '2026-10-11T12:00:00.000Z' });
    expect(reviewBucketsFor([stale], { ...SUN, stale_days: 21 }, NOW).stale).toEqual([]);
    expect(reviewBucketsFor([stale], { ...SUN, stale_days: 10 }, NOW).stale.map((i) => i.id)).toEqual(['stale']);
  });
});

describe('filters', () => {
  const item = card('f', {
    area: 'Garden', horizon: 'soon', notes: 'Mulch the beds', next_steps: [{ id: 'step-01', text: 'Order compost', done: false }],
    references: [{ id: 'ref-001', kind: 'doc', label: 'Bed plan', url: '' }],
  });

  it('matches text across title, notes, steps and reference labels', () => {
    for (const q of ['mulch', 'COMPOST', 'bed plan', 'garden']) expect(matchesFilters(item, { ...EMPTY_FILTERS, q })).toBe(true);
    expect(matchesFilters(item, { ...EMPTY_FILTERS, q: 'kitchen' })).toBe(false);
  });

  it('matches fields, including unset with __none', () => {
    expect(matchesFilters(item, { ...EMPTY_FILTERS, area: 'Garden', horizon: 'soon' })).toBe(true);
    expect(matchesFilters(item, { ...EMPTY_FILTERS, priority: '__none' })).toBe(true);
    expect(matchesFilters(item, { ...EMPTY_FILTERS, area: '__none' })).toBe(false);
    expect(activeFilterCount({ ...EMPTY_FILTERS, q: 'x', area: 'Garden' })).toBe(2);
  });
});
