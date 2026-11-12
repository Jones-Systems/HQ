import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../core';
import { planBoard, planDrop } from '../plan-week-model';
import { VIEW_TODAY, viewItems } from '../fixtures';
import { setup } from './harness';

afterEach(cleanup);

describe('Plan week source recovery', () => {
  it('maps Sunday and Monday starts to the same ISO week without shifting week precision', () => {
    const sun = planBoard([], { ...DEFAULT_SETTINGS, week_start: 'sun' }, VIEW_TODAY, 0);
    const mon = planBoard([], { ...DEFAULT_SETTINGS, week_start: 'mon' }, VIEW_TODAY, 0);
    expect(sun.start).toBe('2026-10-18');
    expect(mon.start).toBe('2026-10-19');
    expect(sun.weekValue).toBe('2026-W43');
    expect(mon.weekValue).toBe(sun.weekValue);
  });

  it('week conversion clears all clocks, keeps other dates and removes only the chosen entry', () => {
    const original = viewItems().find((i) => i.id === 'ex-library')!;
    const extra = { ...original.dates[0]!, id: 'other', value: '2026-11-12' };
    const item = { ...original, dates: [...original.dates, extra] };
    const card = { item, entry: item.dates[0]! };
    const week = planDrop(card, 'week', '2026-W43')!;
    expect(Object.keys(week.patch)).toEqual(['dates']);
    expect(week.patch.dates![0]).toMatchObject({ precision: 'week', value: '2026-W43', time: null, end_time: null, tz: null, kind: 'event' });
    expect(week.patch.dates![1]).toMatchObject(extra);
    expect(planDrop(card, 'backlog', '2026-W43')!.patch.dates).toEqual([extra]);
    expect(planDrop(card, card.entry.value, '2026-W43')).toBeNull();
  });

  it('keyboard planning makes one patch and Undo restores the undated item', async () => {
    const item = { ...viewItems().find((i) => i.id === 'ex-postcards')!, status: 'next' as const, dates: [] };
    const { container, rec, store } = await setup({ view: 'week', items: [item] });
    const row = container.querySelector<HTMLElement>('[data-plan-item]')!;
    fireEvent.keyDown(row, { key: 'ArrowRight', altKey: true });
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    expect(rec.writes()[0]!.method).toBe('patch');
    expect(store.getState().items[0]!.dates[0]).toMatchObject({ kind: 'target', precision: 'day', value: VIEW_TODAY });
    fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]!);
    await waitFor(() => expect(store.getState().items[0]!.dates).toEqual([]));
    expect(rec.writes()).toHaveLength(2);
  });

  it('triage digits stay inside Review and text inputs yield to typing', async () => {
    const { container, rec } = await setup({ view: 'review' });
    const inbox = screen.getByRole('region', { name: 'Sort the Inbox' });
    const row = inbox.querySelector<HTMLElement>('[data-triage]')!;
    let bubbled = 0;
    const listener = () => { bubbled++; };
    window.addEventListener('keydown', listener);
    try {
      fireEvent.keyDown(row, { key: '1' });
      await waitFor(() => expect(rec.writes()).toHaveLength(1));
      expect(bubbled).toBe(0);
      const input = within(container).getByRole('spinbutton', { name: 'Days before an active item counts as quiet' });
      fireEvent.keyDown(input, { key: '1' });
      expect(bubbled).toBe(1);
      expect(rec.writes()).toHaveLength(1);
    } finally { window.removeEventListener('keydown', listener); }
  });
});
