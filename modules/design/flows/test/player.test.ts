import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hotspotId, screenId } from '../src/contract.ts';
import { createPlayer, webApproximation, type PlayerAction, type PlayerState } from '../src/player.ts';
import { checkout, checkoutRaw, parsed } from './fixtures.ts';

function run(actions: readonly PlayerAction[], flow = checkout()): PlayerState {
  const player = createPlayer(flow);
  return actions.reduce(player.reduce, player.initial());
}
const activate = (id: string): PlayerAction => ({ type: 'activate', hotspotId: hotspotId(id) });

describe('prototype player', () => {
  it('starts on the declared start screen with an entered step', () => {
    const state = run([]);
    assert.equal(state.current, 'cart');
    assert.deepEqual(state.steps.map((step) => step.outcome), [{ kind: 'entered', to: 'cart' }]);
  });

  it('sends a hotspot to its declared target: screen, route default state and explicit state', () => {
    assert.equal(run([activate('h-checkout')]).current, 'checkout', 'route without state uses the first declared state');
    assert.equal(run([activate('h-clear')]).current, 'cart-empty', 'route with explicit state');
    assert.equal(run([activate('h-checkout'), activate('h-pay')]).current, 'done', 'screen target');
    assert.equal(run([activate('h-checkout'), activate('h-decline'), activate('h-retry')]).current, 'checkout');
  });

  it('reports a broken target as a recorded step and stays on the current screen', () => {
    const state = run([activate('h-checkout'), activate('h-pay'), activate('h-receipt'), activate('h-promo')]);
    assert.equal(state.current, 'done');
    const broken = state.steps.filter((step) => step.outcome.kind === 'broken');
    assert.deepEqual(broken.map((step) => [step.edgeId, step.outcome.kind === 'broken' && step.outcome.reason]), [['h-receipt', 'missing-screen'], ['h-promo', 'undeclared-route']]);
  });

  it('follows back through history and reports back with no history instead of ignoring it', () => {
    const state = run([activate('h-checkout'), activate('h-back')]);
    assert.equal(state.current, 'cart');
    assert.deepEqual(state.steps.at(-1)!.outcome, { kind: 'back', to: 'cart' });
    const empty = run([{ type: 'back' }]);
    assert.equal(empty.current, 'cart');
    assert.deepEqual(empty.steps.at(-1)!.outcome, { kind: 'back-unavailable' });
  });

  it('records external links as exits without leaving the current screen', () => {
    const state = run([activate('h-help')]);
    assert.equal(state.current, 'cart');
    assert.deepEqual(state.steps.at(-1)!.outcome, { kind: 'exit', url: 'https://example.com/help' });
  });

  it('refuses hotspots that are not on the current screen without recording a step', () => {
    const state = run([activate('h-pay')]);
    assert.equal(state.current, 'cart');
    assert.equal(state.steps.length, 1);
    assert.deepEqual(state.notice, { kind: 'not-on-screen', hotspotId: 'h-pay' });
  });

  it('hit-tests clicks in source CSS pixels, topmost hotspot first, and reports misses', () => {
    const raw = checkoutRaw();
    const hotspots = raw.hotspots as Record<string, unknown>[];
    const overlapping = parsed({ ...raw, hotspots: [...hotspots, { ...hotspots[1]!, id: 'h-top', rect: { x: 100, y: 750, width: 100, height: 60 } }] });
    const player = createPlayer(overlapping);
    assert.equal(player.hitTest(screenId('cart'), { x: 120, y: 770 })?.id, 'h-top');
    assert.equal(player.hitTest(screenId('cart'), { x: 250, y: 770 })?.id, 'h-checkout', 'outside h-top');
    assert.equal(player.hitTest(screenId('cart'), { x: 275, y: 770 }), null, 'right edge is exclusive');
    const missed = player.reduce(player.initial(), { type: 'click', point: { x: 5, y: 5 } });
    assert.deepEqual(missed.notice, { kind: 'miss', point: { x: 5, y: 5 } });
    assert.equal(player.reduce(player.initial(), { type: 'click', point: { x: 120, y: 770 } }).current, 'cart-empty');
  });

  it('labels every step as a web approximation and never as native evidence', () => {
    const state = run([activate('h-checkout'), activate('h-decline'), activate('h-retry'), activate('h-back'), activate('h-help'), { type: 'start', screenId: screenId('done') }, activate('h-receipt')]);
    assert.ok(state.steps.length >= 7);
    for (const step of state.steps) {
      assert.equal(step.evidence.kind, 'web-approximation');
      assert.equal(step.evidence.nativeEvidence, false);
      assert.match(step.evidence.label, /^Web approximation/);
      assert.match(step.evidence.label, /not native evidence/);
      assert.equal(step.evidence.declaredPlatform, 'ios');
    }
    assert.match(webApproximation('ios').label, /iOS design — not native evidence/);
    assert.match(webApproximation('web').label, /not native evidence/);
  });

  it('reports a missing start screen instead of inventing one', () => {
    const player = createPlayer(parsed({ ...checkoutRaw(), start: 'gone' }));
    const state = player.initial();
    assert.equal(state.current, null);
    assert.deepEqual(state.notice, { kind: 'missing-start', screenId: 'gone' });
    assert.equal(player.reduce(state, { type: 'start', screenId: screenId('checkout') }).current, 'checkout');
  });
});
