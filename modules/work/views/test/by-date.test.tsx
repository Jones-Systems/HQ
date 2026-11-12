import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { addDays, type Item } from '../../core';
import { BY_DATE_BANNER, BY_DATE_INERT } from '../ByDate';
import { VIEW_TODAY, viewItems } from '../fixtures';
import { lastWrite, setup } from './harness';

// RV-5 By date: groups come only from each item's own dates, This week is
// bounded by the Planner's week_start, undated items stay Undated, and the
// board never writes from placement. Horizons are shown as the Planner labels
// them and are never mapped to Today or This week.

afterEach(cleanup);

const titles = (group: string) => {
  const section = document.querySelector<HTMLElement>(`[data-group="${group}"]`)!;
  return [...section.querySelectorAll('.wv-card-title')].map((t) => t.textContent);
};

/** Wed Oct 21 + 4 = Sun Oct 25: outside a Sunday-start week, inside a Monday-start week. */
const sundayItem: Item = {
  ...viewItems()[0]!, id: 'ex-sunday-swim', title: 'Swim at the lido', status: 'next', horizon: 'someday', motivation: null,
  priority: null, area: null, next_steps: [],
  dates: [{ id: 'date-swim', kind: 'target', precision: 'day', value: addDays(VIEW_TODAY, 4), time: null, end_time: null, tz: null, note: '' }],
};

describe('By date board', () => {
  it('groups by actual dates only and keeps undated and passed-target items in Undated', async () => {
    await setup({ view: 'by-date' });
    expect(titles('today')).toEqual(['Renew the library card', 'Return the seed-swap tray']);
    expect(titles('week')).toEqual(['Sing at the winter fair', 'Repaint the garden shed']);
    expect(titles('later')).toEqual([
      'Draft the spring market stall list', 'Plan a stargazing night', 'Learn three bread recipes', 'Walk the coastal path end to end', 'Finish the patchwork quilt',
    ]);
    expect(titles('undated')).toEqual(['Sort the old postcards', 'Sketch next year’s vegetable beds', 'Tune up the old bicycle']);
    // Done, Dropped and archived items are hidden.
    for (const hidden of ['Build a box kite', 'Dig a garden pond', 'Copy out the old recipe cards']) expect(screen.queryByText(hidden)).toBeNull();
    // Each group states its rule.
    expect(screen.getByText('A day or week date later in this week (to Sat, Oct 24)')).toBeTruthy();
    expect(screen.getByText('No current or upcoming date. Dates are never invented')).toBeTruthy();
  });

  it('never relabels a horizon: a Someday item in This week still says Someday, and Now items are not forced into Today', async () => {
    await setup({ view: 'by-date', items: [...viewItems(), sundayItem], settings: { default_tz: 'America/New_York', week_start: 'mon', stale_days: 21 } });
    const card = screen.getByRole('article', { name: /^Swim at the lido/ });
    expect(card.closest('[data-group]')!.getAttribute('data-group')).toBe('week');
    expect(within(card).getByText('Someday')).toBeTruthy();
    // "Walk the coastal path" has horizon Now but a date 200 days out: it is Later, not Today.
    expect(titles('later')).toContain('Walk the coastal path end to end');
    expect(within(screen.getByRole('article', { name: /^Walk the coastal path/ })).getByText('Now')).toBeTruthy();
  });

  it('honors week_start: Sunday the 25th is Later in a Sunday-start week and This week in a Monday-start week', async () => {
    const sun = await setup({ view: 'by-date', items: [...viewItems(), sundayItem] });
    expect(titles('later')).toContain('Swim at the lido');
    expect(titles('week')).not.toContain('Swim at the lido');
    sun.unmount();
    await setup({ view: 'by-date', items: [...viewItems(), sundayItem], settings: { default_tz: 'America/New_York', week_start: 'mon', stale_days: 21 } });
    expect(titles('week')).toContain('Swim at the lido');
    expect(screen.getByText('A day or week date later in this week (to Sun, Oct 25)')).toBeTruthy();
  });

  it('is read-only: drag and Alt+arrow moves are inert and explained, and nothing is written', async () => {
    const { rec } = await setup({ view: 'by-date' });
    expect(screen.getByText(/Grouped from each card's own dates\./).closest('[role="note"]')!.textContent)
      .toContain("This board is read-only, so dragging is off. To move a card to another group, change its date in the card. Status and horizon don't change here. Done and Dropped are hidden.");
    const card = screen.getByRole('article', { name: /^Repaint the garden shed/ });
    expect(card.getAttribute('draggable')).toBe('false');
    fireEvent.dragStart(card);
    const later = document.querySelector<HTMLElement>('[data-group="later"]')!;
    fireEvent.dragOver(later);
    fireEvent.drop(later);
    for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) fireEvent.keyDown(card, { key, altKey: true });
    await act(async () => { await Promise.resolve(); });
    expect(rec.writes()).toEqual([]);
    expect(screen.getAllByRole('status').some((s) => s.textContent?.startsWith(BY_DATE_INERT))).toBe(true);
    expect(card.closest('[data-group]')!.getAttribute('data-group')).toBe('week');
  });

  it('the move menu offers status moves only (no reorder items) and a status move never writes a date or horizon', async () => {
    const user = userEvent.setup();
    const { rec } = await setup({ view: 'by-date' });
    const card = screen.getByRole('article', { name: /^Repaint the garden shed/ });
    card.focus();
    await user.keyboard('m');
    const labels = screen.getAllByRole('menuitem').map((i) => i.textContent);
    expect(labels).toEqual(['Inbox', 'Considering', 'Next', 'Active', 'On hold', 'Done', 'Dropped']);
    for (const reorder of ['Move up', 'Move down', 'Move to top', 'Move to bottom']) expect(labels).not.toContain(reorder);
    expect(screen.getByRole('menuitem', { name: 'Active' }).getAttribute('aria-disabled')).toBe('true');
    await user.keyboard('{Escape}');
    expect(rec.writes()).toEqual([]);

    await user.click(within(card).getByRole('button', { name: 'Move “Repaint the garden shed” to a status' }));
    await user.click(screen.getByRole('menuitem', { name: 'On hold' }));
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    expect(lastWrite(rec)!.method).toBe('move');
    expect(lastWrite(rec)!.args.slice(0, 4)).toEqual(['ex-shed-paint', 1, 'on_hold', { place: 'top' }]);
    expect(rec.writes().some((w) => w.method === 'patch')).toBe(false);
  });

  it('uses the shared page header and board look: a titled header with a count, one quiet read-only note and no banner', async () => {
    await setup({ view: 'by-date' });
    const heading = screen.getByRole('heading', { level: 2, name: 'By date' });
    const header = heading.closest('header')!;
    expect(within(header).getByText('12 open cards')).toBeTruthy();
    // The read-only explanation is a quiet line inside the header, not a full-width banner.
    const note = within(header).getByRole('note');
    expect(note.textContent).toContain(BY_DATE_BANNER);
    expect(document.querySelector('.wv-bydate .wv-banner')).toBeNull();
    // Columns and cards are the Status board's: same card, chip and count classes.
    const column = document.querySelector<HTMLElement>('[data-group="week"]')!;
    expect(column.querySelector('.wv-count.wk-count')!.textContent).toBe('2');
    const card = within(column).getByRole('article', { name: /^Repaint the garden shed/ });
    expect(card.classList.contains('work-card')).toBe(true);
    expect(card.querySelector('.work-chips .wk-chip')).not.toBeNull();
  });

  it('has no Done control and no drag ghost: pointer drags are inert and nothing is written', async () => {
    const { rec } = await setup({ view: 'by-date' });
    expect(screen.queryByRole('button', { name: /^Mark “.*” done$/ })).toBeNull();
    const card = screen.getByRole('article', { name: /^Repaint the garden shed/ });
    const first = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 };
    fireEvent.pointerDown(card, first);
    fireEvent.pointerMove(window, { ...first, clientX: 140 });
    fireEvent.pointerMove(window, { ...first, clientX: 600, clientY: 160 });
    fireEvent.pointerUp(window, { ...first, clientX: 600, clientY: 160 });
    expect(document.querySelector('.work-drag-ghost')).toBeNull();
    expect(card.closest('[data-group]')!.getAttribute('data-group')).toBe('week');
    // Alt+arrow still announces that the board is read-only, and the key is handled (default prevented).
    const key = new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true });
    await act(async () => { card.dispatchEvent(key); });
    expect(key.defaultPrevented).toBe(true);
    expect(screen.getAllByRole('status').some((s) => s.textContent?.startsWith(BY_DATE_INERT))).toBe(true);
    expect(rec.writes()).toEqual([]);
  });

  it('reads one way at narrow widths: columns reflow with no tabs and no horizontal scroller', async () => {
    await setup({ view: 'by-date' });
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(document.querySelector('.work-columns')).toBeNull();
    expect(document.querySelectorAll('[data-board-kind="by-date"] > .wv-col')).toHaveLength(4);
  });
});
