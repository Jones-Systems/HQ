import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VIEW_NOW } from '../fixtures';
import { PlanningViews } from '../PlanningViews';
import { lastWrite, setup } from './harness';

// RV-4 Calendar and Timeline moves: each produces the Planner's documented
// patch and offers Undo. A day-date move patches the full `dates` list with
// only that entry's value changed (kind, time, zone and note kept, derived
// fields stripped); a timeline move patches `{ horizon }`.

afterEach(cleanup);

const SHED_DEADLINE = { id: 'date-shed-dl', kind: 'deadline', precision: 'day', time: null, end_time: null, tz: null, note: '' };

function chip(title: string) {
  return screen.getByRole('button', { name: new RegExp(`^${title}, `) });
}

async function pick(user: ReturnType<typeof userEvent.setup>, trigger: HTMLElement, item: string) {
  await user.click(trigger);
  await user.click(screen.getByRole('menuitem', { name: item }));
}

async function showCalendarView(user: ReturnType<typeof userEvent.setup>, name: 'Month' | 'Week' | 'Day' | 'Agenda') {
  await user.click(screen.getByRole('button', { name: /^Calendar view:/ }));
  await user.click(screen.getByRole('menuitemradio', { name }));
}

describe('Calendar moves', () => {
  it('"One day later" patches only that date’s value, keeps the rest, and Undo restores it', async () => {
    const user = userEvent.setup();
    const { rec } = await setup({ view: 'calendar' });
    await pick(user, chip('Repaint the garden shed'), 'One day later · Alt+→');
    await waitFor(() => expect(lastWrite(rec)?.method).toBe('patch'));
    const [id, revision, patch] = lastWrite(rec)!.args;
    expect([id, revision]).toEqual(['ex-shed-paint', 1]);
    expect(patch).toEqual({ dates: [{ ...SHED_DEADLINE, value: '2026-10-25' }] });

    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(rec.writes()).toHaveLength(2));
    expect(lastWrite(rec)!.args.slice(0, 3)).toEqual(['ex-shed-paint', 2, { dates: [{ ...SHED_DEADLINE, value: '2026-10-24' }] }]);
    expect(await screen.findByText('Undone.')).toBeTruthy();
  });

  it('menu offers one day earlier, one day later and one week later for a day date', async () => {
    const user = userEvent.setup();
    const { rec } = await setup({ view: 'calendar' });
    await pick(user, chip('Repaint the garden shed'), 'One day earlier · Alt+←');
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    expect((lastWrite(rec)!.args[2] as { dates: { value: string }[] }).dates[0]!.value).toBe('2026-10-23');
    await pick(user, chip('Repaint the garden shed'), 'One week later · Alt+↓');
    await waitFor(() => expect(rec.writes()).toHaveLength(2));
    expect((lastWrite(rec)!.args[2] as { dates: { value: string }[] }).dates[0]!.value).toBe('2026-10-30');
  });

  it('Alt+→ keeps a timed date’s time and zone and strips the derived instant', async () => {
    const { rec } = await setup({ view: 'calendar' });
    fireEvent.keyDown(chip('Renew the library card'), { key: 'ArrowRight', altKey: true });
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    const patch = lastWrite(rec)!.args[2] as { dates: Record<string, unknown>[] };
    expect(patch.dates).toEqual([{
      id: 'date-library', kind: 'event', precision: 'day', value: '2026-10-22', time: '10:30', end_time: null, tz: 'America/New_York', note: '',
    }]);
    expect(Object.keys(patch.dates[0]!)).not.toContain('instant');
    expect(Object.keys(patch.dates[0]!)).not.toContain('tz_abbr');
    // The menu did not open from Alt+ArrowRight or Alt+ArrowDown.
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('Alt+↓ moves a week, keeps focus on the chip, and follows the date into the next month', async () => {
    const { rec } = await setup({ view: 'calendar' });
    fireEvent.keyDown(chip('Sing at the winter fair'), { key: 'ArrowDown', altKey: true });
    // Before the move lands: Alt+ArrowDown must not also open the chip's menu.
    expect(screen.queryByRole('menu')).toBeNull();
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    expect((lastWrite(rec)!.args[2] as { dates: { value: string }[] }).dates[0]!.value).toBe('2026-10-30');
    await waitFor(() => expect(document.activeElement).toBe(chip('Sing at the winter fair')));
    fireEvent.keyDown(chip('Sing at the winter fair'), { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(rec.writes()).toHaveLength(2));
    expect((lastWrite(rec)!.args[2] as { dates: { value: string }[] }).dates[0]!.value).toBe('2026-11-06');
    expect(screen.getByRole('heading', { level: 2, name: /November/ })).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('"Remove this date" patches the dates without that entry', async () => {
    const user = userEvent.setup();
    const { rec } = await setup({ view: 'calendar' });
    await pick(user, chip('Repaint the garden shed'), 'Remove this date');
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    expect(lastWrite(rec)!.args.slice(0, 3)).toEqual(['ex-shed-paint', 1, { dates: [] }]);
  });

  it('Schedule from the Unscheduled tray asks for the kind and adds a day date on today', async () => {
    const user = userEvent.setup();
    const { rec } = await setup({ view: 'calendar' });
    const tray = screen.getByRole('region', { name: 'Unscheduled items' });
    expect(within(tray).getByText('Sort the old postcards')).toBeTruthy();
    expect(within(tray).getByText('Tune up the old bicycle')).toBeTruthy();
    await user.click(within(tray).getByRole('button', { name: /^Schedule “Sort the old postcards” on Wed, Oct 21 2026/ }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Target (default)', 'Deadline', 'Start', 'Event']);
    await user.click(screen.getByRole('menuitem', { name: 'Deadline' }));
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    const [id, , patch] = lastWrite(rec)!.args as [string, number, { dates: Record<string, unknown>[] }];
    expect(id).toBe('ex-postcards');
    expect(patch.dates).toHaveLength(1);
    expect(patch.dates[0]).toMatchObject({ kind: 'deadline', precision: 'day', value: '2026-10-21', time: null, tz: null, note: '' });
  });

  it('dragging a day chip to another day reschedules it; dropping it on the tray removes it', async () => {
    const { rec, container } = await setup({ view: 'calendar' });
    const holder = (title: string) => chip(title).closest<HTMLElement>('[data-focus-key]')!;
    fireEvent.dragStart(holder('Repaint the garden shed'));
    const day = container.querySelector<HTMLElement>('.wv-month [data-day="2026-10-27"]')!;
    fireEvent.dragOver(day);
    fireEvent.drop(day);
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    expect(lastWrite(rec)!.args[2]).toEqual({ dates: [{ ...SHED_DEADLINE, value: '2026-10-27' }] });

    fireEvent.dragStart(holder('Sing at the winter fair'));
    const tray = screen.getByRole('region', { name: 'Unscheduled items' });
    fireEvent.dragOver(tray);
    fireEvent.drop(tray);
    await waitFor(() => expect(rec.writes()).toHaveLength(2));
    expect(lastWrite(rec)!.args.slice(0, 3)).toEqual(['ex-choir', 1, { dates: [] }]);
  });

  it('dragging an unscheduled item onto a day asks which kind of date to create', async () => {
    const user = userEvent.setup();
    const { rec, container } = await setup({ view: 'calendar' });
    const tray = screen.getByRole('region', { name: 'Unscheduled items' });
    fireEvent.dragStart(within(tray).getByText('Tune up the old bicycle').closest<HTMLElement>('[draggable="true"]')!);
    const day = container.querySelector<HTMLElement>('.wv-month [data-day="2026-10-29"]')!;
    fireEvent.drop(day);
    const dialog = await screen.findByRole('dialog', { name: 'Add to Thu, Oct 29 as…' });
    expect(rec.writes()).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Start' }));
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    expect((lastWrite(rec)!.args[2] as { dates: unknown[] }).dates[0]).toMatchObject({ kind: 'start', precision: 'day', value: '2026-10-29' });
  });

  it('is honest about precision: a month date sits in the band, never on a day', async () => {
    const user = userEvent.setup();
    const { container } = await setup({ view: 'calendar' });
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByRole('heading', { level: 2, name: /December/ })).toBeTruthy();
    const band = screen.getByRole('region', { name: 'Dates without a set day' });
    expect(within(band).getByRole('button', { name: /^Finish the patchwork quilt, Target/ })).toBeTruthy();
    expect(container.querySelector('.wv-month')!.textContent).not.toContain('Finish the patchwork quilt');
    // Coarse dates have no day moves.
    await user.click(within(band).getByRole('button', { name: /^Finish the patchwork quilt/ }));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Remove this date']);
  });

  it('lists earlier open dates and later dates outside the shown month; events never count as earlier', async () => {
    const user = userEvent.setup();
    await setup({ view: 'calendar' });
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    const outside = screen.getByRole('region', { name: 'Outside this month' });
    expect(within(outside).getByText('Earlier, still open')).toBeTruthy();
    expect(within(outside).getByText('Return the seed-swap tray')).toBeTruthy();
    expect(within(outside).getByText('Sketch next year’s vegetable beds')).toBeTruthy();
    expect(within(outside).queryByText('Renew the library card')).toBeNull();
    expect(within(outside).getByText('Later')).toBeTruthy();
  });

  it('honors week_start in the month grid and switches to the agenda layout', async () => {
    const user = userEvent.setup();
    const { container } = await setup({ view: 'calendar', settings: { default_tz: 'America/New_York', week_start: 'mon', stale_days: 21 } });
    expect(container.querySelector('.wv-month-head')!.textContent).toBe('MonTueWedThuFriSatSun');
    await showCalendarView(user, 'Agenda');
    expect(screen.getByRole('button', { name: 'Calendar view: Agenda' })).toBeTruthy();
    expect(container.querySelector('.wv-agenda')!.textContent).toContain('Sat, Oct 24 · in 3 days');
    expect(container.querySelector('.wv-month')).toBeNull();
  });

  it('remembers the shown month across a remount (domain switch)', async () => {
    const user = userEvent.setup();
    const { store, unmount } = await setup({ view: 'calendar' });
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    unmount();
    render(<PlanningViews store={store} view="calendar" now={() => new Date(VIEW_NOW)} pollMs={3_600_000} />);
    expect(screen.getByRole('heading', { level: 2, name: /November/ })).toBeTruthy();
  });
});

describe('Timeline moves', () => {
  const row = (title: string) => screen.getByLabelText(new RegExp(`^${title}, horizon `));

  it('Alt+↓ patches the next lane’s horizon and Undo restores it', async () => {
    const user = userEvent.setup();
    const { rec } = await setup({ view: 'timeline' });
    fireEvent.keyDown(row('Repaint the garden shed'), { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    expect(lastWrite(rec)!.args.slice(0, 3)).toEqual(['ex-shed-paint', 1, { horizon: 'soon' }]);
    expect(within(screen.getByRole('region', { name: /^Soon lane/ })).getByText('Repaint the garden shed')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(row('Repaint the garden shed')));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(rec.writes()).toHaveLength(2));
    expect(lastWrite(rec)!.args.slice(0, 3)).toEqual(['ex-shed-paint', 2, { horizon: 'now' }]);
  });

  it('Alt+↑ from Now and Alt+↓ from No horizon do nothing', async () => {
    const { rec } = await setup({ view: 'timeline' });
    fireEvent.keyDown(row('Repaint the garden shed'), { key: 'ArrowUp', altKey: true });
    fireEvent.keyDown(row('Renew the library card'), { key: 'ArrowDown', altKey: true });
    await act(async () => { await Promise.resolve(); });
    expect(rec.writes()).toHaveLength(0);
  });

  it('M opens the horizon menu; choosing No horizon patches null', async () => {
    const user = userEvent.setup();
    const { rec } = await setup({ view: 'timeline' });
    row('Learn three bread recipes').focus();
    await user.keyboard('m');
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Now', 'Soon · current', 'Later', 'Someday', 'No horizon']);
    await user.click(screen.getByRole('menuitem', { name: 'No horizon' }));
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    expect(lastWrite(rec)!.args.slice(0, 3)).toEqual(['ex-bread', 1, { horizon: null }]);
  });

  it('dragging a row to another lane patches that horizon', async () => {
    const { rec } = await setup({ view: 'timeline' });
    fireEvent.dragStart(row('Tune up the old bicycle'));
    const lane = screen.getByRole('region', { name: /^Later lane/ });
    fireEvent.dragOver(lane);
    fireEvent.drop(lane);
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    expect(lastWrite(rec)!.args.slice(0, 3)).toEqual(['ex-bike', 1, { horizon: 'later' }]);
  });

  it('draws a bar only between a start date and a later end, and shows eight quarters', async () => {
    const { container } = await setup({ view: 'timeline' });
    expect([...container.querySelectorAll('.wv-tl-tick')].map((t) => t.textContent)).toEqual([
      '2026 · Q4', '2027 · Q1', 'Q2', 'Q3', 'Q4', '2028 · Q1', 'Q2', 'Q3',
    ]);
    const spans = container.querySelectorAll<HTMLElement>('.wv-tl-span');
    expect(spans).toHaveLength(1);
    expect(spans[0]!.closest('.wv-tl-row')!.textContent).toContain('Finish the patchwork quilt');
    // Positions are CSSOM custom properties, never inline style attributes from markup.
    expect(spans[0]!.style.getPropertyValue('--wv-left')).toMatch(/%$/);
    expect(row('Tune up the old bicycle').closest('.wv-tl-row')!.textContent).toContain('Unscheduled');
  });
});

describe('timed calendar interaction', () => {
  it('switches range modes, navigates week/day and returns to Today without writes', async () => {
    const user = userEvent.setup();
    const { rec, container } = await setup({ view: 'calendar' });
    await showCalendarView(user, 'Week');
    expect(container.querySelectorAll('[data-time-day]')).toHaveLength(7);
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(container.querySelector('[data-time-day="2026-10-28"]')).toBeTruthy();
    await showCalendarView(user, 'Day');
    expect(container.querySelectorAll('[data-time-day]')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(container.querySelector('[data-time-day="2026-10-21"]')).toBeTruthy();
    const layout = screen.getByRole('group', { name: 'Calendar layout' });
    expect(within(layout).getAllByRole('button')).toHaveLength(1);
    await showCalendarView(user, 'Month');
    expect(within(layout).getByRole('button', { name: 'Calendar view: Month' })).toBeTruthy();
    expect(container.querySelectorAll('[data-time-day]')).toHaveLength(0);
    await showCalendarView(user, 'Agenda');
    expect(container.querySelector('.wv-agenda')).toBeTruthy();
    await showCalendarView(user, 'Month');
    expect(container.querySelector('.wv-month')).toBeTruthy();
    expect(rec.writes()).toHaveLength(0);
  });

  it('moves 15 minutes by keyboard, resizes explicitly, and offers Undo for each single patch', async () => {
    const user = userEvent.setup();
    const { rec } = await setup({ view: 'calendar' });
    await showCalendarView(user, 'Day');
    const event = () => screen.getByRole('button', { name: /^Renew the library card, 10:/ });
    fireEvent.keyDown(event(), { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    expect((lastWrite(rec)!.args[2] as { dates: unknown[] }).dates[0]).toMatchObject({ time: '10:45', end_time: null });
    fireEvent.keyDown(event(), { key: 'ArrowDown', altKey: true, shiftKey: true });
    await waitFor(() => expect(rec.writes()).toHaveLength(2));
    expect((lastWrite(rec)!.args[2] as { dates: unknown[] }).dates[0]).toMatchObject({ time: '10:45', end_time: '11:30' });
    await user.click(screen.getAllByRole('button', { name: 'Undo' }).at(-1)!);
    await waitFor(() => expect(rec.writes()).toHaveLength(3));
    expect((lastWrite(rec)!.args[2] as { dates: unknown[] }).dates[0]).toMatchObject({ time: '10:45', end_time: null });
  });

  it('requires date kind before scheduling a grid drop and rejects a stale drag after dragend', async () => {
    const user = userEvent.setup();
    const { rec, container } = await setup({ view: 'calendar' });
    await showCalendarView(user, 'Day');
    const tray = screen.getByRole('region', { name: 'Unscheduled items' });
    const undated = within(tray).getByText('Tune up the old bicycle').closest<HTMLElement>('[draggable="true"]')!;
    fireEvent.dragStart(undated);
    // Happy DOM has no DragEvent constructor; a MouseEvent preserves the drop's client coordinates.
    fireEvent(container.querySelector('[data-time-day="2026-10-21"]')!, new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: 432 }));
    expect(rec.writes()).toHaveLength(0);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Event' }));
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    expect((lastWrite(rec)!.args[2] as { dates: unknown[] }).dates[0]).toMatchObject({ kind: 'event', time: '09:00', end_time: '09:30' });
    const other = within(tray).getByText('Sort the old postcards').closest<HTMLElement>('[draggable="true"]')!;
    fireEvent.dragStart(other);
    fireEvent.dragEnd(other);
    fireEvent(container.querySelector('[data-time-day="2026-10-21"]')!, new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: 432 }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rec.writes()).toHaveLength(1);
  });
});


describe('calendar pointer commits', () => {
  const geometry = () => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, left: 0, top: 0, right: 700, bottom: 1152, width: 700, height: 1152, toJSON: () => ({}),
  });

  it('previews without writes, commits once on drop, and a click or Escape never patches', async () => {
    const user = userEvent.setup();
    const { rec, container } = await setup({ view: 'calendar' });
    await showCalendarView(user, 'Day');
    const rect = geometry();
    try {
      const event = screen.getByRole('button', { name: /^Renew the library card, 10:30 a\.m\./ });
      fireEvent.pointerDown(event, { pointerId: 1, button: 0, clientX: 100, clientY: 510 });
      fireEvent.pointerUp(window, { pointerId: 1, clientX: 100, clientY: 510 });
      expect(rec.writes()).toHaveLength(0);
      fireEvent.pointerDown(event, { pointerId: 2, button: 0, clientX: 100, clientY: 510 });
      fireEvent.pointerMove(window, { pointerId: 2, clientX: 100, clientY: 534 });
      expect(container.querySelector('.hq-calendar-time-preview')).toBeTruthy();
      expect(rec.writes()).toHaveLength(0);
      fireEvent.keyDown(window, { key: 'Escape' });
      fireEvent.pointerUp(window, { pointerId: 2, clientX: 100, clientY: 534 });
      expect(rec.writes()).toHaveLength(0);
      expect(container.querySelector('.hq-calendar-time-preview')).toBeNull();
      fireEvent.pointerDown(event, { pointerId: 3, button: 0, clientX: 100, clientY: 510 });
      fireEvent.pointerMove(window, { pointerId: 3, clientX: 100, clientY: 534 });
      fireEvent.pointerUp(window, { pointerId: 3, clientX: 100, clientY: 534 });
      await waitFor(() => expect(rec.writes()).toHaveLength(1));
      expect((lastWrite(rec)!.args[2] as { dates: unknown[] }).dates[0]).toMatchObject({ time: '11:00', end_time: null });
    } finally { rect.mockRestore(); }
  });

  it('resizes from the lower edge and clears all time fields when moved to all day', async () => {
    const user = userEvent.setup();
    const { rec, container } = await setup({ view: 'calendar' });
    await showCalendarView(user, 'Day');
    const rect = geometry();
    try {
      fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize Renew the library card' }), { pointerId: 5, button: 0, clientX: 100, clientY: 527 });
      fireEvent.pointerMove(window, { pointerId: 5, clientX: 100, clientY: 552 });
      expect(rec.writes()).toHaveLength(0);
      fireEvent.pointerUp(window, { pointerId: 5, clientX: 100, clientY: 552 });
      await waitFor(() => expect(rec.writes()).toHaveLength(1));
      expect((lastWrite(rec)!.args[2] as { dates: unknown[] }).dates[0]).toMatchObject({ time: '10:30', end_time: '11:30' });
      const hit = vi.spyOn(document, 'elementFromPoint').mockReturnValue(container.querySelector('[data-grid-all-day="2026-10-21"]'));
      try {
        fireEvent.pointerDown(screen.getByRole('button', { name: /^Renew the library card, 10:30 a\.m\./ }), { pointerId: 6, button: 0, clientX: 100, clientY: 510 });
        fireEvent.pointerMove(window, { pointerId: 6, clientX: 100, clientY: 10 });
        fireEvent.pointerUp(window, { pointerId: 6, clientX: 100, clientY: 10 });
        await waitFor(() => expect(rec.writes()).toHaveLength(2));
        expect((lastWrite(rec)!.args[2] as { dates: unknown[] }).dates[0]).toMatchObject({ value: '2026-10-21', time: null, end_time: null, tz: null });
      } finally { hit.mockRestore(); }
    } finally { rect.mockRestore(); }
  });
});


describe('calendar sidebar', () => {
  it('remembers its resized width, keeps content mounted when collapsed, and still accepts a remove-date drop', async () => {
    const { rec } = await setup({ view: 'calendar' });
    const sidebar = screen.getByRole('complementary', { name: 'Calendar sidebar' });
    const splitter = screen.getByRole('separator', { name: 'Calendar sidebar width' });
    fireEvent.keyDown(splitter, { key: 'ArrowLeft', shiftKey: true });
    expect(splitter.getAttribute('aria-valuenow')).toBe('312');
    fireEvent.keyDown(splitter, { key: 'Home' });
    expect(splitter.getAttribute('aria-valuenow')).toBe('0');
    expect(screen.queryByRole('complementary', { name: 'Calendar sidebar' })).toBeNull();
    expect(sidebar.isConnected).toBe(true);
    expect(rec.writes()).toHaveLength(0);
    fireEvent.dragStart(chip('Repaint the garden shed').closest<HTMLElement>('[data-focus-key]')!);
    fireEvent.drop(screen.getByRole('region', { name: 'Remove date' }));
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    expect(lastWrite(rec)!.args.slice(0, 3)).toEqual(['ex-shed-paint', 1, { dates: [] }]);
    fireEvent.click(screen.getByRole('button', { name: 'Show calendar sidebar' }));
    expect(screen.getByRole('complementary', { name: 'Calendar sidebar' })).toBe(sidebar);
    expect(splitter.getAttribute('aria-valuenow')).toBe('312');
    expect(rec.writes()).toHaveLength(1);
  });
});
