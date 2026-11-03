import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { isDestination, parseProjectContext, type ModulePort } from '@hq/contracts';
import { EXAMPLE_SETTINGS, PLANNER_PORT_KEYS, type Item, type PlannerPort } from '../../core';
import { VIEW_TODAY, viewItems } from '../../views/fixtures';
import { EXAMPLE_NOTE, examplePlanner, NAV_ITEMS, resetWorkSessions, setWorkSessionPort, WorkDomain, workSession } from '..';
import { fixedNow, installPlanner, uninstallPlanner, type RecordedPlanner } from './support';

/** ac.work-domain.001: one shared session, honest labels, Work destinations, scoped capture and zero writes on navigation. */

const CONTEXT = parseProjectContext({ id: 'domain-project', name: 'Domain fixture project' })!;
let recorded: RecordedPlanner;

beforeEach(() => {
  ({ recorded } = installPlanner());
});

afterEach(() => {
  cleanup();
  uninstallPlanner();
});

type Port = ModulePort & { navigate: Mock<(destination: string) => void> };

function port(destination: string): Port {
  return {
    context: CONTEXT, destination, appearance: 'light', desktop: { platform: 'browser', versions: { electron: null } },
    navigate: vi.fn<(destination: string) => void>(),
  };
}

const user = () => userEvent.setup();
const workNav = () => within(screen.getByRole('navigation', { name: 'Work' }));
const session = () => workSession(CONTEXT.id);

describe('the Work session', () => {
  it('is one module-level store shared by board, views, detail and capture, and a remount reuses it', async () => {
    const first = render(<WorkDomain {...port('home')} now={fixedNow} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    const store = session().store;
    first.unmount();

    // A remount gets the same session: no second snapshot.
    const props = port('home');
    const view = render(<WorkDomain {...props} now={fixedNow} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    expect(session().store).toBe(store);
    expect(recorded.calls.filter((call) => call.method === 'snapshot')).toHaveLength(1);

    // Captured from the toolbar, the item is on the board, in the List view and in the detail panel at once.
    await user().type(screen.getByRole('textbox', { name: 'Capture to Inbox' }), 'Label the seed jars{Enter}');
    await waitFor(() => expect(recorded.writes()).toHaveLength(1));
    const created = store.getState().items.find((item) => item.title === 'Label the seed jars')!;
    expect(view.container.querySelector(`[data-card-id="${created.id}"]`)).not.toBeNull();
    view.rerender(<WorkDomain {...props} destination="list" now={fixedNow} />);
    expect(await screen.findByRole('button', { name: 'Label the seed jars' })).toBeTruthy();
    view.rerender(<WorkDomain {...props} destination={`item/${created.id}`} now={fixedNow} />);
    expect((await screen.findByRole('textbox', { name: 'Card title' }) as HTMLInputElement).value).toBe('Label the seed jars');
    expect(recorded.writes()).toHaveLength(1);
  });

  it('uses the fictional example Planner by default, with Planner settings and only example items', async () => {
    uninstallPlanner();
    const snapshot = await examplePlanner(fixedNow()).snapshot();
    expect(snapshot.settings).toStrictEqual(EXAMPLE_SETTINGS);
    expect(snapshot.items.length).toBeGreaterThan(0);
    expect(snapshot.items.every((item) => item.is_example)).toBe(true);
    expect(snapshot.features).toStrictEqual([]);
    const live = workSession('example-project');
    expect(live.example).toBe(true);
    expect(Object.keys(live.store).some((key) => /run|exec|dispatch|launch/iu.test(key))).toBe(false);
    resetWorkSessions();
  });

  it('keeps the Planner port surface free of execution members', () => {
    expect([...PLANNER_PORT_KEYS].sort()).toStrictEqual(['create', 'history', 'markReviewed', 'move', 'patch', 'setArchived', 'snapshot', 'updateSettings', 'version']);
  });
});

describe('labels', () => {
  it('labels example data, session-only state and the not-project-scoped note, and filters area only as a label', async () => {
    render(<WorkDomain {...port('home')} now={fixedNow} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    expect(screen.getByRole('note', { name: '' }).textContent).toContain(EXAMPLE_NOTE);
    expect(EXAMPLE_NOTE).toMatch(/fictional/iu);
    expect(EXAMPLE_NOTE).toMatch(/this session only/iu);
    expect(screen.getByText('Planner items aren’t project-scoped · showing all planning')).toBeTruthy();
    const filters = within(screen.getByRole('group', { name: 'Filter planning' }));
    expect(filters.getByLabelText('Area label').getAttribute('aria-describedby')).toBeTruthy();
    expect(screen.getByText('A Planner label, not a project.')).toBeTruthy();
    expect(screen.queryByText(/switch project/iu)).toBeNull();
  });

  it('shows the not-project-scoped note on a planning view and on Planner settings', async () => {
    const props = port('glance');
    const view = render(<WorkDomain {...props} now={fixedNow} />);
    expect(await screen.findByText('Planner items aren\'t project-scoped · showing all planning')).toBeTruthy();
    view.rerender(<WorkDomain {...props} destination="settings" now={fixedNow} />);
    expect(await screen.findByRole('heading', { level: 2, name: 'Planner settings' })).toBeTruthy();
    expect(screen.getByText('Planner items aren\'t project-scoped · showing all planning')).toBeTruthy();
  });
});

describe('destinations and navigation', () => {
  it('maps every secondary-navigation item to a valid destination with no port call, write or execution', async () => {
    const props = port('home');
    const view = render(<WorkDomain {...props} now={fixedNow} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    const calls = recorded.calls.length;
    for (const item of NAV_ITEMS) {
      expect(isDestination(item.destination)).toBe(true);
      await user().click(workNav().getByRole('button', { name: item.label }));
      expect(props.navigate).toHaveBeenLastCalledWith(item.destination);
      view.rerender(<WorkDomain {...props} destination={item.destination} now={fixedNow} />);
      expect(workNav().getByRole('button', { name: item.label }).getAttribute('aria-current')).toBe('page');
    }
    expect(recorded.calls.length).toBe(calls);
    expect(recorded.execution()).toHaveLength(0);
  });

  it('never navigates on mount, even for an unknown destination', async () => {
    for (const destination of ['home', 'board', 'lists', 'item/ex-bread', 'calendar/2026-11', 'not/a/page']) {
      const props = port(destination);
      const view = render(<WorkDomain {...props} now={fixedNow} />);
      await act(async () => {});
      expect(props.navigate).not.toHaveBeenCalled();
      view.unmount();
    }
    expect(recorded.writes()).toHaveLength(0);
  });

  it('renders lists as By date, a reserved plan board as proposed and an unknown page honestly', async () => {
    const props = port('lists');
    const view = render(<WorkDomain {...props} now={fixedNow} />);
    expect(await screen.findByRole('region', { name: /^Today, / })).toBeTruthy();
    expect(workNav().getByRole('button', { name: 'By date' }).getAttribute('aria-current')).toBe('page');
    view.rerender(<WorkDomain {...props} destination="board/plan/weekly" now={fixedNow} />);
    expect(screen.getByText('Proposed — not available')).toBeTruthy();
    view.rerender(<WorkDomain {...props} destination="nowhere" now={fixedNow} />);
    expect(screen.getByText('This Work page doesn\'t exist')).toBeTruthy();
    await user().click(screen.getByRole('button', { name: 'Open the board' }));
    expect(props.navigate).toHaveBeenCalledWith('board');
    expect(recorded.writes()).toHaveLength(0);
  });

  it('opens item/<id> over the last page and closes back to it', async () => {
    const props = port('timeline');
    const view = render(<WorkDomain {...props} now={fixedNow} />);
    await screen.findByText('Planner items aren\'t project-scoped · showing all planning');
    view.rerender(<WorkDomain {...props} destination="item/ex-bread" now={fixedNow} />);
    expect((await screen.findByRole('textbox', { name: 'Card title' }) as HTMLInputElement).value).toBe('Learn three bread recipes');
    expect(view.container.querySelector('.wv')?.getAttribute('data-view')).toBe('timeline');
    await user().click(screen.getByRole('button', { name: 'Close card' }));
    expect(props.navigate).toHaveBeenLastCalledWith('timeline');
    expect(recorded.writes()).toHaveLength(0);
  });
});

describe('Planner settings week_start', () => {
  /** Today is Wednesday 2026-10-21; Sunday the 25th ends a Monday-start week but starts the next Sunday-start week. */
  function sundayItem(): Item {
    const base = viewItems(VIEW_TODAY).find((item) => item.id === 'ex-postcards')!;
    return { ...base, id: 'ex-sunday', title: 'Press the autumn leaves', dates: [{ id: 'date-sun', kind: 'target', precision: 'day', value: '2026-10-25', time: null, end_time: null, tz: null, note: '' }] };
  }

  async function groupOf(weekStart: 'sun' | 'mon') {
    cleanup();
    ({ recorded } = installPlanner({ items: [sundayItem()], settings: { ...EXAMPLE_SETTINGS, week_start: weekStart } }));
    render(<WorkDomain {...port('board/by-date')} now={fixedNow} />);
    const card = await screen.findByRole('article', { name: /^Press the autumn leaves/u });
    return card.closest('[data-group]')!.getAttribute('data-group');
  }

  it('groups weeks by the Planner week_start the session loaded', async () => {
    expect(await groupOf('sun')).toBe('later');
    expect(await groupOf('mon')).toBe('week');
  });

  it('shows the week start on the Planner settings page', async () => {
    cleanup();
    installPlanner({ settings: { ...EXAMPLE_SETTINGS, week_start: 'mon' } });
    render(<WorkDomain {...port('settings')} now={fixedNow} />);
    const list = await screen.findByRole('heading', { level: 2, name: 'Planner settings' });
    expect(list.parentElement!.textContent).toContain('Week starts onMonday');
  });
});

describe('quick capture', () => {
  it('opens the capture dialog with N only while focus is inside Work', async () => {
    render(<><button type="button">Outside Work</button><WorkDomain {...port('home')} now={fixedNow} /></>);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    screen.getByRole('button', { name: 'Outside Work' }).focus();
    await user().keyboard('n');
    expect(screen.queryByRole('dialog', { name: 'Capture' })).toBeNull();
    workNav().getByRole('button', { name: 'Glance' }).focus();
    await user().keyboard('n');
    expect(await screen.findByRole('dialog', { name: 'Capture' })).toBeTruthy();
  });

  it('captures the title exactly as typed into Inbox with no invented date, and offers a date only as a suggestion', async () => {
    render(<WorkDomain {...port('home')} now={fixedNow} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    const input = screen.getByRole('textbox', { name: 'Capture to Inbox' });
    await user().type(input, 'Call the farrier friday');
    expect(screen.getByText(/‘friday’ looks like a date/u)).toBeTruthy();
    await user().click(screen.getByRole('button', { name: 'Capture' }));
    await waitFor(() => expect(recorded.writes()).toHaveLength(1));
    expect(recorded.writes()[0]!.method).toBe('create');
    const fields = recorded.writes()[0]!.args[0] as { title: string; status: string; dates?: unknown[] };
    expect(fields.title).toBe('Call the farrier friday');
    expect(fields.status).toBe('inbox');
    expect(fields.dates ?? []).toStrictEqual([]);
    expect((input as HTMLInputElement).value).toBe('');
    expect(recorded.execution()).toHaveLength(0);
  });

  it('keeps an HQ draft only by explicit choice while the Planner is unreachable', async () => {
    cleanup();
    const installed = installPlanner();
    recorded = installed.recorded;
    render(<WorkDomain {...port('home')} now={fixedNow} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    installed.faults.next('unavailable');
    await user().type(screen.getByRole('textbox', { name: 'Capture to Inbox' }), 'Mend the gate latch{Enter}');
    expect(await screen.findByText('Planner unreachable')).toBeTruthy();
    expect(session().drafts.getState().drafts).toHaveLength(0);
    await user().click(screen.getByRole('button', { name: 'Keep as HQ draft' }));
    expect(session().drafts.getState().drafts.map((draft) => draft.fields.title)).toStrictEqual(['Mend the gate latch']);
    expect(screen.getAllByText('HQ draft · not in the Planner').length).toBeGreaterThan(0);
  });

  it('once the Planner answers again, editing the capture offers Capture instead of an HQ draft', async () => {
    cleanup();
    const installed = installPlanner();
    recorded = installed.recorded;
    render(<WorkDomain {...port('home')} now={fixedNow} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    installed.faults.next('unavailable');
    const input = screen.getByRole('textbox', { name: 'Capture to Inbox' });
    await user().type(input, 'Mend the gate latch{Enter}');
    expect(await screen.findByText('Planner unreachable')).toBeTruthy();
    // Still unreachable: editing keeps the HQ draft offer.
    await user().type(input, ' again');
    expect(screen.getByText('Planner unreachable')).toBeTruthy();

    await act(async () => { await session().store.poll(); });
    await user().type(input, '!');
    expect(screen.queryByText('Planner unreachable')).toBeNull();
    await user().keyboard('{Enter}');
    await waitFor(() => expect(recorded.writes().filter((call) => call.method === 'create')).toHaveLength(2));
    expect((recorded.writes().at(-1)!.args[0] as { title: string }).title).toBe('Mend the gate latch again!');
    expect(session().drafts.getState().drafts).toHaveLength(0);
  });

  it('a capture still saving is not sent again after a domain switch and back', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const inner = recorded.port;
    setWorkSessionPort({
      ...inner,
      create: async (...args: Parameters<PlannerPort['create']>) => {
        const result = await inner.create(...args);
        await gate;
        return result;
      },
    });
    const first = render(<WorkDomain {...port('home')} now={fixedNow} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    await user().type(screen.getByRole('textbox', { name: 'Capture to Inbox' }), 'Oil the hinges{Enter}');
    await waitFor(() => expect(recorded.writes()).toHaveLength(1));
    first.unmount();

    render(<WorkDomain {...port('home')} now={fixedNow} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    const input = screen.getByRole('textbox', { name: 'Capture to Inbox' }) as HTMLInputElement;
    expect(input.value).toBe('Oil the hinges');
    await user().type(input, '{Enter}');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(recorded.writes()).toHaveLength(1);

    await act(async () => { release(); await gate; });
    await waitFor(() => expect(input.value).toBe(''));
    expect(recorded.writes()).toHaveLength(1);
    expect(session().store.getState().items.filter((item) => item.title === 'Oil the hinges')).toHaveLength(1);
  });
});


describe('collapsible Work panels', () => {
  it('collapses navigation to zero and restores the remembered width without planning writes', async () => {
    const { unmount } = render(<WorkDomain {...port('home')} now={fixedNow} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Work navigation width' }), { key: 'ArrowRight', shiftKey: true });
    expect(screen.getByRole('separator', { name: 'Work navigation width' }).getAttribute('aria-valuenow')).toBe('216');
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Work navigation width' }), { key: 'Home' });
    expect(screen.queryByRole('navigation', { name: 'Work' })).toBeNull();
    unmount();
    render(<WorkDomain {...port('home')} now={fixedNow} />);
    await user().click(screen.getByRole('button', { name: 'Show Work navigation' }));
    expect(screen.getByRole('separator', { name: 'Work navigation width' }).getAttribute('aria-valuenow')).toBe('216');
    expect(recorded.writes()).toHaveLength(0);
  });

  it('keeps the detail editor mounted while collapsed and restores the same notes buffer', async () => {
    render(<WorkDomain {...port('item/ex-library')} now={fixedNow} />);
    const notes = await screen.findByRole('textbox', { name: 'Notes' });
    fireEvent.change(notes, { target: { value: 'Keep this draft visible after restore' } });
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Work detail width' }), { key: 'Home' });
    expect(screen.queryByRole('textbox', { name: 'Notes' })).toBeNull();
    expect(notes.isConnected).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Show item details' }));
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBe(notes);
    expect((notes as HTMLTextAreaElement).value).toBe('Keep this draft visible after restore');
  });

  it('hides capture and filters behind one restore control and preserves an active filter', async () => {
    render(<WorkDomain {...port('home')} now={fixedNow} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'library' } });
    fireEvent.click(screen.getByRole('button', { name: /Hide capture & filters/ }));
    expect(screen.queryByRole('searchbox', { name: 'Search' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Show capture & filters · 1 filters/ }));
    expect((screen.getByRole('searchbox', { name: 'Search' }) as HTMLInputElement).value).toBe('library');
    expect(recorded.writes()).toHaveLength(0);
  });
});
