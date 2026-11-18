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
  it('keeps labelled filters and an icon collapse control together after capture', async () => {
    const { container, session } = await mount();
    const toolbar = container.querySelector('.wd-toolbar')!;
    const filters = screen.getByRole('group', { name: 'Filter planning' });
    const search = within(filters).getByRole('searchbox', { name: 'Search' });
    expect(search.getAttribute('placeholder')).toBe('Search planning');
    for (const name of ['Kind', 'Horizon', 'Area label']) expect(within(filters).getByRole('combobox', { name })).toBeTruthy();
    const hide = screen.getByRole('button', { name: 'Hide capture & filters' });
    expect(hide.classList.contains('hq-btn--icon')).toBe(true);
    expect(toolbar.lastElementChild).toBe(hide);
    expect(toolbar.contains(screen.getByRole('form', { name: 'Quick capture' }))).toBe(true);
    fireEvent.change(search, { target: { value: 'library' } });
    const capture = screen.getByRole('textbox', { name: 'Capture to Inbox' });
    fireEvent.change(capture, { target: { value: 'Keep this unsent title' } });
    fireEvent.click(hide);
    expect(screen.queryByRole('searchbox', { name: 'Search' })).toBeNull();
    const show = screen.getByRole('button', { name: 'Show capture & filters · 1 filters' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(show);
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
    expect(screen.getByText('Updated bicycle horizon')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(screen.queryByText('Updated bicycle horizon')).toBeNull();
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
    const { session } = await mount(destination);
    vi.useFakeTimers();
    act(() => {
      session.feedback.push({ message: 'Unknown save result', tone: 'warning' });
      session.feedback.push({ message: 'Saving is paused', tone: 'danger' });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(screen.getByText('Unknown save result')).toBeTruthy();
    expect(screen.getByText('Saving is paused')).toBeTruthy();
  });
});
