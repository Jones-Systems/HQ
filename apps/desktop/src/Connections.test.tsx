import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { HqServices } from '@hq/contracts/services';
import { Connections } from './Connections';
const original = window.hqServices;
afterEach(() => { cleanup(); Object.defineProperty(window, 'hqServices', { configurable: true, value: original }); vi.useRealTimers(); });
function services() {
  const value = {
    config: { status: vi.fn(async () => ({ configured: true, policy: 'ok', transport: 'https' })), set: vi.fn() },
    social: { call: vi.fn(async () => ({ ok: true, status: 200, body: { private: 'discard' }, replayed: false })) },
    work: { call: vi.fn(async () => ({ ok: true, status: 200, body: {}, replayed: false })) },
    wiki: { indexStatus: vi.fn(async () => ({ ok: false })) },
  };
  Object.defineProperty(window, 'hqServices', { configurable: true, value: value as unknown as HqServices }); return value;
}
it('loads configuration without health probes and checks only on explicit activation', async () => {
  const value = services(); const manage = vi.fn(); render(<Connections onManage={manage} />);
  await screen.findAllByText('Configured · not checked');
  expect(value.social.call).not.toHaveBeenCalled(); expect(value.work.call).not.toHaveBeenCalled();
  expect(screen.getByText('Index unavailable')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Recheck Social: Configured · not checked' }));
  await screen.findByText('Reachable'); expect(value.social.call).toHaveBeenCalledExactlyOnceWith('workspace', {});
  expect(screen.queryByText('discard')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Manage connections' })); expect(manage).toHaveBeenCalledOnce();
});
it('keeps timed-out probes single-flight until their underlying request settles', async () => {
  const value = services(); let release!: (value: unknown) => void;
  value.social.call.mockImplementation(() => new Promise(resolve => { release = resolve; }) as never);
  render(<Connections compact onManage={() => {}} />);
  await screen.findAllByText('Configured · not checked');
  vi.useFakeTimers(); fireEvent.click(screen.getByRole('button', { name: 'Recheck Social: Configured · not checked' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  expect((screen.getByRole('button', { name: 'Recheck Social: Check timed out' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { release({ ok: true, status: 200 }); await vi.advanceTimersByTimeAsync(0); });
  vi.useRealTimers(); await waitFor(() => expect((screen.getByRole('button', { name: 'Recheck Social: Check timed out' }) as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByText('Reachable')).toBeNull();
});
