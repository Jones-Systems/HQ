/** Pure playback presentation: step direction, the followed link, keyboard targets, notices and version chips. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hotspotId, screenId, type ScreenId } from '../src/contract.ts';
import { createPlayer, type PlayerAction, type PlayerState } from '../src/player.ts';
import {
  bindingText, lastMove, moveDirection, pinChips, playerNotice, screenNames, screenSequence, shortVersion, stepTarget, stripJoins, traversedEdge,
  type VersionPin,
} from '../src/presentation.ts';
import { checkout } from './fixtures.ts';

const flow = checkout();
const player = createPlayer(flow);
const order = screenSequence(flow).map((screen) => screen.id);
const activate = (id: string): PlayerAction => ({ type: 'activate', hotspotId: hotspotId(id) });
const show = (id: string): PlayerAction => ({ type: 'start', screenId: screenId(id) });
const run = (...actions: readonly PlayerAction[]): PlayerState => actions.reduce(player.reduce, player.initial());

describe('lastMove', () => {
  it('starts with the opening of the start screen and no previous screen', () => {
    assert.deepEqual(lastMove(run().steps), { index: 0, kind: 'entered', from: null, to: 'cart', edgeId: null });
  });

  it('records the hotspot that was followed and the screen it left', () => {
    assert.deepEqual(lastMove(run(activate('h-checkout')).steps), { index: 1, kind: 'navigated', from: 'cart', to: 'checkout', edgeId: 'h-checkout' });
  });

  it('is unchanged by steps that leave the screen where it was', () => {
    const moved = run(activate('h-checkout'));
    const after = run(activate('h-checkout'), activate('h-pay'), activate('h-receipt'), activate('h-promo'));
    assert.equal(lastMove(moved.steps)!.to, 'checkout');
    assert.deepEqual(lastMove(after.steps), { index: 2, kind: 'navigated', from: 'checkout', to: 'done', edgeId: 'h-pay' }, 'broken targets do not move');
    const exit = run(activate('h-help'));
    assert.equal(lastMove(exit.steps)!.index, 0, 'an exit keeps the opening as the last move');
  });

  it('reports Back as a move to the screen before it', () => {
    assert.deepEqual(lastMove(run(activate('h-checkout'), { type: 'back' }).steps), { index: 2, kind: 'back', from: 'checkout', to: 'cart', edgeId: null });
  });
});

describe('moveDirection', () => {
  it('does not move for the first screen or a repeat of the same screen', () => {
    assert.equal(moveDirection(order, lastMove(run().steps)), 'none');
    assert.equal(moveDirection(order, lastMove(run(show('cart')).steps)), 'none');
    assert.equal(moveDirection(order, null), 'none');
  });

  it('goes forward for Next and for a link to a later screen', () => {
    const [first, second] = order;
    assert.equal(moveDirection(order, lastMove(run(show(second!)).steps)), 'forward', `${first} → ${second} as Next`);
    assert.equal(moveDirection(order, lastMove(run(activate('h-checkout')).steps)), 'forward');
  });

  it('goes back for Previous, for Back, and for a link to an earlier screen', () => {
    assert.equal(moveDirection(order, lastMove(run(show('done'), show('cart')).steps)), 'back', 'Previous or Start');
    assert.equal(moveDirection(order, lastMove(run(activate('h-checkout'), { type: 'back' }).steps)), 'back', 'Back always arrives from the start side');
    const state = run(activate('h-checkout'), activate('h-decline'), activate('h-retry'));
    assert.equal(state.current, 'checkout');
    assert.equal(moveDirection(order, lastMove(state.steps)), 'back', 'checkout-error links to the earlier checkout');
  });

  it('does not guess when a screen is not in the list', () => {
    assert.equal(moveDirection(order.slice(1), { index: 1, kind: 'navigated', from: 'cart' as ScreenId, to: 'checkout' as ScreenId, edgeId: null }), 'none');
  });
});

describe('traversedEdge', () => {
  const edges = player.edges;

  it('is the hotspot that was followed', () => {
    assert.deepEqual(traversedEdge(edges, lastMove(run(activate('h-checkout')).steps)), { edgeId: 'h-checkout', index: 1, reverse: false });
    assert.deepEqual(traversedEdge(edges, lastMove(run(activate('h-checkout'), activate('h-pay')).steps)), { edgeId: 'h-pay', index: 2, reverse: false });
  });

  it('matches a move through the player chrome to a link between the same two screens', () => {
    assert.deepEqual(traversedEdge(edges, lastMove(run(show('checkout')).steps)), { edgeId: 'h-checkout', index: 1, reverse: false }, 'Next along a link');
    assert.deepEqual(traversedEdge(edges, lastMove(run(show('checkout'), show('cart')).steps)), { edgeId: 'h-checkout', index: 2, reverse: true }, 'Previous against a link');
  });

  it('draws Back against the link that led here', () => {
    assert.deepEqual(traversedEdge(edges, lastMove(run(activate('h-checkout'), { type: 'back' }).steps)), { edgeId: 'h-checkout', index: 2, reverse: true });
  });

  it('draws nothing for the first screen, a repeat, or screens with no link between them', () => {
    assert.equal(traversedEdge(edges, lastMove(run().steps)), null);
    assert.equal(traversedEdge(edges, lastMove(run(show('cart')).steps)), null);
    assert.equal(traversedEdge(edges, lastMove(run(show('done')).steps)), null, 'cart has no link to done');
    assert.equal(traversedEdge(edges, null), null);
  });

  it('keeps the last followed link after a step that stayed on the screen', () => {
    const state = run(activate('h-checkout'), activate('h-pay'), activate('h-receipt'));
    assert.deepEqual(traversedEdge(edges, lastMove(state.steps)), { edgeId: 'h-pay', index: 2, reverse: false });
  });
});

describe('stripJoins', () => {
  it('draws an arrow only where a recorded link joins neighbours', () => {
    const joins = stripJoins(order, player.edges);
    assert.equal(joins.length, order.length - 1);
    for (const [n, join] of joins.entries()) {
      const a = order[n]!, b = order[n + 1]!;
      const forward = player.edges.some((edge) => edge.from === a && edge.resolution.status === 'ok' && edge.resolution.to === b);
      const back = player.edges.some((edge) => edge.from === b && edge.resolution.status === 'ok' && edge.resolution.to === a);
      assert.equal(join, forward ? 'forward' : back ? 'back' : 'order', `${a} and ${b}`);
    }
    assert.ok(joins.includes('forward'), 'the fixture links some neighbours');
  });

  it('joins everything by order alone when no links are recorded', () => {
    const unlinked = { ...flow, hotspots: [] };
    const sequence = screenSequence(unlinked).map((screen) => screen.id);
    assert.deepEqual(stripJoins(sequence, createPlayer(unlinked).edges), sequence.slice(1).map(() => 'order'));
  });
});

describe('stepTarget', () => {
  const ids = ['a', 'b', 'c'] as ScreenId[];

  it('moves one screen with the arrow keys and stops at the ends', () => {
    assert.equal(stepTarget(ids, 'b' as ScreenId, 'ArrowRight'), 'c');
    assert.equal(stepTarget(ids, 'b' as ScreenId, 'ArrowLeft'), 'a');
    assert.equal(stepTarget(ids, 'c' as ScreenId, 'ArrowRight'), null);
    assert.equal(stepTarget(ids, 'a' as ScreenId, 'ArrowLeft'), null);
  });

  it('jumps to the ends with Home and End', () => {
    assert.equal(stepTarget(ids, 'b' as ScreenId, 'Home'), 'a');
    assert.equal(stepTarget(ids, 'b' as ScreenId, 'End'), 'c');
    assert.equal(stepTarget(ids, 'a' as ScreenId, 'Home'), null);
    assert.equal(stepTarget(ids, 'c' as ScreenId, 'End'), null);
  });

  it('ignores other keys and empty lists, and opens the first screen when none is showing', () => {
    assert.equal(stepTarget(ids, 'a' as ScreenId, 'Enter'), null);
    assert.equal(stepTarget(ids, 'a' as ScreenId, 'ArrowDown'), null);
    assert.equal(stepTarget([], null, 'ArrowRight'), null);
    assert.equal(stepTarget(ids, null, 'ArrowRight'), 'a');
  });
});

describe('playerNotice', () => {
  it('says nothing after an ordinary move', () => {
    assert.equal(playerNotice(run()), null);
    assert.equal(playerNotice(run(activate('h-checkout'))), null);
  });

  it('reports a broken target with its reason, as a danger', () => {
    const notice = playerNotice(run(activate('h-checkout'), activate('h-pay'), activate('h-receipt')));
    assert.deepEqual(notice, { tone: 'danger', title: 'Broken target reported, not followed', detail: 'screen receipt does not exist' });
  });

  it('explains Back with no history and an exit without opening anything', () => {
    assert.equal(playerNotice(run({ type: 'back' }))!.tone, 'info');
    assert.match(playerNotice(run({ type: 'back' }))!.title, /Back unavailable/);
    assert.deepEqual(playerNotice(run(activate('h-help'))), { tone: 'info', title: 'Leaves the prototype, not opened', detail: 'https://example.com/help' });
  });

  it('reports a missing start screen', () => {
    const missing = createPlayer({ ...flow, start: screenId('nowhere') });
    assert.deepEqual(playerNotice(missing.initial()), { tone: 'danger', title: 'Start screen nowhere does not exist.' });
  });
});

describe('pinned version chips', () => {
  it('shortens version ids to a tag', () => {
    assert.equal(shortVersion('hq-local-cart-v1'), 'v1');
    assert.equal(shortVersion('capture-V2.1'), 'v2.1');
    assert.equal(shortVersion('v-cart-3'), 'v-cart-3');
    assert.equal(shortVersion('a-very-long-version-identifier'), '…identifier');
  });

  it('gives every binding status a few plain words', () => {
    assert.equal(bindingText('exact'), 'exact');
    assert.equal(bindingText('route-mismatch'), 'route differs');
    assert.equal(bindingText('something-new'), 'something new');
    assert.equal(bindingText('__proto__'), '__proto__');
  });

  const names = screenNames(flow);
  const pin = (screen: string, binding = 'exact'): VersionPin => ({ screenId: screen, versionId: `hq-local-${screen}-v1`, binding });

  it('labels each chip with the screen, the version tag and the status, and keeps the full ids for the tooltip', () => {
    const { chips, hiddenExact } = pinChips([pin('cart'), pin('checkout', 'route-mismatch')], names);
    assert.equal(hiddenExact, 0);
    assert.deepEqual(chips.map((chip) => [chip.label, chip.status, chip.exact]), [['Cart · v1', 'exact', true], ['Checkout · v1', 'route differs', false]]);
    assert.equal(chips[0]!.title, 'Cart → hq-local-cart-v1: exact');
  });

  it('always shows pins that need attention and folds extra exact ones into a count', () => {
    const pins = [pin('cart'), pin('cart-empty'), pin('checkout'), pin('checkout-error'), pin('done', 'missing-version')];
    const { chips, hiddenExact } = pinChips(pins, names, 3);
    assert.deepEqual(chips.map((chip) => chip.screenId), ['cart', 'cart-empty', 'done'], 'order is kept; the warning is never hidden');
    assert.equal(hiddenExact, 2);
    const many = pinChips(Array.from({ length: 6 }, (_, n) => pin(`s${n}`, 'missing-version')), names, 3);
    assert.equal(many.chips.length, 6, 'problems are never folded away');
  });
});
