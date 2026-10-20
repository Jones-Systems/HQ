/// <reference path="./environment.d.ts" />
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import SocialDefault, { SocialModule } from '@hq/social';
import WorkDefault, { WorkModule } from '@hq/work';
import { App } from './App';
import { MODULES } from './modules';
import { APPEARANCE_KEY } from './state';
import { CALL_CLASSES, FIXTURE_IDS, resetSocialSessions, type PortMethod, type SocialWorkspacePort } from '../../../modules/social/core';
import { NAV_ITEMS as SOCIAL_NAV, setSocialWorkspacePort } from '../../../modules/social/nav';
import { createWorkbenchFixture } from '../../../modules/social/workbench/fixtures/examples';
import { createFixturePlanner, EXAMPLE_SETTINGS, PLANNER_PORT_KEYS, type PlannerPort } from '../../../modules/work/core';
import { NAV_ITEMS as WORK_NAV, resetWorkSessions, setWorkSessionPort, workSession } from '../../../modules/work/nav';
import { resetViewMemory } from '../../../modules/work/views/env';
import { VIEW_NOW, VIEW_TODAY, viewItems } from '../../../modules/work/views/fixtures';

/**
 * test.domain-integration.001 (ac.sw-assembly.001, ac.integration.001): the accepted Social and Work domains mounted
 * through T0's registry in the real shell (`App` → `MODULES`), with T0's Design placeholder, on fictional example data.
 * Every method of both domain ports is a spy, including Social's execution-class `submitRun`, so each scenario counts
 * reads, planning or content writes and execution calls exactly.
 *
 * Accuracy boundary (accepted Work-domain findings WD-1/WD-2, P3): leaving a dirty card-detail field commits that one
 * pending explicit edit through the detail panel's accepted save-on-leave. Zero-write navigation is proved here for
 * clean paths with no pending edit; the dirty-field case is shown separately and is not "zero writes".
 */

type Spies<K extends string> = Record<K, Mock<(...args: unknown[]) => unknown>>;

/** Replaces every port method with a forwarding spy. */
function spyPort<T extends object, K extends keyof T & string>(inner: T, keys: readonly K[]): { port: T; spies: Spies<K> } {
  const spies = Object.fromEntries(keys.map((key) => [key, vi.fn((...args: unknown[]) =>
    (inner[key] as (...a: unknown[]) => unknown).apply(inner, args))])) as Spies<K>;
  return { port: spies as unknown as T, spies };
}

const SOCIAL_METHODS = Object.keys(CALL_CLASSES) as PortMethod[];
const PLANNER_READS = ['snapshot', 'version', 'history'] as const;
const PLANNER_WRITES = ['create', 'patch', 'move', 'setArchived', 'markReviewed', 'updateSettings'] as const;

let social: Spies<PortMethod>;
let planner: Spies<(typeof PLANNER_PORT_KEYS)[number]>;

const callsOf = <K extends string>(spies: Spies<K>, methods: readonly K[]) =>
  methods.reduce((total, method) => total + spies[method].mock.calls.length, 0);
const socialOf = (callClass: 'content' | 'read' | 'execution', includeSnapshot = true) =>
  callsOf(social, SOCIAL_METHODS.filter((method) => CALL_CLASSES[method] === callClass && (includeSnapshot || method !== 'snapshot')));
/** Social content writes: `saveDraft` and `addBrand` (the snapshot read is content-class but writes nothing). */
const socialWrites = () => socialOf('content', false);
const socialExecution = () => socialOf('execution');
const plannerWrites = () => callsOf(planner, PLANNER_WRITES);
const allCalls = () => callsOf(social, SOCIAL_METHODS) + callsOf(planner, PLANNER_PORT_KEYS);
/** Every Planner method that is neither a read nor a planning write; the port has none, so this stays zero. */
const plannerExecution = () => callsOf(planner, PLANNER_PORT_KEYS.filter((key) =>
  !(PLANNER_READS as readonly string[]).includes(key) && !(PLANNER_WRITES as readonly string[]).includes(key)));

function expectNoExecution() {
  expect(social.submitRun).not.toHaveBeenCalled();
  expect(socialExecution()).toBe(0);
  expect(plannerExecution()).toBe(0);
}

beforeEach(() => {
  // Only Date is faked, so the Work example planning and Social calendar land on the fixtures' fixed day.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(VIEW_NOW));
  window.localStorage.clear();

  resetSocialSessions();
  const socialPort = spyPort<SocialWorkspacePort, PortMethod>(createWorkbenchFixture().port, SOCIAL_METHODS);
  social = socialPort.spies;
  setSocialWorkspacePort(socialPort.port);

  resetWorkSessions();
  resetViewMemory();
  const fixture = createFixturePlanner({ items: viewItems(VIEW_TODAY), settings: { ...EXAMPLE_SETTINGS } });
  const plannerPort = spyPort<PlannerPort, (typeof PLANNER_PORT_KEYS)[number]>(fixture.port, PLANNER_PORT_KEYS);
  planner = plannerPort.spies;
  setWorkSessionPort(plannerPort.port);
});

afterEach(() => {
  cleanup();
  resetSocialSessions();
  setSocialWorkspacePort(null);
  setWorkSessionPort(null);
  resetWorkSessions();
  resetViewMemory();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

const user = () => userEvent.setup();
const rail = () => within(screen.getByRole('navigation', { name: 'Domains' }));
const main = () => screen.getByRole('main');
const socialSide = () => within(screen.getByRole('complementary', { name: 'Social workspace' }));
const workNav = () => within(screen.getByRole('navigation', { name: 'Work' }));
const workFilters = () => within(screen.getByRole('group', { name: 'Filter planning' }));
const workScroller = () => main().querySelector<HTMLElement>('.wd-scroll')!;
const capture = () => screen.getByRole('textbox', { name: 'Capture to Inbox' }) as HTMLInputElement;
const workCard = (id: string) => main().querySelector<HTMLElement>(`[data-card-id="${id}"]`)!;
const workUndo = () => workSession('hq-local').store.getState().undo;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

async function switchDomain(name: 'Design' | 'Social' | 'Work') {
  await user().click(rail().getByRole('button', { name }));
  expect(rail().getByRole('button', { name }).getAttribute('aria-current')).toBe('page');
}

async function openSocial() {
  await switchDomain('Social');
  await screen.findByRole('heading', { level: 1, name: 'Overview' });
}

async function openWork() {
  await switchDomain('Work');
  await screen.findByRole('heading', { level: 2, name: 'Status board' });
}

/** Let any stray asynchronous write or second undo reach a port before counting. */
async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

/** Social: Larkspur brand, Library filtered to LinkedIn and "autumn", one draft selected with unsaved body text. */
async function arrangeSocial() {
  await openSocial();
  await user().selectOptions(socialSide().getByLabelText('Brand'), FIXTURE_IDS.larkspur);
  await user().click(socialSide().getByRole('button', { name: 'Library' }));
  const filters = within(await screen.findByRole('group', { name: 'Filter drafts' }));
  await user().selectOptions(filters.getByLabelText('Channel'), 'LinkedIn');
  await user().type(filters.getByLabelText('Search'), 'autumn');
  await user().click(screen.getByRole('button', { name: /^Autumn blend tasting notes/u }));
  await user().type(await screen.findByLabelText('Body'), ' A fourth cup for November.');
}

async function expectSocialRestored() {
  expect(socialSide().getByRole('button', { name: 'Library' }).getAttribute('aria-current')).toBe('page');
  expect((socialSide().getByLabelText('Brand') as HTMLSelectElement).value).toBe(FIXTURE_IDS.larkspur);
  const filters = within(await screen.findByRole('group', { name: 'Filter drafts' }));
  expect((filters.getByLabelText('Channel') as HTMLSelectElement).value).toBe('LinkedIn');
  expect((filters.getByLabelText('Search') as HTMLInputElement).value).toBe('autumn');
  expect((screen.getByLabelText('Title') as HTMLInputElement).value).toBe('Autumn blend tasting notes');
  expect((screen.getByLabelText('Body') as HTMLTextAreaElement).value)
    .toBe('Three cups, three steeping times. Which one tastes like October? A fourth cup for November.');
  expect(screen.getAllByText('Unsaved changes').length).toBeGreaterThan(0);
}

/** Work: List view filtered to chores matching "the", one card selected, unsaved capture text and a scroll offset. */
async function arrangeWork() {
  await openWork();
  await user().click(workNav().getByRole('button', { name: 'List' }));
  await user().selectOptions(workFilters().getByLabelText('Kind'), 'chore');
  await user().type(workFilters().getByLabelText('Search'), 'the');
  await user().click(await screen.findByRole('button', { name: 'Repaint the garden shed' }));
  expect(await screen.findByRole('textbox', { name: 'Card title' })).toBeTruthy();
  await user().type(capture(), 'Order twine for the bean poles');
  act(() => {
    workScroller().scrollTop = 180;
    workScroller().scrollLeft = 24;
    fireEvent.scroll(workScroller());
  });
}

async function expectWorkRestored() {
  expect(workNav().getByRole('button', { name: 'List' }).getAttribute('aria-current')).toBe('page');
  expect(main().querySelector('.wv')?.getAttribute('data-view')).toBe('list');
  expect((workFilters().getByLabelText('Kind') as HTMLSelectElement).value).toBe('chore');
  expect((workFilters().getByLabelText('Search') as HTMLInputElement).value).toBe('the');
  expect((await screen.findByRole('textbox', { name: 'Card title' }) as HTMLInputElement).value).toBe('Repaint the garden shed');
  expect(capture().value).toBe('Order twine for the bean poles');
  expect(workScroller().scrollTop).toBe(180);
  expect(workScroller().scrollLeft).toBe(24);
}

describe('Social and Work mounted in the T0 shell', () => {
  it('registers the accepted domain descriptors and keeps T0’s Design placeholder', () => {
    expect(MODULES.social).toBe(SocialModule);
    expect(SocialDefault).toBe(SocialModule);
    expect(MODULES.work).toBe(WorkModule);
    expect(WorkDefault).toBe(WorkModule);
    expect(MODULES.design).not.toBe(SocialModule);
    expect(MODULES.design).not.toBe(WorkModule);
  });

  it('opens on the Design placeholder and mounts both domains with labelled fictional data and no execution', async () => {
    render(<App />);
    expect(rail().getByRole('button', { name: 'Design' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('heading', { level: 1, name: 'A place for Design.' })).toBeTruthy();
    expect(screen.getByText('Awaiting module integration')).toBeTruthy();

    await openSocial();
    expect(screen.getByText(/^Fictional example workspace/u)).toBeTruthy();
    expect(screen.getByText(/^No account connection, posting, live collection or scheduling\./u)).toBeTruthy();

    await openWork();
    expect(screen.getByText(/^Fictional example planning, kept in memory for this session only\./u)).toBeTruthy();
    expect(screen.getByText('Example data')).toBeTruthy();
    // The shell's own project context is shown and unchanged by either domain.
    expect(screen.getByText('HQ workspace')).toBeTruthy();

    expect(social.snapshot).toHaveBeenCalledTimes(1);
    expect(planner.snapshot).toHaveBeenCalledTimes(1);
    expect(socialWrites()).toBe(0);
    expect(plannerWrites()).toBe(0);
    expectNoExecution();
  });
});

describe('cross-domain round trips', () => {
  it('Design → Social → Work → Social → Work → Design restores both domains with no port call at all', async () => {
    render(<App />);
    await arrangeSocial();
    await arrangeWork();
    const callsBefore = allCalls();
    expect(socialWrites()).toBe(0);
    expect(plannerWrites()).toBe(0);

    await switchDomain('Design');
    expect(screen.getByRole('heading', { level: 1, name: 'A place for Design.' })).toBeTruthy();
    let previous = main().firstElementChild;
    for (const domain of ['Social', 'Work', 'Social', 'Work'] as const) {
      await switchDomain(domain);
      // T0 keys <main> by domain, so every switch is a real remount restored from the domain's own session.
      expect(main().firstElementChild).not.toBe(previous);
      previous = main().firstElementChild;
      if (domain === 'Social') {
        expect(screen.queryByRole('navigation', { name: 'Work' })).toBeNull();
        await expectSocialRestored();
      } else {
        expect(screen.queryByRole('complementary', { name: 'Social workspace' })).toBeNull();
        await expectWorkRestored();
      }
    }
    await switchDomain('Design');
    expect(screen.getByRole('heading', { level: 1, name: 'A place for Design.' })).toBeTruthy();
    await settle();

    // Remounts reuse each domain's session: no new read, no write, no execution in either port.
    expect(allCalls()).toBe(callsBefore);
    expect(social.snapshot).toHaveBeenCalledTimes(1);
    expect(planner.snapshot).toHaveBeenCalledTimes(1);
    expect(socialWrites()).toBe(0);
    expect(plannerWrites()).toBe(0);
    expectNoExecution();
  });

  it('every Social and Work page switch, and repeated domain switches, make zero writes and zero execution', async () => {
    render(<App />);
    await openSocial();
    for (const item of SOCIAL_NAV) {
      await user().click(socialSide().getByRole('button', { name: new RegExp(`^${escape(item.label)}`, 'u') }));
      await waitFor(() => expect(socialSide().getByRole('button', { name: new RegExp(`^${escape(item.label)}`, 'u') })
        .getAttribute('aria-current')).toBe('page'));
    }
    await openWork();
    for (const item of WORK_NAV) {
      await user().click(workNav().getByRole('button', { name: item.label }));
      expect(workNav().getByRole('button', { name: item.label }).getAttribute('aria-current')).toBe('page');
    }
    for (let round = 0; round < 3; round += 1) {
      for (const domain of ['Design', 'Social', 'Work'] as const) await switchDomain(domain);
    }
    await settle();

    expect(social.snapshot).toHaveBeenCalledTimes(1);
    expect(planner.snapshot).toHaveBeenCalledTimes(1);
    expect(socialWrites()).toBe(0);
    expect(plannerWrites()).toBe(0);
    expectNoExecution();
  });

  it('the execution spy is live: only the explicit Run executes, once, and navigation around it adds none', async () => {
    render(<App />);
    await openSocial();
    await user().click(socialSide().getByRole('button', { name: 'Workbenches' }));
    await user().click(await screen.findByRole('button', { name: 'Open Writing studio' }));
    await screen.findByRole('heading', { level: 1, name: 'Writing studio' });
    await user().click(screen.getByRole('button', { name: 'Load example' }));
    expect(social.submitRun).not.toHaveBeenCalled();

    await user().click(screen.getByRole('button', { name: 'Run Writing studio' }));
    await waitFor(() => expect(social.submitRun).toHaveBeenCalledTimes(1));
    expect(social.submitRun.mock.calls[0]![0]).toBe('x-studio');
    expect(social.submitRun.mock.calls[0]![2]).toBe(true);

    for (const domain of ['Work', 'Design', 'Social', 'Work', 'Social'] as const) await switchDomain(domain);
    await user().click(socialSide().getByRole('button', { name: /^Run history/u }));
    await settle();
    expect(social.submitRun).toHaveBeenCalledTimes(1);
    expect(socialWrites()).toBe(0);
    expect(plannerWrites()).toBe(0);
    expect(plannerExecution()).toBe(0);
  });

  it('discloses WD-1/WD-2: leaving a dirty card-detail field commits only that one pending explicit edit', async () => {
    render(<App />);
    await openSocial();
    await openWork();
    await user().click(workCard('ex-shed-paint'));
    await user().type(await screen.findByRole('textbox', { name: 'Card title' }), ' today');
    expect(plannerWrites()).toBe(0);

    // The rail takes focus from the field; the accepted save-on-leave sends the user's own edit, once.
    await switchDomain('Social');
    await switchDomain('Work');
    expect((await screen.findByRole('textbox', { name: 'Card title' }) as HTMLInputElement).value).toBe('Repaint the garden shed today');
    await settle();
    expect(plannerWrites()).toBe(1);
    expect(planner.patch.mock.calls.map((call) => [call[0], call[2]])).toStrictEqual([['ex-shed-paint', { title: 'Repaint the garden shed today' }]]);
    expect(socialWrites()).toBe(0);
    expectNoExecution();
  });
});

describe('explicit planning moves', () => {
  it('a keyboard card move sends one move, its toast Undo sends one more, and nothing executes', async () => {
    render(<App />);
    await openWork();
    workCard('ex-shed-paint').focus();
    await act(async () => { fireEvent.keyDown(workCard('ex-shed-paint'), { key: 'ArrowLeft', altKey: true }); });
    await waitFor(() => expect(planner.move).toHaveBeenCalledTimes(1));
    expect(planner.move.mock.calls[0]![0]).toBe('ex-shed-paint');
    await settle();
    expect(plannerWrites()).toBe(1);

    await user().click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(planner.move).toHaveBeenCalledTimes(2));
    await settle();
    expect(plannerWrites()).toBe(2);
    expect(socialWrites()).toBe(0);
    expectNoExecution();
  });

  it('a Calendar date move patches only that date, and its Undo restores it', async () => {
    render(<App />);
    await openWork();
    await user().click(workNav().getByRole('button', { name: 'Calendar' }));
    const chip = () => screen.getByRole('button', { name: /^Repaint the garden shed, /u });
    await act(async () => { fireEvent.keyDown(chip(), { key: 'ArrowRight', altKey: true }); });
    await waitFor(() => expect(planner.patch).toHaveBeenCalledTimes(1));
    const [id, , patch] = planner.patch.mock.calls[0]! as [string, number, { dates: { value: string }[] }];
    expect(id).toBe('ex-shed-paint');
    expect(Object.keys(patch)).toStrictEqual(['dates']);
    expect(patch.dates.map((date) => date.value)).toStrictEqual(['2026-10-25']);
    await settle();
    expect(plannerWrites()).toBe(1);

    await user().click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(planner.patch).toHaveBeenCalledTimes(2));
    expect((planner.patch.mock.calls[1]![2] as { dates: { value: string }[] }).dates.map((date) => date.value)).toStrictEqual(['2026-10-24']);
    await settle();
    expect(plannerWrites()).toBe(2);
    expect(socialWrites()).toBe(0);
    expectNoExecution();
  });

  it('a Timeline horizon move patches only the horizon, and its Undo restores it', async () => {
    render(<App />);
    await openWork();
    await user().click(workNav().getByRole('button', { name: 'Timeline' }));
    const row = () => screen.getByLabelText(/^Repaint the garden shed, horizon /u);
    await act(async () => { fireEvent.keyDown(row(), { key: 'ArrowDown', altKey: true }); });
    await waitFor(() => expect(planner.patch).toHaveBeenCalledTimes(1));
    expect(planner.patch.mock.calls[0]!.slice(0, 3)).toStrictEqual(['ex-shed-paint', 1, { horizon: 'soon' }]);
    await settle();
    expect(plannerWrites()).toBe(1);

    await user().click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(planner.patch).toHaveBeenCalledTimes(2));
    expect(planner.patch.mock.calls[1]!.slice(0, 3)).toStrictEqual(['ex-shed-paint', 2, { horizon: 'now' }]);
    await settle();
    expect(plannerWrites()).toBe(2);
    expect(socialWrites()).toBe(0);
    expectNoExecution();
  });
});

describe('one keypress, one undo', () => {
  it('Ctrl+Z and ⌘+Z each consume exactly one Work entry, and Ctrl+Z in Social touches neither domain', async () => {
    render(<App />);
    await openSocial();
    await openWork();
    await user().click(workNav().getByRole('button', { name: 'List' }));
    await screen.findByRole('button', { name: 'Learn three bread recipes' });
    await act(async () => {
      await workSession('hq-local').store.move('ex-bread', 'active', { place: 'top' });
      await workSession('hq-local').store.move('ex-bike', 'next', { place: 'top' });
    });
    expect(workUndo()).toHaveLength(2);
    const writes = plannerWrites();

    // In Social, Ctrl+Z belongs to nothing in Work: the Work module is unmounted and its undo stack is untouched.
    await switchDomain('Social');
    await screen.findByRole('heading', { level: 1, name: 'Overview' });
    socialSide().getByRole('button', { name: 'Overview' }).focus();
    await user().keyboard('{Control>}z{/Control}');
    await settle();
    expect(workUndo()).toHaveLength(2);
    expect(plannerWrites()).toBe(writes);
    expect(socialWrites()).toBe(0);

    // Back in Work, one Ctrl+Z inside the nested planning views consumes exactly one entry.
    await switchDomain('Work');
    const link = await screen.findByRole('button', { name: 'Learn three bread recipes' });
    link.focus();
    await user().keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(workUndo()).toHaveLength(1));
    await settle();
    expect(workUndo()).toHaveLength(1);
    expect(planner.move.mock.calls.slice(2).map((call) => call[0])).toStrictEqual(['ex-bike']);

    // One ⌘+Z on the Work navigation consumes the other, through the Work-level handler.
    workNav().getByRole('button', { name: 'List' }).focus();
    await user().keyboard('{Meta>}z{/Meta}');
    await waitFor(() => expect(workUndo()).toHaveLength(0));
    await settle();
    expect(plannerWrites()).toBe(writes + 2);
    expect(socialWrites()).toBe(0);
    expectNoExecution();
  });
});

describe('appearance', () => {
  it('an explicit theme survives a reload of the shell', async () => {
    const first = render(<App />);
    await user().selectOptions(screen.getByLabelText('Appearance'), 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(APPEARANCE_KEY)).toBe('dark');
    first.unmount();
    delete document.documentElement.dataset.theme;

    render(<App />);
    expect((screen.getByLabelText('Appearance') as HTMLSelectElement).value).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    await openWork();
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user().selectOptions(screen.getByLabelText('Appearance'), 'light');
    cleanup();
    render(<App />);
    expect((screen.getByLabelText('Appearance') as HTMLSelectElement).value).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
    expectNoExecution();
  });

  it('System follows the OS colour scheme as it changes', async () => {
    let dark = false;
    const listeners = new Set<() => void>();
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      get matches() { return query === '(prefers-color-scheme: dark)' && dark; },
      media: query, onchange: null,
      addEventListener: (_type: string, listener: () => void) => { listeners.add(listener); },
      removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener); },
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => true,
    }) as unknown as MediaQueryList);

    render(<App />);
    expect((screen.getByLabelText('Appearance') as HTMLSelectElement).value).toBe('system');
    await openSocial();
    expect(document.documentElement.dataset.theme).toBe('light');
    act(() => { dark = true; for (const listener of listeners) listener(); });
    expect(document.documentElement.dataset.theme).toBe('dark');
    await openWork();
    expect(document.documentElement.dataset.theme).toBe('dark');
    act(() => { dark = false; for (const listener of listeners) listener(); });
    expect(document.documentElement.dataset.theme).toBe('light');
    // An explicit choice wins over the OS until System is chosen again.
    await user().selectOptions(screen.getByLabelText('Appearance'), 'dark');
    act(() => { for (const listener of listeners) listener(); });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expectNoExecution();
  });

  it('a theme change leaves captured text and planning data intact, with no write', async () => {
    render(<App />);
    await arrangeSocial();
    await arrangeWork();
    const items = structuredClone(workSession('hq-local').store.getState().items);
    const callsBefore = allCalls();

    await user().selectOptions(screen.getByLabelText('Appearance'), 'dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    await expectWorkRestored();
    await switchDomain('Social');
    await user().selectOptions(screen.getByLabelText('Appearance'), 'light');
    expect(document.documentElement.dataset.theme).toBe('light');
    await expectSocialRestored();
    await switchDomain('Work');
    await expectWorkRestored();
    await settle();

    expect(workSession('hq-local').store.getState().items).toStrictEqual(items);
    expect(allCalls()).toBe(callsBefore);
    expect(socialWrites()).toBe(0);
    expect(plannerWrites()).toBe(0);
    expectNoExecution();
  });
});
