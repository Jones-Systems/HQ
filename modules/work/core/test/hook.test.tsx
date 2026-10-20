import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { createFixturePlanner } from '../fixtures/adapter';
import { exampleItems } from '../fixtures/examples';
import { useWorkState } from '../hook';
import { createWorkStore, sharedWorkStore, type WorkStore } from '../store';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Probe({ store, pollMs }: { store: WorkStore; pollMs?: number }) {
  const state = useWorkState(store, { pollMs });
  return <p data-testid="probe">{`${state.load}|${state.items.length}|${state.undo.length}`}</p>;
}

describe('useWorkState', () => {
  it('keeps the undo stack and items across an unmount and remount (domain switch)', async () => {
    const { port } = createFixturePlanner({ items: exampleItems('2026-10-21') });
    const store = () => sharedWorkStore('hook-remount', () => createWorkStore(port));
    const first = render(<Probe store={store()} />);
    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('ready|7|0'));
    await act(async () => {
      await store().patch('ex-bread', { notes: 'Try a rye loaf' });
    });
    expect(screen.getByTestId('probe').textContent).toBe('ready|7|1');
    first.unmount();
    render(<Probe store={store()} />);
    expect(screen.getByTestId('probe').textContent).toBe('ready|7|1');
    let outcome;
    await act(async () => {
      outcome = await store().undo();
    });
    expect(outcome).toEqual({ status: 'undone' });
    expect(screen.getByTestId('probe').textContent).toBe('ready|7|0');
  });

  it('polls the version only while mounted and visible', async () => {
    const { port } = createFixturePlanner();
    const version = vi.spyOn(port, 'version');
    const store = createWorkStore(port);
    const view = render(<Probe store={store} pollMs={15} />);
    await waitFor(() => expect(version).toHaveBeenCalled());
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const hiddenCount = version.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(version.mock.calls.length).toBe(hiddenCount);
    visibility.mockReturnValue('visible');
    await waitFor(() => expect(version.mock.calls.length).toBeGreaterThan(hiddenCount));
    view.unmount();
    const unmountedCount = version.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(version.mock.calls.length).toBe(unmountedCount);
    expect(store.getState().load).toBe('ready');
  });
});
