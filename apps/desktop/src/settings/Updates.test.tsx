import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { UpdateCandidate, UpdatePreferences, UpdateResult, UpdateStatus, UpdatesPort } from '@hq/contracts/updates';
import { Updates } from './Updates';

afterEach(cleanup);

const candidate: UpdateCandidate = {
  candidateId: 'a'.repeat(64), version: '1.1.0', sourceSha: 'b'.repeat(40),
  size: 100_000_000, publishedAt: '2026-10-22T12:00:00Z',
};

function status(patch: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    schemaVersion: 1, phase: 'idle', supported: true,
    installed: { version: '1.0.0', sourceSha: 'c'.repeat(40), channel: 'preview' },
    preferences: { automaticChecks: false, backgroundDownload: false },
    lastCheckedAt: null, nextCheckAt: null, candidate: null, progress: null, error: null, recovery: null,
    ...patch,
  };
}

const success = (value: UpdateStatus): UpdateResult => ({ ok: true, status: value });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function bridge(initial = status()) {
  let current = initial;
  const listeners = new Set<(value: UpdateStatus) => void>();
  const unsubscribe = vi.fn();
  const port = {
    status: vi.fn(async () => current),
    subscribe: vi.fn((listener: (value: UpdateStatus) => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); unsubscribe(); };
    }),
    check: vi.fn(async () => success(current)),
    download: vi.fn(async (_candidateId: string) => success(current)),
    cancelDownload: vi.fn(async () => success({ ...current, phase: 'available', progress: null })),
    setPreferences: vi.fn(async (preferences: UpdatePreferences) => {
      current = { ...current, preferences };
      return success(current);
    }),
    schedule: vi.fn(async (_candidateId: string) => success({ ...current, phase: 'scheduled' })),
    cancelScheduled: vi.fn(async () => success({ ...current, phase: 'ready' })),
    shellReady: vi.fn(async () => {}),
  } satisfies UpdatesPort;
  return {
    port, unsubscribe,
    emit(value: UpdateStatus) { current = value; for (const listener of listeners) listener(value); },
  };
}

it('shows installed identity and an unchecked empty state, and checks only on request', async () => {
  const fixture = bridge();
  fixture.port.check.mockResolvedValue(success(status({ phase: 'available', candidate, lastCheckedAt: '2026-10-22T13:00:00Z' })));
  render(<Updates port={fixture.port} />);
  await screen.findByText('Version 1.0.0');
  expect(screen.getByText('c'.repeat(40))).toBeTruthy();
  expect(screen.getByText('Preview')).toBeTruthy();
  expect(screen.getByText('Not checked yet')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Ready to check' })).toBeTruthy();
  expect(fixture.port.check).not.toHaveBeenCalled();
  expect(fixture.port.download).not.toHaveBeenCalled();
  expect(fixture.port.schedule).not.toHaveBeenCalled();
  expect(fixture.port.shellReady).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
  await screen.findByRole('heading', { name: 'HQ 1.1.0' });
  expect(fixture.port.check).toHaveBeenCalledOnce();
  expect(screen.getByText('Oct 22, 2026, 9:00 AM EDT')).toBeTruthy();
});

it('keeps a newer subscription status when the initial read resolves late and unsubscribes', async () => {
  const fixture = bridge();
  const firstRead = deferred<UpdateStatus>();
  fixture.port.status.mockReturnValue(firstRead.promise);
  const view = render(<Updates port={fixture.port} />);
  expect(screen.getByText('Loading update status…')).toBeTruthy();
  act(() => fixture.emit(status({ phase: 'ready', candidate })));
  await screen.findByRole('button', { name: 'Install on next launch' });
  await act(async () => { firstRead.resolve(status()); });
  expect(screen.getByRole('heading', { name: 'HQ 1.1.0' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Ready to check' })).toBeNull();
  view.unmount();
  expect(fixture.unsubscribe).toHaveBeenCalledOnce();
});

it('downloads the displayed candidate and allows cancellation while its request is pending', async () => {
  const fixture = bridge(status({ phase: 'available', candidate }));
  const download = deferred<UpdateResult>();
  fixture.port.download.mockReturnValue(download.promise);
  // The host acknowledges cancellation only after the active download has settled.
  fixture.port.cancelDownload.mockImplementation(async () => {
    await download.promise;
    return success(status({ phase: 'available', candidate }));
  });
  render(<Updates port={fixture.port} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Download update' }));
  expect(fixture.port.download).toHaveBeenCalledWith(candidate.candidateId);
  act(() => fixture.emit(status({ phase: 'downloading', candidate, progress: { received: 40_000_000, total: 100_000_000 } })));
  const progress = screen.getByRole('progressbar', { name: 'Update download' }) as HTMLProgressElement;
  expect(progress.value).toBe(40);
  expect(progress.getAttribute('aria-valuetext')).toBe('40% · 40 MB of 100 MB');
  const cancel = screen.getByRole('button', { name: 'Cancel download' }) as HTMLButtonElement;
  expect(cancel.disabled).toBe(false);
  fireEvent.click(cancel);
  await waitFor(() => expect(fixture.port.cancelDownload).toHaveBeenCalledOnce());
  expect((screen.getByRole('button', { name: 'Cancelling…' }) as HTMLButtonElement).disabled).toBe(true);
  expect(fixture.port.download).toHaveBeenCalledOnce();
  await act(async () => { download.resolve({ ok: false, code: 'cancelled', status: status({ phase: 'available', candidate }) }); });
  expect((await screen.findByRole('button', { name: 'Download update' }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(fixture.port.schedule).not.toHaveBeenCalled();
});

it('keeps verification distinct from install readiness and supports cancellation', async () => {
  const fixture = bridge(status({ phase: 'verifying', candidate, progress: { received: candidate.size, total: candidate.size } }));
  render(<Updates port={fixture.port} />);
  const progress = await screen.findByRole('progressbar', { name: 'Update verification' });
  expect(progress.hasAttribute('value')).toBe(false);
  expect(screen.queryByRole('button', { name: 'Install on next launch' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel download' }));
  await waitFor(() => expect(fixture.port.cancelDownload).toHaveBeenCalledOnce());
  await screen.findByRole('button', { name: 'Download update' });
});

it('schedules the exact verified candidate for next launch and can cancel that acceptance', async () => {
  const fixture = bridge(status({ phase: 'ready', candidate }));
  render(<Updates port={fixture.port} />);
  const install = await screen.findByRole('button', { name: 'Install on next launch' });
  expect(screen.getByText(/may prompt for Keychain access again/)).toBeTruthy();
  expect(screen.getByText(/leave HQ open and remote work running/)).toBeTruthy();
  fireEvent.click(install);
  fireEvent.click(install);
  const cancel = await screen.findByRole('button', { name: 'Cancel scheduled installation' });
  expect(fixture.port.schedule).toHaveBeenCalledExactlyOnceWith(candidate.candidateId);
  expect(screen.getByRole('heading', { name: 'Installation scheduled' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /restart|quit/i })).toBeNull();
  fireEvent.click(cancel);
  await screen.findByRole('button', { name: 'Install on next launch' });
  expect(fixture.port.cancelScheduled).toHaveBeenCalledOnce();
  expect(fixture.port.shellReady).not.toHaveBeenCalled();
});

it('requires another explicit choice after stale candidate consent is rejected', async () => {
  const fixture = bridge(status({ phase: 'ready', candidate }));
  const request = deferred<UpdateResult>();
  const replacement = { ...candidate, candidateId: 'd'.repeat(64), sourceSha: 'e'.repeat(40), version: '1.2.0' };
  const replacementStatus = status({ phase: 'ready', candidate: replacement });
  fixture.port.schedule.mockReturnValueOnce(request.promise);
  render(<Updates port={fixture.port} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Install on next launch' }));
  act(() => fixture.emit(replacementStatus));
  await act(async () => { request.resolve({ ok: false, code: 'stale-candidate', status: replacementStatus }); });
  expect(screen.getByRole('alert').textContent).toContain('The update candidate changed');
  expect(screen.getByRole('heading', { name: 'HQ 1.2.0' })).toBeTruthy();
  expect(fixture.port.schedule).toHaveBeenCalledExactlyOnceWith(candidate.candidateId);
  fixture.port.schedule.mockResolvedValue(success({ ...replacementStatus, phase: 'scheduled' }));
  fireEvent.click(screen.getByRole('button', { name: 'Install on next launch' }));
  await screen.findByRole('heading', { name: 'Installation scheduled' });
  expect(fixture.port.schedule).toHaveBeenNthCalledWith(2, replacement.candidateId);
});

it('sends complete preferences and keeps the saved values when a change is rejected', async () => {
  const original = status({ preferences: { automaticChecks: false, backgroundDownload: true } });
  const fixture = bridge(original);
  const request = deferred<UpdateResult>();
  fixture.port.setPreferences.mockReturnValueOnce(request.promise);
  render(<Updates port={fixture.port} />);
  const automatic = await screen.findByRole('checkbox', { name: 'Check for updates automatically' }) as HTMLInputElement;
  fireEvent.click(automatic);
  expect(fixture.port.setPreferences).toHaveBeenCalledWith({ automaticChecks: true, backgroundDownload: true });
  expect(automatic.checked).toBe(false);
  expect(automatic.disabled).toBe(true);
  await act(async () => { request.resolve({ ok: false, code: 'permission', status: original }); });
  expect(automatic.checked).toBe(false);
  expect(automatic.disabled).toBe(false);
  expect(screen.getByRole('alert').textContent).toContain('could not access its update files');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Download updates in the background' }));
  await waitFor(() => expect(fixture.port.setPreferences).toHaveBeenNthCalledWith(2, { automaticChecks: false, backgroundDownload: false }));
  await waitFor(() => expect((screen.getByRole('checkbox', { name: 'Download updates in the background' }) as HTMLInputElement).checked).toBe(false));
  expect(fixture.port.schedule).not.toHaveBeenCalled();
});

it('shows host error and recovery state without offering installation from a hold', async () => {
  const fixture = bridge(status({ phase: 'held', candidate,
    error: { code: 'recovery-required', message: 'The candidate is still running; installation is held.' },
    recovery: { state: 'held-awaiting-health', message: 'The retained app is available. No automatic recovery is running.' },
  }));
  render(<Updates port={fixture.port} />);
  expect((await screen.findByRole('alert')).textContent).toContain('The candidate is still running');
  expect(screen.getByText('State: held-awaiting-health')).toBeTruthy();
  expect(screen.getByText('The retained app is available. No automatic recovery is running.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Install on next launch' })).toBeNull();
});

it('holds further actions after an unconfirmed result until status is refreshed', async () => {
  const fixture = bridge(status({ phase: 'ready', candidate }));
  fixture.port.schedule.mockImplementationOnce(async () => {
    fixture.emit(status({ phase: 'ready', candidate }));
    throw new Error('Synthetic transport detail must stay out of the UI');
  });
  render(<Updates port={fixture.port} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Install on next launch' }));
  expect((await screen.findByRole('alert')).textContent).toContain('HQ could not confirm the result');
  expect(screen.queryByText(/Synthetic transport detail/)).toBeNull();
  expect((screen.getByRole('button', { name: 'Check for updates' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Install on next launch' }) as HTMLButtonElement).disabled).toBe(true);
  fixture.port.status.mockResolvedValueOnce(status({ phase: 'scheduled', candidate }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh update status' }));
  await screen.findByRole('button', { name: 'Cancel scheduled installation' });
  expect(fixture.port.schedule).toHaveBeenCalledOnce();
  expect(fixture.port.status).toHaveBeenCalledTimes(2);
  expect(fixture.port.subscribe).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('can refresh a failed initial status read without adding a second subscription', async () => {
  const fixture = bridge(status({ lastCheckedAt: '2026-10-22T13:00:00Z', installed: { version: 'legacy', sourceSha: null, channel: 'stable' } }));
  fixture.port.status.mockRejectedValueOnce(new Error('Unavailable'));
  render(<Updates port={fixture.port} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh update status' }));
  await screen.findByRole('heading', { name: 'No update available' });
  expect(screen.getByText('Not recorded for this installation')).toBeTruthy();
  expect(screen.getByText('Stable')).toBeTruthy();
  expect(fixture.port.subscribe).toHaveBeenCalledOnce();
});

it('releases the old subscription and ignores old action results when the bridge changes', async () => {
  const oldBridge = bridge(status({ phase: 'ready', candidate }));
  const newBridge = bridge(status({ installed: { version: '2.0.0', sourceSha: null, channel: 'stable' } }));
  const request = deferred<UpdateResult>();
  oldBridge.port.schedule.mockReturnValue(request.promise);
  const view = render(<Updates port={oldBridge.port} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Install on next launch' }));
  view.rerender(<Updates port={newBridge.port} />);
  await screen.findByText('Version 2.0.0');
  await act(async () => { request.resolve(success(status({ phase: 'scheduled', candidate }))); });
  expect(oldBridge.unsubscribe).toHaveBeenCalledOnce();
  expect(screen.getByText('Version 2.0.0')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Installation scheduled' })).toBeNull();
  view.unmount();
  expect(newBridge.unsubscribe).toHaveBeenCalledOnce();
});

it('explains a missing native bridge without exposing update actions', () => {
  const original = Object.getOwnPropertyDescriptor(window, 'hqUpdates');
  Reflect.deleteProperty(window, 'hqUpdates');
  try {
    render(<Updates />);
    expect(screen.getByRole('heading', { name: 'Updates unavailable' })).toBeTruthy();
    expect(screen.getByText(/Browser previews and development windows do not install updates/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  } finally {
    cleanup();
    if (original) Object.defineProperty(window, 'hqUpdates', original);
  }
});

it('shows unsupported installed status while keeping update controls disabled', async () => {
  const fixture = bridge(status({ phase: 'unavailable', supported: false, error: { code: 'unavailable', message: 'Updates are unavailable in this development build.' } }));
  render(<Updates port={fixture.port} />);
  await screen.findByText('Version 1.0.0');
  expect(screen.getByRole('heading', { name: 'Updates unavailable' })).toBeTruthy();
  const check = screen.getByRole('button', { name: 'Check for updates' }) as HTMLButtonElement;
  expect(check.disabled).toBe(true);
  fireEvent.click(check);
  expect(fixture.port.check).not.toHaveBeenCalled();
  expect(screen.getAllByRole('checkbox').every(input => (input as HTMLInputElement).disabled)).toBe(true);
});
