import { useEffect, useRef } from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseProjectContext, type ModulePort } from '@hq/contracts';
import { isTypingControl, shouldUndo, WorkDomain, workSession, workUndoHandler } from '..';
import { fixedNow, installPlanner, uninstallPlanner, type RecordedPlanner } from './support';

/**
 * RW-8 and ac.work-domain.001: the planning views handle Ctrl/⌘+Z themselves and mark it handled; the Work-level
 * handler around them skips handled events and typing controls, so one keypress consumes exactly one undo entry.
 */

const CONTEXT = parseProjectContext({ id: 'undo-project', name: 'Undo fixture project' })!;
let recorded: RecordedPlanner;

beforeEach(() => {
  ({ recorded } = installPlanner());
});

afterEach(() => {
  cleanup();
  uninstallPlanner();
});

function port(destination: string): ModulePort {
  return { context: CONTEXT, destination, appearance: 'light', desktop: { platform: 'browser', versions: { electron: null } }, navigate: () => {} };
}

const session = () => workSession(CONTEXT.id);
const undoWrites = () => recorded.writes().length;

/** Two recorded moves, so the undo stack holds two entries. */
async function twoMoves() {
  await act(async () => {
    await session().store.move('ex-bread', 'active', { place: 'top' });
    await session().store.move('ex-bike', 'next', { place: 'top' });
  });
  expect(session().store.getState().undo).toHaveLength(2);
  return recorded.writes().length;
}

async function settle() {
  // Let any second, wrongly dispatched undo reach the port before counting.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
}

describe('Work-level Ctrl/⌘+Z', () => {
  it('consumes exactly one undo entry for one keypress inside the nested PlanningViews', async () => {
    render(<WorkDomain {...port('list')} now={fixedNow} />);
    const link = await screen.findByRole('button', { name: 'Learn three bread recipes' });
    const before = await twoMoves();
    expect(link.closest('.wv')).not.toBeNull();

    link.focus();
    await userEvent.setup().keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(session().store.getState().undo).toHaveLength(1));
    await settle();

    expect(session().store.getState().undo).toHaveLength(1);
    expect(recorded.writes().slice(before).map((call) => [call.method, call.args[0]])).toStrictEqual([['move', 'ex-bike']]);
    expect(recorded.execution()).toHaveLength(0);
  });

  it('consumes exactly one entry for ⌘+Z outside the views, through the Work-level handler', async () => {
    render(<WorkDomain {...port('list')} now={fixedNow} />);
    await screen.findByRole('button', { name: 'Learn three bread recipes' });
    const before = await twoMoves();

    within(screen.getByRole('navigation', { name: 'Work' })).getByRole('button', { name: 'List' }).focus();
    await userEvent.setup().keyboard('{Meta>}z{/Meta}');
    await waitFor(() => expect(session().store.getState().undo).toHaveLength(1));
    await settle();

    expect(recorded.writes().slice(before).map((call) => call.method)).toStrictEqual(['move']);
    expect(await screen.findByText(/^Undone:/u)).toBeTruthy();
  });

  it('consumes exactly one entry on the Board, whose cards leave Ctrl/⌘+Z to the domain', async () => {
    const { container } = render(<WorkDomain {...port('home')} now={fixedNow} />);
    await screen.findByRole('heading', { level: 2, name: 'Status board' });
    const before = await twoMoves();

    container.querySelector<HTMLElement>('[data-card-id="ex-shed-paint"]')!.focus();
    await userEvent.setup().keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(session().store.getState().undo).toHaveLength(1));
    await settle();
    expect(recorded.writes().length - before).toBe(1);
  });

  it('leaves Ctrl/⌘+Z to typing controls: capture input, filter select and detail title', async () => {
    render(<WorkDomain {...port('item/ex-shed-paint')} now={fixedNow} />);
    await screen.findByRole('textbox', { name: 'Card title' });
    const before = await twoMoves();
    const keys = userEvent.setup();

    for (const target of [
      screen.getByRole('textbox', { name: 'Capture to Inbox' }),
      within(screen.getByRole('group', { name: 'Filter planning' })).getByLabelText('Kind'),
      screen.getByRole('textbox', { name: 'Card title' }),
    ]) {
      target.focus();
      await keys.keyboard('{Control>}z{/Control}');
    }
    await settle();
    expect(session().store.getState().undo).toHaveLength(2);
    expect(undoWrites()).toBe(before);
  });
});

describe('the outer handler in isolation', () => {
  function Harness({ inner }: { inner: 'react' | 'native' | 'editable' | 'plain' }) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const el = ref.current;
      if (inner !== 'native' || !el) return;
      const mark = (event: KeyboardEvent) => event.preventDefault();
      el.addEventListener('keydown', mark);
      return () => el.removeEventListener('keydown', mark);
    }, [inner]);
    const s = session();
    return (
      <div onKeyDown={workUndoHandler(s.store, s.feedback)}>
        <div
          ref={ref}
          tabIndex={0}
          data-testid="inner"
          contentEditable={inner === 'editable' ? true : undefined}
          suppressContentEditableWarning
          onKeyDown={inner === 'react' ? (event) => event.preventDefault() : undefined}
        >
          inner
        </div>
      </div>
    );
  }

  async function press(inner: 'react' | 'native' | 'editable' | 'plain') {
    await act(() => session().store.load());
    const before = await twoMoves();
    render(<Harness inner={inner} />);
    screen.getByTestId('inner').focus();
    await userEvent.setup().keyboard('{Control>}z{/Control}');
    await settle();
    return { consumed: 2 - session().store.getState().undo.length, writes: recorded.writes().length - before };
  }

  it('undoes once for a plain focused element', async () => {
    expect(await press('plain')).toStrictEqual({ consumed: 1, writes: 1 });
  });

  it('skips an event an inner React handler marked handled', async () => {
    expect(await press('react')).toStrictEqual({ consumed: 0, writes: 0 });
  });

  it('skips an event an inner native listener marked handled', async () => {
    expect(await press('native')).toStrictEqual({ consumed: 0, writes: 0 });
  });

  it('skips contenteditable content', async () => {
    expect(await press('editable')).toStrictEqual({ consumed: 0, writes: 0 });
  });

  it('classifies typing controls and undo keys', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const child = document.createElement('span');
    editable.append(child);
    const off = document.createElement('div');
    off.setAttribute('contenteditable', 'false');
    for (const el of [document.createElement('input'), document.createElement('textarea'), document.createElement('select'), editable, child]) {
      expect(isTypingControl(el)).toBe(true);
    }
    for (const el of [document.createElement('button'), document.createElement('div'), off, null]) {
      expect(isTypingControl(el)).toBe(false);
    }
    const event = (init: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> & { key: string }) => ({
      ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init,
      target: document.createElement('button'), isDefaultPrevented: () => false, nativeEvent: { defaultPrevented: false },
    }) as unknown as Parameters<typeof shouldUndo>[0];
    expect(shouldUndo(event({ key: 'z', ctrlKey: true }))).toBe(true);
    expect(shouldUndo(event({ key: 'Z', metaKey: true }))).toBe(true);
    expect(shouldUndo(event({ key: 'z', ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(shouldUndo(event({ key: 'z', ctrlKey: true, altKey: true }))).toBe(false);
    expect(shouldUndo(event({ key: 'z' }))).toBe(false);
  });
});
