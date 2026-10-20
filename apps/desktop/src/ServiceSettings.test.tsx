import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ServiceSettings } from './ServiceSettings';
import type { ServiceConfigTransport } from '@hq/contracts/services';
afterEach(cleanup);
it('shows sanitized status; saves explicit input and clears it without URL readback', async () => {
  const config: ServiceConfigTransport = { status: vi.fn(async () => ({ configured: false, policy: 'ok' as const, transport: null })), set: vi.fn(async () => ({ configured: true, policy: 'ok' as const, transport: 'https' as const })) };
  const close = vi.fn(); render(<ServiceSettings config={config} onClose={close} />);
  await screen.findAllByText('Not set up'); expect(config.set).not.toHaveBeenCalled();
  const input = screen.getByLabelText('New social base URL') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'https://example.test' } }); fireEvent.submit(input.closest('form')!);
  await screen.findByText('Configured · not checked'); expect(config.set).toHaveBeenCalledWith({ domain: 'social', baseUrl: 'https://example.test' }); expect(input.value).toBe('');
  fireEvent.click(screen.getByText('Close')); expect(close).toHaveBeenCalledOnce();
});
it('explains rejected policy without returning an endpoint', async () => {
  const config: ServiceConfigTransport = { status: async () => ({ configured: false, policy: 'rejected', transport: null }), set: vi.fn() };
  render(<ServiceSettings config={config} onClose={() => {}} />);
  await waitFor(() => expect(screen.getAllByText(/Configuration rejected/)).toHaveLength(2));
  expect(screen.getAllByRole('textbox').every(e => (e as HTMLInputElement).value === '')).toBe(true);
});

it('shows unavailable service management and a real native Wiki import action', async () => {
  const original = window.hqServices;
  const status = { revision: 'a'.repeat(64), sources: [{ namespace: 'bl', state: 'not-configured' }, { namespace: 'appdev', state: 'not-configured' }] };
  const call = vi.fn(async (route: string) => route === 'importProfile' ? { ok: true, value: { token: 'opaque-selection', namespace: 'bl', label: 'synthetic.git' } } : { ok: true, value: status });
  Object.defineProperty(window, 'hqServices', { configurable: true, value: { wikiAdmin: { call } } });
  try {
    render(<ServiceSettings onClose={() => {}} />);
    expect(screen.getByText('Service configuration is unavailable in this window.')).toBeTruthy();
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
  const call = vi.fn(async () => ({ ok: true, value: status }));
  Object.defineProperty(window, 'hqServices', { configurable: true, value: { wikiAdmin: { call } } });
  try {
    render(<ServiceSettings onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove source' }));
    expect(call).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove source' }));
    await waitFor(() => expect(call).toHaveBeenCalledWith('removeSource', { namespace: 'bl', expectedRevision: status.revision, confirmed: true }));
  } finally { cleanup(); Object.defineProperty(window, 'hqServices', { configurable: true, value: original }); }
});
