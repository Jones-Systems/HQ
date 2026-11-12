import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastStoreProvider, ToastViewport, createToastStore } from '@hq/ui';
import {
  FEATURE_HQ_EDITORIAL_TIMEBOX, FIXTURE_IDS, PortFailure, createFixtureWorkspace, fictionalSeed, recordCalls, resetSocialSessions, socialSession, workspaceSnapshot,
  type Draft, type FixtureOptions, type RecordedPort, type WorkspaceLoad,
} from '../../core';
import { SocialFrameContext, type SocialFrame } from '../../ui';
import { SocialContent } from '..';
import { changeDraft } from '../actions';

afterEach(() => {
  cleanup();
  resetSocialSessions();
  vi.restoreAllMocks();
});

const NOW = () => new Date('2026-10-20T12:00:00Z');

/** The shell mounts the toast viewport; a section mounted on its own needs one, on a store of its own. */
/** What the Social domain provides to its pages; a section mounted on its own has none. */
const FRAME: SocialFrame = { load: { status: 'idle' } as WorkspaceLoad, example: true, onCheck: () => undefined, limits: 'Fixture limits.', exampleNote: 'Example workspace.' };

function setup(destination = 'library', options: FixtureOptions = {}, frame: SocialFrame | null = null) {
  const fixture = createFixtureWorkspace(options);
  const recorded = recordCalls(fixture.port);
  const visited: string[] = [];
  const store = createToastStore();
  let go: (destination: string) => void = () => undefined;
  function Host({ initial }: { initial: string }) {
    const [current, setCurrent] = useState(initial);
    go = (next) => act(() => setCurrent(next));
    return <SocialFrameContext.Provider value={frame}><ToastStoreProvider store={store}>
      <SocialContent port={recorded.port} projectId="fixture-project" destination={current} now={NOW} navigate={(next) => { visited.push(next); setCurrent(next); }} />
      <ToastViewport hotkey={null} />
    </ToastStoreProvider></SocialFrameContext.Provider>;
  }
  const view = render(<Host initial={destination} />);
  return { ...fixture, recorded, visited, view, go: (next: string) => go(next), Host, user: userEvent.setup() };
}

function methods(recorded: RecordedPort) {
  return recorded.calls().map((call) => call.method);
}

function expectNoExecution(recorded: RecordedPort) {
  expect(recorded.callsOf('execution')).toEqual([]);
}

/** A toast is a group named by its title; its live-region copy is separate, so text queries would match twice. */
/** A success dismisses after 8 s; the viewport then keeps it mounted for its exit animation (up to 320 ms). */
const TOAST_EXIT = 400;
const SUCCESS_EXPIRY = 8000 + TOAST_EXIT;
const findToast = (name: string | RegExp) => screen.findByRole('group', { name });
const getToast = (name: string | RegExp) => screen.getByRole('group', { name });
const queryToast = (name: string | RegExp) => screen.queryByRole('group', { name });

describe('Social content: calendar', () => {
  it('states that planned dates are editorial intent and never says scheduled', async () => {
    setup('calendar/2026-10');
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeTruthy();
    expect(screen.getByText(/Planned dates are editorial intent/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/scheduled|published|connected/iu);
  });

  it('moves a draft by keyboard with exactly one versioned save, and undoes it', async () => {
    const { controls, recorded, user } = setup('calendar/2026-10');
    const chip = await screen.findByRole('button', { name: /^Autumn blend tasting notes/ });
    recorded.clear();
    chip.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Planned date'), { target: { value: '2026-10-28' } });
    await user.click(within(dialog).getByRole('button', { name: 'Move to date' }));
    expect(await findToast('Moved “Autumn blend tasting notes” to 28 Oct 2026.')).toBeTruthy();
    expect(methods(recorded)).toEqual(['saveDraft']);
    expect(recorded.calls()[0]!.args[0]).toMatchObject({ id: FIXTURE_IDS.autumnBlend, version: 3, planned_date: '2026-10-28', body: 'Three cups, three steeping times. Which one tastes like October?' });
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)).toMatchObject({ planned_date: '2026-10-28', version: 4 });

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await findToast(/Undone/)).toBeTruthy();
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)).toMatchObject({ planned_date: '2026-10-24', version: 5 });
    expect(methods(recorded)).toEqual(['saveDraft', 'saveDraft']);
    expectNoExecution(recorded);
  });

  it('clears a date into the No date yet tray', async () => {
    const { controls, user } = setup('calendar/2026-10');
    await user.click(await screen.findByRole('button', { name: /^Autumn blend tasting notes/ }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Clear date' }));
    expect(await findToast('Cleared the planned date of “Autumn blend tasting notes”.')).toBeTruthy();
    const tray = screen.getByRole('complementary', { name: 'No date yet' });
    expect(within(tray).getByRole('button', { name: /^Autumn blend tasting notes/ })).toBeTruthy();
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planned_date).toBe('');
  });

  it('moves a draft by pointer drag with one versioned save', async () => {
    const { controls, recorded } = setup('calendar/2026-10');
    const chip = await screen.findByRole('button', { name: /^Steeping times thread/ });
    const target = document.querySelector('[data-drop-date="2026-10-15"]')!;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);
    recorded.clear();
    fireEvent.pointerDown(chip, { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.pointerUp(chip, { pointerId: 1, clientX: 60, clientY: 40 });
    fireEvent.click(chip);
    expect(await findToast('Moved “Steeping times thread” to 15 Oct 2026.')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(methods(recorded)).toEqual(['saveDraft']);
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.steepingThread)?.planned_date).toBe('2026-10-15');
  });

  it('refuses to move a draft with unsaved edits instead of conflicting with them', async () => {
    const { recorded, go, user } = setup(`library/${FIXTURE_IDS.autumnBlend}`);
    await screen.findByRole('heading', { name: 'Edit draft' });
    await user.type(screen.getByLabelText('Body'), ' (draft edit)');
    go('calendar/2026-10');
    await user.click(await screen.findByRole('button', { name: /^Autumn blend tasting notes/ }));
    fireEvent.change(within(await screen.findByRole('dialog')).getByLabelText('Planned date'), { target: { value: '2026-10-30' } });
    recorded.clear();
    await user.click(screen.getByRole('button', { name: 'Move to date' }));
    expect(await findToast(/has unsaved edits in the Library/)).toBeTruthy();
    expect(recorded.calls()).toEqual([]);
  });

  it('reports a move conflict without an Undo', async () => {
    const { controls, user } = setup('calendar/2026-10');
    await user.click(await screen.findByRole('button', { name: /^Autumn blend tasting notes/ }));
    controls.editElsewhere(FIXTURE_IDS.autumnBlend, { title: 'Autumn blend tasting notes' });
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Clear date' }));
    expect(await findToast(/Not moved: This draft changed in another window/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('navigates months by destination only', async () => {
    const { recorded, visited, user } = setup('calendar/2026-12');
    await user.click(await screen.findByRole('button', { name: 'Next month' }));
    expect(visited.at(-1)).toBe('calendar/2027-01');
    expect(await screen.findByRole('heading', { name: 'January 2027' })).toBeTruthy();
    expect(methods(recorded)).toEqual(['snapshot']);
  });
});

describe('Social calendar navigation and notification lifetime', () => {
  async function selectView(user: ReturnType<typeof userEvent.setup>, name: 'Month' | 'Week' | 'Day') {
    if (screen.queryByRole('button', { name: 'Agenda', pressed: true })) await user.click(screen.getByRole('button', { name: 'Agenda' }));
    for (let i = 0; i < 3 && !screen.getByRole('button', { name: /^Calendar view:/ }).textContent?.includes(name); i++) {
      await user.click(screen.getByRole('button', { name: /^Calendar view:/ }));
    }
  }
  async function moveTo(title: string, day: string) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${title}`) }));
    fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: day } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Move to date' })); });
  }

  it('drills the full month header and week header into the exact day without saving', async () => {
    const { recorded, user } = setup('calendar/2026-10');
    await screen.findByRole('heading', { name: 'October 2026' });
    fireEvent.doubleClick(document.querySelector('[data-drop-date="2026-10-22"] .cal-day-head')!);
    expect(screen.getByRole('button', { name: /^Calendar view: Week\./ })).toBeTruthy();
    expect(document.querySelector('[data-time-day="2026-10-22"]')).toBeTruthy();
    const day = screen.getByRole('button', { name: 'Open day 2026-10-22' });
    await user.click(day);
    expect(screen.getByRole('button', { name: /^Calendar view: Week\./ })).toBeTruthy();
    await user.dblClick(day);
    expect(screen.getByRole('button', { name: /^Calendar view: Day\./ })).toBeTruthy();
    expect(document.querySelectorAll('[data-time-day]')).toHaveLength(1);
    expect(document.querySelector('[data-time-day="2026-10-22"]')).toBeTruthy();
    await selectView(user, 'Month');
    await selectView(user, 'Day');
    expect(document.querySelector('[data-time-day="2026-10-22"]')).toBeTruthy();
    expect(methods(recorded)).toEqual(['snapshot']);
  });

  it('keeps the month grid to one Tab stop that arrow keys, Home and End move through', async () => {
    const { user, recorded } = setup('calendar/2026-10');
    const today = await screen.findByRole('button', { name: 'Open week of 20 Oct 2026' });
    const stops = () => screen.getAllByRole('button', { name: /^Open week of / }).filter((day) => day.tabIndex === 0);
    expect(stops()).toEqual([today]);
    today.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open week of 21 Oct 2026' }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open week of 28 Oct 2026' }));
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open week of 1 Nov 2026' }));
    await user.keyboard('{Home}');
    const monday = screen.getByRole('button', { name: 'Open week of 26 Oct 2026' });
    expect(document.activeElement).toBe(monday);
    // The stop follows focus, so Tab comes back to the last day used.
    expect(stops()).toEqual([monday]);
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: /^Calendar view: Week\./ })).toBeTruthy();
    expect(methods(recorded)).toEqual(['snapshot']);
  });

  it.each(['Enter', ' ', 'assistive click'])('opens an adjacent month day with %s and keeps the exact anchor through routing', async (key) => {
    const { recorded, visited, user } = setup('calendar/2026-10');
    const number = await screen.findByRole('button', { name: 'Open week of 1 Nov 2026' });
    await user.click(number);
    expect(screen.getByRole('button', { name: /^Calendar view: Month\./ })).toBeTruthy();
    if (key === 'assistive click') fireEvent.click(number, { detail: 0 });
    else fireEvent.keyDown(number, { key });
    expect(visited.at(-1)).toBe('calendar/2026-11');
    const heading = document.querySelector('.cal-bar h2');
    expect(document.activeElement).toBe(heading);
    await selectView(user, 'Day');
    expect(document.querySelector('[data-time-day="2026-11-01"]')).toBeTruthy();
    await selectView(user, 'Month');
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeTruthy();
    expect(methods(recorded)).toEqual(['snapshot']);
  });

  it('keeps a revision-bound Undo after success expires and consumes it only once', async () => {
    const { controls, recorded } = setup('calendar/2026-10');
    await screen.findByRole('heading', { name: 'October 2026' });
    vi.useFakeTimers();
    try {
      recorded.clear();
      await moveTo('Autumn blend tasting notes', '2026-10-28');
      expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(SUCCESS_EXPIRY); });
      expect(queryToast('Moved “Autumn blend tasting notes” to 28 Oct 2026.')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
      expect(methods(recorded)).toEqual(['saveDraft']);
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo last calendar change' })); });
      expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)).toMatchObject({ planned_date: '2026-10-24', version: 5 });
      expect(recorded.calls()[1]!.args[0]).toMatchObject({ id: FIXTURE_IDS.autumnBlend, version: 4, planned_date: '2026-10-24' });
      expect(screen.queryByRole('button', { name: 'Undo last calendar change' })).toBeNull();
      expect(methods(recorded)).toEqual(['saveDraft', 'saveDraft']);
      expectNoExecution(recorded);
    } finally { vi.useRealTimers(); }
  });

  it('restarts the expiry for a new success and replaces Undo with its exact inverse', async () => {
    const { controls, recorded } = setup('calendar/2026-10');
    await screen.findByRole('heading', { name: 'October 2026' });
    vi.useFakeTimers();
    try {
      recorded.clear();
      await moveTo('Autumn blend tasting notes', '2026-10-28');
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
      await moveTo('Autumn blend tasting notes', '2026-10-29');
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
      expect(getToast('Moved “Autumn blend tasting notes” to 29 Oct 2026.')).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(4000 + TOAST_EXIT); });
      expect(queryToast('Moved “Autumn blend tasting notes” to 29 Oct 2026.')).toBeNull();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo last calendar change' })); });
      expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)).toMatchObject({ planned_date: '2026-10-28', version: 6 });
      expect(recorded.calls()[2]!.args[0]).toMatchObject({ version: 5, planned_date: '2026-10-28' });
      expect(methods(recorded)).toEqual(['saveDraft', 'saveDraft', 'saveDraft']);
    } finally { vi.useRealTimers(); }
  });

  it('preserves an unknown-save message and the previous inverse without retrying', async () => {
    const { controls, recorded } = setup('calendar/2026-10');
    await screen.findByRole('heading', { name: 'October 2026' });
    vi.useFakeTimers();
    try {
      await moveTo('Autumn blend tasting notes', '2026-10-28');
      controls.failNext('saveDraft', { kind: 'unknown', attemptedAt: NOW().toISOString() });
      recorded.clear();
      await moveTo('Steeping times thread', '2026-10-29');
      expect(getToast(/Not moved: HQ could not confirm the result/)).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
      expect(getToast(/Not moved: HQ could not confirm the result/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Undo last calendar change' })).toBeTruthy();
      expect(methods(recorded)).toEqual(['saveDraft', 'snapshot']);
      expectNoExecution(recorded);
    } finally { vi.useRealTimers(); }
  });

  it('refuses a stale Undo after expiry and preserves the conflict notification', async () => {
    const { controls, recorded } = setup('calendar/2026-10');
    await screen.findByRole('heading', { name: 'October 2026' });
    vi.useFakeTimers();
    try {
      await moveTo('Autumn blend tasting notes', '2026-10-28');
      await act(async () => { await vi.advanceTimersByTimeAsync(SUCCESS_EXPIRY); });
      controls.editElsewhere(FIXTURE_IDS.autumnBlend, { planned_date: '2026-10-30' });
      recorded.clear();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo last calendar change' })); });
      expect(recorded.calls()[0]!.args[0]).toMatchObject({ version: 4 });
      expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planned_date).toBe('2026-10-30');
      expect(getToast(/Could not undo: This draft changed in another window/)).toBeTruthy();
      await act(async () => { await vi.advanceTimersByTimeAsync(16000); });
      expect(getToast(/Could not undo: This draft changed in another window/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Undo last calendar change' })).toBeNull();
      expect(methods(recorded)).toEqual(['saveDraft']);
    } finally { vi.useRealTimers(); }
  });
});

describe('Social calendar service-backed timeboxes', () => {
  async function showView(user: ReturnType<typeof userEvent.setup>, name: 'Month' | 'Week' | 'Day') {
    await screen.findByRole('button', { name: /^Calendar view:/ });
    if (screen.queryByRole('button', { name: 'Agenda', pressed: true })) await user.click(screen.getByRole('button', { name: 'Agenda' }));
    for (let i = 0; i < 3 && !screen.getByRole('button', { name: /^Calendar view:/ }).textContent?.includes(name); i++) {
      await user.click(screen.getByRole('button', { name: /^Calendar view:/ }));
    }
  }
  const timedSeed = () => {
    const seed = fictionalSeed();
    seed.content = seed.content.map((draft) => draft.id === FIXTURE_IDS.autumnBlend
      ? { ...draft, planned_date: '2026-10-20', planning_slot: { start: '09:00', duration_minutes: 30, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } } : draft);
    return seed;
  };
  it('tints a timed entry with its channel, as the chips are', async () => {
    const { user } = setup('calendar/2026-10', { features: [FEATURE_HQ_EDITORIAL_TIMEBOX], seed: timedSeed() });
    await showView(user, 'Day');
    const holder = await waitFor(() => document.querySelector<HTMLElement>(`[data-event-id="${FIXTURE_IDS.autumnBlend}"]`)!);
    expect(holder.dataset.channel).toBe('LinkedIn');
  });

  it('cycles grid modes with separate Agenda round trips and no saves', async () => {
    const { recorded, user } = setup('calendar/2026-10');
    const group = await screen.findByRole('group', { name: 'Calendar view' });
    for (const [name, columns] of [['Week', 7], ['Day', 1], ['Month', 0]] as const) {
      expect(within(group).getAllByRole('button')).toHaveLength(2);
      await showView(user, name);
      expect(within(group).getByRole('button', { name: new RegExp(`^Calendar view: ${name}\\.`) })).toBeTruthy();
      expect(document.querySelectorAll('[data-time-day]')).toHaveLength(columns);
      const cycle = within(group).getByRole('button', { name: /^Calendar view:/ });
      await user.click(within(group).getByRole('button', { name: 'Agenda' }));
      expect(screen.getByRole('region', { name: 'Planned drafts agenda' })).toBeTruthy();
      expect(cycle.getAttribute('aria-pressed')).toBe('false');
      cycle.focus(); await user.keyboard('{Enter}');
      expect(cycle.textContent).toBe(name);
      expect(document.querySelectorAll('[data-time-day]')).toHaveLength(columns);
      expect(screen.queryByRole('menu')).toBeNull();
    }
    expect(methods(recorded)).toEqual(['snapshot']);
    expectNoExecution(recorded);
  });

  it('drags all-day into a scrolled time grid, then moves vertically with one save per release and Undo', async () => {
    const seed = fictionalSeed();
    seed.content = seed.content.map((draft) => draft.id === FIXTURE_IDS.autumnBlend ? { ...draft, planned_date: '2026-10-20' } : draft);
    const { controls, recorded, user } = setup('calendar/2026-10', { features: [FEATURE_HQ_EDITORIAL_TIMEBOX], seed });
    await showView(user, 'Day');
    const rect = { x: 88, y: -236, left: 88, top: -236, right: 888, bottom: 916, width: 800, height: 1152, toJSON: () => ({}) };
    const columns = document.querySelector('.hq-calendar-time-columns')!;
    const day = document.querySelector('[data-time-day="2026-10-20"]')!;
    vi.spyOn(columns, 'getBoundingClientRect').mockReturnValue(rect);
    vi.spyOn(day, 'getBoundingClientRect').mockReturnValue(rect);
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(day);
    const chip = screen.getByRole('button', { name: /^Autumn blend tasting notes/ });
    recorded.clear();
    fireEvent.pointerDown(chip, { pointerId: 10, button: 0, clientX: 300, clientY: 40 });
    fireEvent.pointerMove(chip, { pointerId: 10, clientX: 300, clientY: 196 });
    expect(methods(recorded)).toEqual([]);
    fireEvent.pointerUp(chip, { pointerId: 10, clientX: 300, clientY: 196 });
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planning_slot).toMatchObject({ start: '09:00', duration_minutes: 30 }));
    expect(methods(recorded)).toEqual(['saveDraft']);
    const timed = await screen.findByRole('button', { name: /^Autumn blend tasting notes, 9:00 a\.m\./ });
    fireEvent.pointerDown(timed, { pointerId: 11, button: 0, clientX: 300, clientY: 196 });
    fireEvent.pointerMove(window, { pointerId: 11, clientX: 300, clientY: 244 });
    expect(methods(recorded)).toEqual(['saveDraft']);
    fireEvent.pointerUp(window, { pointerId: 11, clientX: 300, clientY: 244 });
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planning_slot).toMatchObject({ start: '10:00', duration_minutes: 30 }));
    expect(methods(recorded)).toEqual(['saveDraft', 'saveDraft']);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planning_slot?.start).toBe('09:00'));
    expect(methods(recorded)).toEqual(['saveDraft', 'saveDraft', 'saveDraft']);
    expectNoExecution(recorded);
  });

  it('accepts a native HTML drop from the undated tray into scrolled time slots with a 30 minute default', async () => {
    const { controls, recorded, user } = setup('calendar/2026-10', { features: [FEATURE_HQ_EDITORIAL_TIMEBOX] });
    await showView(user, 'Day');
    const draft = screen.getByRole('button', { name: /^Steeping times thread/ });
    const day = document.querySelector('[data-time-day="2026-10-20"]')!;
    vi.spyOn(day, 'getBoundingClientRect').mockReturnValue({ x: 88, y: -236, left: 88, top: -236, right: 888, bottom: 916, width: 800, height: 1152, toJSON: () => ({}) });
    const payload = new Map<string, string>();
    const dataTransfer = { setData: (type: string, value: string) => payload.set(type, value), getData: (type: string) => payload.get(type) ?? '',
      get types() { return [...payload.keys()]; } };
    recorded.clear();
    fireEvent.dragStart(draft, { dataTransfer });
    fireEvent.dragOver(day, { dataTransfer });
    expect(methods(recorded)).toEqual([]);
    // Happy DOM has no DragEvent constructor; MouseEvent preserves client coordinates plus the native drag payload.
    const drop = new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 300, clientY: 436 });
    Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
    fireEvent(day, drop);
    await waitFor(() => expect(controls.inspect().content.find((item) => item.id === FIXTURE_IDS.steepingThread)).toMatchObject({ planned_date: '2026-10-20', planning_slot: { start: '14:00', duration_minutes: 30 } }));
    expect(methods(recorded)).toEqual(['saveDraft']);
    expectNoExecution(recorded);
  });
  it('assigns a 30 minute time via the accessible dialog and Undo restores date-only state', async () => {
    const { recorded, controls, user } = setup('calendar/2026-10', { features: [FEATURE_HQ_EDITORIAL_TIMEBOX] });
    await user.click(await screen.findByRole('button', { name: /^Autumn blend tasting notes/ }));
    await user.click(screen.getByRole('checkbox', { name: 'Set time' }));
    expect((screen.getByLabelText('Duration (minutes)') as HTMLInputElement).value).toBe('30');
    recorded.clear();
    await user.click(screen.getByRole('button', { name: 'Save planning time' }));
    await screen.findByRole('button', { name: 'Undo' });
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planning_slot).toMatchObject({ start: '09:00', duration_minutes: 30 });
    expect(methods(recorded)).toEqual(['saveDraft']);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await findToast(/Undone/);
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planning_slot).toBeNull();
    expectNoExecution(recorded);
  });
  it('uses shared keyboard moves and resize with one atomic save and exact Undo', async () => {
    const { controls, recorded, user } = setup('calendar/2026-10', { features: [FEATURE_HQ_EDITORIAL_TIMEBOX], seed: timedSeed() });
    await showView(user, 'Week');
    const event = await screen.findByRole('button', { name: /^Autumn blend tasting notes, 9:00 a\.m\./ });
    recorded.clear();
    fireEvent.keyDown(event, { altKey: true, key: 'ArrowDown' });
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planning_slot?.start).toBe('09:15'));
    expect(methods(recorded)).toEqual(['saveDraft']);
    fireEvent.keyDown(await screen.findByRole('button', { name: /^Autumn blend tasting notes, 9:15 a\.m\./ }), { altKey: true, shiftKey: true, key: 'ArrowDown' });
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planning_slot?.duration_minutes).toBe(45));
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await findToast(/Undone/);
    expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)?.planning_slot).toMatchObject({ start: '09:15', duration_minutes: 30 });
    expect(methods(recorded)).toEqual(['saveDraft', 'saveDraft', 'saveDraft']);
    expectNoExecution(recorded);
  });
  it('previews pointer movement without saving, commits on drop, and clears time into all-day', async () => {
    const { controls, recorded, user } = setup('calendar/2026-10', { features: [FEATURE_HQ_EDITORIAL_TIMEBOX], seed: timedSeed() });
    await showView(user, 'Week');
    const event = await screen.findByRole('button', { name: /^Autumn blend tasting notes, 9:00 a\.m\./ });
    const columns = document.querySelector('.hq-calendar-time-columns')!;
    vi.spyOn(columns, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 700, bottom: 1152, width: 700, height: 1152, toJSON: () => ({}) });
    const day = document.querySelector('[data-time-day="2026-10-21"]')!;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(day);
    recorded.clear();
    fireEvent.pointerDown(event, { button: 0, pointerId: 7, clientX: 150, clientY: 432 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 250, clientY: 456 });
    expect(methods(recorded)).toEqual([]);
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 250, clientY: 456 });
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)).toMatchObject({ planned_date: '2026-10-21', planning_slot: { start: '09:30', duration_minutes: 30 } }));
    expect(methods(recorded)).toEqual(['saveDraft']);
    const moved = await screen.findByRole('button', { name: /^Autumn blend tasting notes, 9:30 a\.m\./ });
    const allDay = document.querySelector('[data-grid-all-day="2026-10-22"]')!;
    vi.mocked(document.elementFromPoint).mockReturnValue(allDay);
    fireEvent.pointerDown(moved, { button: 0, pointerId: 8, clientX: 250, clientY: 456 });
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 350, clientY: 10 });
    fireEvent.pointerUp(window, { pointerId: 8, clientX: 350, clientY: 10 });
    await waitFor(() => expect(controls.inspect().content.find((draft) => draft.id === FIXTURE_IDS.autumnBlend)).toMatchObject({ planned_date: '2026-10-22', planning_slot: null }));
    expect(methods(recorded)).toEqual(['saveDraft', 'saveDraft']);
    expectNoExecution(recorded);
  });
  it('keeps unsupported time planning read-only and the collapsed tray a drop target', async () => {
    const { recorded, user } = setup('calendar/2026-10', { features: [] });
    await showView(user, 'Day');
    expect(screen.getByText(/Timed planning needs a newer Social service/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Collapse undated drafts' }));
    expect(document.querySelector('[data-calendar-remove]')).toBeTruthy();
    expect(screen.getByRole('separator', { name: 'Undated drafts tray width' }).getAttribute('aria-valuenow')).toBe('0');
    expect(methods(recorded)).toEqual(['snapshot']);
  });
  it('reconciles a lost timed-save response by one read, never by another save', async () => {
    const fixture = createFixtureWorkspace({ features: [FEATURE_HQ_EDITORIAL_TIMEBOX] });
    const session = socialSession('lost-time');
    await session.load(fixture.port);
    const draft = workspaceSnapshot(session.getState().workspace)!.content.find((item) => item.id === FIXTURE_IDS.autumnBlend)!;
    const save = vi.fn(async (input: Parameters<typeof fixture.port.saveDraft>[0]) => {
      await fixture.port.saveDraft(input);
      throw new PortFailure({ kind: 'unknown', attemptedAt: NOW().toISOString() });
    });
    const snapshot = vi.fn(fixture.port.snapshot);
    const port = { ...fixture.port, saveDraft: save, snapshot };
    const slot = { start: '09:00', duration_minutes: 30, timezone: 'UTC' };
    const result = await changeDraft(session, port, draft, { planning_slot: slot }, true);
    expect(result).toMatchObject({ ok: true, draft: { planning_slot: slot, version: draft.version + 1 } });
    expect(save).toHaveBeenCalledTimes(1); expect(snapshot).toHaveBeenCalledTimes(1);
  });
  it('refuses a changed slot during unknown recovery instead of treating matching text as success', async () => {
    const fixture = createFixtureWorkspace({ features: [FEATURE_HQ_EDITORIAL_TIMEBOX] });
    const session = socialSession('changed-time'); await session.load(fixture.port);
    const draft = workspaceSnapshot(session.getState().workspace)!.content.find((item) => item.id === FIXTURE_IDS.autumnBlend)!;
    const slot = { start: '09:00', duration_minutes: 30, timezone: 'UTC' };
    const saveDraft = vi.fn(async (_input: Parameters<typeof fixture.port.saveDraft>[0]): Promise<Draft> => {
      fixture.controls.editElsewhere(draft.id, { planning_slot: { ...slot, duration_minutes: 60 } });
      throw new PortFailure({ kind: 'unknown', attemptedAt: NOW().toISOString() });
    });
    const result = await changeDraft(session, { ...fixture.port, saveDraft }, draft, { planning_slot: slot }, true);
    expect(result).toMatchObject({ ok: false, reconciliation: 'changed', error: { kind: 'unknown' } });
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });
});

describe('Social calendar: now, chips and drag feedback', () => {
  const fakeTransfer = () => {
    const payload = new Map<string, string>();
    return { setData: (type: string, value: string) => payload.set(type, value), getData: (type: string) => payload.get(type) ?? '',
      get types() { return [...payload.keys()]; }, effectAllowed: 'none' };
  };
  const chipOf = async (name: RegExp) => (await screen.findByRole('button', { name })) as HTMLButtonElement;

  it('marks today, and Today returns to it by navigation only', async () => {
    const { recorded, visited, user } = setup('calendar/2026-12');
    await screen.findByRole('heading', { name: 'December 2026' });
    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(visited.at(-1)).toBe('calendar/2026-10');
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeTruthy();
    const today = document.querySelector('[aria-current="date"]')!;
    expect(today.getAttribute('data-drop-date')).toBe('2026-10-20');
    expect(within(today as HTMLElement).getByText('(today)')).toBeTruthy();
    expect(methods(recorded)).toEqual(['snapshot']);
  });

  it('offers the next planned date when the visible month is empty, and follows it without saving', async () => {
    const { recorded, visited, user } = setup('calendar/2026-09');
    await screen.findByRole('heading', { name: 'September 2026' });
    expect(screen.getByText('Nothing planned this month.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Next planned: Oct 24' }));
    expect(visited.at(-1)).toBe('calendar/2026-10');
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeTruthy();
    expect(screen.queryByText(/Nothing planned/)).toBeNull();
    expect(methods(recorded)).toEqual(['snapshot']);
    expectNoExecution(recorded);
  });

  it('points back to the last planned date when nothing is planned later', async () => {
    const { user } = setup('calendar/2027-03');
    await screen.findByRole('heading', { name: 'March 2027' });
    await user.click(screen.getByRole('button', { name: 'Last planned: Nov 2, 2026' }));
    expect(await screen.findByRole('heading', { name: 'November 2026' })).toBeTruthy();
  });

  it('shows a chip as a channel bar, a readable title and the channel badge, with the full title on hover', async () => {
    setup('calendar/2026-10');
    const chip = await chipOf(/^Autumn blend tasting notes/);
    expect(chip.getAttribute('title')).toBe('Autumn blend tasting notes · LinkedIn');
    expect(chip.getAttribute('data-channel')).toBe('LinkedIn');
    expect(chip.querySelector('.cal-chip-bar')).toBeTruthy();
    expect(chip.querySelector('.cal-chip-title')?.textContent).toBe('Autumn blend tasting notes');
    expect(chip.querySelector('.sx-channel')).toBeTruthy();
    // No grey channel line above the title: the channel is the badge and the bar.
    expect(chip.querySelector('.cal-chip-channel')).toBeNull();
  });

  it('lifts a dragged chip, highlights the day under it, and clears both without saving', async () => {
    const { recorded } = setup('calendar/2026-10');
    const chip = await chipOf(/^Autumn blend tasting notes/);
    const cell = document.querySelector('[data-drop-date="2026-10-28"]')!;
    const dataTransfer = fakeTransfer();
    recorded.clear();
    fireEvent.dragStart(chip, { dataTransfer });
    expect(chip.getAttribute('data-dragging')).not.toBeNull();
    fireEvent.dragOver(cell, { dataTransfer });
    expect(cell.getAttribute('data-drop-active')).not.toBeNull();
    fireEvent.dragOver(document.querySelector('[data-drop-date="2026-10-29"]')!, { dataTransfer });
    expect(cell.getAttribute('data-drop-active')).toBeNull();
    fireEvent.dragEnd(chip, { dataTransfer });
    expect(chip.getAttribute('data-dragging')).toBeNull();
    expect(document.querySelector('[data-drop-active]')).toBeNull();
    expect(methods(recorded)).toEqual([]);
  });

  it('highlights the No date yet tray as a drop target for clearing a date', async () => {
    setup('calendar/2026-10');
    const chip = await chipOf(/^Autumn blend tasting notes/);
    const tray = screen.getByRole('complementary', { name: 'No date yet' });
    const dataTransfer = fakeTransfer();
    fireEvent.dragStart(chip, { dataTransfer });
    fireEvent.dragOver(tray, { dataTransfer });
    expect(tray.getAttribute('data-drop-active')).not.toBeNull();
    fireEvent.drop(tray, { dataTransfer });
    expect(tray.getAttribute('data-drop-active')).toBeNull();
  });

  it('highlights a day during a pointer drag too', async () => {
    const { recorded } = setup('calendar/2026-10');
    const chip = await chipOf(/^Autumn blend tasting notes/);
    const cell = document.querySelector('[data-drop-date="2026-10-28"]')!;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(cell);
    recorded.clear();
    fireEvent.pointerDown(chip, { button: 0, pointerId: 3, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(chip, { pointerId: 3, clientX: 80, clientY: 60 });
    expect(chip.getAttribute('data-dragging')).not.toBeNull();
    expect(cell.getAttribute('data-drop-active')).not.toBeNull();
    expect(methods(recorded)).toEqual([]);
    fireEvent.pointerCancel(chip, { pointerId: 3 });
    expect(cell.getAttribute('data-drop-active')).toBeNull();
    expect(chip.getAttribute('data-dragging')).toBeNull();
  });

  describe('settling after a drop', () => {
    afterEach(() => { delete document.documentElement.dataset.hqMotion; delete (HTMLElement.prototype as { animate?: unknown }).animate; });
    const dropOnDay = async (day: string) => {
      const chip = await chipOf(/^Steeping times thread/);
      const dataTransfer = fakeTransfer();
      fireEvent.dragStart(chip, { dataTransfer });
      fireEvent.drop(document.querySelector(`[data-drop-date="${day}"]`)!, { dataTransfer });
      await findToast(/^Moved “Steeping times thread”/);
    };

    it('springs the moved chip into place and washes it with colour', async () => {
      const animate = vi.fn(() => ({}) as Animation);
      (HTMLElement.prototype as { animate?: unknown }).animate = animate;
      setup('calendar/2026-10');
      await screen.findByRole('heading', { name: 'October 2026' });
      await dropOnDay('2026-10-15');
      const landed = document.querySelector('[data-drop-date="2026-10-15"] .cal-chip')!;
      expect(landed.classList.contains('hq-flash')).toBe(true);
      expect(animate).toHaveBeenCalledTimes(1);
    });

    it('under reduced motion keeps the colour wash and drops the movement', async () => {
      document.documentElement.dataset.hqMotion = 'reduce';
      const animate = vi.fn(() => ({}) as Animation);
      (HTMLElement.prototype as { animate?: unknown }).animate = animate;
      setup('calendar/2026-10');
      await screen.findByRole('heading', { name: 'October 2026' });
      await dropOnDay('2026-10-15');
      expect(document.querySelector('[data-drop-date="2026-10-15"] .cal-chip')!.classList.contains('hq-flash')).toBe(true);
      expect(animate).not.toHaveBeenCalled();
    });
  });

  it('keeps an unknown save visible on its chip, pauses its moves and never saves a second time', async () => {
    const { controls, recorded, user } = setup('calendar/2026-10');
    await screen.findByRole('heading', { name: 'October 2026' });
    controls.failNext('saveDraft', { kind: 'unknown', attemptedAt: NOW().toISOString() });
    controls.failNext('snapshot', { kind: 'unavailable' });
    recorded.clear();
    await user.click(await chipOf(/^Autumn blend tasting notes/));
    fireEvent.change(await screen.findByLabelText('Planned date'), { target: { value: '2026-10-28' } });
    await user.click(screen.getByRole('button', { name: 'Move to date' }));
    expect(await findToast(/Not moved: HQ could not confirm the result/)).toBeTruthy();
    expect(methods(recorded)).toEqual(['saveDraft', 'snapshot']);
    const chip = await chipOf(/^Autumn blend tasting notes/);
    expect(chip.getAttribute('data-unknown')).not.toBeNull();
    expect(chip.disabled).toBe(true);
    expect(screen.getByText(/Moves for drafts with an unresolved save are paused/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Undo last calendar change' })).toBeNull();
    expectNoExecution(recorded);
  });

  it('puts the channel and time in the tooltip of a timed chip, since a compact chip hides them', async () => {
    const seed = fictionalSeed();
    seed.content = seed.content.map((draft) => draft.id === FIXTURE_IDS.autumnBlend
      ? { ...draft, planned_date: '2026-10-20', planning_slot: { start: '09:00', duration_minutes: 30, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } } : draft);
    setup('calendar/2026-10', { features: [FEATURE_HQ_EDITORIAL_TIMEBOX], seed });
    const chip = await chipOf(/^Autumn blend tasting notes/);
    expect(chip.getAttribute('title')).toMatch(/^Autumn blend tasting notes · LinkedIn · 9:00 a\.m\. · 30 min$/u);
    expect(chip.getAttribute('aria-label')).toMatch(/LinkedIn.*9:00 a\.m\., 30 min/u);
  });

  describe('while the Social service is unreachable', () => {
    async function goOffline(frame: SocialFrame | null) {
      const s = setup('calendar/2026-10', {}, frame);
      await screen.findByRole('heading', { name: 'October 2026' });
      s.controls.setUnavailable(true);
      await act(async () => { await socialSession('fixture-project').load(s.recorded.port); });
      return s;
    }

    it('keeps its own "Moves are paused" bar when mounted on its own', async () => {
      await goOffline(null);
      expect(await screen.findByText('Moves are paused')).toBeTruthy();
      expect((await chipOf(/^Autumn blend tasting notes/)).disabled).toBe(true);
    });

    it('adds no second bar inside the frame, whose bar already says changes are paused; chips stay disabled and say why', async () => {
      const s = await goOffline(FRAME);
      const chip = await chipOf(/^Autumn blend tasting notes/);
      await waitFor(() => expect(chip.disabled).toBe(true));
      expect(screen.queryByText('Moves are paused')).toBeNull();
      expect(chip.getAttribute('draggable')).toBe('false');
      expect(chip.title).toMatch(/Moves are paused while the Social service is unreachable\.$/u);
      const note = document.getElementById(chip.getAttribute('aria-describedby')!)!;
      expect(note.textContent).toBe('Moves are paused while the Social service is unreachable.');
      s.recorded.clear();
      fireEvent.click(chip);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(methods(s.recorded)).toEqual([]);
    });

    it('still shows the unknown-save bar inside the frame, a different reason', async () => {
      const { controls, user } = setup('calendar/2026-10', {}, FRAME);
      await screen.findByRole('heading', { name: 'October 2026' });
      controls.failNext('saveDraft', { kind: 'unknown', attemptedAt: NOW().toISOString() });
      controls.failNext('snapshot', { kind: 'unavailable' });
      await user.click(await chipOf(/^Autumn blend tasting notes/));
      fireEvent.change(await screen.findByLabelText('Planned date'), { target: { value: '2026-10-28' } });
      await user.click(screen.getByRole('button', { name: 'Move to date' }));
      expect(await screen.findByText('Some moves are paused')).toBeTruthy();
    });
  });

  it('shows a No date yet tray without a stray arrow, with its count and a labelled collapse control', async () => {
    const { user } = setup('calendar/2026-10');
    const tray = await screen.findByRole('complementary', { name: 'No date yet' });
    expect(tray.textContent).not.toMatch(/[→←]/u);
    expect(within(tray).getAllByRole('button', { name: /^(Notes on a slower|Steeping times)/ })).toHaveLength(2);
    expect(tray.querySelector('.cal-count')?.textContent).toBe('2');
    await user.click(within(tray).getByRole('button', { name: 'Collapse undated drafts' }));
    expect(within(tray).getByRole('button', { name: 'Show undated drafts' })).toBeTruthy();
    expect(within(tray).queryByRole('button', { name: /^Steeping times/ })).toBeNull();
  });

  it('shows the toolbar Undo compactly with its full accessible name', async () => {
    const { user } = setup('calendar/2026-10');
    await user.click(await screen.findByRole('button', { name: /^Autumn blend tasting notes/ }));
    fireEvent.change(screen.getByLabelText('Planned date'), { target: { value: '2026-10-28' } });
    await user.click(screen.getByRole('button', { name: 'Move to date' }));
    const undo = await screen.findByRole('button', { name: 'Undo last calendar change' });
    expect(undo.textContent).toBe('Undo');
  });

  it('keeps success toasts to eight seconds and error toasts until dismissed', async () => {
    const { controls, user } = setup('calendar/2026-10');
    await user.click(await screen.findByRole('button', { name: /^Autumn blend tasting notes/ }));
    controls.editElsewhere(FIXTURE_IDS.autumnBlend, { title: 'Autumn blend tasting notes' });
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Clear date' }));
    const refusal = await findToast(/Not moved: This draft changed in another window/);
    expect(refusal.getAttribute('data-tone')).toBe('danger');
    expect(within(refusal).getByRole('button', { name: 'Dismiss notification' })).toBeTruthy();
  });
});

describe('calendar stylesheet', () => {
  const css = readFileSync('modules/social/content/calendar.css', 'utf8');
  it('uses tokens, not raw colours, and no inline styles', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/iu);
    expect(css).not.toMatch(/style=/u);
  });
  it('drops the lifted tilt under reduced motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.cal-chip--lifted \{ transform: none; \}/u);
    expect(css).toMatch(/:root\[data-hq-motion="reduce"\] \.cal-chip--lifted \{ transform: none; \}/u);
  });
  it('goes compact from the calendar region\'s own width, not the window\'s, and never scrolls the month sideways', () => {
    expect(css).toMatch(/\.cal-main \{[^}]*container: calmain \/ inline-size/u);
    expect(css).toMatch(/@container calmain \(max-width: 40rem\) \{[^}]*\.cal-cell \{ --cal-compact: 1;/u);
    expect(css).toMatch(/@container calchip style\(--cal-compact: 1\)/u);
    expect(css).not.toMatch(/\.cal-month \{[^}]*min-width: [1-9]/u);
    expect(css).toMatch(/\.cal-month \{[^}]*table-layout: fixed/u);
  });
  it('breaks chip titles at word boundaries, hyphenated, in two lines', () => {
    expect(css).toMatch(/\.cal-chip-title \{[^}]*-webkit-line-clamp: 2[^}]*overflow-wrap: break-word; word-break: normal; hyphens: auto/u);
    expect(css.match(/\.cal-chip-title \{[^}]*\}/u)![0]).not.toMatch(/overflow-wrap: anywhere|word-break: break-all/u);
  });
  it('gives tray chips air: six pixels above and below, eight at the side, six between', () => {
    expect(css).toMatch(/\.cal-tray \.cal-chips \{ gap: var\(--hq-space-xs\); \}/u);
    expect(css).toMatch(/\.cal-tray \.cal-chip \{ padding: var\(--hq-space-xs\) var\(--hq-space-sm\)/u);
  });
  it('keeps Agenda and the view cycle apart with the small spacing token', () => {
    expect(css).toMatch(/\.cal-views \{[^}]*gap: var\(--hq-space-sm\)/u);
  });
});
