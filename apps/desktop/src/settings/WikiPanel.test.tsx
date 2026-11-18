import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ToastStoreProvider, createToastStore, type ToastStore } from '@hq/ui';
import type { WikiAdminTransport } from '@hq/contracts/wiki-admin';
import { POLL_LIMIT_MS, WikiPanel } from './WikiPanel';

type State = 'ready' | 'stale' | 'indexing' | 'index-unavailable' | 'source-unavailable' | 'not-configured';
const status = (bl: State, appdev: State = 'not-configured') => ({ revision: 'a'.repeat(64), sources: [{ namespace: 'bl', state: bl }, { namespace: 'appdev', state: appdev }] });
const ok = (value: unknown) => ({ ok: true, value });
const NO_BRIDGE = "Native Wiki management isn't available in this window.";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

function mount(call: ReturnType<typeof vi.fn> | undefined) {
  const store: ToastStore = createToastStore();
  const admin = call ? { call } as unknown as WikiAdminTransport : undefined;
  const view = render(<ToastStoreProvider store={store}><WikiPanel headingId="wiki-heading" {...(admin ? { admin } : {})} selected={false} /></ToastStoreProvider>);
  return { store, view };
}
const settle = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const statusCalls = (call: ReturnType<typeof vi.fn>) => call.mock.calls.filter(([route]) => route === 'status').length;

it('reads the status every two seconds while a repository is indexing and stops once none is', async () => {
  const responses = [status('indexing'), status('indexing'), status('ready')];
  const call = vi.fn(async (route: string) => route === 'status' ? ok(responses.shift() ?? status('ready')) : ok(status('ready')));
  const { store } = mount(call);
  await settle();
  expect(statusCalls(call)).toBe(1);
  expect(screen.getAllByText('Indexing').length).toBeGreaterThan(0);
  await settle(1999); expect(statusCalls(call)).toBe(1);
  await settle(1); expect(statusCalls(call)).toBe(2);
  await settle(2000); expect(statusCalls(call)).toBe(3);
  expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
  expect(store.getSnapshot()).toEqual([expect.objectContaining({ tone: 'success', title: 'BusinessLessons reindexed' })]);
  expect(document.getElementById('wiki-bl')?.classList.contains('hq-flash')).toBe(true);
  await settle(20_000);
  expect(statusCalls(call)).toBe(3);
});

it('does not poll when nothing is indexing', async () => {
  const call = vi.fn(async () => ok(status('ready', 'stale')));
  mount(call);
  await settle();
  await settle(30_000);
  expect(call).toHaveBeenCalledOnce();
});

it('stops polling after two minutes and says the index is not updating, with a Check action', async () => {
  const call = vi.fn(async () => ok(status('indexing')));
  mount(call);
  await settle();
  await settle(POLL_LIMIT_MS - 1);
  expect(screen.queryByText('Still indexing')).toBeNull();
  await settle(1);
  const stalled = statusCalls(call);
  expect(stalled).toBeGreaterThan(30);
  const indicator = screen.getByText('Still indexing').closest('[role]') ?? screen.getByText('Still indexing').parentElement!;
  expect(indicator.textContent).toContain('not updating');
  expect(screen.getByRole('button', { name: 'Check' })).toBeTruthy();
  await settle(30_000);
  expect(statusCalls(call)).toBe(stalled);
});

it('stops polling when the page closes', async () => {
  const call = vi.fn(async () => ok(status('indexing')));
  const { view } = mount(call);
  await settle();
  await settle(2000);
  const before = statusCalls(call);
  view.unmount();
  await settle(20_000);
  expect(statusCalls(call)).toBe(before);
});

it('announces an indexing run that ends in failure and keeps the problem on the row', async () => {
  const responses = [status('indexing'), status('index-unavailable')];
  const call = vi.fn(async () => ok(responses.shift() ?? status('index-unavailable')));
  const { store } = mount(call);
  await settle(); await settle(2000);
  expect(store.getSnapshot()).toEqual([expect.objectContaining({ tone: 'danger', title: "Couldn't finish indexing BusinessLessons" })]);
  const row = document.getElementById('wiki-bl')!;
  expect(within(row).getByText("Couldn't finish indexing BusinessLessons")).toBeTruthy();
});

it('starts one reindex per activation, marks the row busy and explains why the other actions wait', async () => {
  let finish!: (value: unknown) => void;
  const call = vi.fn((route: string) => route === 'reindex' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(ok(status('ready', 'ready'))));
  const { store } = mount(call);
  await settle();
  const reindex = screen.getByRole('button', { name: 'Reindex BusinessLessons' });
  fireEvent.click(reindex); fireEvent.click(reindex);
  await settle();
  expect(call.mock.calls.filter(([route]) => route === 'reindex')).toHaveLength(1);
  expect(reindex.getAttribute('aria-busy')).toBe('true');
  expect(within(document.getElementById('wiki-bl')!).getAllByText('Reindexing').some(element => !element.closest('button'))).toBe(true);
  const other = screen.getByRole('button', { name: 'Reindex App Development' });
  expect(other.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(other.getAttribute('aria-describedby')!)?.textContent).toBe('Another action is in progress.');
  await act(async () => { finish(ok(status('ready', 'ready'))); await vi.advanceTimersByTimeAsync(0); });
  expect(store.getSnapshot()).toEqual([expect.objectContaining({ tone: 'success', title: 'BusinessLessons reindexed' })]);
  expect(reindex.getAttribute('aria-busy')).toBeNull();
});

it('keeps a refused reindex visible: a persistent toast and an inline notice that say nothing changed', async () => {
  const call = vi.fn(async (route: string) => route === 'reindex' ? { ok: false, kind: 'source-unavailable' } : ok(status('ready')));
  const { store } = mount(call);
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Reindex BusinessLessons' }));
  await settle();
  expect(store.getSnapshot()).toEqual([expect.objectContaining({ tone: 'danger', title: "Couldn't reindex BusinessLessons", description: expect.stringContaining('Nothing was changed') })]);
  const row = document.getElementById('wiki-bl')!;
  expect(within(row).getByText("Couldn't reindex BusinessLessons")).toBeTruthy();
  await settle(60_000);
  expect(store.getSnapshot()).toHaveLength(1);
});

it('shows skeleton rows while the first status loads', async () => {
  const call = vi.fn(() => new Promise(() => {}));
  mount(call);
  const panel = document.getElementById('settings-wiki')!;
  expect(panel.getAttribute('aria-busy')).toBe('true');
  expect(within(panel).queryAllByRole('button')).toHaveLength(0);
  await settle(5000);
});

it('shows a full-panel error only for a failed first load, and Try again recovers', async () => {
  let answer: unknown = { ok: false, kind: 'unavailable' };
  const call = vi.fn(async () => answer);
  mount(call);
  await settle();
  expect(screen.getByText('Local Wiki settings are unavailable')).toBeTruthy();
  answer = ok(status('ready'));
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await settle();
  expect(screen.queryByText('Local Wiki settings are unavailable')).toBeNull();
  expect(screen.getByRole('button', { name: 'Reindex BusinessLessons' })).toBeTruthy();
});

it('keeps the rows and states why each action is unavailable when native management is missing', async () => {
  mount(undefined);
  await settle();
  expect(screen.getAllByText(NO_BRIDGE).length).toBeGreaterThan(0);
  for (const name of ['Reindex BusinessLessons', 'Change repository for BusinessLessons', 'Remove BusinessLessons…', 'Recheck Local Wiki sources', 'Import source profile…']) {
    const button = screen.getByRole('button', { name });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(NO_BRIDGE);
  }
});

it('guides a first-time setup with an import step and no repository actions', async () => {
  const call = vi.fn(async () => ok(status('not-configured')));
  mount(call);
  await settle();
  const guide = screen.getByRole('group', { name: 'Set up Local Wiki' });
  expect(within(guide).getByText('Set up your first repository')).toBeTruthy();
  expect(within(guide).getAllByRole('listitem')).toHaveLength(3);
  expect(within(guide).getByRole('button', { name: 'Import source profile…' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Reindex/ })).toBeNull();
  expect(screen.getAllByRole('button', { name: /^Set up/ }).length).toBeGreaterThanOrEqual(2);
});
