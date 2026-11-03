import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createToastApi, createToastStore, ErrorBoundary, FieldError, fieldErrorProps, InlineNotice, Presence, StatusIndicator,
  TOAST_ACTION_MIN_MS, ToastStoreProvider, ToastViewport, useAsyncAction, type ToastStore,
} from '../src';

describe('toast store', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('only runs timers while a viewport is subscribed, and pauses them together', () => {
    const store = createToastStore();
    const toast = createToastApi(store);
    toast.success('Saved');
    vi.advanceTimersByTime(60_000);
    expect(store.getSnapshot()).toHaveLength(1);
    const unsubscribe = store.subscribe(() => {});
    store.pause();
    vi.advanceTimersByTime(60_000);
    expect(store.getSnapshot()).toHaveLength(1);
    store.resume();
    vi.advanceTimersByTime(3_999);
    expect(store.getSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot()).toHaveLength(0);
    unsubscribe();
  });

  it('keeps failures and unknown results until dismissed, and keeps actions reachable', () => {
    const store = createToastStore();
    const toast = createToastApi(store);
    const unsubscribe = store.subscribe(() => {});
    const onDismiss = vi.fn();
    toast.error("Couldn't save the board", { onDismiss });
    toast.unknown('Save result unknown', { action: { label: 'Check', onAction: () => {} } });
    toast.show({ title: 'Moved card to Active', action: { label: 'Undo', onAction: () => {} }, duration: 1000 });
    vi.advanceTimersByTime(TOAST_ACTION_MIN_MS - 1);
    expect(store.getSnapshot().map((record) => record.tone)).toEqual(['danger', 'unknown', 'neutral']);
    vi.advanceTimersByTime(10 * 60_000);
    expect(store.getSnapshot().map((record) => record.tone)).toEqual(['danger', 'unknown']);
    toast.dismiss(store.getSnapshot()[0]!.id);
    expect(onDismiss).toHaveBeenCalledWith('programmatic');
    unsubscribe();
  });

  it('folds identical toasts, updates by id and replaces a promise toast in place', async () => {
    const store = createToastStore();
    const toast = createToastApi(store);
    toast.info('Synced');
    toast.info('Synced');
    expect(store.getSnapshot()).toHaveLength(1);
    expect(store.getSnapshot()[0]!.repeat).toBe(2);
    toast.show({ id: 'sync', title: 'Syncing', tone: 'loading', description: '3 items' });
    toast.show({ id: 'sync', title: 'Synced 3 items', tone: 'success' });
    expect(store.getSnapshot().filter((record) => record.id === 'sync')).toEqual([expect.objectContaining({ title: 'Synced 3 items', tone: 'success', revision: 1 })]);
    const result = toast.promise(Promise.resolve(42), { loading: 'Exporting', success: (value) => `Exported ${value}`, error: 'Export failed' });
    expect(store.getSnapshot().at(-1)).toMatchObject({ tone: 'loading', title: 'Exporting' });
    await expect(result).resolves.toBe(42);
    expect(store.getSnapshot().at(-1)).toMatchObject({ tone: 'success', title: 'Exported 42' });
    await expect(toast.promise(Promise.reject(new Error('disk full')), { loading: 'Exporting again', success: 'Done', error: (error) => ({ title: 'Export failed', description: (error as Error).message }) })).rejects.toThrow('disk full');
    expect(store.getSnapshot().at(-1)).toMatchObject({ tone: 'danger', title: 'Export failed', description: 'disk full' });
  });

  it('refuses an empty title', () => {
    expect(() => createToastApi(createToastStore())('  ')).toThrow(/title/);
  });
});

describe('ToastViewport', () => {
  let store: ToastStore;
  beforeEach(() => { store = createToastStore(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });
  const mount = () => render(<ToastStoreProvider store={store}><button>Elsewhere</button><ToastViewport /></ToastStoreProvider>);

  it('renders a labelled region, announces failures assertively and successes politely', () => {
    mount();
    const toast = createToastApi(store);
    act(() => { toast.success('Saved'); });
    expect(screen.getByRole('region', { name: 'Notifications (F8)' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Saved');
    act(() => { toast.error("Couldn't save", { description: 'Kept on this device.' }); });
    expect(screen.getByRole('alert').textContent).toBe("Couldn't save. Kept on this device.");
    expect(screen.getByRole('group', { name: "Couldn't save" })).toBeTruthy();
  });

  it('runs the action once and dismisses; Escape dismisses the focused toast; F8 jumps in and back', () => {
    mount();
    const undo = vi.fn();
    act(() => { createToastApi(store)('Moved card'); });
    act(() => { createToastApi(store).show({ title: 'Archived card', action: { label: 'Undo', onAction: undo } }); });
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' });
    elsewhere.focus();
    fireEvent.keyDown(window, { key: 'F8' });
    expect(document.activeElement?.textContent).toBe('Undo');
    fireEvent.keyDown(window, { key: 'F8' });
    expect(document.activeElement).toBe(elsewhere);
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().map((record) => record.title)).toEqual(['Moved card']);
    const leaving = screen.getByRole('group', { name: 'Archived card' }).closest('li')!;
    expect(leaving.hasAttribute('inert')).toBe(true);
    const dismiss = within(screen.getByRole('group', { name: 'Moved card' })).getByRole('button', { name: 'Dismiss notification' });
    dismiss.focus();
    fireEvent.keyDown(dismiss, { key: 'Escape' });
    expect(store.getSnapshot()).toHaveLength(0);
  });

  it('leaves focus on the page again when F8 was pressed with nothing focused', () => {
    mount();
    act(() => { createToastApi(store).error("Couldn't save"); });
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(window, { key: 'F8' });
    expect(screen.getByRole('group', { name: "Couldn't save" }).contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(window, { key: 'F8' });
    expect(document.activeElement).toBe(document.body);
  });

  it('announces every toast raised together, and a folded repeat again', () => {
    mount();
    const toast = createToastApi(store);
    act(() => { for (const title of ['Card one synced', 'Card two synced', 'Card three synced']) toast.info(title); });
    expect(screen.getByRole('status').textContent).toBe('Card one synced. Card two synced. Card three synced');
    act(() => { toast.success('Saved'); });
    const first = screen.getByRole('status').textContent;
    act(() => { toast.success('Saved'); });
    const second = screen.getByRole('status').textContent;
    expect(second).not.toBe(first);
    expect(second?.trim()).toBe('Saved');
  });

  it('drops a toast that expires or is dismissed while folded, instead of leaving an inert ghost', () => {
    vi.useFakeTimers();
    mount();
    const toast = createToastApi(store);
    act(() => {
      toast.info('Old one', { duration: 1000 });
      toast.info('Old two', { duration: 1000 });
      for (const title of ['Three', 'Four', 'Five']) toast.info(title, { duration: 60_000 });
    });
    expect(screen.getAllByRole('group')).toHaveLength(3);
    expect(screen.getByRole('button', { name: '2 more notifications' })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(store.getSnapshot()).toHaveLength(3);
    expect(document.querySelectorAll('.hq-toast-slot')).toHaveLength(3);
    expect(document.querySelectorAll('.hq-toast-slot[inert]')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: /more notification/ })).toBeNull();
    act(() => { for (const title of ['Six', 'Seven']) toast.info(title, { duration: 60_000 }); });
    act(() => { toast.dismiss(); });
    act(() => { vi.advanceTimersByTime(1000); });
    expect(store.getSnapshot()).toHaveLength(0);
    expect(document.querySelectorAll('.hq-toast-slot')).toHaveLength(0);
  });

  it('folds older toasts behind a "more" control', () => {
    mount();
    const toast = createToastApi(store);
    act(() => { for (const title of ['One', 'Two', 'Three', 'Four', 'Five']) toast.info(title); });
    expect(screen.getAllByRole('group')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '2 more notifications' }));
    expect(screen.getAllByRole('group')).toHaveLength(5);
  });
});

describe('inline feedback', () => {
  afterEach(() => { cleanup(); });

  it('InlineNotice pairs a glyph with words and announces by tone', () => {
    const retry = vi.fn();
    const { rerender } = render(<InlineNotice tone="danger" title="Couldn't refresh the board" actions={[{ label: 'Retry', onAction: retry }]}>Showing what loaded at 14:02.</InlineNotice>);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("Couldn't refresh the board");
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    rerender(<InlineNotice tone="warning" title="Stale" variant="bar" live="off" />);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('FieldError renders only with a message and ties itself to the field', () => {
    const { rerender } = render(<><input aria-label="Title" {...fieldErrorProps('title-error', '')} /><FieldError id="title-error" /></>);
    expect(screen.getByLabelText('Title').getAttribute('aria-invalid')).toBeNull();
    expect(document.getElementById('title-error')).toBeNull();
    rerender(<><input aria-label="Title" {...fieldErrorProps('title-error', 'Title is required')} /><FieldError id="title-error">Title is required</FieldError></>);
    const input = screen.getByLabelText('Title');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('title-error');
    expect(document.getElementById('title-error')?.textContent).toBe('Title is required');
  });

  it('StatusIndicator shows a busy word and one action', () => {
    const reconnect = vi.fn();
    render(<StatusIndicator tone="danger" label="Offline" detail="kept on this device" action={{ label: 'Reconnect', onAction: reconnect }} />);
    expect(screen.getByRole('status').textContent).toContain('Offline');
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(reconnect).toHaveBeenCalledOnce();
  });

  it('ErrorBoundary contains a render failure and recovers with Try again', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let explode = true;
    function Fragile() { if (explode) throw new Error('bad card'); return <p>Board</p>; }
    render(<><nav>Rail</nav><ErrorBoundary><Fragile /></ErrorBoundary></>);
    expect(screen.getByText('Rail')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('This view stopped working');
    explode = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(screen.getByText('Board')).toBeTruthy();
    consoleError.mockRestore();
  });

  it('useAsyncAction ignores double activation and raises one failure toast with optional Retry', async () => {
    const store = createToastStore();
    let reject: (error: Error) => void = () => {};
    const work = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
    function Save() {
      const save = useAsyncAction(work, { error: "Couldn't save", retry: true });
      return <button aria-busy={save.pending} onClick={() => void save.run()}>Save</button>;
    }
    render(<ToastStoreProvider store={store}><Save /></ToastStoreProvider>);
    const button = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(work).toHaveBeenCalledTimes(1);
    expect(button.getAttribute('aria-busy')).toBe('true');
    await act(async () => { reject(new Error('offline')); });
    expect(store.getSnapshot()).toEqual([expect.objectContaining({ tone: 'danger', title: "Couldn't save", description: 'offline' })]);
    expect(store.getSnapshot()[0]!.action?.label).toBe('Retry');
  });
});

describe('Presence', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('keeps content mounted through its exit, then removes it', () => {
    vi.useFakeTimers();
    function Toggle() {
      const [show, setShow] = useState(true);
      return <><button onClick={() => setShow((value) => !value)}>Toggle</button><Presence show={show} motion="rise">Panel</Presence></>;
    }
    render(<Toggle />);
    const panel = screen.getByText('Panel');
    expect(panel.getAttribute('data-hq-presence')).toBe('enter');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle' }));
    expect(screen.getByText('Panel').getAttribute('data-hq-presence')).toBe('exit');
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByText('Panel')).toBeNull();
  });

  it('unmounts immediately under the shell reduced-motion override', () => {
    document.documentElement.setAttribute('data-hq-motion', 'reduce');
    function Toggle() {
      const [show, setShow] = useState(true);
      return <><button onClick={() => setShow(false)}>Hide</button><Presence show={show}>Panel</Presence></>;
    }
    render(<Toggle />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(screen.queryByText('Panel')).toBeNull();
    document.documentElement.removeAttribute('data-hq-motion');
  });
});
