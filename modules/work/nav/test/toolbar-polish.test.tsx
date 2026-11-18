import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import { parseProjectContext, type ModulePort } from '@hq/contracts';
import { reportWrite } from '../../board';
import { WorkDomain, workSession } from '..';
import { fixedNow, installPlanner, uninstallPlanner } from './support';

const context = parseProjectContext({ id: 'toolbar-polish', name: 'Toolbar fixture' })!;
const port = (destination: string): ModulePort => ({
  context, destination, appearance: 'light', navigate: () => {},
  desktop: { platform: 'browser', versions: { electron: null } },
});

beforeEach(() => { installPlanner(); });
afterEach(() => {
  cleanup();
  uninstallPlanner();
  vi.useRealTimers();
});

async function mount(destination = 'board') {
  const session = workSession(context.id);
  await session.store.load();
  const view = render(<WorkDomain {...port(destination)} now={fixedNow} pollMs={3_600_000} />);
  return { ...view, session };
}

describe('Work toolbar grouping', () => {
  it('keeps labelled filters visible and preserves unsent capture text', async () => {
    const { container, session } = await mount();
    const toolbar = container.querySelector('.wd-topbar')!;
    const filters = screen.getByRole('group', { name: 'Filter planning' });
    const search = within(filters).getByRole('searchbox', { name: 'Search' });
    expect(search.getAttribute('placeholder')).toBe('Search planning');
    for (const name of ['Kind', 'Horizon', 'Area label']) expect(within(filters).getByRole('combobox', { name })).toBeTruthy();
    expect(toolbar.contains(screen.getByRole('form', { name: 'Quick capture' }))).toBe(true);
    fireEvent.change(search, { target: { value: 'library' } });
    const capture = screen.getByRole('textbox', { name: 'Capture to Inbox' });
    fireEvent.change(capture, { target: { value: 'Keep this unsent title' } });
    expect(screen.getByRole('group', { name: 'Filter planning' })).toBe(filters);
    expect(screen.queryByRole('button', { name: 'Hide capture & filters' })).toBeNull();
    expect(screen.getByRole('textbox', { name: 'Capture to Inbox' })).toBe(capture);
    expect(capture).toHaveProperty('value', 'Keep this unsent title');
    expect(search).toHaveProperty('value', 'library');
    expect(session.store.getState().undo).toHaveLength(0);
  });
});

describe.each(['board', 'list'])('Work feedback on %s', (destination) => {
  it.each(['ctrlKey', 'metaKey'] as const)('expires success after eight seconds while %s Undo survives exactly once', async (modifier) => {
    const { session, container } = await mount(destination);
    vi.useFakeTimers();
    await act(async () => {
      reportWrite(session.feedback, await session.store.patch('ex-bike', { horizon: 'later' }), 'Updated bicycle horizon');
    });
    expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('aria-keyshortcuts')).toBe('Control+Z Meta+Z');
    await act(async () => { await vi.advanceTimersByTimeAsync(7999); });
    expect(within(container.querySelector('.hq-toast-list')!).getByText('Updated bicycle horizon')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    const leaving = within(container.querySelector('.hq-toast-list')!).getByText('Updated bicycle horizon').closest('li')!;
    expect(leaving.getAttribute('data-hq-presence')).toBe('exit');
    expect(leaving.hasAttribute('inert')).toBe(true);
    fireEvent.animationEnd(leaving);
    expect(within(container.querySelector('.hq-toast-list')!).queryByText('Updated bicycle horizon')).toBeNull();
    expect(session.store.getState().undo).toHaveLength(1);
    await act(async () => { fireEvent.keyDown(container.querySelector('.wd-domain')!, { key: 'z', [modifier]: true }); });
    const restored = session.store.getState().items.find((item) => item.id === 'ex-bike')!;
    expect(restored.horizon).toBe('someday');
    expect(restored.revision).toBe(3);
    expect(session.store.getState().undo).toHaveLength(0);
    await act(async () => { fireEvent.keyDown(container.querySelector('.wd-domain')!, { key: 'z', [modifier]: true }); });
    expect(session.store.getState().items.find((item) => item.id === 'ex-bike')!.revision).toBe(3);
  });

  it('keeps warning and danger feedback visible past eight seconds', async () => {
    const { session, container } = await mount(destination);
    vi.useFakeTimers();
    act(() => {
      session.feedback.push({ message: 'Unknown save result', tone: 'warning' });
      session.feedback.push({ message: 'Saving is paused', tone: 'danger' });
      session.feedback.push({ message: 'Awaiting confirmation', tone: 'unknown' });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(within(container.querySelector('.hq-toast-list')!).getByText('Unknown save result')).toBeTruthy();
    expect(within(container.querySelector('.hq-toast-list')!).getByText('Saving is paused')).toBeTruthy();
    const unknown = screen.getByRole('group', { name: 'Awaiting confirmation' });
    expect(within(unknown).getByRole('button', { name: 'Check' })).toBeTruthy();
    expect(within(unknown).queryByRole('button', { name: /Retry|Apply/u })).toBeNull();
  });
});
