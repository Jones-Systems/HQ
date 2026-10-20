import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createWorkStore, PLANNER_PORT_KEYS, type PlannerPort, type Status } from '../../core';
import { APPLY_LABEL, OFFLINE_BANNER, POSSIBLY_SAVED_NOTE } from '../SyncStatus';
import { PROJECT_SCOPE_NOTE } from '../StatusBoard';
import { createFeedback } from '../feedback';
import { moveShape, setup, writes, type PortCall } from './fixtures';
import { belowCard, columnX, Host, syntheticLayout } from './host';

afterEach(cleanup);

type Method = 'drag' | 'keyboard' | 'menu';

const card = (id: string) => document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)!;
const titleOf = (id: string) => card(id).querySelector('h4')!.textContent!;

async function drag(id: string, from: Status, to: Status, y: number) {
  const layout = syntheticLayout();
  try {
    const start = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: columnX(from), clientY: 120 };
    await act(async () => {
      fireEvent.pointerDown(card(id), start);
      fireEvent.pointerMove(window, { ...start, clientX: start.clientX + 12 });
      fireEvent.pointerMove(window, { ...start, clientX: columnX(to), clientY: y });
    });
    await act(async () => { fireEvent.pointerUp(window, { ...start, clientX: columnX(to), clientY: y }); });
  } finally {
    layout.mockRestore();
  }
}

async function keyboard(id: string, key: string) {
  card(id).focus();
  await act(async () => { fireEvent.keyDown(card(id), { key, altKey: true }); });
}

async function menu(id: string, label: string) {
  const trigger = screen.getByRole('button', { name: `Move “${titleOf(id)}”` });
  await act(async () => { fireEvent.click(trigger); });
  await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: label })); });
}

interface Scenario { name: string; id: string; drag: () => Promise<void>; keyboard: () => Promise<void>; menu: () => Promise<void> }

const SCENARIOS: Scenario[] = [
  {
    name: 'status change to the next column',
    id: 'it-kite',
    drag: () => drag('it-kite', 'inbox', 'considering', belowCard(-1)),
    keyboard: () => keyboard('it-kite', 'ArrowRight'),
    menu: () => menu('it-kite', 'Move to Considering'),
  },
  {
    name: 'status change into the top of a non-empty column',
    id: 'it-shed',
    drag: () => drag('it-shed', 'active', 'next', belowCard(-1)),
    keyboard: () => keyboard('it-shed', 'ArrowLeft'),
    menu: () => menu('it-shed', 'Move to Next'),
  },
  {
    name: 'reorder down one within a column',
    id: 'it-seed',
    drag: () => drag('it-seed', 'inbox', 'inbox', belowCard(1)),
    keyboard: () => keyboard('it-seed', 'ArrowDown'),
    menu: () => menu('it-seed', 'Move down'),
  },
];

/** Runs one input method on a fresh, identical fixture, then Undo from the toast. */
async function run(method: Method, scenario: Scenario) {
  const env = await setup();
  render(<Host store={env.store} feedback={env.feedback} />);
  const before = env.layout();
  const start = env.calls.length;
  await scenario[method]();
  const undo = await screen.findByRole('button', { name: 'Undo' });
  const moved = writes(env.calls.slice(start)).map(moveShape);
  const after = env.layout();
  await act(async () => { fireEvent.click(undo); });
  await waitFor(() => expect(env.layout()).toEqual(before));
  const undone = writes(env.calls.slice(start)).map(moveShape).slice(moved.length);
  const methods = env.calls.map((c) => c.method);
  cleanup();
  return { moved, after, undone, before, methods };
}

describe('drag, keyboard and menu moves (RV-1, ac.work-board.001)', () => {
  for (const scenario of SCENARIOS) {
    it(`make identical move calls and agree after Undo: ${scenario.name}`, async () => {
      const results = { drag: await run('drag', scenario), keyboard: await run('keyboard', scenario), menu: await run('menu', scenario) };
      expect(results.drag.moved).toHaveLength(1);
      expect(results.drag.moved[0]!.method).toBe('move');
      expect(results.keyboard.moved).toEqual(results.drag.moved);
      expect(results.menu.moved).toEqual(results.drag.moved);
      expect(results.keyboard.after).toEqual(results.drag.after);
      expect(results.menu.after).toEqual(results.drag.after);
      expect(results.drag.after).not.toEqual(results.drag.before);
      // Undo is one move back to the exact neighbour anchor, the same for every input method.
      expect(results.drag.undone).toHaveLength(1);
      expect(results.drag.undone[0]!.method).toBe('move');
      expect(results.keyboard.undone).toEqual(results.drag.undone);
      expect(results.menu.undone).toEqual(results.drag.undone);
    });
  }

  it('records the exact anchors: a status change lands at the top, a reorder after its new upper neighbour', async () => {
    const { moved: status } = await run('keyboard', SCENARIOS[0]!);
    expect(status[0]!.args).toEqual(['it-kite', 1, 'considering', { place: 'top' }]);
    const { moved: reorder, undone } = await run('menu', SCENARIOS[2]!);
    expect(reorder[0]!.args).toEqual(['it-seed', 1, 'inbox', { after_id: 'it-kite' }]);
    expect(undone[0]!.args).toEqual(['it-seed', 2, 'inbox', { before_id: 'it-kite' }]);
  });

  it('drops on a collapsed column at its top, and Dropped starts collapsed', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const dropped = screen.getByRole('button', { name: /^Dropped/ });
    expect(dropped.getAttribute('aria-expanded')).toBe('false');
    await drag('it-seed', 'inbox', 'dropped', 900);
    await screen.findByRole('button', { name: 'Undo' });
    expect(writes(env.calls).map(moveShape)).toEqual([{ method: 'move', args: ['it-seed', 1, 'dropped', { place: 'top' }] }]);
  });

  it('collapses and expands a column', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const toggle = screen.getByRole('button', { name: /^Next/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(card('it-zine')).toBeNull();
    fireEvent.click(toggle);
    expect(card('it-zine')).not.toBeNull();
  });

  it('sends nothing for a move to where the card already is', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    await keyboard('it-seed', 'ArrowUp');
    await keyboard('it-seed', 'ArrowLeft');
    expect(writes(env.calls)).toEqual([]);
  });
});

describe('keyboard model', () => {
  it('arrows move focus, a keyboard move keeps focus on the moved card, and M opens the move menu', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    card('it-seed').focus();
    fireEvent.keyDown(card('it-seed'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(card('it-kite'));
    // Across columns focus keeps the row where it can: Considering is empty, so the second card of Next.
    fireEvent.keyDown(card('it-kite'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(card('it-bread'));
    fireEvent.keyDown(card('it-bread'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(card('it-zine'));
    await keyboard('it-zine', 'ArrowRight');
    await screen.findByRole('button', { name: 'Undo' });
    expect(env.byId('it-zine').status).toBe('active');
    expect(document.activeElement).toBe(card('it-zine'));
    await act(async () => { fireEvent.keyDown(card('it-zine'), { key: 'm' }); });
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Move to Active' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('Enter opens the card detail', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    fireEvent.keyDown(card('it-zine'), { key: 'Enter' });
    expect(screen.getByRole('complementary', { name: /Card · Next/ })).toBeTruthy();
  });
});

describe('Undo is consumed once (RW-8)', () => {
  it('Ctrl+Z consumes the entry and removes its toast, so the toast cannot replay it', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const before = env.layout();
    await keyboard('it-kite', 'ArrowRight');
    await screen.findByRole('button', { name: 'Undo' });
    const start = env.calls.length;
    await act(async () => { fireEvent.keyDown(card('it-kite'), { key: 'z', ctrlKey: true }); });
    await waitFor(() => expect(env.layout()).toEqual(before));
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.getByText('Undone: Moved “Sketch a kite frame” to Considering')).toBeTruthy();
    expect(writes(env.calls.slice(start))).toHaveLength(1);
    await act(async () => { fireEvent.keyDown(card('it-kite'), { key: 'z', metaKey: true }); });
    expect(writes(env.calls.slice(start))).toHaveLength(1);
    expect(env.store.getState().undo).toEqual([]);
  });

  it('ignores Ctrl+Z while typing', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} initialOpen="it-zine" />);
    await keyboard('it-kite', 'ArrowRight');
    await screen.findByRole('button', { name: 'Undo' });
    const notes = screen.getByRole('textbox', { name: 'Notes' });
    fireEvent.keyDown(notes, { key: 'z', ctrlKey: true });
    expect(env.store.getState().undo).toHaveLength(1);
  });
});

describe('zero execution (RV-6, RL-10, req.safety.001)', () => {
  it('the port surface is exactly the Planner API, with no execution, export or import member', () => {
    expect([...PLANNER_PORT_KEYS].sort()).toEqual(['create', 'history', 'markReviewed', 'move', 'patch', 'setArchived', 'snapshot', 'updateSettings', 'version']);
    for (const key of PLANNER_PORT_KEYS) expect(key).not.toMatch(/run|exec|dispatch|submit|launch|start|job|send|import|export|backup/iu);
  });

  it('drag, keyboard, menu, detail, capture and following a link call only planning reads and writes', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} drafts={env.drafts} detail={env.detail} />);
    await drag('it-seed', 'inbox', 'next', belowCard(-1));
    await keyboard('it-kite', 'ArrowRight');
    await menu('it-lamp', 'Move to top');
    fireEvent.click(card('it-shed'));
    const panel = screen.getByRole('complementary', { name: /Card · Active/ });
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: /On hold/ })); });
    fireEvent.keyDown(screen.getByTestId('work-root'), { key: 'n' });
    const dialog = screen.getByRole('dialog', { name: 'Capture' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), { target: { value: 'Label the jam jars' } });
    await act(async () => { fireEvent.click(within(dialog).getByRole('button', { name: 'Save' })); });
    const allowed = new Set(['snapshot', 'version', 'move', 'patch', 'create']);
    expect(env.calls.map((c: PortCall) => c.method).filter((m) => !allowed.has(m))).toEqual([]);
    expect(new Set(writes(env.calls).map((c) => c.method))).toEqual(new Set(['move', 'create']));
  });
});

describe('states (ctx.test-plan.001 matrix)', () => {
  it('loading: shows a busy loading view until the first snapshot', async () => {
    const env = await setup({ load: false });
    const never: PlannerPort = { ...env.fixture.port, snapshot: () => new Promise(() => {}) };
    const store = createWorkStore(never);
    render(<Host store={store} feedback={env.feedback} />);
    expect(await screen.findByText('Loading the Planner…')).toBeTruthy();
  });

  it('unavailable before any snapshot: says so, shows nothing stale, and retries on request', async () => {
    const env = await setup({ load: false });
    env.faults.readsUnavailable(true);
    render(<Host store={env.store} feedback={env.feedback} />);
    expect(await screen.findByText('Planner service unreachable')).toBeTruthy();
    expect(card('it-seed')).toBeNull();
    env.faults.readsUnavailable(false);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Try again' })); });
    expect(card('it-seed')).not.toBeNull();
  });

  it('empty: explains the empty board and offers capture', async () => {
    const env = await setup({ items: [] });
    render(<Host store={env.store} feedback={env.feedback} />);
    expect(screen.getByText('No planning items yet')).toBeTruthy();
    expect(screen.getAllByText('No cards').length).toBe(6);
    expect(screen.getByText(PROJECT_SCOPE_NOTE)).toBeTruthy();
  });

  it('offline after a snapshot: keeps the board, marks it stale and paused', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    env.faults.readsUnavailable(true);
    await act(async () => { await env.store.poll(); });
    expect(screen.getByText(`${OFFLINE_BANNER}. What you see may be out of date.`)).toBeTruthy();
    expect(screen.getAllByText('Offline').length).toBeGreaterThan(0);
    expect(card('it-seed')).not.toBeNull();
  });

  it('saving: a move in flight shows Saving… on the card and in the header', async () => {
    const env = await setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const slow: PlannerPort = { ...env.fixture.port, move: async (...args) => { await gate; return env.fixture.port.move(...args); } };
    const store = createWorkStore(slow);
    await store.load();
    render(<Host store={store} feedback={createFeedback()} />);
    await keyboard('it-kite', 'ArrowRight');
    expect(within(card('it-kite')).getByText('Saving…')).toBeTruthy();
    release();
    await screen.findByRole('button', { name: 'Undo' });
    expect(within(card('it-kite')).queryByText('Saving…')).toBeNull();
  });

  it('unknown: a lost response stays Unconfirmed; Check never re-sends it, and without a replay check asks for a read-back', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    env.faults.next('lose-response');
    await keyboard('it-kite', 'ArrowRight');
    expect(within(card('it-kite')).getByText('Unconfirmed')).toBeTruthy();
    expect(screen.getByText(/Move of “Sketch a kite frame” to Considering/)).toBeTruthy();
    expect(screen.getByText(/Check asks the Planner whether it was saved; nothing is re-sent/)).toBeTruthy();
    const sent = writes(env.calls).length;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Check now' })); });
    expect(writes(env.calls)).toHaveLength(sent);
    expect(within(card('it-kite')).getByText('Unconfirmed')).toBeTruthy();
    expect(screen.getByText(/Cannot be checked · this Planner offers no replay check\. Read the board back/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: APPLY_LABEL })).toBeNull();
  });

  it('a same-title item after a lost create is flagged as possibly saved, never as proof', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    env.faults.next('lose-response');
    await act(async () => { await env.store.create({ title: 'Oil the gate' }); });
    await act(async () => { await env.store.load(); });
    expect(screen.getByText('Possibly already saved')).toBeTruthy();
    expect(screen.getByText(new RegExp(POSSIBLY_SAVED_NOTE.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')))).toBeTruthy();
    expect(env.store.getState().unconfirmed).toHaveLength(1);
  });
});

describe('cards', () => {
  it('show words for why, horizon, date and priority, and an overdue deadline in words', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    expect(within(card('it-shed')).getByText('Need')).toBeTruthy();
    expect(within(card('it-shed')).getByText('High')).toBeTruthy();
    expect(within(card('it-zine')).getByText('Soon')).toBeTruthy();
    expect(within(card('it-zine')).getByText('Garden')).toBeTruthy();
    expect(within(card('it-bread')).getByText(/Overdue · Oct 19/)).toBeTruthy();
  });
});
