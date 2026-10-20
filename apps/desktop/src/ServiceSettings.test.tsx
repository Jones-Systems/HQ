import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ServiceSettings } from './ServiceSettings';
import type { ServiceConfigTransport } from '@hq/contracts/services';
afterEach(cleanup);
it('shows sanitized status; saves explicit input and clears it without URL readback', async () => {
  const config: ServiceConfigTransport = { status: vi.fn(async () => ({ configured: false, policy: 'ok' as const, transport: null })), set: vi.fn(async () => ({ configured: true, policy: 'ok' as const, transport: 'https' as const })) };
  const close = vi.fn(); render(<ServiceSettings config={config} onClose={close} />);
  await screen.findAllByText('Not connected.'); expect(config.set).not.toHaveBeenCalled();
  const input = screen.getByLabelText('New social base URL') as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'https://example.test' } }); fireEvent.submit(input.closest('form')!);
  await screen.findByText('Configured (HTTPS).'); expect(config.set).toHaveBeenCalledWith({ domain: 'social', baseUrl: 'https://example.test' }); expect(input.value).toBe('');
  fireEvent.click(screen.getByText('Close')); expect(close).toHaveBeenCalledOnce();
});
it('explains rejected policy without returning an endpoint', async () => {
  const config: ServiceConfigTransport = { status: async () => ({ configured: false, policy: 'rejected', transport: null }), set: vi.fn() };
  render(<ServiceSettings config={config} onClose={() => {}} />);
  await waitFor(() => expect(screen.getAllByText(/Configuration rejected/)).toHaveLength(2));
  expect(screen.getAllByRole('textbox').every(e => (e as HTMLInputElement).value === '')).toBe(true);
});
