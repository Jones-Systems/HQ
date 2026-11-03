import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastViewport, toastStore } from '@hq/ui';
import type { ServiceConfigStatus } from '@hq/contracts/services';
import { DataSourcesProvider, useDataSources } from '../settings/DataSources';
import type { StoragePort } from '../state';
import { GettingStarted, type GettingStartedProps } from './GettingStarted';
import { ONBOARDING_KEY, serializeOnboarding, type OnboardingState } from './onboarding-state';

const SAMPLE: ServiceConfigStatus = { configured: false, policy: 'ok', transport: null };
const HTTPS: ServiceConfigStatus = { configured: true, policy: 'ok', transport: 'https' };
const world = { social: SAMPLE, work: SAMPLE, wiki: [] as string[], socialReachable: true, workReachable: true };
const config = { status: vi.fn(async (domain: 'social' | 'work') => world[domain]), set: vi.fn() };

const memory = (initial?: Partial<OnboardingState>): StoragePort & { values: Record<string, string>; state: () => OnboardingState } => {
  const values: Record<string, string> = initial ? { [ONBOARDING_KEY]: serializeOnboarding({ state: 'open', visited: {}, used: {}, celebrated: false, ...initial }) } : {};
  return { values, getItem: key => values[key] ?? null, setItem: (key, value) => { values[key] = value; }, state: () => JSON.parse(values[ONBOARDING_KEY]!) };
};
const refusing: StoragePort = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };

function Recheck() {
  const { check } = useDataSources();
  return <button onClick={() => void check('work')}>Recheck Work</button>;
}

interface Mounted { onNavigate: ReturnType<typeof vi.fn>; storage: ReturnType<typeof memory>; update: (next: Partial<GettingStartedProps>) => void; unmount: () => void }
function mount(options: Partial<GettingStartedProps> & { storage?: StoragePort; extra?: ReactElement } = {}): Mounted {
  const onNavigate = vi.fn();
  const storage = (options.storage ?? memory()) as ReturnType<typeof memory>;
  const view = (props: Partial<GettingStartedProps>) => <>
    <ToastViewport hotkey={null} />
    <DataSourcesProvider config={config}>
      <GettingStarted storage={storage} domain="design" settingsOpen={false} onNavigate={onNavigate} {...options} {...props} />
      {options.extra}
    </DataSourcesProvider>
  </>;
  const result = render(view({}));
  return { onNavigate, storage, update: next => result.rerender(view(next)), unmount: result.unmount };
}

const card = () => screen.queryByRole('region', { name: 'Welcome to HQ' });
const findCard = () => screen.findByRole('region', { name: 'Welcome to HQ' });
const pill = () => screen.queryByRole('button', { name: /^Getting started · \d\/5$/ });
const item = (name: string) => screen.getByRole('button', { name }).closest('li') as HTMLLIElement;
const live = () => document.querySelector('.gs-anchor > [role="status"]')!.textContent;
const settled = () => screen.findByText('Not set up');
const event = (name: string, detail?: unknown) => act(() => { window.dispatchEvent(new CustomEvent(name, { detail })); });

beforeEach(() => {
  Object.assign(world, { social: SAMPLE, work: SAMPLE, wiki: [], socialReachable: true, workReachable: true });
  document.documentElement.setAttribute('data-hq-motion', 'reduce');
  Object.defineProperty(window, 'hqServices', { configurable: true, value: {
    config,
    wikiAdmin: { call: vi.fn(async () => ({ ok: true, value: { sources: world.wiki.map(state => ({ state })) } })) },
    social: { call: vi.fn(async () => ({ ok: world.socialReachable, status: 200 })) },
    work: { call: vi.fn(async () => ({ ok: world.workReachable, status: 200 })) },
  } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers(); vi.restoreAllMocks();
  toastStore.dismiss();
  document.documentElement.removeAttribute('data-hq-motion');
  delete (window as { hqServices?: unknown }).hqServices;
});

describe('first run', () => {
  it('opens a calm, non-modal welcome card with the four domains and the checklist', async () => {
    const view = mount();
    const panel = await findCard();
    await settled();
    expect(within(panel).getByRole('heading', { level: 2, name: 'Welcome to HQ' })).toBeTruthy();
    expect(panel.textContent).toContain("Design, Social, Work and Wiki in one place. Here's how to get set up.");
    expect(within(panel).getAllByRole('heading').map(heading => heading.textContent)).toEqual(['Welcome to HQ', "What's in HQ", 'Get set up']);

    const [domains, checklist] = within(panel).getAllByRole('list');
    expect(within(domains!).getAllByRole('listitem').map(row => row.querySelector('strong')!.textContent)).toEqual(['Design', 'Social', 'Work', 'Wiki']);
    expect(within(domains!).getAllByText('Sample data · set up to use your own')).toHaveLength(2);
    expect(within(domains!).getByText('Local, on this device')).toBeTruthy();
    expect(within(domains!).getByText('Not set up')).toBeTruthy();
    expect(within(domains!).getByText('Projects, references and live design work')).toBeTruthy();

    expect(within(checklist!).getAllByRole('button').map(button => button.textContent)).toEqual([
      'Take a look around with sample data', 'Connect Work (Planner)', 'Connect Social', 'Add a Wiki repository', expect.stringMatching(/^Jump anywhere with (⌘K|Ctrl K)$/),
    ]);
    expect(within(panel).getByText('0 of 5')).toBeTruthy();
    const bar = within(panel).getByRole('progressbar');
    expect([bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax'), bar.getAttribute('aria-valuetext')]).toEqual(['0', '5', '0 of 5 done']);

    // Non-modal: it takes no focus, traps none and claims no dialog semantics.
    expect(document.querySelector('[aria-modal]')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(document.body);
    // A first launch is remembered, with Design counted as visited.
    expect(view.storage.state()).toMatchObject({ state: 'open', visited: { design: true } });
  });

  it('orders its controls for the keyboard: collapse, the checklist, then Hide', async () => {
    mount();
    const panel = await findCard();
    expect(within(panel).getAllByRole('button').map(button => button.getAttribute('aria-label') ?? button.textContent)).toEqual([
      'Collapse getting started', 'Take a look around with sample data', 'Connect Work (Planner)', 'Connect Social', 'Add a Wiki repository',
      expect.stringMatching(/^Jump anywhere/), 'Hide',
    ]);
    expect(panel.tagName).toBe('SECTION');
    expect(within(panel).getAllByRole('list').map(list => list.tagName)).toEqual(['UL', 'OL']);
  });

  it('treats unreadable or malformed storage as a first launch', async () => {
    mount({ storage: refusing });
    await findCard();
    cleanup();
    const malformed = memory();
    malformed.values[ONBOARDING_KEY] = '{"state":';
    mount({ storage: malformed });
    expect(await findCard()).toBeTruthy();
  });
});

describe('hide, collapse and reopen', () => {
  it('hides for good, confirms with an Undo toast and stays hidden after a restart', async () => {
    const view = mount();
    await findCard();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(card()).toBeNull());
    expect(pill()).toBeNull();
    expect(view.storage.state().state).toBe('hidden');
    // The toast, and the live region that announces it.
    expect((await screen.findAllByText(/^Getting started hidden — reopen it from (⌘K|Ctrl K) › Show getting started$/)).length).toBeGreaterThan(0);
    expect(within(document.querySelector<HTMLElement>('.hq-toast')!).getByRole('button', { name: 'Undo' })).toBeTruthy();

    view.unmount(); toastStore.dismiss();
    mount({ storage: view.storage });
    await act(async () => {});
    expect(card()).toBeNull();
    expect(pill()).toBeNull();
  });

  it('brings it back with Undo', async () => {
    const view = mount();
    await findCard();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(card()).toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }));
    expect(await findCard()).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Welcome to HQ' }));
    expect(view.storage.state().state).toBe('open');
  });

  it('reopens on hq-show-welcome from hidden and from the pill', async () => {
    const view = mount({ storage: memory({ state: 'hidden' }) });
    await act(async () => {});
    expect(card()).toBeNull();
    event('hq-show-welcome');
    expect(await findCard()).toBeTruthy();
    expect(view.storage.state().state).toBe('open');
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Welcome to HQ' }));

    fireEvent.click(screen.getByRole('button', { name: 'Collapse getting started' }));
    await waitFor(() => expect(card()).toBeNull());
    event('hq-show-welcome');
    expect(await findCard()).toBeTruthy();
  });

  it('collapses to a pill that shows progress and expands again on click', async () => {
    const view = mount({ storage: memory({ state: 'collapsed', visited: { social: true, work: true } }) });
    await act(async () => {});
    expect(card()).toBeNull();
    const button = screen.getByRole('button', { name: 'Getting started · 1/5' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    const panel = await findCard();
    expect(within(panel).getByText('1 of 5')).toBeTruthy();
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: 'Welcome to HQ' }));
    expect(view.storage.state().state).toBe('open');

    fireEvent.click(within(panel).getByRole('button', { name: 'Collapse getting started' }));
    await waitFor(() => expect(card()).toBeNull());
    expect(view.storage.state().state).toBe('collapsed');
  });

  it('collapses on Escape from inside the panel and moves focus to the pill', async () => {
    const view = mount();
    await findCard();
    // Escape elsewhere does nothing.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(card()).toBeTruthy();

    const connect = screen.getByRole('button', { name: 'Connect Social' });
    connect.focus();
    fireEvent.keyDown(connect, { key: 'Escape' });
    await waitFor(() => expect(card()).toBeNull());
    expect(view.storage.state().state).toBe('collapsed');
    await waitFor(() => expect(document.activeElement).toBe(pill()));
  });

  it('keeps its state while Settings is open and shows it again afterwards', async () => {
    const view = mount({ storage: memory({ state: 'collapsed' }) });
    await act(async () => {});
    expect(pill()).toBeTruthy();
    view.update({ settingsOpen: true });
    expect(document.querySelector<HTMLElement>('.gs-anchor')!.hidden).toBe(true);
    expect(pill()).toBeNull();
    view.update({ settingsOpen: false });
    expect(pill()).toBeTruthy();
    expect(view.storage.state().state).toBe('collapsed');
  });

  it('keeps working for the session when storage refuses to save', async () => {
    mount({ storage: refusing });
    await findCard();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse getting started' }));
    await waitFor(() => expect(card()).toBeNull());
    fireEvent.click(await screen.findByRole('button', { name: /^Getting started/ }));
    expect(await findCard()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await waitFor(() => expect(card()).toBeNull());
    expect(pill()).toBeNull();
  });

  it('rests as the pill in a narrow workspace without forgetting that it is open, and opens on request', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 400, x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 400, toJSON: () => ({}) });
    const view = mount({ storage: memory({ state: 'open' }) });
    await act(async () => {});
    expect(card()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Getting started · 0\/5$/ }));
    const panel = await findCard();
    expect(view.storage.state().state).toBe('open');
    fireEvent.keyDown(within(panel).getByRole('button', { name: 'Connect Social' }), { key: 'Escape' });
    await waitFor(() => expect(card()).toBeNull());
    expect(view.storage.state().state).toBe('collapsed');
  });
});

describe('checklist', () => {
  it.each([
    ['Connect Work (Planner)', 'work'], ['Connect Social', 'social'], ['Add a Wiki repository', 'wiki'],
  ])('"%s" opens Settings › Data sources for %s', async (label, source) => {
    mount();
    await findCard();
    const opened = vi.fn();
    window.addEventListener('hq-open-settings', opened);
    fireEvent.click(screen.getByRole('button', { name: label }));
    window.removeEventListener('hq-open-settings', opened);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(((opened.mock.calls[0]![0]) as CustomEvent).detail).toEqual({ source });
  });

  it('walks through Social, then Work, and ticks the step once both were visited', async () => {
    const view = mount({ domain: 'design' });
    await findCard();
    fireEvent.click(screen.getByRole('button', { name: 'Take a look around with sample data' }));
    expect(view.onNavigate).toHaveBeenLastCalledWith('social', 'overview');
    view.update({ domain: 'social' });
    expect(item('Take a look around with sample data').dataset.done).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Take a look around with sample data' }));
    expect(view.onNavigate).toHaveBeenLastCalledWith('work', 'board');
    view.update({ domain: 'work' });
    expect(item('Take a look around with sample data').dataset.done).toBe('true');
    expect(screen.getByText('1 of 5')).toBeTruthy();
    expect(view.storage.state().visited).toEqual({ design: true, social: true, work: true });
    expect(live()).toBe('Take a look around with sample data: done. 1 of 5 complete.');
    expect(item('Take a look around with sample data').className).toContain('hq-flash');
  });

  it('does not count a domain opened while Settings covers it', async () => {
    const view = mount({ domain: 'design' });
    await findCard();
    view.update({ domain: 'social', settingsOpen: true });
    expect(view.storage.state().visited).toEqual({ design: true });
    view.update({ domain: 'social', settingsOpen: false });
    expect(view.storage.state().visited).toEqual({ design: true, social: true });
  });

  it('marks a configured data source done without announcing what was already true at launch', async () => {
    world.work = HTTPS;
    mount();
    const panel = await findCard();
    await waitFor(() => expect(item('Connect Work (Planner)').dataset.done).toBe('true'));
    expect(within(panel).getByText('Set up · not checked')).toBeTruthy();
    expect(item('Connect Social').dataset.done).toBeUndefined();
    expect(within(panel).getByText('1 of 5')).toBeTruthy();
    expect(live()).toBe('');
  });

  it('announces and flashes a step the moment its source gets set up', async () => {
    mount();
    await findCard(); await settled();
    expect(item('Connect Work (Planner)').dataset.done).toBeUndefined();
    world.work = HTTPS; world.wiki = ['ready'];
    event('hq-connections-changed');
    await waitFor(() => expect(item('Connect Work (Planner)').dataset.done).toBe('true'));
    expect(item('Add a Wiki repository').dataset.done).toBe('true');
    await waitFor(() => expect(live()).toBe('Connect Work (Planner), Add a Wiki repository: done. 2 of 5 complete.'));
    expect(item('Connect Work (Planner)').className).toContain('hq-flash');
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
  });

  it('keeps a step ticked while its source is being rechecked', async () => {
    world.work = HTTPS;
    mount({ extra: <Recheck /> });
    await findCard();
    await waitFor(() => expect(item('Connect Work (Planner)').dataset.done).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Recheck Work' }));
    expect(item('Connect Work (Planner)').dataset.done).toBe('true');
    await waitFor(() => expect(screen.getAllByText('Connected').length).toBeGreaterThan(0));
    expect(item('Connect Work (Planner)').dataset.done).toBe('true');
    expect(live()).toBe('');
  });

  it('says so, inline, when a set-up source does not answer, and leaves the step open', async () => {
    world.work = HTTPS; world.workReachable = false;
    mount({ extra: <Recheck /> });
    await findCard();
    await waitFor(() => expect(item('Connect Work (Planner)').dataset.done).toBe('true'));
    fireEvent.click(screen.getByRole('button', { name: 'Recheck Work' }));
    const notice = await screen.findByText('Work is unreachable');
    expect(notice.closest('.hq-notice')).toBeTruthy();
    expect(item('Connect Work (Planner)').dataset.done).toBeUndefined();
    expect(within(item('Connect Work (Planner)')).getByText(/Unreachable · check the address in Data sources/)).toBeTruthy();

    const opened = vi.fn();
    window.addEventListener('hq-open-settings', opened);
    fireEvent.click(screen.getByRole('button', { name: 'Open Data sources' }));
    window.removeEventListener('hq-open-settings', opened);
    expect(((opened.mock.calls[0]![0]) as CustomEvent).detail).toEqual({ source: 'work' });
  });

  it('dispatches the palette event from its step and counts any use of the palette', async () => {
    const view = mount();
    await findCard();
    const opened = vi.fn();
    window.addEventListener('hq-open-command-palette', opened);
    fireEvent.click(screen.getByRole('button', { name: /^Jump anywhere/ }));
    window.removeEventListener('hq-open-command-palette', opened);
    expect(opened).toHaveBeenCalledTimes(1);
    expect(item('Jump anywhere with ' + (/⌘K/.test(screen.getByRole('button', { name: /^Jump anywhere/ }).textContent!) ? '⌘K' : 'Ctrl K')).dataset.done).toBe('true');
    expect(view.storage.state().used).toEqual({ palette: true });

    cleanup();
    const other = mount();
    await findCard();
    expect(screen.getByRole('button', { name: /^Jump anywhere/ }).closest('li')!.dataset.done).toBeUndefined();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.getByRole('button', { name: /^Jump anywhere/ }).closest('li')!.dataset.done).toBe('true');
    expect(other.storage.state().used).toEqual({ palette: true });
  });
});

describe('finishing', () => {
  const nearlyDone = () => {
    world.social = HTTPS; world.work = HTTPS; world.wiki = ['ready'];
    return memory({ visited: { social: true, work: true } });
  };

  it('shows "You\'re all set", then folds into the pill and does not play again', async () => {
    const storage = nearlyDone();
    mount({ storage });
    const panel = await findCard();
    await waitFor(() => expect(within(panel).getByText('4 of 5')).toBeTruthy());
    expect(within(panel).queryByText("You're all set")).toBeNull();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    event('hq-open-command-palette');
    expect(within(panel).getByText("You're all set")).toBeTruthy();
    expect(live()).toBe("You're all set. 5 of 5 complete.");
    expect(within(panel).queryByRole('button', { name: 'Connect Social' })).toBeNull();
    expect(storage.state().celebrated).toBe(false);

    act(() => { vi.advanceTimersByTime(3300); });
    expect(card()).toBeNull();
    expect(screen.getByRole('button', { name: 'Getting started · 5/5' })).toBeTruthy();
    expect(storage.state()).toMatchObject({ state: 'collapsed', celebrated: true });
    vi.useRealTimers();

    // A later launch of a finished profile just shows the pill, with no new celebration.
    cleanup();
    mount({ storage });
    await act(async () => {});
    expect(screen.getByRole('button', { name: 'Getting started · 5/5' })).toBeTruthy();
    event('hq-show-welcome');
    const reopened = await findCard();
    expect(within(reopened).queryByText("You're all set")).toBeNull();
    expect(within(reopened).getByText('5 of 5')).toBeTruthy();
  });

  it('does not celebrate a profile that was already complete when it launched', async () => {
    world.social = HTTPS; world.work = HTTPS; world.wiki = ['ready'];
    mount({ storage: memory({ visited: { social: true, work: true }, used: { palette: true } }) });
    const panel = await findCard();
    await waitFor(() => expect(within(panel).getByText('5 of 5')).toBeTruthy());
    expect(within(panel).queryByText("You're all set")).toBeNull();
  });

  it('only flashes the pill when the last step lands while the panel is collapsed', async () => {
    const storage = nearlyDone(); storage.values[ONBOARDING_KEY] = serializeOnboarding({ state: 'collapsed', visited: { social: true, work: true }, used: {}, celebrated: false });
    mount({ storage });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Getting started · 4/5' })).toBeTruthy());
    event('hq-open-command-palette');
    const finished = screen.getByRole('button', { name: 'Getting started · 5/5' });
    expect(finished.className).toContain('hq-flash');
    expect(card()).toBeNull();
    expect(storage.state().celebrated).toBe(true);
  });
});
