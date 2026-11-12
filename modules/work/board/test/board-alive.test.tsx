import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createWorkStore, EMPTY_FILTERS, STATUS_IDS, useWorkState, type Filters, type Status, type WorkStore } from '../../core';
import type { Feedback } from '../feedback';
import { StatusBoard } from '../StatusBoard';
import { fixedNow } from './fixtures';
import { moveShape, setup, writes } from './fixtures';
import { belowCard, columnX, Host, syntheticLayout } from './host';

// The board made alive (flow assessment D-1, D-2, X-4 and the capture landing): the Done control, drag physics (lift,
// placeholder, drop badge, settle, Escape flight, refused shake), the capture landing, narrow status tabs, rails and
// the scroll affordance. happy-dom has no layout or Web Animations, so geometry is synthetic and `animate` is a spy.

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-hq-motion');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

const card = (id: string) => document.querySelector<HTMLElement>(`[data-card-id="${id}"]`)!;
const ghost = () => document.querySelector<HTMLElement>('.work-drag-ghost');
const badge = () => document.querySelector('.work-drag-badge')?.textContent;
const done = (title: string) => screen.queryByRole('button', { name: `Mark “${title}” done` });

interface PendingAnimation { target: HTMLElement; keyframes: Keyframe[]; options: KeyframeAnimationOptions; finish(): void }

/** A Web Animations stand-in: records each `animate` call and lets the test finish it. */
function spyOnAnimate() {
  const calls: PendingAnimation[] = [];
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true, writable: true,
    value: function (this: HTMLElement, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const listeners = new Map<string, () => void>();
      let resolveFinished!: () => void;
      const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
      calls.push({ target: this, keyframes, options, finish: () => { listeners.get('finish')?.(); resolveFinished(); } });
      return { finished, addEventListener: (type: string, fn: () => void) => { listeners.set(type, fn); }, cancel: () => listeners.get('cancel')?.() };
    },
  });
  return calls;
}

const start = (from: Status) => ({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: columnX(from), clientY: 120 });

/** Picks a card up and carries it over `to` at height `y`, leaving the pointer down. */
async function lift(id: string, from: Status, to: Status, y: number) {
  const first = start(from);
  await act(async () => {
    fireEvent.pointerDown(card(id), first);
    fireEvent.pointerMove(window, { ...first, clientX: first.clientX + 12 });
    fireEvent.pointerMove(window, { ...first, clientX: columnX(to), clientY: y });
  });
}
const release = (to: Status, y: number) => act(async () => { fireEvent.pointerUp(window, { ...start('inbox'), clientX: columnX(to), clientY: y }); });

describe('the Done control (D-1)', () => {
  it('is named for its card, shows on every open card, and moves it to the top of Done with Undo', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const before = env.layout();
    const button = done('Sketch a kite frame')!;
    expect(button).toBeTruthy();
    expect(card('it-kite').contains(button)).toBe(true);
    await act(async () => { fireEvent.click(button); });
    await screen.findByRole('button', { name: 'Undo' });
    expect(writes(env.calls).map(moveShape)).toEqual([{ method: 'move', args: ['it-kite', 1, 'done', { place: 'top' }] }]);
    expect(env.order('done')).toEqual(['it-kite', 'it-bike']);
    expect(screen.getByRole('group', { name: 'Moved “Sketch a kite frame” to Done' })).toBeTruthy();
    // The card stays in the board, now under Done and without the control.
    expect(within(document.querySelector('[data-drop-status="done"]')!).getByText('Sketch a kite frame')).toBeTruthy();
    expect(done('Sketch a kite frame')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })); });
    await waitFor(() => expect(env.layout()).toEqual(before));
  });

  it('is absent on Done and Dropped cards', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    expect(done('Tune the bicycle')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Dropped/ }));
    expect(card('it-pond')).not.toBeNull();
    expect(done('Dig a pond')).toBeNull();
    expect(done('Sort the seed packets')).toBeTruthy();
  });

  it('is a real button in the tab order that activates once and never opens the card', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const button = done('Fix the porch lamp')!;
    expect(button.tabIndex).toBeGreaterThanOrEqual(0);
    button.focus();
    expect(document.activeElement).toBe(button);
    await act(async () => { fireEvent.click(button); });
    await screen.findByRole('button', { name: 'Undo' });
    expect(writes(env.calls)).toHaveLength(1);
    expect(screen.queryByRole('complementary', { name: /Card ·/ })).toBeNull();
  });

  it('never starts a drag from the Done control or the move menu button', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const layout = syntheticLayout();
    try {
      for (const control of [done('Sort the seed packets')!, screen.getByRole('button', { name: 'Move “Sort the seed packets”' })]) {
        await act(async () => {
          fireEvent.pointerDown(control, start('inbox'));
          fireEvent.pointerMove(window, { ...start('inbox'), clientX: columnX('inbox') + 40 });
          fireEvent.pointerMove(window, { ...start('inbox'), clientX: columnX('next'), clientY: 150 });
        });
        expect(ghost()).toBeNull();
        expect(document.querySelector('[data-dragging="true"]')).toBeNull();
        await act(async () => { fireEvent.pointerUp(window, start('inbox')); });
      }
    } finally { layout.mockRestore(); }
    expect(writes(env.calls)).toEqual([]);
  });
});

describe('capture landing', () => {
  it('marks the Inbox card list as the capture target, once, and only the Inbox', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const targets = document.querySelectorAll('[data-wk-capture-target]');
    expect(targets).toHaveLength(1);
    expect(targets[0]!.getAttribute('data-wk-capture-target')).toBe('inbox');
    expect(targets[0]!.closest('[data-drop-status]')!.getAttribute('data-drop-status')).toBe('inbox');
    expect(within(targets[0] as HTMLElement).getByText('Sort the seed packets')).toBeTruthy();
  });

  it('animates nothing on first load, on a load after first render, or on remount', async () => {
    const first = await setup({ load: false });
    render(<Host store={first.store} feedback={first.feedback} />);
    await act(async () => { await first.store.load(); });
    expect(card('it-seed')).not.toBeNull();
    expect(document.querySelectorAll('.hq-enter-rise, .hq-flash')).toHaveLength(0);
    cleanup();
    const env = await setup();
    await act(async () => { await env.store.create({ title: 'Oil the gate' }); });
    render(<Host store={env.store} feedback={env.feedback} />);
    expect(screen.getByText('Oil the gate')).toBeTruthy();
    expect(document.querySelectorAll('.hq-enter-rise, .hq-flash')).toHaveLength(0);
  });

  it('a card that appears in Inbox after first render rises into place and the Inbox flashes', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    expect(document.querySelectorAll('.hq-enter-rise, .hq-flash')).toHaveLength(0);
    await act(async () => { await env.store.create({ title: 'Oil the gate' }); });
    const landed = within(document.querySelector('[data-wk-capture-target="inbox"]') as HTMLElement).getByText('Oil the gate').closest('li')!;
    expect(landed.classList.contains('hq-enter-rise')).toBe(true);
    expect(document.querySelector('[data-drop-status="inbox"]')!.classList.contains('hq-flash')).toBe(true);
    // Only the new card rises; the cards that were already there stay still.
    expect([...document.querySelectorAll('.hq-enter-rise')]).toEqual([landed]);
    expect(document.querySelector('[data-drop-status="next"]')!.classList.contains('hq-flash')).toBe(false);
  });

  it('a filter change brings cards back without treating them as new', async () => {
    const env = await setup();
    function Filtered({ store, feedback, filters }: { store: WorkStore; feedback: Feedback; filters: Filters }) {
      const state = useWorkState(store, { pollMs: 1e9 });
      return <StatusBoard store={store} state={state} feedback={feedback} filters={filters} now={fixedNow} onOpenItem={() => {}} onCapture={() => {}} />;
    }
    const { rerender } = render(<Filtered store={env.store} feedback={env.feedback} filters={EMPTY_FILTERS} />);
    rerender(<Filtered store={env.store} feedback={env.feedback} filters={{ ...EMPTY_FILTERS, q: 'seed' }} />);
    expect(card('it-kite')).toBeNull();
    rerender(<Filtered store={env.store} feedback={env.feedback} filters={EMPTY_FILTERS} />);
    expect(card('it-kite')).not.toBeNull();
    expect(document.querySelectorAll('.hq-enter-rise, .hq-flash')).toHaveLength(0);
  });
});

describe('drag physics (D-2)', () => {
  it('lifts the card into a ghost with the drop badge, keeps its slot as a placeholder, and opens a gap at the target', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const layout = syntheticLayout();
    try {
      await lift('it-seed', 'inbox', 'next', belowCard(0));
      const lifted = ghost()!;
      expect(lifted).not.toBeNull();
      expect(lifted.getAttribute('aria-hidden')).toBe('true');
      expect(within(lifted).getByText('Sort the seed packets')).toBeTruthy();
      expect(badge()).toBe('Move to Next');
      // The source keeps its slot as a dashed placeholder; a gap opens in Next after its first card.
      expect(card('it-seed').classList.contains('work-card--source')).toBe(true);
      const gap = document.querySelector('[data-drop-status="next"] [data-drop-placeholder]')!;
      expect(gap).not.toBeNull();
      expect(gap.previousElementSibling!.querySelector('[data-card-id]')!.getAttribute('data-card-id')).toBe('it-zine');
      expect(document.querySelector('[data-drop-status="next"]')!.getAttribute('data-drop-target')).toBe('true');
      // The ghost follows the pointer through CSSOM, with a tilt, never a style attribute.
      expect(lifted.style.getPropertyValue('transform')).toMatch(/translate3d\(.+\) rotate\(.+deg\)/);
    } finally { layout.mockRestore(); }
  });

  it('names the effect: reorder in the same column, stays over its own slot, move across columns', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const layout = syntheticLayout();
    try {
      await lift('it-seed', 'inbox', 'inbox', belowCard(1));
      expect(badge()).toBe('Reorder in Inbox');
      await act(async () => { fireEvent.pointerMove(window, { ...start('inbox'), clientX: columnX('inbox'), clientY: belowCard(-1) }); });
      expect(badge()).toBe('Stays in Inbox');
      expect(card('it-seed').getAttribute('data-slot-active')).toBe('true');
      expect(document.querySelector('[data-drop-placeholder]')).toBeNull();
      await act(async () => { fireEvent.pointerMove(window, { ...start('inbox'), clientX: columnX('active'), clientY: belowCard(-1) }); });
      expect(badge()).toBe('Move to Active');
      await act(async () => { fireEvent.pointerMove(window, { ...start('inbox'), clientX: 9000, clientY: 120 }); });
      expect(badge()).toBe('Drop on a column');
    } finally { layout.mockRestore(); }
  });

  it('settles the ghost into the landing slot with the spring, then reveals and flashes the landed card', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const animations = spyOnAnimate();
    const layout = syntheticLayout();
    try {
      await lift('it-seed', 'inbox', 'next', belowCard(-1));
      await release('next', belowCard(-1));
      await screen.findByRole('button', { name: 'Undo' });
      expect(writes(env.calls).map(moveShape)).toEqual([{ method: 'move', args: ['it-seed', 1, 'next', { place: 'top' }] }]);
      // The card is hidden under its ghost until it lands.
      expect(card('it-seed').closest('li')!.getAttribute('data-landing')).toBe('true');
      await waitFor(() => expect(animations.some((a) => a.target === ghost())).toBe(true));
      const settle = animations.find((a) => a.target === ghost())!;
      expect(String(settle.options.easing)).toMatch(/^linear\(/);
      expect(settle.options.duration).toBe(240);
      await act(async () => { settle.finish(); });
      expect(ghost()).toBeNull();
      expect(card('it-seed').closest('li')!.getAttribute('data-landing')).toBeNull();
      expect(card('it-seed').classList.contains('hq-flash')).toBe(true);
      expect(env.order('next')).toEqual(['it-seed', 'it-zine', 'it-bread']);
    } finally { layout.mockRestore(); }
  });

  it('Escape cancels: nothing is written, the ghost flies back to its origin and the board is as it was', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const before = env.layout();
    const animations = spyOnAnimate();
    const layout = syntheticLayout();
    try {
      await lift('it-seed', 'inbox', 'next', belowCard(-1));
      expect(ghost()).not.toBeNull();
      await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
      // It flies to the source card's slot: column 0, first card, so (8, 100) in the synthetic layout.
      const flight = animations.find((a) => a.target === ghost())!;
      expect(JSON.stringify(flight.keyframes)).toContain('translate(8px, 100px)');
      expect(document.querySelector('[data-drop-placeholder]')).toBeNull();
      expect(document.querySelector('[data-dragging="true"]')).toBeNull();
      await act(async () => { flight.finish(); });
      expect(ghost()).toBeNull();
      expect(screen.getByText('Drag cancelled. Nothing moved.')).toBeTruthy();
    } finally { layout.mockRestore(); }
    expect(writes(env.calls)).toEqual([]);
    expect(env.layout()).toEqual(before);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(card('it-seed').closest('li')!.getAttribute('data-landing')).toBeNull();
  });

  it('Escape in a plain environment (no animation support) also leaves nothing behind', async () => {
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: undefined });
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const layout = syntheticLayout();
    try {
      await lift('it-kite', 'inbox', 'considering', belowCard(-1));
      await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }); });
    } finally { layout.mockRestore(); }
    expect(ghost()).toBeNull();
    expect(writes(env.calls)).toEqual([]);
    expect(env.order('inbox')).toEqual(['it-seed', 'it-kite', 'it-lamp']);
  });

  it('reduced motion drops immediately: no ghost, no settle animation, and the landed card still flashes', async () => {
    document.documentElement.setAttribute('data-hq-motion', 'reduce');
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const animations = spyOnAnimate();
    const layout = syntheticLayout();
    try {
      await lift('it-seed', 'inbox', 'next', belowCard(-1));
      expect(ghost()!.style.getPropertyValue('transform')).toMatch(/rotate\(0deg\)/);
      await release('next', belowCard(-1));
      expect(ghost()).toBeNull();
      expect(card('it-seed').closest('li')!.getAttribute('data-landing')).toBeNull();
      await screen.findByRole('button', { name: 'Undo' });
      await waitFor(() => expect(card('it-seed').classList.contains('hq-flash')).toBe(true));
    } finally { layout.mockRestore(); }
    expect(animations).toEqual([]);
    expect(env.order('next')[0]).toBe('it-seed');
  });

  it('keeps Alt+arrows calling preventDefault and gliding keyboard moves through the same single write', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const animations = spyOnAnimate();
    const layout = syntheticLayout();
    card('it-kite').focus();
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true, cancelable: true });
    await act(async () => { card('it-kite').dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    await screen.findByRole('button', { name: 'Undo' });
    expect(writes(env.calls)).toHaveLength(1);
    expect(env.byId('it-kite').status).toBe('considering');
    expect(document.activeElement).toBe(card('it-kite'));
    // The moved card glides (list motion runs a transform animation on its slot).
    expect(animations.some((a) => a.target === card('it-kite').closest('li') && JSON.stringify(a.keyframes).includes('translate('))).toBe(true);
    layout.mockRestore();
  });

  it('shakes the card once when a move is refused', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const animations = spyOnAnimate();
    // A move to a card that has gone from the Planner is refused (not_found); the board rolls back.
    await act(async () => { await env.device.move('it-kite', 1, 'next', { place: 'top' }, 'other-000001'); });
    card('it-kite').focus();
    await act(async () => { fireEvent.keyDown(card('it-kite'), { key: 'ArrowRight', altKey: true }); });
    await waitFor(() => expect(animations.some((a) => a.target === card('it-kite') && JSON.stringify(a.keyframes).includes('translateX(-5px)'))).toBe(true));
    expect(animations.filter((a) => JSON.stringify(a.keyframes).includes('translateX(-5px)'))).toHaveLength(1);
  });
});

describe('collapsed rails', () => {
  it('draws a collapsed column as a rail with a count pill, and it highlights while a card is over it', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const rail = document.querySelector<HTMLElement>('[data-drop-status="dropped"]')!;
    expect(rail.getAttribute('data-collapsed')).toBe('true');
    expect(rail.classList.contains('work-col--rail')).toBe(true);
    const toggle = within(rail).getByRole('button', { name: /^Dropped/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(rail.querySelector('.work-col-count')!.textContent).toBe('1');
    expect(within(rail).queryByRole('button', { name: /Add a card/ })).toBeNull();
    const layout = syntheticLayout();
    try {
      await lift('it-seed', 'inbox', 'dropped', 900);
      expect(rail.getAttribute('data-drop-target')).toBe('true');
      expect(badge()).toBe('Move to Dropped');
      await release('dropped', 900);
    } finally { layout.mockRestore(); }
    await screen.findByRole('button', { name: 'Undo' });
    expect(writes(env.calls).map(moveShape)).toEqual([{ method: 'move', args: ['it-seed', 1, 'dropped', { place: 'top' }] }]);
  });

  it('Done and Dropped can both collapse to rails that keep their counts', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    fireEvent.click(screen.getByRole('button', { name: /^Done/ }));
    const done = document.querySelector<HTMLElement>('[data-drop-status="done"]')!;
    expect(done.getAttribute('data-collapsed')).toBe('true');
    expect(done.querySelector('.work-col-count')!.textContent).toBe('1');
  });
});

describe('narrow layout: status tabs', () => {
  function narrow(width = 500) {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const rect = (x: number, y: number, w: number, h: number) => ({ x, y, left: x, top: y, width: w, height: h, right: x + w, bottom: y + h, toJSON: () => ({}) }) as DOMRect;
      if (this.classList.contains('work-board')) return rect(0, 0, width, 900);
      if (this.dataset.dropTab) return rect(STATUS_IDS.indexOf(this.dataset.dropTab as Status) * 90, 0, 86, 32);
      if (this.dataset.dropStatus) return rect(0, 80, width - 20, 2000);
      if (this.dataset.cardId) {
        const index = [...this.closest('[data-drop-status]')!.querySelectorAll('[data-card-id]')].indexOf(this);
        return rect(8, 100 + index * 80, width - 40, 70);
      }
      return rect(0, 0, 0, 0);
    });
  }

  it('shows status tabs with counts and one column at a time when the board is under 640px', async () => {
    const env = await setup();
    const layout = narrow();
    render(<Host store={env.store} feedback={env.feedback} />);
    const tabs = screen.getByRole('tablist', { name: 'Status' });
    const names = within(tabs).getAllByRole('tab').map((tab) => tab.textContent);
    expect(names).toEqual(['Inbox3', 'Considering0', 'Next2', 'Active1', 'On hold0', 'Done1', 'Dropped1']);
    expect(within(tabs).getByRole('tab', { name: /^Inbox/ }).getAttribute('aria-selected')).toBe('true');
    // One column: Inbox. The others are not rendered; the scroll controls are not either.
    expect(document.querySelectorAll('[data-drop-status]')).toHaveLength(1);
    expect(card('it-seed')).not.toBeNull();
    expect(card('it-zine')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show more columns' })).toBeNull();
    fireEvent.click(within(tabs).getByRole('tab', { name: /^Next/ }));
    expect(card('it-zine')).not.toBeNull();
    expect(card('it-seed')).toBeNull();
    expect(screen.getByRole('tabpanel', { name: /^Next/ })).toBeTruthy();
    layout.mockRestore();
  });

  it('is the wide board with no tabs when the board has room', async () => {
    const env = await setup();
    const layout = narrow(900);
    render(<Host store={env.store} feedback={env.feedback} />);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(document.querySelectorAll('[data-drop-status]')).toHaveLength(7);
    layout.mockRestore();
  });

  it('accepts a move by dropping a card on a status tab, highlighting the tab while it is over it', async () => {
    const env = await setup();
    const layout = narrow();
    render(<Host store={env.store} feedback={env.feedback} />);
    const next = screen.getByRole('tab', { name: /^Next/ });
    const first = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 120 };
    await act(async () => {
      fireEvent.pointerDown(card('it-seed'), first);
      fireEvent.pointerMove(window, { ...first, clientX: 112 });
      fireEvent.pointerMove(window, { ...first, clientX: 2 * 90 + 40, clientY: 16 });
    });
    expect(next.getAttribute('data-drop-target')).toBe('true');
    expect(badge()).toBe('Move to Next');
    expect(document.querySelector('[data-drop-placeholder]')).toBeNull();
    await act(async () => { fireEvent.pointerUp(window, { ...first, clientX: 2 * 90 + 40, clientY: 16 }); });
    await screen.findByRole('button', { name: 'Undo' });
    expect(writes(env.calls).map(moveShape)).toEqual([{ method: 'move', args: ['it-seed', 1, 'next', { place: 'top' }] }]);
    expect(env.order('next')[0]).toBe('it-seed');
    expect(next.getAttribute('data-drop-target')).toBeNull();
    layout.mockRestore();
  });

  it('dropping a card on its own status tab changes nothing', async () => {
    const env = await setup();
    const layout = narrow();
    render(<Host store={env.store} feedback={env.feedback} />);
    const first = { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 120 };
    await act(async () => {
      fireEvent.pointerDown(card('it-kite'), first);
      fireEvent.pointerMove(window, { ...first, clientX: 112 });
      fireEvent.pointerMove(window, { ...first, clientX: 40, clientY: 16 });
      fireEvent.pointerUp(window, { ...first, clientX: 40, clientY: 16 });
    });
    expect(writes(env.calls)).toEqual([]);
    layout.mockRestore();
  });

  it('a keyboard status move follows the card to its tab and keeps focus on it', async () => {
    const env = await setup();
    const layout = narrow();
    render(<Host store={env.store} feedback={env.feedback} />);
    card('it-kite').focus();
    await act(async () => { fireEvent.keyDown(card('it-kite'), { key: 'ArrowRight', altKey: true }); });
    await screen.findByRole('button', { name: 'Undo' });
    expect(screen.getByRole('tab', { selected: true }).textContent).toMatch(/^Considering/);
    expect(document.activeElement).toBe(card('it-kite'));
    layout.mockRestore();
  });

  it('arrow keys on the tab list move between statuses', async () => {
    const env = await setup();
    const layout = narrow();
    render(<Host store={env.store} feedback={env.feedback} />);
    const inbox = screen.getByRole('tab', { name: /^Inbox/ });
    inbox.focus();
    fireEvent.keyDown(inbox, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { selected: true }).textContent).toMatch(/^Considering/);
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /^Considering/ }));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(screen.getByRole('tab', { selected: true }).textContent).toMatch(/^Dropped/);
    expect(writes(env.calls)).toEqual([]);
    layout.mockRestore();
  });
});

describe('scroll affordance and keyboard hint', () => {
  it('offers keyboard-reachable controls and an edge fade when columns overflow, and none when they fit', async () => {
    const env = await setup();
    const { unmount } = render(<Host store={env.store} feedback={env.feedback} />);
    const fits = document.querySelector('.work-columns')!;
    expect(fits.getAttribute('data-more')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show more columns' }).hasAttribute('disabled')).toBe(true);
    unmount();
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get(this: HTMLElement) { return this.classList.contains('work-columns') ? 2400 : 0; } });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get(this: HTMLElement) { return this.classList.contains('work-columns') ? 900 : 0; } });
    try {
      render(<Host store={env.store} feedback={env.feedback} />);
      const columns = document.querySelector<HTMLElement>('.work-columns')!;
      expect(columns.getAttribute('data-more')).toBe('end');
      const more = screen.getByRole('button', { name: 'Show more columns' });
      expect(more.hasAttribute('disabled')).toBe(false);
      expect(more.tabIndex).toBe(0);
      const scrollBy = vi.fn();
      columns.scrollBy = scrollBy as unknown as typeof columns.scrollBy;
      fireEvent.click(more);
      expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 720 }));
      columns.scrollLeft = 300;
      fireEvent.scroll(columns);
      expect(columns.getAttribute('data-more')).toBe('start end');
      expect(screen.getByRole('button', { name: 'Show earlier columns' }).hasAttribute('disabled')).toBe(false);
      expect(writes(env.calls)).toEqual([]);
    } finally {
      delete (HTMLElement.prototype as { scrollWidth?: unknown }).scrollWidth;
      delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth;
    }
  });

  it('replaces the keyboard paragraph with a Keyboard button and popover, keeping the card description for screen readers', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    expect(document.getElementById('work-board-keys')!.textContent).toContain('Alt+←/→ changes status');
    expect(card('it-seed').getAttribute('aria-describedby')).toBe('work-board-keys');
    expect(screen.queryByText(/Drag a card, or use its Move menu/)).not.toBeNull();
    const button = screen.getByRole('button', { name: /^Keyboard/ });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    const panel = screen.getByRole('group', { name: 'Board keyboard shortcuts' });
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(within(panel).getByText('Change status')).toBeTruthy();
    expect(within(panel).getByText('Cancel a drag')).toBeTruthy();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Board keyboard shortcuts' })).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it('puts a titled page header over the columns: counts and the project-scope note, with no stacked paragraphs', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const heading = screen.getByRole('heading', { level: 2, name: 'Status board' });
    const header = heading.closest('header')!;
    expect(within(header).getByText('8 cards')).toBeTruthy();
    expect(within(header).getByText('Planner items aren’t project-scoped · showing all planning')).toBeTruthy();
    expect(header.querySelectorAll('p')).toHaveLength(1);
  });

  it('shows a board-shaped skeleton while loading, and says so in words', async () => {
    const env = await setup({ load: false });
    const never = { ...env.fixture.port, snapshot: () => new Promise<never>(() => {}) };
    const store = createWorkStore(never);
    const { container } = render(<Host store={store} feedback={env.feedback} />);
    expect(screen.getByText('Loading the Planner…')).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"] .work-skeleton-col')).not.toBeNull();
    expect(container.querySelectorAll('.work-skeleton-card').length).toBeGreaterThan(4);
  });
});


describe('shell Back chord ownership', () => {
  it('reserves Alt+Left at Inbox without a move or navigation', async () => {
    const env = await setup();
    render(<Host store={env.store} feedback={env.feedback} />);
    const target = card('it-kite');
    expect(target).toBeTruthy();
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true });
    await act(async () => { target.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    expect(writes(env.calls)).toEqual([]);
    expect(env.order('inbox')).toContain('it-kite');
  });
});
