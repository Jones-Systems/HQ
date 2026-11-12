/**
 * Markup contracts of the Flows workspace chrome (header, pins, filmstrip, notices) under the real
 * React server renderer. Layout, motion and pointer behaviour are checked in a browser, not here.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { hotspotId } from '../src/contract.ts';
import { createPlayer } from '../src/player.ts';
import { FlowsWorkspace, PrototypePlayerView, type FlowsUi } from '../src/views.ts';
import { checkout } from './fixtures.ts';

const render = (element: ReactElement): string => renderToStaticMarkup(element);

describe('flows workspace chrome', () => {
  it('names the flow, its platform and its size, and offers no rating without a caller', () => {
    const markup = render(h(FlowsWorkspace, { flow: checkout() }));
    assert.match(markup, /<h2 class="hqd-flows__title">Checkout<\/h2>/);
    assert.match(markup, /data-platform="ios"[^>]*>iOS</);
    assert.match(markup, /5 screens · 9 links/);
    assert.doesNotMatch(markup, /data-rate-flow/);
  });

  it('offers "Rate this flow" only when asked, and says so once it is waiting in Taste', () => {
    const asked = render(h(FlowsWorkspace, { flow: checkout(), onRate: () => {} }));
    assert.match(asked, /data-rate-flow="true"[^>]*>.*Rate this flow<\/button>/);
    assert.doesNotMatch(asked, /Waiting in Taste/);
    const waiting = render(h(FlowsWorkspace, { flow: checkout(), onRate: () => {}, rated: true }));
    assert.match(waiting, /data-queued="true"[^>]*>.*Waiting in Taste<\/button>/);
  });

  it('marks exactly one filmstrip screen as the current step, and gives it a roving tab stop', () => {
    const markup = render(h(FlowsWorkspace, { flow: checkout() }));
    const thumbs = [...markup.matchAll(/<button\b[^>]*data-play-from="([^"]+)"[^>]*>/gu)];
    assert.equal(thumbs.length, 5);
    assert.deepEqual(thumbs.filter((thumb) => thumb[0].includes('aria-current="step"')).map((thumb) => thumb[1]), ['cart']);
    assert.deepEqual(thumbs.filter((thumb) => thumb[0].includes('tabindex="0"')).map((thumb) => thumb[1]), ['cart']);
  });

  it('shows pinned versions with a word and shape for any that are not exact, and keeps the full ids in a disclosure', () => {
    const pins = {
      scope: 'project hq-local',
      sameProject: true,
      items: [
        { screenId: 'cart', versionId: 'hq-local-cart-v1', binding: 'exact' },
        { screenId: 'checkout', versionId: 'hq-local-checkout-v1', binding: 'route-mismatch' },
      ],
    };
    const markup = render(h(FlowsWorkspace, { flow: checkout(), pins }));
    assert.match(markup, /aria-label="Pinned project versions"/);
    assert.match(markup, /data-exact="true"[^>]*title="[^"]*"[^>]*>.*exact/);
    assert.match(markup, /data-exact="false"[^>]*>.*route differs/);
    assert.match(markup, /data-versions="true"/);
    assert.match(markup, /hq-local-checkout-v1/);
  });

  it('says plainly when the flow belongs to another project', () => {
    const pins = { scope: 'project hq-local', sameProject: false, items: [{ screenId: 'cart', versionId: 'other-cart-v1', binding: 'exact' }] };
    const markup = render(h(FlowsWorkspace, { flow: checkout(), pins }));
    assert.match(markup, /another project/);
  });

  it('draws the hotspot toggle off by default, so captures are not covered until asked', () => {
    const markup = render(h(FlowsWorkspace, { flow: checkout() }));
    assert.match(markup, /data-hotspot-toggle="true"[^>]*aria-pressed="false"/);
  });

  it('hands the switcher to the header unchanged', () => {
    const switcher = h('div', { 'data-test-switcher': true }, 'Saved flows');
    const markup = render(h(FlowsWorkspace, { flow: checkout(), switcher }));
    assert.match(markup, /<header[^>]*>.*data-test-switcher="true".*<\/header>/s);
  });
});

describe('player notices', () => {
  const brokenState = () => {
    const player = createPlayer(checkout());
    const actions = ['h-checkout', 'h-pay', 'h-receipt'].map((id) => ({ type: 'activate' as const, hotspotId: hotspotId(id) }));
    return { player, state: actions.reduce(player.reduce, player.initial()) };
  };

  it('falls back to a plain alert when no notice component is supplied', () => {
    const { player, state } = brokenState();
    const markup = render(h(PrototypePlayerView, { player, state, dispatch: () => {} }));
    assert.match(markup, /role="alert"[^>]*>Broken target reported, not followed/);
  });

  it('renders the caller\'s notice component with the tone, title and detail it was given', () => {
    const { player, state } = brokenState();
    const ui: FlowsUi = {
      motion: { reduced: true, animate: () => null },
      notice: (notice) => h('aside', { 'data-test-notice': notice.tone }, `${notice.title} | ${notice.detail ?? ''}`),
    };
    const markup = render(h(PrototypePlayerView, { player, state, dispatch: () => {}, ui }));
    assert.match(markup, /data-test-notice="danger"[^>]*>Broken target reported, not followed \| .*receipt/);
    assert.doesNotMatch(markup, /role="alert"/);
  });

  it('shows no notice before anything has gone wrong', () => {
    const player = createPlayer(checkout());
    const markup = render(h(PrototypePlayerView, { player, state: player.initial(), dispatch: () => {} }));
    assert.doesNotMatch(markup, /role="alert"/);
  });
});
