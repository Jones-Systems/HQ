import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ToastStoreProvider, createToastStore, type ToastStore } from '@hq/ui';
import { ServiceSettings } from './ServiceSettings';
import { DataSourcesProvider } from './settings/DataSources';
import type { ServiceConfigTransport } from '@hq/contracts/services';
import type { UpdateStatus, UpdatesPort } from '@hq/contracts/updates';
afterEach(() => { cleanup(); Reflect.deleteProperty(window, 'hqServices'); });

type Props = Partial<Parameters<typeof ServiceSettings>[0]>;
function renderSettings(props: Props = {}, config?: ServiceConfigTransport) {
  const store: ToastStore = createToastStore();
  const onClose = vi.fn();
  const view = render(<ToastStoreProvider store={store}><DataSourcesProvider {...(config ? { config } : {})}>
    <ServiceSettings {...(config ? { config } : {})} onClose={onClose} {...props} />
  </DataSourcesProvider></ToastStoreProvider>);
  return { store, onClose, view };
}
const configured = () => ({ configured: true, policy: 'ok' as const, transport: 'https' as const });
const toastTitles = (store: ToastStore) => store.getSnapshot().map(record => record.title);
const nav = () => within(screen.getByRole('navigation', { name: 'Settings categories' }));
const setBridge = (value: unknown) => Object.defineProperty(window, 'hqServices', { configurable: true, value });

it('shows sanitized status; saves explicit input and clears it without URL readback', async () => {
  let isConfigured = false;
  const config: ServiceConfigTransport = { status: vi.fn(async domain => ({ configured: domain === 'social' && isConfigured, policy: 'ok' as const, transport: domain === 'social' && isConfigured ? 'https' as const : null })), set: vi.fn(async () => { isConfigured = true; return configured(); }) };
  const { store, onClose } = renderSettings({ target: 'social' }, config);
  await screen.findAllByText('Sample data'); expect(config.set).not.toHaveBeenCalled();
  const toggle = screen.getByRole('button', { name: 'Change Social address' });
  fireEvent.click(toggle);
  const input = screen.getByLabelText('New social base URL') as HTMLInputElement;
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: 'https://example.test' } }); fireEvent.submit(input.closest('form')!);
  await screen.findByText('Set up · not checked'); expect(config.set).toHaveBeenCalledWith({ domain: 'social', baseUrl: 'https://example.test' }); expect(input.value).toBe('');
  const [saved] = store.getSnapshot();
  expect(saved).toMatchObject({ tone: 'success', title: 'Social address saved', meta: 'Reload HQ to use it' });
  expect(document.activeElement).toBe(toggle);
  expect(screen.getByRole('region', { name: 'Social data source' }).classList.contains('hq-flash')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '← Back to Design' })); expect(onClose).toHaveBeenCalledOnce();
});

it('explains rejected policy without returning an endpoint', async () => {
  const config: ServiceConfigTransport = { status: async () => ({ configured: false, policy: 'rejected', transport: null }), set: vi.fn() };
  renderSettings({ target: 'work' }, config);
  await waitFor(() => expect(screen.getAllByText(/Use an allowed address and save it successfully/)).toHaveLength(2));
  expect(screen.getAllByText('Address rejected').length).toBeGreaterThanOrEqual(2);
  expect(screen.queryAllByRole('textbox').every(e => (e as HTMLInputElement).value === '')).toBe(true);
});

it('keeps a rejected save in the field and the row, and says the old address is gone', async () => {
  const config: ServiceConfigTransport = { status: vi.fn(async () => ({ configured: false, policy: 'ok' as const, transport: null })), set: vi.fn(async () => ({ configured: false, policy: 'rejected' as const, transport: null })) };
  const { store } = renderSettings({ target: 'social' }, config);
  await screen.findAllByText('Sample data');
  fireEvent.click(screen.getByRole('button', { name: 'Change Social address' }));
  const input = screen.getByLabelText('New social base URL') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'http://example.test' } }); fireEvent.submit(input.closest('form')!);
  await waitFor(() => expect(toastTitles(store)).toContain('Address rejected'));
  expect(store.getSnapshot()[0]).toMatchObject({ tone: 'danger', description: expect.stringContaining('cleared the previous address') });
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(within(screen.getByRole('region', { name: 'Social data source' })).getByText(/That address is not allowed/)).toBeTruthy();
  expect(input.value).toBe('http://example.test');
});

it('shows unavailable service management and a real native Wiki import action', async () => {
  const status = { revision: 'a'.repeat(64), sources: [{ namespace: 'bl', state: 'not-configured' }, { namespace: 'appdev', state: 'not-configured' }] };
  const call = vi.fn(async (route: string) => route === 'importProfile' ? { ok: true, value: { token: 'opaque-selection', namespace: 'bl', label: 'synthetic.git' } } : { ok: true, value: status });
  setBridge({ wikiAdmin: { call } });
  const { store } = renderSettings();
  fireEvent.click(nav().getByRole('button', { name: 'Social & Work' }));
  expect(screen.getAllByText('Service configuration is unavailable in this window.')[0]).toBeTruthy();
  fireEvent.click(nav().getByRole('button', { name: 'Local Wiki' }));
  await screen.findByText('Set up your first repository');
  fireEvent.click(screen.getByRole('button', { name: 'Import source profile…' }));
  await screen.findByText('Selected BusinessLessons: synthetic.git');
  expect(call).toHaveBeenCalledWith('importProfile', {});
  fireEvent.click(screen.getByRole('button', { name: 'Save source' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith('saveSource', { expectedRevision: status.revision, token: 'opaque-selection' }));
  await waitFor(() => expect(toastTitles(store)).toContain('BusinessLessons saved'));
  expect(screen.queryByRole('textbox')).toBeNull();
});

it('requires confirmation before removing a Wiki source', async () => {
  const status = { revision: 'b'.repeat(64), sources: [{ namespace: 'bl', state: 'ready' }, { namespace: 'appdev', state: 'not-configured' }] };
  const call = vi.fn(async (_route: string, _params: unknown) => ({ ok: true, value: status }));
  setBridge({ wikiAdmin: { call } });
  const { store } = renderSettings({ target: 'wiki' });
  fireEvent.click(await screen.findByRole('button', { name: 'Remove BusinessLessons…' }));
  expect(call.mock.calls.some(([route]) => route === 'removeSource')).toBe(false);
  expect(screen.getByRole('group', { name: 'Confirm removal of BusinessLessons' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove source' }));
  await waitFor(() => expect(call).toHaveBeenCalledWith('removeSource', { namespace: 'bl', expectedRevision: status.revision, confirmed: true }));
  await waitFor(() => expect(store.getSnapshot()[0]).toMatchObject({ title: 'BusinessLessons removed', description: 'Repository files remain on disk.' }));
});

it('opens Updates from Settings and releases its subscription when another category is selected', async () => {
  const status: UpdateStatus = {
    schemaVersion: 1, phase: 'idle', supported: true,
    installed: { version: '1.0.0', sourceSha: 'a'.repeat(40), channel: 'preview' },
    preferences: { automaticChecks: false, backgroundDownload: false },
    lastCheckedAt: null, nextCheckAt: null, candidate: null, progress: null, error: null, recovery: null,
  };
  const result = { ok: true as const, status };
  const unsubscribe = vi.fn();
  const updates = {
    status: vi.fn(async () => status), subscribe: vi.fn(() => unsubscribe),
    check: vi.fn(async () => result), download: vi.fn(async () => result),
    cancelDownload: vi.fn(async () => result), setPreferences: vi.fn(async () => result),
    schedule: vi.fn(async () => result), cancelScheduled: vi.fn(async () => result),
    shellReady: vi.fn(async () => {}),
  } satisfies UpdatesPort;
  const original = Object.getOwnPropertyDescriptor(window, 'hqUpdates');
  Object.defineProperty(window, 'hqUpdates', { configurable: true, value: updates });
  try {
    const { onClose } = renderSettings({ returnLabel: 'Work' });
    expect(updates.status).not.toHaveBeenCalled();
    const category = screen.getByRole('button', { name: 'Updates' });
    fireEvent.click(category);
    await screen.findByText('Version 1.0.0');
    expect(category.getAttribute('aria-current')).toBe('page');
    expect(updates.subscribe).toHaveBeenCalledOnce();
    expect(updates.check).not.toHaveBeenCalled();
    expect(updates.shellReady).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeTruthy();
    expect(unsubscribe).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '← Back to Work' }));
    expect(onClose).toHaveBeenCalledOnce();
  } finally {
    cleanup();
    if (original) Object.defineProperty(window, 'hqUpdates', original);
    else Reflect.deleteProperty(window, 'hqUpdates');
  }
});

it('groups categories under Data sources and App, marks the current one and moves with the arrow keys', () => {
  renderSettings();
  const groups = screen.getAllByRole('group').filter(group => group.classList.contains('settings-nav-group'));
  expect(groups.map(group => group.getAttribute('aria-label'))).toEqual(['Data sources', 'App']);
  expect(within(groups[0]!).getAllByRole('button').map(button => button.textContent)).toEqual(['Overview', 'Social & Work', 'Local Wiki', 'Projects & Jones']);
  expect(within(groups[1]!).getAllByRole('button').map(button => button.textContent)).toEqual(['Appearance', 'Updates']);
  expect(nav().getByRole('button', { name: 'Overview' }).getAttribute('aria-current')).toBe('page');
  expect(nav().getAllByRole('button').filter(button => button.getAttribute('aria-current') === 'page')).toHaveLength(1);
  const overview = nav().getByRole('button', { name: 'Overview' });
  overview.focus();
  fireEvent.keyDown(overview, { key: 'ArrowDown' });
  expect(document.activeElement).toBe(nav().getByRole('button', { name: 'Social & Work' }));
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' }); fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
  expect(document.activeElement).toBe(nav().getByRole('button', { name: 'Updates' }));
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(document.activeElement).toBe(overview);
  // Arrows only move focus: the category changes on activation.
  expect(overview.getAttribute('aria-current')).toBe('page');
});

it('starts each category at the top and moves focus to its heading', () => {
  renderSettings();
  const scroll = document.querySelector<HTMLElement>('.settings-scroll')!;
  scroll.scrollTop = 240;
  fireEvent.click(nav().getByRole('button', { name: 'Appearance' }));
  expect(scroll.scrollTop).toBe(0);
  const heading = screen.getByRole('heading', { name: 'Appearance' });
  expect(document.activeElement).toBe(heading);
  const region = screen.getByRole('region', { name: 'Appearance' });
  expect(region.classList.contains('hq-enter-rise')).toBe(true);
  expect(region.getAttribute('aria-labelledby')).toBe(heading.id);
});

it.each([
  ['social', 'Social & Work', 'settings-social'], ['work', 'Social & Work', 'settings-work'],
  ['wiki', 'Local Wiki', 'settings-wiki'], ['appearance', 'Appearance', null],
] as const)('opens the %s target on its category with the right element highlighted', async (target, category, id) => {
  setBridge({ wikiAdmin: { call: vi.fn(async () => ({ ok: true, value: { revision: 'c'.repeat(64), sources: [{ namespace: 'bl', state: 'ready' }, { namespace: 'appdev', state: 'ready' }] } })) } });
  const scrolled = vi.fn();
  Element.prototype.scrollIntoView = scrolled;
  renderSettings({ target });
  expect(nav().getByRole('button', { name: category }).getAttribute('aria-current')).toBe('page');
  if (id) {
    const element = document.getElementById(id)!;
    expect(element.classList.contains('is-target')).toBe(true);
    expect(scrolled).toHaveBeenCalled();
    expect(scrolled.mock.instances).toContain(element);
  }
  await act(async () => {});
});

it('opens Overview with one status row per source and sends Manage to the right category and row', async () => {
  setBridge({ config: { status: vi.fn(async () => configured()), set: vi.fn() }, social: { call: vi.fn() }, work: { call: vi.fn() } });
  const config: ServiceConfigTransport = { status: vi.fn(async () => configured()), set: vi.fn() };
  renderSettings({}, config);
  const overview = screen.getByRole('group', { name: 'Data source status' });
  expect(within(overview).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent)).toEqual(['Social', 'Work', 'Local Wiki', 'Project sources', 'Jones requests']);
  await waitFor(() => expect(within(overview).getAllByText('Set up · not checked')).toHaveLength(2));
  expect(overview.textContent).not.toMatch(/not-configured|index-unavailable/);
  fireEvent.click(within(overview).getByRole('button', { name: 'Manage Work' }));
  expect(nav().getByRole('button', { name: 'Social & Work' }).getAttribute('aria-current')).toBe('page');
  expect(document.getElementById('settings-work')!.classList.contains('is-target')).toBe(true);
  expect(document.getElementById('settings-social')!.classList.contains('is-target')).toBe(false);
  fireEvent.click(nav().getByRole('button', { name: 'Overview' }));
  fireEvent.click(screen.getByRole('button', { name: 'Manage Local Wiki' }));
  expect(nav().getByRole('button', { name: 'Local Wiki' }).getAttribute('aria-current')).toBe('page');
  fireEvent.click(nav().getByRole('button', { name: 'Overview' }));
  fireEvent.click(screen.getByRole('button', { name: 'Manage Jones requests' }));
  expect(nav().getByRole('button', { name: 'Projects & Jones' }).getAttribute('aria-current')).toBe('page');
});

it('rechecks every source from Overview once and confirms with a toast', async () => {
  const socialCall = vi.fn(async () => ({ ok: true, status: 200, body: {}, replayed: false }));
  const workCall = vi.fn(async () => ({ ok: false, kind: 'unavailable' }));
  setBridge({ config: { status: vi.fn(async () => configured()), set: vi.fn() }, social: { call: socialCall }, work: { call: workCall }, wikiAdmin: { call: vi.fn(async () => ({ ok: true, value: { revision: 'd'.repeat(64), sources: [{ namespace: 'bl', state: 'ready' }, { namespace: 'appdev', state: 'not-configured' }] } })) } });
  const config: ServiceConfigTransport = { status: vi.fn(async () => configured()), set: vi.fn() };
  const { store } = renderSettings({}, config);
  const button = screen.getByRole('button', { name: 'Recheck all' });
  fireEvent.click(button); fireEvent.click(button);
  expect(button.getAttribute('aria-busy')).toBe('true');
  await waitFor(() => expect(toastTitles(store)).toContain('Rechecked all data sources'));
  expect(socialCall).toHaveBeenCalledOnce(); expect(workCall).toHaveBeenCalledOnce();
  expect(store.getSnapshot().find(record => record.title === 'Rechecked all data sources')?.description).toBe('1 of 3 need attention.');
  const overview = screen.getByRole('group', { name: 'Data source status' });
  expect(within(overview).getByText('Reachable')).toBeTruthy();
  expect(within(overview).getByText('Unreachable')).toBeTruthy();
  expect(within(overview).getByText('Ready')).toBeTruthy();
});

it('runs one connection check per activation and confirms reachable with a toast and a flash', async () => {
  let release!: (value: unknown) => void;
  const socialCall = vi.fn(() => new Promise(resolve => { release = resolve; }));
  const config: ServiceConfigTransport = { status: vi.fn(async () => configured()), set: vi.fn() };
  setBridge({ config, social: { call: socialCall }, work: { call: vi.fn() } });
  const { store } = renderSettings({ target: 'social' }, config);
  const check = await screen.findByRole('button', { name: 'Check connection for Social' });
  await screen.findAllByText('Set up · not checked');
  fireEvent.click(check); fireEvent.click(check);
  await waitFor(() => expect(socialCall).toHaveBeenCalled());
  expect(check.getAttribute('aria-busy')).toBe('true');
  expect(within(check).getByText('Checking')).toBeTruthy();
  // The other mutating control in the panel says why it cannot start.
  const change = screen.getByRole('button', { name: 'Change Social address' });
  expect(change.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(change.getAttribute('aria-describedby')!)?.textContent).toBe('Another action is in progress.');
  await act(async () => { release({ ok: true, status: 200 }); });
  await waitFor(() => expect(toastTitles(store)).toContain('Social is reachable'));
  expect(socialCall).toHaveBeenCalledOnce();
  expect(check.getAttribute('aria-busy')).toBeNull();
  expect(screen.getByRole('region', { name: 'Social data source' }).classList.contains('hq-flash')).toBe(true);
});

it('keeps the saved address when a check fails: failure toast with Retry, mirrored inline on the row', async () => {
  const socialCall = vi.fn(async () => ({ ok: false, kind: 'unavailable' }));
  const config: ServiceConfigTransport = { status: vi.fn(async () => configured()), set: vi.fn() };
  setBridge({ config, social: { call: socialCall }, work: { call: vi.fn() } });
  const { store } = renderSettings({ target: 'social' }, config);
  await screen.findAllByText('Set up · not checked');
  fireEvent.click(screen.getByRole('button', { name: 'Check connection for Social' }));
  await waitFor(() => expect(store.getSnapshot()).toHaveLength(1));
  const [failure] = store.getSnapshot();
  expect(failure).toMatchObject({ tone: 'danger', title: "Couldn't reach Social", description: 'The saved address was kept.', action: { label: 'Retry' } });
  const row = screen.getByRole('region', { name: 'Social data source' });
  expect(within(row).getByText("Couldn't reach Social")).toBeTruthy();
  expect(within(row).getByText('The saved address was kept.')).toBeTruthy();
  expect(within(row).getByText('Unreachable')).toBeTruthy();
  await act(async () => { failure!.action!.onAction(); });
  await waitFor(() => expect(socialCall).toHaveBeenCalledTimes(2));
});

it('keeps unavailable actions focusable and states the reason on focus, ignoring activation', async () => {
  renderSettings({ target: 'social' });
  const check = screen.getByRole('button', { name: 'Check connection for Social' });
  const change = screen.getByRole('button', { name: 'Change Social address' });
  for (const button of [check, change]) {
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    button.focus(); expect(document.activeElement).toBe(button);
    expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe('Service configuration is unavailable in this window.');
  }
  fireEvent.click(change);
  expect(change.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('textbox')).toBeNull();
  await act(async () => {});
});

it('uses plain words for statuses and never shows raw enums as primary text', async () => {
  setBridge({ wikiAdmin: { call: vi.fn(async () => ({ ok: true, value: { revision: 'e'.repeat(64), sources: [{ namespace: 'bl', state: 'index-unavailable' }, { namespace: 'appdev', state: 'source-unavailable' }] } })) } });
  renderSettings({ target: 'wiki' });
  await screen.findByText('BusinessLessons');
  const page = screen.getByRole('region', { name: 'Settings page' });
  expect(page.textContent).not.toMatch(/index-unavailable|source-unavailable|not-configured|generation \d/);
  expect(within(page).getAllByText('Unavailable').length).toBeGreaterThanOrEqual(2);
});
