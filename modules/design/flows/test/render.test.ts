/**
 * Real React runtime renders (react-dom/server). These prove rendered markup and attributes,
 * not browser layout, pointer handling or Electron capture.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement as h, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { hotspotId } from '../src/contract.ts';
import { createPlayer, type PlayerAction } from '../src/player.ts';
import { FlowCanvasItemView, FlowMapView, FlowsWorkspace, PrototypePlayerView } from '../src/views.ts';
import { checkout, randomFlow } from './fixtures.ts';

const render = (element: ReactElement): string => renderToStaticMarkup(element);
const decode = (value: string): string => value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');

/** `[edgeId, from, to]` for each opening tag that carries the given marker attribute. */
function edgeAttributes(markup: string, tag: string, marker: string): string[] {
  const rows: string[] = [];
  for (const match of markup.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gu'))) {
    const attrs = Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/gu)].map((pair) => [pair[1]!, decode(pair[2]!)]));
    if (attrs[marker] !== undefined) rows.push(`${attrs[marker]} | ${attrs['data-from']} | ${attrs['data-to']}`);
  }
  return rows;
}

function renderedAgreement(flow: ReturnType<typeof checkout>): void {
  const map = render(h(FlowMapView, { flow }));
  const rows = edgeAttributes(map, 'tr', 'data-edge-row');
  assert.equal(rows.length, flow.hotspots.length, 'every edge is listed, including broken and orphan ones');
  const lines = edgeAttributes(map, 'line', 'data-edge-id');
  const fromExists = new Set(flow.screens.map((screen) => screen.id as string));
  assert.deepEqual(lines, rows.filter((row) => fromExists.has(row.split(' | ')[1]!)), 'drawn edges match listed edges');

  const player = createPlayer(flow);
  const offered: string[] = [];
  for (const screen of flow.screens) {
    const state = player.reduce(player.initial(), { type: 'start', screenId: screen.id });
    offered.push(...edgeAttributes(render(h(PrototypePlayerView, { player, state, dispatch: () => {} })), 'button', 'data-edge-id'));
  }
  assert.deepEqual(offered.sort(), lines.slice().sort(), `${flow.id}: rendered player hotspots equal rendered map edges`);
}

function assertNeverNative(markup: string): void {
  for (const match of markup.matchAll(/native evidence/giu)) {
    assert.equal(markup.slice(Math.max(0, match.index - 4), match.index), 'not ', `"native evidence" at ${match.index} is negated`);
  }
}

describe('rendered flow map and player', () => {
  it('agree on every edge for the fixture', () => renderedAgreement(checkout()));

  it('agree on every edge for 60 generated flows', () => {
    for (let seed = 1; seed <= 60; seed += 1) renderedAgreement(randomFlow(seed));
  });

  it('label every rendered step as a web approximation and surface broken targets as alerts', () => {
    const flow = checkout();
    const player = createPlayer(flow);
    const actions: PlayerAction[] = ['h-checkout', 'h-pay', 'h-receipt'].map((id) => ({ type: 'activate', hotspotId: hotspotId(id) }));
    const state = actions.reduce(player.reduce, player.initial());
    const markup = render(h(PrototypePlayerView, { player, state, dispatch: () => {} }));
    const steps = [...markup.matchAll(/<li data-step="(\d+)"[^>]*data-evidence="([^"]+)"[^>]*>(.*?)<\/li>/gu)];
    assert.equal(steps.length, state.steps.length);
    for (const step of steps) {
      assert.equal(step[2], 'web-approximation');
      assert.match(step[3]!, /Web approximation of an iOS design — not native evidence/);
    }
    assert.match(markup, /role="note" data-evidence="web-approximation"[^>]*>Web approximation of an iOS design — not native evidence/);
    assert.match(markup, /role="alert"[^>]*>Broken target reported, not followed: screen receipt does not exist/);
    assertNeverNative(markup);
  });

  it('positions hotspots as percentages of the declared viewport and keeps capture colors', () => {
    const flow = checkout();
    const player = createPlayer(flow);
    const markup = render(h(PrototypePlayerView, { player, state: player.initial(), dispatch: () => {} }));
    const button = /<button[^>]*data-edge-id="h-checkout"[^>]*>/u.exec(markup)![0];
    assert.match(button, new RegExp(`left:${115 / 390 * 100}%`));
    assert.match(button, new RegExp(`width:${160 / 390 * 100}%`));
    assert.match(button, /aria-label="Checkout → Checkout"/);
    assert.match(markup, /data-screen="cart"[^>]*style="[^"]*background:#ffffff/);
  });

  it('workspace shows the issues list with each broken target and a play-from control per screen', () => {
    const markup = render(h(FlowsWorkspace, { flow: checkout() }));
    assert.deepEqual([...markup.matchAll(/data-issue="broken-target"[^>]*data-subject="([^"]+)"/gu)].map((match) => match[1]), ['h-receipt', 'h-promo']);
    assert.equal([...markup.matchAll(/data-play-from=/gu)].length, 5);
    assertNeverNative(markup);
  });

  it('renders both canvas item kinds', () => {
    const flow = checkout();
    assert.match(render(h(FlowCanvasItemView, { flow, kind: 'flow-map' })), /data-flow-map="flow-checkout"/);
    const player = render(h(FlowCanvasItemView, { flow, kind: 'flow-player' }));
    assert.match(player, /data-player="flow-checkout"/);
    assert.match(player, /data-current="cart"/);
  });
});
