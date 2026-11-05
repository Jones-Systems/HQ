/** Display naming and ordering for captured flows; the stored document is never changed. */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FLOW_SCHEMA, flowId, projectId, screenId, versionId, type FlowDocument, type Screen } from '../src/contract.ts';
import { createPlayer } from '../src/player.ts';
import { routeName, screenName, screenNames, screenSequence, stateLabel } from '../src/presentation.ts';
import { FlowMapView, FlowsWorkspace, PrototypePlayerView } from '../src/views.ts';
import { checkout } from './fixtures.ts';

const digest = (n: number) => `sha256:${String(n).repeat(64).slice(0, 64)}`;
/** The shape Add screen to flow saves: route titles, JSON-encoded empty states and no hotspots. */
function captured(routes: readonly string[], viewport = { w: 1024, h: 720, dpr: 1 }): FlowDocument {
  const screens: Screen[] = routes.map((route, n) => ({ id: screenId(`screen-${n}`), title: route, versionId: versionId(`capture-${n}`),
    route, state: '""', viewport, captureDigest: digest(n + 1) }));
  return Object.freeze({ schema: FLOW_SCHEMA, id: flowId('interactive-synthetic'), projectId: projectId('synthetic'), title: 'Synthetic flow', platform: 'web',
    start: screens[0]!.id, routes: routes.map((route) => ({ route, states: ['""'] })), screens, hotspots: [] });
}

describe('flow presentation', () => {
  it('names captured routes readably without changing stored titles', () => {
    assert.equal(routeName('/projects/example/sites/public/variations/v1/index.html'), 'Home');
    assert.equal(routeName('/projects/example/sites/public/variations/v1/weddings/'), 'Weddings');
    assert.equal(routeName('/projects/example/sites/app/index.html?direction=a&screen=today'), 'Today');
    assert.equal(routeName('/shop/gift-cards.html'), 'Gift cards');
    assert.equal(routeName('/'), 'Home');
    const flow = captured(['/site/index.html', '/site/weddings/']);
    assert.deepEqual([...screenNames(flow).values()], ['Home', 'Weddings']);
    assert.equal(flow.screens[1]!.title, '/site/weddings/', 'stored title is untouched');
    assert.equal(screenName({ ...flow.screens[0]!, title: 'Landing' }), 'Landing', 'owner titles are shown as written');
  });

  it('labels only meaningful states and disambiguates repeated names', () => {
    assert.equal(stateLabel('""'), null);
    assert.equal(stateLabel('default'), null);
    assert.equal(stateLabel('"#pricing"'), '#pricing');
    assert.equal(stateLabel('error'), 'error');
    assert.deepEqual([...screenNames(captured(['/a/index.html', '/b/index.html'])).values()], ['Home (1)', 'Home (2)']);
  });

  it('orders the start screen and linked screens first, then saved order, without adding links', () => {
    const flow = checkout();
    const order = screenSequence(flow).map((screen) => screen.id);
    assert.equal(order[0], flow.start);
    assert.equal(new Set(order).size, flow.screens.length);
    const unlinked = captured(['/z/', '/a/', '/m/']);
    assert.deepEqual(screenSequence(unlinked).map((screen) => screen.route), ['/z/', '/a/', '/m/']);
    assert.equal(unlinked.hotspots.length, 0);
  });
});

describe('captured flow rendering', () => {
  const flow = captured(['/projects/example/v1/index.html', '/projects/example/v1/weddings/']);
  const markup = renderToStaticMarkup(h(FlowsWorkspace, { flow }));

  it('shows readable names in the strip and map instead of raw routes', () => {
    assert.match(markup, /data-play-from="screen-0"[^>]*aria-label="1\. Home, start screen"/);
    assert.match(markup, /data-play-from="screen-1"[^>]*aria-label="2\. Weddings"/);
    assert.doesNotMatch(markup, /<text[^>]*>\/projects\//u, 'map node text never prints a full route');
    assert.match(markup, /data-no-links="true"/);
    assert.doesNotMatch(markup, /<line /u, 'no edge is drawn for an unlinked flow');
  });

  it('offers Start and Next in saved order, no link Back, and explains why', () => {
    assert.match(markup, /data-player-restart="true"[^>]*>Start</);
    assert.match(markup, /data-player-previous="true" disabled=""/);
    assert.doesNotMatch(markup, /data-player-next="true" disabled/);
    assert.doesNotMatch(markup, /data-player-back/);
    assert.match(markup, /data-player-unlinked="true"[^>]*>No links are recorded between these screens/);
    assert.match(markup, /data-playback="recorded"[^>]*>Saved captures are still images recorded from the live preview, not the live page\./);
  });

  it('states why a capture image is absent instead of an empty frame', () => {
    assert.match(markup, /data-capture-missing="true"[^>]*><strong>Home<\/strong><span>No capture image is available for this screen\.<\/span>/);
    const player = createPlayer(flow);
    const previews = { label: 'test', previewUrl: () => null, unavailableReason: () => 'The saved capture image is not stored on this device.' };
    const reasoned = renderToStaticMarkup(h(PrototypePlayerView, { player, state: player.initial(), dispatch: () => {}, previews }));
    assert.match(reasoned, /not stored on this device/);
    const shown = renderToStaticMarkup(h(PrototypePlayerView, { player, state: player.initial(), dispatch: () => {}, previews: { label: 'test', previewUrl: () => 'blob:capture' } }));
    assert.match(shown, /<img src="blob:capture" alt="Saved capture of Home"/);
  });

  it('frames phone captures at their own aspect ratio and offers live only when the caller binds it', () => {
    const phone = captured(['/app/index.html?screen=today', '/app/index.html?screen=workout'], { w: 390, h: 844, dpr: 1 });
    const player = createPlayer(phone);
    const rendered = renderToStaticMarkup(h(PrototypePlayerView, { player, state: player.initial(), dispatch: () => {} }));
    assert.match(rendered, /data-frame="phone"[^>]*style="[^"]*aspect-ratio:390 \/ 844/);
    assert.doesNotMatch(rendered, /data-open-live/);
    const bound = renderToStaticMarkup(h(PrototypePlayerView, { player, state: player.initial(), dispatch: () => {}, onOpenLive: () => {} }));
    assert.match(bound, /data-open-live="screen-0"/);
  });

  it('makes map nodes selectable only when the caller can show a screen', () => {
    assert.doesNotMatch(renderToStaticMarkup(h(FlowMapView, { flow })), /role="button"/);
    assert.match(renderToStaticMarkup(h(FlowMapView, { flow, onPlayFrom: () => {} })), /<g data-node="screen-1"[^>]*role="button"[^>]*aria-label="Show Weddings"/);
  });
});
