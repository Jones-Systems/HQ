/// <reference path="../../../../apps/desktop/src/environment.d.ts" />
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WorkDefault, { WorkModule } from '@hq/work';
import { App } from '../../../../apps/desktop/src/App';
import { MODULES } from '../../../../apps/desktop/src/modules';
import { workSession } from '..';
import { installPlanner, uninstallPlanner, type RecordedPlanner } from './support';

/**
 * test.work-domain.001: the actual Work descriptor mounts through T0's registry inside the real shell (`App` →
 * `MODULES.work`), which remounts the module on every domain switch. Every Planner port call is recorded, so
 * restoration is proved with no new reads, no writes and no execution.
 */

let recorded: RecordedPlanner;
let device: ReturnType<typeof installPlanner>['device'];

beforeEach(() => {
  window.localStorage.clear();
  ({ recorded, device } = installPlanner());
});

afterEach(() => {
  cleanup();
  uninstallPlanner();
  delete document.documentElement.dataset.theme;
});

const user = () => userEvent.setup();
const rail = () => within(screen.getByRole('navigation', { name: 'Domains' }));
const workNav = () => within(screen.getByRole('navigation', { name: 'Work' }));
const main = () => screen.getByRole('main');
const scroller = () => main().querySelector<HTMLElement>('.wd-scroll')!;
const filters = () => within(screen.getByRole('group', { name: 'Filter planning' }));
const capture = () => screen.getByRole('textbox', { name: 'Capture to Inbox' }) as HTMLInputElement;
const card = (id: string) => main().querySelector<HTMLElement>(`[data-card-id="${id}"]`)!;

async function openCard(id: string) {
  await screen.findByRole('heading', { level: 2, name: 'Status board' });
  await user().click(card(id));
  return screen.findByRole('textbox', { name: 'Card title' });
}

async function switchDomain(name: 'Design' | 'Social' | 'Work') {
  await user().click(rail().getByRole('button', { name }));
  expect(rail().getByRole('button', { name }).getAttribute('aria-current')).toBe('page');
}

/** Design → Social → Work → Work, checking the module really remounted and that re-selecting Work keeps it. */
async function roundTrip(check: () => Promise<void> | void) {
  const before = main().firstElementChild;
  await switchDomain('Design');
  expect(screen.getByRole('heading', { level: 1, name: 'A place for Design.' })).toBeTruthy();
  await switchDomain('Social');
  expect(screen.queryByRole('navigation', { name: 'Work' })).toBeNull();
  await switchDomain('Work');
  const after = main().firstElementChild;
  expect(after).not.toBe(before);
  await check();
  await switchDomain('Work');
  expect(main().firstElementChild).toBe(after);
  await check();
}

describe('Work descriptor in the T0 registry', () => {
  it('is the registry entry for the work domain, as a named and a default export', () => {
    expect(MODULES.work).toBe(WorkModule);
    expect(WorkDefault).toBe(WorkModule);
  });

  it('opens the Board at home with honest example, session-only and not-project-scoped labels', async () => {
    render(<App />);
    await switchDomain('Work');
    expect(await screen.findByRole('heading', { level: 2, name: 'Status board' })).toBeTruthy();
    expect(workNav().getByRole('button', { name: 'Status board' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByText(/^Fictional example planning, kept in memory for this session only\./u)).toBeTruthy();
    expect(screen.getByText('Example data')).toBeTruthy();
    expect(screen.getByText('Planner items aren’t project-scoped · showing all planning')).toBeTruthy();
    // The shell's project context is unchanged; Work never switches it.
    expect(screen.getByText('HQ workspace')).toBeTruthy();
    expect(recorded.writes()).toHaveLength(0);
    expect(recorded.execution()).toHaveLength(0);
  });

  it('restores view, filters, selection, scroll and unsaved capture text across Design → Social → Work → Work with no port calls', async () => {
    render(<App />);
    await switchDomain('Work');
    await screen.findByRole('heading', { level: 2, name: 'Status board' });

    await user().click(workNav().getByRole('button', { name: 'List' }));
    await user().selectOptions(filters().getByLabelText('Kind'), 'chore');
    await user().type(filters().getByLabelText('Search'), 'the');
    await user().click(await screen.findByRole('button', { name: 'Repaint the garden shed' }));
    expect(await screen.findByRole('textbox', { name: 'Card title' })).toBeTruthy();
    await user().type(capture(), 'Order twine for the bean poles');
    act(() => {
      scroller().scrollTop = 180;
      scroller().scrollLeft = 24;
      fireEvent.scroll(scroller());
    });
    const callsBefore = recorded.calls.length;

    await roundTrip(async () => {
      expect(workNav().getByRole('button', { name: 'List' }).getAttribute('aria-current')).toBe('page');
      expect(main().querySelector('.wv')?.getAttribute('data-view')).toBe('list');
      expect((filters().getByLabelText('Kind') as HTMLSelectElement).value).toBe('chore');
      expect((filters().getByLabelText('Search') as HTMLInputElement).value).toBe('the');
      expect((await screen.findByRole('textbox', { name: 'Card title' }) as HTMLInputElement).value).toBe('Repaint the garden shed');
      expect(capture().value).toBe('Order twine for the bean poles');
      expect(scroller().scrollTop).toBe(180);
      expect(scroller().scrollLeft).toBe(24);
    });

    // The remounts reused the session: no further reads, no writes, no execution.
    expect(recorded.calls.length).toBe(callsBefore);
    expect(recorded.calls.filter((call) => call.method === 'snapshot')).toHaveLength(1);
    expect(recorded.writes()).toHaveLength(0);
    expect(recorded.execution()).toHaveLength(0);
  });

  it('restores detail text the Planner could not take (changed elsewhere) with no writes', async () => {
    render(<App />);
    await switchDomain('Work');
    const title = await openCard('ex-shed-paint');
    await user().clear(title);
    await user().type(title, 'Repaint the shed in sage');
    // Another device renames the card; the session's next version check sees it.
    await device.patch('ex-shed-paint', 1, { title: 'Repaint the shed and fence' }, 'other-device-0001');
    await act(() => workSession('hq-local').store.poll());
    const writesBefore = recorded.writes().length;

    // Leaving the field finds the Planner value moved, so nothing is sent and the text is kept.
    await roundTrip(async () => {
      expect((await screen.findByRole('textbox', { name: 'Card title' }) as HTMLInputElement).value).toBe('Repaint the shed in sage');
      expect(screen.getAllByText('Changed elsewhere').length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Keep mine' })).toBeTruthy();
    });
    expect(recorded.writes()).toHaveLength(writesBefore);
    expect(writesBefore).toBe(0);
    expect(recorded.execution()).toHaveLength(0);
  });

  it('commits a focused detail field by the detail panel’s save-on-leave when the rail takes focus, and only that', async () => {
    render(<App />);
    await switchDomain('Work');
    const title = await openCard('ex-shed-paint');
    await user().type(title, ' today');
    expect(recorded.writes()).toHaveLength(0);

    // Accepted RV-3 behaviour: leaving a detail field saves it. Clicking the rail moves focus out of the field, so the
    // user's own edit is sent once, as a planning patch. The switch adds nothing else.
    await roundTrip(async () => {
      expect((await screen.findByRole('textbox', { name: 'Card title' }) as HTMLInputElement).value).toBe('Repaint the garden shed today');
    });
    expect(recorded.writes().map((call) => [call.method, call.args[2]])).toStrictEqual([['patch', { title: 'Repaint the garden shed today' }]]);
    expect(recorded.execution()).toHaveLength(0);
  });

  it('restores board collapse and the selected card after a remount without moving anything', async () => {
    render(<App />);
    await switchDomain('Work');
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    await user().click(screen.getByRole('button', { name: /^Inbox/u, expanded: true }));
    await openCard('ex-bread');

    await roundTrip(async () => {
      const inbox = main().querySelector('[data-drop-status="inbox"]')!;
      expect(within(inbox as HTMLElement).getByRole('button', { name: /^Inbox/u }).getAttribute('aria-expanded')).toBe('false');
      expect(main().querySelector('[data-card-id="ex-bread"]')?.getAttribute('data-selected')).toBe('true');
      expect((screen.getByRole('textbox', { name: 'Card title' }) as HTMLInputElement).value).toBe('Learn three bread recipes');
    });
    expect(recorded.writes()).toHaveLength(0);
    expect(recorded.execution()).toHaveLength(0);
  });
});
