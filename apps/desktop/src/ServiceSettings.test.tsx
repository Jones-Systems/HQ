import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ServiceSettings } from './ServiceSettings';
import { DataSourcesProvider } from './settings/DataSources';
import type { ServiceConfigTransport } from '@hq/contracts/services';
import type { UpdateStatus, UpdatesPort } from '@hq/contracts/updates';
afterEach(cleanup);
it('shows sanitized status; saves explicit input and clears it without URL readback', async () => {
  let configured = false;
  const config: ServiceConfigTransport = { status: vi.fn(async domain => ({ configured: domain === 'social' && configured, policy: 'ok' as const, transport: domain === 'social' && configured ? 'https' as const : null })), set: vi.fn(async () => { configured = true; return { configured, policy: 'ok' as const, transport: 'https' as const }; }) };
  const close = vi.fn(); render(<DataSourcesProvider config={config}><ServiceSettings config={config} onClose={close} /></DataSourcesProvider>);
  await screen.findAllByText('Sample data · not set up'); expect(config.set).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Change Social address' }));
  const input = screen.getByLabelText('New social base URL') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'https://example.test' } }); fireEvent.submit(input.closest('form')!);
  await screen.findByText('Set up · not checked'); expect(config.set).toHaveBeenCalledWith({ domain: 'social', baseUrl: 'https://example.test' }); expect(input.value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: '← Back to Design' })); expect(close).toHaveBeenCalledOnce();
});
it('explains rejected policy without returning an endpoint', async () => {
  const config: ServiceConfigTransport = { status: async () => ({ configured: false, policy: 'rejected', transport: null }), set: vi.fn() };
  render(<DataSourcesProvider config={config}><ServiceSettings config={config} onClose={() => {}} /></DataSourcesProvider>);
  await waitFor(() => expect(screen.getAllByText('Address rejected. Use an allowed address and save it successfully.')).toHaveLength(2));
  expect(screen.queryAllByRole('textbox').every(e => (e as HTMLInputElement).value === '')).toBe(true);
});

it('shows unavailable service management and a real native Wiki import action', async () => {
  const original = window.hqServices;
  const status = { revision: 'a'.repeat(64), sources: [{ namespace: 'bl', state: 'not-configured' }, { namespace: 'appdev', state: 'not-configured' }] };
  const call = vi.fn(async (route: string) => route === 'importProfile' ? { ok: true, value: { token: 'opaque-selection', namespace: 'bl', label: 'synthetic.git' } } : { ok: true, value: status });
  Object.defineProperty(window, 'hqServices', { configurable: true, value: { wikiAdmin: { call } } });
  try {
    render(<DataSourcesProvider><ServiceSettings onClose={() => {}} /></DataSourcesProvider>);
    expect(screen.getAllByText('Service configuration is unavailable in this window.')[0]).toBeTruthy();
    await screen.findByText(/Import a complete source profile/);
    fireEvent.click(screen.getByRole('button', { name: 'Import source profile…' }));
    await screen.findByText('Selected bl: synthetic.git');
    expect(call).toHaveBeenCalledWith('importProfile', {});
    fireEvent.click(screen.getByRole('button', { name: 'Save source' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('saveSource', { expectedRevision: status.revision, token: 'opaque-selection' }));
    expect(screen.queryByRole('textbox')).toBeNull();
  } finally { cleanup(); Object.defineProperty(window, 'hqServices', { configurable: true, value: original }); }
});

it('requires confirmation before removing a Wiki source', async () => {
  const original = window.hqServices;
  const status = { revision: 'b'.repeat(64), sources: [{ namespace: 'bl', state: 'ready' }, { namespace: 'appdev', state: 'not-configured' }] };
  const call = vi.fn(async (_route: string, _params: unknown) => ({ ok: true, value: status }));
  Object.defineProperty(window, 'hqServices', { configurable: true, value: { wikiAdmin: { call } } });
  try {
    render(<DataSourcesProvider><ServiceSettings onClose={() => {}} /></DataSourcesProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove source' }));
    expect(call.mock.calls.some(([route]) => route === 'removeSource')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove source' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('removeSource', { namespace: 'bl', expectedRevision: status.revision, confirmed: true }));
  } finally { cleanup(); Object.defineProperty(window, 'hqServices', { configurable: true, value: original }); }
});

it('opens Updates from Settings and releases its subscription when another category is selected', async () => {
  const original = Object.getOwnPropertyDescriptor(window, 'hqUpdates');
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
  Object.defineProperty(window, 'hqUpdates', { configurable: true, value: updates });
  try {
    const onClose = vi.fn();
    render(<DataSourcesProvider><ServiceSettings onClose={onClose} returnLabel="Work" /></DataSourcesProvider>);
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
