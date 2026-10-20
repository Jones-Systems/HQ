import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
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
    await user.click(screen.getByRole('button', { name: 'Agenda' }));
    expect(screen.getByRole('button', { name: 'Agenda' }).getAttribute('aria-pressed')).toBe('true');
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
      '2026 Q4', '2027 Q1', '2027 Q2', '2027 Q3', '2027 Q4', '2028 Q1', '2028 Q2', '2028 Q3',
    ]);
    const spans = container.querySelectorAll<HTMLElement>('.wv-tl-span');
    expect(spans).toHaveLength(1);
    expect(spans[0]!.closest('.wv-tl-row')!.textContent).toContain('Finish the patchwork quilt');
    // Positions are CSSOM custom properties, never inline style attributes from markup.
    expect(spans[0]!.style.getPropertyValue('--wv-left')).toMatch(/%$/);
    expect(row('Tune up the old bicycle').closest('.wv-tl-row')!.textContent).toContain('Unscheduled');
  });
});
