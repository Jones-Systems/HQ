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
