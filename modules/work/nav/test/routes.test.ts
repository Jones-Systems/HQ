import { describe, expect, it } from 'vitest';
import { isDestination } from '@hq/contracts';
import { itemDestination, NAV_ITEMS, pageDestination, parseWorkDestination, viewLinkDestination } from '../routes';

/** iface.domain-module.001 Work destinations, with T4 P-8. */
describe('Work destinations', () => {
  it('parses every documented destination', () => {
    expect(parseWorkDestination('home')).toStrictEqual({ kind: 'page', page: 'board' });
    expect(parseWorkDestination('board')).toStrictEqual({ kind: 'page', page: 'board' });
    expect(parseWorkDestination('board/by-date')).toStrictEqual({ kind: 'page', page: 'by-date' });
    expect(parseWorkDestination('lists')).toStrictEqual({ kind: 'page', page: 'by-date' });
    for (const page of ['glance', 'list', 'timeline', 'review', 'archive', 'settings'] as const) {
      expect(parseWorkDestination(page)).toStrictEqual({ kind: 'page', page });
    }
    expect(parseWorkDestination('calendar')).toStrictEqual({ kind: 'page', page: 'calendar' });
    expect(parseWorkDestination('calendar/2026-11')).toStrictEqual({ kind: 'page', page: 'calendar', month: '2026-11' });
    expect(parseWorkDestination('item/ex-bread')).toStrictEqual({ kind: 'item', itemId: 'ex-bread' });
    expect(parseWorkDestination('board/plan/weekly')).toStrictEqual({ kind: 'page', page: 'plan', planId: 'weekly' });
  });

  it('rejects malformed, foreign and URL-like destinations', () => {
    for (const destination of [
      '', ' home', 'https://example.com', '//host/board', 'calendar/2026-13', 'calendar/2026-1', 'item/', 'item/a/b',
      'item/-lead', 'board/plan/', 'board/plan/a/b', 'board/other', 'library', 'overview', 'x'.repeat(513),
    ]) {
      expect(parseWorkDestination(destination)).toBeNull();
    }
  });

  it('serializes only destinations that pass isDestination and parse back', () => {
    const destinations = [
      ...NAV_ITEMS.map((item) => item.destination),
      pageDestination({ kind: 'page', page: 'calendar', month: '2026-11' }),
      pageDestination({ kind: 'page', page: 'plan', planId: 'weekly' }),
      itemDestination('ex-bread'),
      viewLinkDestination({ view: 'board', column: 'next' }),
      viewLinkDestination({ view: 'by-date' }),
      viewLinkDestination({ view: 'review' }),
    ];
    for (const destination of destinations) {
      expect(isDestination(destination)).toBe(true);
      expect(parseWorkDestination(destination)).not.toBeNull();
    }
    expect(viewLinkDestination({ view: 'by-date' })).toBe('board/by-date');
  });

  it('round-trips page routes canonically', () => {
    for (const item of NAV_ITEMS) {
      const route = parseWorkDestination(item.destination);
      expect(route?.kind).toBe('page');
      if (route?.kind === 'page') expect(pageDestination(route)).toBe(item.destination);
    }
  });
});
