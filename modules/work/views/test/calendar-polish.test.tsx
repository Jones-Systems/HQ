import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlanningViews } from '../PlanningViews';
import { VIEW_NOW } from '../fixtures';
import { setup } from './harness';

afterEach(cleanup);

async function selectView(user: ReturnType<typeof userEvent.setup>, name: 'Month' | 'Week' | 'Day' | 'Agenda') {
  await user.click(screen.getByRole('button', { name: /^Calendar view:/ }));
  await user.click(screen.getByRole('menuitemradio', { name }));
}

describe('Calendar view navigation', () => {
  it('drills the full month header into the clicked week, then its day, without writes', async () => {
    const { container, rec } = await setup({ view: 'calendar' });
    const head = container.querySelector('[data-day="2026-10-30"] .wv-day-head')!;
    fireEvent.doubleClick(head);
    expect(screen.getByRole('button', { name: 'Calendar view: Week' })).toBeTruthy();
    expect(container.querySelector('[data-time-day="2026-10-30"]')).toBeTruthy();
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Open day 2026-10-30' }));
    expect(screen.getByRole('button', { name: 'Calendar view: Day' })).toBeTruthy();
    expect(container.querySelectorAll('[data-time-day]')).toHaveLength(1);
    expect(container.querySelector('[data-time-day="2026-10-30"]')).toBeTruthy();
    expect(rec.writes()).toEqual([]);
  });

  it.each(['Enter', ' ', 'assistive click'])('opens the number with %s and focuses the new heading', async (key) => {
    const { container, rec } = await setup({ view: 'calendar' });
    const number = within(container.querySelector('[data-day="2026-10-22"] .wv-day-head') as HTMLElement).getByRole('button', { name: /^Open week/ });
    fireEvent.click(number, { detail: 1 });
    expect(screen.getByRole('button', { name: 'Calendar view: Month' })).toBeTruthy();
    number.focus();
    if (key === 'assistive click') fireEvent.click(number, { detail: 0 });
    else fireEvent.keyDown(number, { key });
    expect(screen.getByRole('button', { name: 'Calendar view: Week' })).toBeTruthy();
    expect(document.activeElement).toBe(container.querySelector('.wv-cal-title'));
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'Open day 2026-10-22' }).focus();
    await user.keyboard(key === ' ' ? ' ' : '{Enter}');
    expect(container.querySelector('[data-time-day="2026-10-22"]')).toBeTruthy();
    expect(container.querySelectorAll('[data-time-day]')).toHaveLength(1);
    expect(document.activeElement).toBe(container.querySelector('.wv-cal-title'));
    expect(rec.writes()).toEqual([]);
  });

  it('double-clicks the number to drill but leaves capture clicks on the month', async () => {
    const capture = vi.fn();
    const { container, rec } = await setup({ view: 'calendar', capture });
    const user = userEvent.setup();
    const head = container.querySelector('[data-day="2026-10-22"] .wv-day-head') as HTMLElement;
    await user.dblClick(within(head).getByRole('button', { name: /^New item on/ }));
    expect(capture).toHaveBeenCalled();
    expect(capture.mock.calls.every(([value]) => value.date.value === '2026-10-22')).toBe(true);
    expect(screen.getByRole('button', { name: 'Calendar view: Month' })).toBeTruthy();
    await user.dblClick(within(head).getByRole('button', { name: /^Open week/ }));
    expect(screen.getByRole('button', { name: 'Calendar view: Week' })).toBeTruthy();
    expect(rec.writes()).toEqual([]);
  });

  it('offers all four modes in one radio menu, retaining the clicked anchor and remembered mode', async () => {
    const user = userEvent.setup();
    const { container, rec, store, unmount } = await setup({ view: 'calendar' });
    fireEvent.doubleClick(container.querySelector('[data-day="2026-10-30"] .wv-day-head')!);
    await selectView(user, 'Month');
    await user.click(screen.getByRole('button', { name: 'Calendar view: Month' }));
    expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent?.replace('✓', '').trim())).toEqual(['Month', 'Week', 'Day', 'Agenda']);
    expect(screen.getByRole('menuitemradio', { name: 'Month' }).getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('menuitemradio', { name: 'Day' }));
    expect(container.querySelector('[data-time-day="2026-10-30"]')).toBeTruthy();
    await selectView(user, 'Agenda');
    expect(screen.getByRole('heading', { level: 2, name: /October/ })).toBeTruthy();
    await selectView(user, 'Day');
    unmount();
    const restored = render(<PlanningViews store={store} view="calendar" now={() => new Date(VIEW_NOW)} pollMs={3_600_000} />);
    expect(screen.getByRole('button', { name: 'Calendar view: Day' })).toBeTruthy();
    expect(restored.container.querySelector('[data-time-day="2026-10-30"]')).toBeTruthy();
    expect(rec.writes()).toEqual([]);
  });

  it('uses the first of another shown month and retains an adjacent-cell drill anchor', async () => {
    const user = userEvent.setup();
    const { container, rec } = await setup({ view: 'calendar' });
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await selectView(user, 'Day');
    expect(container.querySelector('[data-time-day="2026-11-01"]')).toBeTruthy();
    await selectView(user, 'Month');
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await selectView(user, 'Day');
    expect(container.querySelector('[data-time-day="2026-10-21"]')).toBeTruthy();
    await selectView(user, 'Month');
    fireEvent.doubleClick(container.querySelector('[data-day="2026-09-30"] .wv-day-head')!);
    await selectView(user, 'Day');
    expect(container.querySelector('[data-time-day="2026-09-30"]')).toBeTruthy();
    await selectView(user, 'Month');
    expect(screen.getByRole('heading', { level: 2, name: /September/ })).toBeTruthy();
    expect(rec.writes()).toEqual([]);
  });
});
