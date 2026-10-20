import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { HqServices } from '@hq/contracts/services';
import { Connections } from './Connections';
import { DataSourcesProvider } from './settings/DataSources';
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
it('loads configuration without health probes; source rows open their settings and only recheck activates a probe', async () => {
  const value = services(); const manage = vi.fn(); render(<DataSourcesProvider><Connections onManage={manage} /></DataSourcesProvider>);
  await screen.findAllByText('Set up · not checked');
  expect(value.social.call).not.toHaveBeenCalled(); expect(value.work.call).not.toHaveBeenCalled();
  expect(screen.getByText('Index unavailable')).toBeTruthy();
  const row = screen.getByRole('button', { name: 'Social: Set up · not checked' });
  fireEvent.click(row); expect(manage).toHaveBeenCalledWith('social', row);
  fireEvent.click(screen.getByRole('button', { name: 'Recheck Social: Set up · not checked' }));
  await screen.findByText('Reachable'); expect(value.social.call).toHaveBeenCalledExactlyOnceWith('workspace', {});
  expect(screen.queryByText('discard')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Manage connections' })).toBeNull();
});
it('releases timed-out checks and ignores their late answers without unlocking a newer check', async () => {
  const value = services(); let releaseFirst!: (value: unknown) => void; let releaseSecond!: (value: unknown) => void;
  value.social.call.mockImplementationOnce(() => new Promise(resolve => { releaseFirst = resolve; }) as never)
    .mockImplementationOnce(() => new Promise(resolve => { releaseSecond = resolve; }) as never);
  render(<DataSourcesProvider><Connections onManage={() => {}} /></DataSourcesProvider>);
  await screen.findAllByText('Set up · not checked');
  vi.useFakeTimers(); fireEvent.click(screen.getByRole('button', { name: 'Recheck Social: Set up · not checked' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  const retry = screen.getByRole('button', { name: 'Recheck Social: Unreachable' }) as HTMLButtonElement;
  expect(retry.disabled).toBe(false);
  fireEvent.click(retry);
  await act(async () => { releaseFirst({ ok: true, status: 200 }); await vi.advanceTimersByTimeAsync(0); });
  expect((screen.getByRole('button', { name: 'Recheck Social: Checking…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('Reachable')).toBeNull();
  await act(async () => { releaseSecond({ ok: true, status: 200 }); await vi.advanceTimersByTimeAsync(0); });
  vi.useRealTimers(); await waitFor(() => expect((screen.getByRole('button', { name: 'Recheck Social: Reachable' }) as HTMLButtonElement).disabled).toBe(false));
  expect(value.social.call).toHaveBeenCalledTimes(2);
});
it('compact rail uses one accessible source summary, preserves worst status and opens Settings', async () => {
  const value = services(); const manage = vi.fn(); render(<DataSourcesProvider><Connections compact onManage={manage} /></DataSourcesProvider>);
  const summary = await screen.findByRole('button', { name: /Data sources: Social: Set up · not checked; Work: Set up · not checked; Local Wiki: Index unavailable/ });
  expect(summary.className).toContain('connection-row--bad');
  expect(screen.getAllByRole('button')).toHaveLength(1);
  fireEvent.click(summary); expect(manage).toHaveBeenCalledWith(undefined, summary);
  expect(value.social.call).not.toHaveBeenCalled(); expect(value.work.call).not.toHaveBeenCalled();
});
