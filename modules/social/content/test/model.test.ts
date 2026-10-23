import { describe, expect, it } from 'vitest';
import { isDestination } from '@hq/contracts';
import { fictionalSeed, type Draft } from '../../core';
import {
  DEFAULT_FILTERS, calendarPlan, contentDestination, dateLabel, filterDrafts, isLibraryFilters, monthGrid, monthLabel,
  parseContentDestination, shiftMonth,
} from '../model';

const drafts: Draft[] = fictionalSeed().content;

describe('content destinations', () => {
  it.each([
    ['library', { page: 'library' }],
    ['library/new', { page: 'library', draftId: 'new' }],
    [`library/${'d'.repeat(32)}`, { page: 'library', draftId: 'd'.repeat(32) }],
    ['calendar', { page: 'calendar' }],
    ['calendar/2026-10', { page: 'calendar', month: '2026-10' }],
  ])('round-trips %s', (destination, location) => {
    expect(parseContentDestination(destination)).toEqual(location);
    expect(contentDestination(location as never)).toBe(destination);
    expect(isDestination(destination)).toBe(true);
  });

  it.each(['calendar/2026-13', 'calendar/26-10', 'library/a/b', 'library/../x', 'runs', 'home', ''])('rejects %j', (destination) => {
    expect(parseContentDestination(destination)).toBeNull();
  });
});

describe('library filters', () => {
  const titles = (filters: Partial<typeof DEFAULT_FILTERS>) => filterDrafts(drafts, { ...DEFAULT_FILTERS, ...filters }).map((draft) => draft.title);

  it('shows active drafts by default and archived ones on request', () => {
    expect(titles({})).not.toContain('Summer iced tea recap');
    expect(titles({ archived: 'archived' })).toEqual(['Summer iced tea recap']);
    expect(titles({ archived: 'all' })).toHaveLength(drafts.length);
  });

  it('filters by brand, channel, planned date and text', () => {
    expect(titles({ channel: 'X' })).toEqual(['Steeping times thread']);
    expect(titles({ planned: 'unplanned' }).sort()).toEqual(['Notes on a slower posting rhythm', 'Steeping times thread']);
    expect(titles({ brand: drafts.find((draft) => draft.title === 'Sourdough starter open day')!.brand_id })).toEqual(['Sourdough starter open day']);
    expect(titles({ query: 'BITTERNESS' })).toEqual(['Steeping times thread']);
  });

  it('accepts only well-formed stored filters', () => {
    expect(isLibraryFilters(DEFAULT_FILTERS)).toBe(true);
    expect(isLibraryFilters({ ...DEFAULT_FILTERS, channel: 'Mastodon' })).toBe(false);
    expect(isLibraryFilters(null)).toBe(false);
  });
});

describe('calendar model', () => {
  it('lays out a month Monday first, padded with neighbouring days', () => {
    const weeks = monthGrid('2026-10', '2026-10-20');
    expect(weeks).toHaveLength(5);
    expect(weeks[0]![0]).toEqual({ date: '2026-09-28', inMonth: false, isToday: false });
    expect(weeks.flat().find((day) => day.isToday)?.date).toBe('2026-10-20');
    expect(weeks.at(-1)!.at(-1)!.date).toBe('2026-11-01');
    expect(monthGrid('2027-02', '2026-10-20')).toHaveLength(4);
  });

  it('moves between months across years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthLabel('2026-10')).toBe('October 2026');
    expect(dateLabel('2026-10-24')).toBe('24 Oct 2026');
  });

  it('places active drafts by planned date and keeps undated ones in the tray', () => {
    const plan = calendarPlan(drafts, 'all');
    expect(plan.byDate.get('2026-10-24')?.map((draft) => draft.title)).toEqual(['Autumn blend tasting notes']);
    expect(plan.undated.map((draft) => draft.title)).toEqual(['Notes on a slower posting rhythm', 'Steeping times thread']);
    expect([...plan.byDate.values()].flat().some((draft) => draft.archived === 1)).toBe(false);
  });
});

import { calendarRange, draftGridEvent, gridPlanning } from '../calendar-time';
import { sameStoredFields } from '../actions';
import { FEATURE_HQ_EDITORIAL_TIMEBOX, draftFields } from '../../core';

describe('editorial calendar time conversion', () => {
  const draft = drafts.find((item) => item.planned_date && !item.archived)!;
  it('assigns 30 minutes, clamps a new 23:45 block to 15 and preserves an existing duration', () => {
    expect(gridPlanning(draft, '2026-10-22', 9 * 60, false, 'UTC')).toEqual({ ok: true, value: { planned_date: '2026-10-22', planning_slot: { start: '09:00', duration_minutes: 30, timezone: 'UTC' } } });
    expect(gridPlanning(draft, '2026-10-22', 1425, false, 'UTC')).toMatchObject({ ok: true, value: { planning_slot: { duration_minutes: 15 } } });
    const timed = { ...draft, planned_date: '2026-10-22', planning_slot: { start: '09:00', duration_minutes: 90, timezone: 'UTC' } };
    expect(gridPlanning(timed, '2026-10-23', 600, false, 'UTC')).toMatchObject({ ok: true, value: { planned_date: '2026-10-23', planning_slot: { start: '10:00', duration_minutes: 90 } } });
    expect(gridPlanning(timed, '2026-10-23', 1425, false, 'UTC').ok).toBe(false);
  });
  it('displays a source-zone slot across display midnight and saves grid movement back to its source zone', () => {
    const timed = { ...draft, planned_date: '2026-10-22', planning_slot: { start: '23:30', duration_minutes: 30, timezone: 'America/New_York' } };
    expect(draftGridEvent(timed, 'UTC')).toMatchObject({ day: '2026-10-23', start: 210, endDay: '2026-10-23', end: 240 });
    expect(gridPlanning(timed, '2026-10-23', 180, false, 'UTC')).toMatchObject({ ok: true, value: { planned_date: '2026-10-22', planning_slot: { start: '23:00', duration_minutes: 30, timezone: 'America/New_York' } } });
    expect(gridPlanning(timed, '2026-10-23', 240, true, 'UTC')).toMatchObject({ ok: true, value: { planning_slot: { start: '23:30', duration_minutes: 30 } } });
  });
  it('rejects ambiguous/skipped display drops and source-midnight overflow', () => {
    expect(gridPlanning(draft, '2026-03-08', 150, false, 'America/New_York').ok).toBe(false);
    expect(gridPlanning(draft, '2026-11-01', 90, false, 'America/New_York').ok).toBe(false);
    const timed = { ...draft, planned_date: '2026-10-22', planning_slot: { start: '23:30', duration_minutes: 30, timezone: 'UTC' } };
    expect(gridPlanning(timed, '2026-10-22', 1440, true, 'UTC').ok).toBe(true);
    expect(gridPlanning(timed, '2026-10-23', 15, true, 'UTC').ok).toBe(false);
    expect(draftGridEvent({ ...timed, archived: 1 }, 'UTC')).toBeNull();
  });
  it('compares canonical slots when reconciling unknown saves', () => {
    const timed = { ...draft, planning_slot: { start: '09:00', duration_minutes: 30, timezone: 'UTC' } };
    expect(draftFields(timed).planning_slot).toEqual(timed.planning_slot);
    expect(sameStoredFields(timed, draftFields(timed), [FEATURE_HQ_EDITORIAL_TIMEBOX])).toBe(true);
    expect(sameStoredFields(timed, { ...draftFields(timed), planning_slot: { ...timed.planning_slot, duration_minutes: 60 } }, [FEATURE_HQ_EDITORIAL_TIMEBOX])).toBe(false);
  });
  it('navigates Monday-first weeks and single days across month boundaries', () => {
    expect(calendarRange('2026-11-01', 'week')).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    expect(calendarRange('2026-11-01', 'day')).toEqual(['2026-11-01']);
  });
});
