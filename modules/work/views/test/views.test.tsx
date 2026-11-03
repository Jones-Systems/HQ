import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLANNER_PORT_KEYS, type Filters } from '../../core';
import { pendingWord } from '../env';
import { NO_RUN_NOTE, PLANNING_VIEW_IDS, PROJECT_NOTE, WORK_BOARDS, WORK_HOME_VIEW, WORK_VIEWS } from '../meta';
import { lastWrite, setup } from './harness';

// Every view renders the synthetic fixture with the not-project-scoped note,
// in light and dark chrome, through the full RS-3 state matrix. Happy-dom
// proves roles, words and keyboard paths, not pixels; the light and dark
// captures are in docs/evidence/hq-social-work/work-planner/.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const VIEW_PROOF: Record<string, string[]> = {
  glance: ['Good morning', 'Now', 'Next 21 days', 'Inbox', 'Worth a look', 'Recently changed'],
  list: ['Repaint the garden shed', 'Draft the spring market stall list', 'Tune up the old bicycle'],
  calendar: ['October', 'This month, no set day', 'Unscheduled', 'Outside this month'],
  timeline: ['No horizon', 'Someday', '2026 · Q4'],
  review: ['Gentle prompts. Nothing changes until you choose an action.', 'Sort the Inbox', 'Overdue deadlines', 'Targets that have passed', 'Active but quiet', 'Horizon and date disagree', 'No “why” yet'],
  archive: ['Copy out the old recipe cards', 'Restore'],
  'by-date': ['Today', 'This week', 'Later', 'Undated'],
};

describe.each(['light', 'dark'] as const)('views in %s chrome', (theme) => {
  beforeEach(() => { document.documentElement.dataset.theme = theme; });
  afterEach(() => { delete document.documentElement.dataset.theme; });

  it.each(PLANNING_VIEW_IDS)('%s renders the fixture with the not-project-scoped note', async (view) => {
    const { container } = await setup({ view });
    expect(screen.getByText(PROJECT_NOTE).getAttribute('role')).toBe('note');
    for (const text of VIEW_PROOF[view]!) expect(container.textContent).toContain(text);
  });

  it('loading: a busy skeleton until the first snapshot', async () => {
    await setup({ view: 'glance', loaded: false });
    const loading = screen.getByText('Loading planning…').closest('[data-state]')!;
    expect(loading.getAttribute('data-state')).toBe('loading');
    expect(loading.getAttribute('aria-busy')).toBe('true');
    await screen.findByText('Good morning');
  });

  it('unavailable: the Planner never answered, with Try again and no write', async () => {
    const { rec, faults } = await setup({ view: 'list', loaded: false, readsDown: true });
    const state = (await screen.findByText('Planner service unreachable')).closest('[data-state]')!;
    expect(state.getAttribute('data-state')).toBe('unavailable');
    faults.readsUnavailable(false);
    fireEvent.click(within(state as HTMLElement).getByRole('button', { name: 'Try again' }));
    await screen.findByText('Repaint the garden shed');
    expect(rec.writes()).toEqual([]);
  });

  it('error: a view that fails shows the error state, not a blank panel', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = new Proxy({} as Filters, { get: () => { throw new Error('fictional render failure'); } });
    await setup({ view: 'list', filters: broken });
    const error = screen.getByRole('alert');
    expect(error.getAttribute('data-state')).toBe('error');
    expect(error.textContent).toContain('This view could not be shown');
    expect(screen.getByText(PROJECT_NOTE)).toBeTruthy();
  });

  it('empty: each view says so plainly', async () => {
    for (const [view, title] of [['glance', 'Your planning hub is empty'], ['list', 'Nothing to list'], ['archive', 'Archive is empty'], ['review', 'All clear']] as const) {
      const ui = await setup({ view, items: [] });
      expect(screen.getByText(title).closest('[data-state]')!.getAttribute('data-state')).toBe('empty');
      ui.unmount();
    }
  });

  it('saving, then saved: the save indicator follows a write in flight', async () => {
    const user = userEvent.setup();
    const { held } = await setup({ view: 'list' });
    held.hold();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Horizon of Tune up the old bicycle' }), 'soon');
    await screen.findByText('Saving…', { selector: '[role="status"]' });
    expect(screen.getByRole('combobox', { name: 'Horizon of Tune up the old bicycle' })).toHaveProperty('value', 'soon');
    await act(async () => { held.release(); });
    await screen.findByText(/^Saved /, { selector: '[role="status"]' });
  });

  it('unknown: a lost response is shown as unconfirmed with Check, never as saved or failed', async () => {
    const user = userEvent.setup();
    const { faults, rec, store } = await setup({ view: 'list' });
    faults.next('lose-response');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status of Tune up the old bicycle' }), 'next');
    await screen.findByText('Save result unknown');
    expect(pendingWord(store.getState(), 'ex-bike')).toBe('Unconfirmed');
    expect(screen.getByText(/was sent but not confirmed\. It may or may not have been saved\./)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Check' }).length).toBeGreaterThan(0);
    expect(rec.writes()).toHaveLength(1);
  });

  it('offline: the Planner is unreachable, changes are paused, nothing claims a device copy', async () => {
    const user = userEvent.setup();
    const { faults, container } = await setup({ view: 'list' });
    faults.next('unavailable');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Horizon of Tune up the old bicycle' }), 'later');
    await waitFor(() => expect(container.textContent).toContain('Planner service unreachable · changes paused'));
    expect(container.textContent).not.toContain('kept on this device');
  });

  it('conflict: a change made elsewhere is kept and shown, and ours is not applied', async () => {
    const user = userEvent.setup();
    const { device } = await setup({ view: 'list' });
    await device.patch('ex-bike', 1, { notes: 'Changed on another device' }, 'device-request-0001');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Horizon of Tune up the old bicycle' }), 'now');
    await screen.findByText(/changed on another device, so your change was not applied/);
    expect(screen.getByText('Changed elsewhere')).toBeTruthy();
  });
});

describe('view behaviour', () => {
  it.each(['ctrlKey', 'metaKey'] as const)('keeps %s Undo available after the success toast expires and applies its inverse once', async (modifier) => {
    const { rec, store, container } = await setup({ view: 'timeline' });
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText(/^Tune up the old bicycle, horizon /), { key: 'ArrowUp', altKey: true });
    });
    expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('aria-keyshortcuts')).toBe('Control+Z Meta+Z');
    await act(async () => { await vi.advanceTimersByTimeAsync(7999); });
    expect(screen.getByText('“Tune up the old bicycle” is now Later.')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.queryByText('“Tune up the old bicycle” is now Later.')).toBeNull();
    expect(store.getState().undo).toHaveLength(1);
    await act(async () => { fireEvent.keyDown(container.querySelector('.wv')!, { key: 'z', [modifier]: true }); });
    expect(rec.writes()).toHaveLength(2);
    expect(lastWrite(rec)!.args.slice(0, 3)).toEqual(['ex-bike', 2, { horizon: 'someday' }]);
    expect(screen.getByText('Undone.')).toBeTruthy();
    expect(store.getState().undo).toHaveLength(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(screen.queryByText('Undone.')).toBeNull();
    await act(async () => { fireEvent.keyDown(container.querySelector('.wv')!, { key: 'z', [modifier]: true }); });
    expect(screen.getByText('Nothing to undo.')).toBeTruthy();
    expect(rec.writes()).toHaveLength(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(screen.queryByText('Nothing to undo.')).toBeNull();
  });

  it('keeps a refused undo visible after eight seconds', async () => {
    const { store, device, container } = await setup({ view: 'timeline' });
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText(/^Tune up the old bicycle, horizon /), { key: 'ArrowUp', altKey: true });
    });
    await device.patch('ex-bike', 2, { horizon: 'soon' }, 'toast-conflict-device');
    await act(async () => { await store.poll(); });
    await act(async () => { fireEvent.keyDown(container.querySelector('.wv')!, { key: 'z', ctrlKey: true }); });
    const text = container.querySelector('.hq-toast-text')!.textContent;
    expect(text).not.toContain('Undone.');
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(container.querySelector('.hq-toast-text')!.textContent).toBe(text);
  });

  it('List sorts by column and moves status through move (top of the new status), with Undo restoring the place', async () => {
    const user = userEvent.setup();
    const { rec } = await setup({ view: 'list' });
    const header = screen.getByRole('columnheader', { name: /Title/ });
    await user.click(within(header).getByRole('button'));
    expect(header.getAttribute('aria-sort')).toBe('ascending');
    const first = screen.getAllByRole('row')[1]!;
    expect(first.textContent).toContain('Build a box kite');

    await user.selectOptions(screen.getByRole('combobox', { name: 'Status of Learn three bread recipes' }), 'active');
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    expect(lastWrite(rec)!.method).toBe('move');
    expect(lastWrite(rec)!.args.slice(0, 4)).toEqual(['ex-bread', 1, 'active', { place: 'top' }]);
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(rec.writes()).toHaveLength(2));
    expect(lastWrite(rec)!.method).toBe('move');
    expect(lastWrite(rec)!.args.slice(0, 3)).toEqual(['ex-bread', 2, 'next']);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Horizon of Learn three bread recipes' }), '');
    await waitFor(() => expect(rec.writes()).toHaveLength(3));
    expect(lastWrite(rec)!.args.slice(1, 3)).toEqual([3, { horizon: null }]);
  });

  it('List shows every area as a label and filters nothing by area as a project', async () => {
    const { container } = await setup({ view: 'list' });
    for (const area of ['Home', 'Kitchen', 'Market', 'Garden']) expect(within(container.querySelector('tbody')!).getAllByText(area).length).toBeGreaterThan(0);
    expect(screen.queryByRole('combobox', { name: /project/i })).toBeNull();
    expect(screen.getAllByRole('row')).toHaveLength(1 + 14);
  });

  it('Glance links only navigate; panels follow the Planner selections', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const { rec } = await setup({ view: 'glance', navigate });
    const upcoming = screen.getByRole('region', { name: 'Next 21 days' });
    expect(within(upcoming).getByRole('heading', { name: 'Overdue · 1' })).toBeTruthy();
    expect(within(upcoming).getByText('Return the seed-swap tray')).toBeTruthy();
    expect(within(upcoming).getByText('Today')).toBeTruthy();
    const now = screen.getByRole('region', { name: 'Now' });
    expect(within(now).getByText('Next: Sand the door')).toBeTruthy();
    expect(within(now).queryByText('Plan a stargazing night')).toBeNull();
    const attention = screen.getByRole('region', { name: 'Worth a look' });
    expect(attention.textContent).toContain('1 target date has passed');
    expect(attention.textContent).toContain('1 active item untouched for 21+ days');
    expect(attention.textContent).toContain('2 horizon/date mismatches');

    await user.click(screen.getByRole('button', { name: 'Next: 4. Open on the board' }));
    await user.click(within(attention).getByRole('button', { name: /target date has passed/ }));
    await user.click(screen.getByRole('button', { name: /Open calendar/ }));
    expect(navigate.mock.calls).toEqual([[{ view: 'board', column: 'next' }], [{ view: 'review' }], [{ view: 'calendar' }]]);
    expect(rec.writes()).toEqual([]);
  });

  it('Review actions are one-tap writes: why, mark done, still active and the quiet-after preference', async () => {
    const user = userEvent.setup();
    const { rec } = await setup({ view: 'review' });
    const inbox = screen.getByRole('region', { name: 'Sort the Inbox' });
    await user.click(within(within(inbox).getByRole('group', { name: 'Why for Sort the old postcards' })).getByRole('button', { name: 'Need' }));
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    expect(lastWrite(rec)!.args.slice(0, 3)).toEqual(['ex-postcards', 1, { motivation: 'need' }]);

    await user.click(within(screen.getByRole('region', { name: 'Overdue deadlines' })).getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(rec.writes()).toHaveLength(2));
    expect(lastWrite(rec)!.args.slice(0, 4)).toEqual(['ex-seed-tray', 1, 'done', { place: 'top' }]);

    await user.click(within(screen.getByRole('region', { name: 'Active but quiet' })).getByRole('button', { name: 'Still active' }));
    await waitFor(() => expect(rec.writes()).toHaveLength(3));
    expect(lastWrite(rec)!.method).toBe('markReviewed');

    const quiet = screen.getByRole('spinbutton', { name: 'Days before an active item counts as quiet' });
    await user.clear(quiet);
    await user.type(quiet, '30{Enter}');
    await waitFor(() => expect(rec.writes()).toHaveLength(4));
    expect(lastWrite(rec)!.method).toBe('updateSettings');
    expect(lastWrite(rec)!.args[0]).toEqual({ default_tz: 'America/New_York', week_start: 'sun', stale_days: 30 });
  });

  it('Archive restores with Undo, and nothing is deleted', async () => {
    const user = userEvent.setup();
    const { rec } = await setup({ view: 'archive' });
    expect(screen.getByText(/Done · archived/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(rec.writes()).toHaveLength(1));
    expect(lastWrite(rec)!.args.slice(0, 3)).toEqual(['ex-old-recipes', 1, false]);
    await screen.findByText('Archive is empty');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(rec.writes()).toHaveLength(2));
    expect(lastWrite(rec)!.args.slice(0, 3)).toEqual(['ex-old-recipes', 2, true]);
    expect(rec.calls.map((c) => c.method)).not.toContain('delete');
  });

  it('a toast loses its Undo once that entry was undone elsewhere, so it can never replay', async () => {
    const { rec, store } = await setup({ view: 'timeline' });
    fireEvent.keyDown(screen.getByLabelText(/^Tune up the old bicycle, horizon /), { key: 'ArrowUp', altKey: true });
    await screen.findByRole('button', { name: 'Undo' });
    // For example the Work shell's own Ctrl/⌘+Z, which calls the shared store directly.
    await act(async () => { await store.undo(); });
    expect(screen.getByText('“Tune up the old bicycle” is now Later.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(rec.writes()).toHaveLength(2);
  });

  it('Ctrl+Z undoes the newest change once, and the stale toast loses its Undo', async () => {
    const { rec, container } = await setup({ view: 'timeline' });
    fireEvent.keyDown(screen.getByLabelText(/^Tune up the old bicycle, horizon /), { key: 'ArrowUp', altKey: true });
    await screen.findByRole('button', { name: 'Undo' });
    expect(screen.getByText(NO_RUN_NOTE)).toBeTruthy();
    fireEvent.keyDown(container.querySelector('.wv')!, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(rec.writes()).toHaveLength(2));
    expect(lastWrite(rec)!.args.slice(0, 3)).toEqual(['ex-bike', 2, { horizon: 'someday' }]);
    await screen.findByText('Undone.');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    fireEvent.keyDown(container.querySelector('.wv')!, { key: 'z', ctrlKey: true });
    await screen.findByText('Nothing to undo.');
    expect(rec.writes()).toHaveLength(2);
  });
});

describe('zero execution', () => {
  it('navigation, view switches, layout toggles and links make no write and no execution call', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.fn();
    const openSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.spyOn(window, 'open').mockImplementation(openSpy);
    const openItem = vi.fn();
    const navigate = vi.fn();
    const { rec, rerender } = await setup({ view: 'glance', openItem, navigate });
    for (const view of PLANNING_VIEW_IDS) rerender({ view });
    rerender({ view: 'calendar' });
    await user.click(screen.getByRole('button', { name: 'Next month' }));
    await user.click(screen.getByRole('button', { name: 'Agenda' }));
    await user.click(screen.getByRole('button', { name: 'Agenda' }));
    await user.click(screen.getByRole('button', { name: 'Targets' }));
    await user.click(screen.getByRole('checkbox', { name: 'Show done & dropped' }));
    rerender({ view: 'list' });
    await user.click(within(screen.getByRole('columnheader', { name: /Updated/ })).getByRole('button'));
    await user.click(screen.getByRole('button', { name: 'Repaint the garden shed' }));
    rerender({ view: 'glance' });
    await user.click(screen.getByRole('button', { name: /Sort in Review/ }));
    vi.unstubAllGlobals();

    expect(rec.writes()).toEqual([]);
    expect(rec.calls.every((c) => (PLANNER_PORT_KEYS as readonly string[]).includes(c.method))).toBe(true);
    expect(new Set(rec.calls.map((c) => c.method))).toEqual(new Set(['snapshot']));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(openItem).toHaveBeenCalledWith('ex-shed-paint');
    expect(navigate).toHaveBeenCalledWith({ view: 'review' });
  });

  it('records the Work navigation defaults: Board is home, By date keeps its Lists alias', () => {
    expect(WORK_HOME_VIEW).toBe('board');
    expect(WORK_VIEWS.map((v) => `${v.key}:${v.label}`)).toEqual(['1:Glance', '2:Board', '3:List', '4:Calendar', '5:Timeline', '6:Review', '7:Archive']);
    expect(WORK_BOARDS.find((b) => b.id === 'by-date')).toMatchObject({ label: 'By date', aliases: ['lists'] });
  });
});
