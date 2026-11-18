import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, type Status } from '../../core';
import { anchorAt, boardColumns, cardKey, moveMenuEntries, resolveMove, type MoveIntent } from '../moves';
import { boardItems, item } from './fixtures';

const columns = boardColumns(boardItems());
const key = (k: string, mods: { altKey?: boolean; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {}) =>
  ({ key: k, altKey: false, shiftKey: false, ctrlKey: false, metaKey: false, ...mods });
const menuIntent = (id: string, label: string) => moveMenuEntries(columns, id).find((e) => e.label === label)!.intent;
const keyIntent = (k: string, status: Status) => {
  const result = cardKey(key(k, { altKey: true }), status);
  if (result?.type !== 'move') throw new Error(`no move for ${k}`);
  return result.intent;
};

describe('anchorAt: one anchor rule for every input', () => {
  it('uses place top at the visible top, place bottom at the visible end, else the upper neighbour', () => {
    expect(anchorAt([], 0)).toEqual({ place: 'top' });
    expect(anchorAt(['a', 'b'], 0)).toEqual({ place: 'top' });
    expect(anchorAt(['a', 'b'], 1)).toEqual({ after_id: 'a' });
    expect(anchorAt(['a', 'b'], 2)).toEqual({ place: 'bottom' });
    expect(anchorAt(['a', 'b'], 9)).toEqual({ place: 'bottom' });
  });
});

describe('resolveMove', () => {
  it('lands a status change at the top of the target, as RW-7 requires', () => {
    expect(resolveMove(columns, 'it-seed', { type: 'status', status: 'next' })).toEqual({ id: 'it-seed', status: 'next', anchor: { place: 'top' } });
  });

  it('steps within the visible column and refuses to step past either end', () => {
    expect(resolveMove(columns, 'it-seed', { type: 'step', delta: 1 })).toEqual({ id: 'it-seed', status: 'inbox', anchor: { after_id: 'it-kite' } });
    expect(resolveMove(columns, 'it-lamp', { type: 'step', delta: -1 })).toEqual({ id: 'it-lamp', status: 'inbox', anchor: { after_id: 'it-seed' } });
    expect(resolveMove(columns, 'it-kite', { type: 'step', delta: -1 })).toEqual({ id: 'it-kite', status: 'inbox', anchor: { place: 'top' } });
    expect(resolveMove(columns, 'it-seed', { type: 'step', delta: -1 })).toBeNull();
    expect(resolveMove(columns, 'it-lamp', { type: 'step', delta: 1 })).toBeNull();
  });

  it('treats a move to the place a card already holds as no move at all', () => {
    expect(resolveMove(columns, 'it-seed', { type: 'status', status: 'inbox' })).toBeNull();
    expect(resolveMove(columns, 'it-seed', { type: 'edge', edge: 'top' })).toBeNull();
    expect(resolveMove(columns, 'it-lamp', { type: 'edge', edge: 'bottom' })).toBeNull();
    expect(resolveMove(columns, 'it-kite', { type: 'drop', status: 'inbox', index: 1 })).toBeNull();
    expect(resolveMove(columns, 'it-unknown', { type: 'status', status: 'next' })).toBeNull();
  });

  it('anchors a cross-column drop between visible neighbours', () => {
    expect(resolveMove(columns, 'it-seed', { type: 'drop', status: 'next', index: 1 })).toEqual({ id: 'it-seed', status: 'next', anchor: { after_id: 'it-zine' } });
    expect(resolveMove(columns, 'it-seed', { type: 'drop', status: 'next', index: 2 })).toEqual({ id: 'it-seed', status: 'next', anchor: { place: 'bottom' } });
    expect(resolveMove(columns, 'it-seed', { type: 'drop', status: 'on_hold', index: 0 })).toEqual({ id: 'it-seed', status: 'on_hold', anchor: { place: 'top' } });
  });

  it('anchors to visible neighbours when filters hide cards, so hidden cards keep their order on the server', () => {
    const filtered = boardColumns(boardItems(), { ...EMPTY_FILTERS, motivation: 'want' });
    expect(filtered.inbox.map((i) => i.id)).toEqual(['it-kite']);
    expect(resolveMove(filtered, 'it-kite', { type: 'step', delta: -1 })).toBeNull();
    expect(resolveMove(filtered, 'it-kite', { type: 'status', status: 'next' })).toEqual({ id: 'it-kite', status: 'next', anchor: { place: 'top' } });
  });

  it('leaves archived items off the board', () => {
    const board = boardColumns([...boardItems(), item('it-old', 'Old plan', 'inbox', 512, { archived_at: '2026-10-02T00:00:00.000Z' })]);
    expect(board.inbox.map((i) => i.id)).toEqual(['it-seed', 'it-kite', 'it-lamp']);
  });
});

describe('drag, keyboard and menu resolve to identical move requests', () => {
  const cases: { name: string; id: string; status: Status; drag: MoveIntent; keyboard: MoveIntent; menu: MoveIntent }[] = [
    { name: 'status change to the next column', id: 'it-kite', status: 'inbox', drag: { type: 'drop', status: 'considering', index: 0 }, keyboard: keyIntent('ArrowRight', 'inbox'), menu: menuIntent('it-kite', 'Move to Considering') },
    { name: 'status change into a non-empty column', id: 'it-shed', status: 'active', drag: { type: 'drop', status: 'next', index: 0 }, keyboard: keyIntent('ArrowLeft', 'active'), menu: menuIntent('it-shed', 'Move to Next') },
    { name: 'reorder down one', id: 'it-seed', status: 'inbox', drag: { type: 'drop', status: 'inbox', index: 1 }, keyboard: keyIntent('ArrowDown', 'inbox'), menu: menuIntent('it-seed', 'Move down') },
    { name: 'reorder up one to the top', id: 'it-kite', status: 'inbox', drag: { type: 'drop', status: 'inbox', index: 0 }, keyboard: keyIntent('ArrowUp', 'inbox'), menu: menuIntent('it-kite', 'Move up') },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const drag = resolveMove(columns, c.id, c.drag);
      expect(drag).not.toBeNull();
      expect(resolveMove(columns, c.id, c.keyboard)).toEqual(drag);
      expect(resolveMove(columns, c.id, c.menu)).toEqual(drag);
    });
  }

  it('menu Move to top / bottom equal a drag to the visible top / end', () => {
    expect(resolveMove(columns, 'it-lamp', menuIntent('it-lamp', 'Move to top'))).toEqual(resolveMove(columns, 'it-lamp', { type: 'drop', status: 'inbox', index: 0 }));
    expect(resolveMove(columns, 'it-seed', menuIntent('it-seed', 'Move to bottom'))).toEqual(resolveMove(columns, 'it-seed', { type: 'drop', status: 'inbox', index: 2 }));
  });
});

describe('cardKey', () => {
  it('maps Alt+arrows to moves, plain arrows to focus, M to the menu and Enter to open', () => {
    expect(cardKey(key('ArrowRight', { altKey: true }), 'inbox')).toEqual({ type: 'move', intent: { type: 'status', status: 'considering' } });
    expect(cardKey(key('ArrowLeft', { altKey: true }), 'inbox')).toBeNull();
    expect(cardKey(key('ArrowRight', { altKey: true }), 'dropped')).toBeNull();
    expect(cardKey(key('ArrowUp', { altKey: true }), 'next')).toEqual({ type: 'move', intent: { type: 'step', delta: -1 } });
    expect(cardKey(key('ArrowDown'), 'next')).toEqual({ type: 'focus', axis: 'card', delta: 1 });
    expect(cardKey(key('ArrowLeft'), 'next')).toEqual({ type: 'focus', axis: 'column', delta: -1 });
    expect(cardKey(key('m'), 'next')).toEqual({ type: 'menu' });
    expect(cardKey(key('M'), 'next')).toEqual({ type: 'menu' });
    expect(cardKey(key('Enter'), 'next')).toEqual({ type: 'open' });
    expect(cardKey(key('z', { ctrlKey: true }), 'next')).toBeNull();
    expect(cardKey(key('ArrowDown', { metaKey: true, altKey: true }), 'next')).toBeNull();
  });
});

describe('moveMenuEntries', () => {
  it('lists every status, the current one disabled, then up, down, top and bottom', () => {
    const entries = moveMenuEntries(columns, 'it-seed');
    expect(entries.map((e) => e.label)).toEqual([
      'Move to Inbox', 'Move to Considering', 'Move to Next', 'Move to Active', 'Move to On hold', 'Move to Done', 'Move to Dropped',
      'Move up', 'Move down', 'Move to top', 'Move to bottom',
    ]);
    expect(entries.filter((e) => e.disabled).map((e) => e.label)).toEqual(['Move to Inbox', 'Move up', 'Move to top']);
  });
});
