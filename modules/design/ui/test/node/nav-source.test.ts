import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NavNode } from '@hq/ui';
import { DESIGN_NAV_IDS, type DesignNavId } from '../../contract.ts';
import { createDesignCore } from '../../src/domain-core.ts';
import { createFakeStorage } from '../../src/fakes.ts';
import { buildDesignNavNodes, createDesignNavSource, NAV_SOURCE_LIMITS, subRoutesLookup } from '../../src/nav-source.ts';
import { formatDestination, parseDestination } from '../../src/navigation.ts';
import { buildRegistry } from '../../src/registry.ts';
import { sectionPayloadsFor } from '../../src/section-payload.ts';
import type { SessionStore } from '../../src/session.ts';
import { entry } from './fixtures.ts';

/**
 * K's node limits, replicated here so this Node test never imports the @hq/ui runtime (it pulls CSS).
 * They mirror NAV_LIMITS and the id pattern in packages/hq-ui/src/nav/state.ts.
 */
const K = Object.freeze({ nodes: 512, depth: 8, id: 128, label: 256, destination: 512 });
const K_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

const COMPARE = { fixed: [
  { id: 'strip', title: 'Strip' }, { id: 'before-after', title: 'Before / after' }, { id: 'swipe', title: 'Swipe stage' }, { id: 'matrix', title: 'Matrix' },
], navChildren: true };
const FLOWS = { fixed: [
  { id: 'player', title: 'Player' }, { id: 'storyboards', title: 'Storyboards' }, { id: 'outline', title: 'Outline' }, { id: 'board', title: 'Board' },
], navChildren: false };
const COMPONENTS = { fixed: [{ id: 'tokens', title: 'Tokens' }, { id: 'motion', title: 'Motion' }], navChildren: true, itemPrefix: 'item' };

/** Section code is never loaded by navigation: every `view` loader here counts its calls. */
const loaded: string[] = [];
function counting(id: string, nav: DesignNavId, extra: Record<string, unknown> = {}) {
  return {
    designModule: {
      schema: 'hq.design.section/v1', id, title: id[0]!.toUpperCase() + id.slice(1), nav,
      view: async () => { loaded.push(id); return null; }, ...extra,
    },
  };
}

const registry = buildRegistry({
  '../../projects/design-module.ts': counting('projects', 'projects'),
  '../../canvas/design-module.ts': counting('canvas', 'review'),
  '../../compare/design-module.ts': counting('compare', 'review', { subRoutes: COMPARE }),
  '../../components/design-module.ts': counting('components', 'resources', { subRoutes: COMPONENTS }),
  '../../flows/design-module.ts': counting('flows', 'resources', { subRoutes: FLOWS }),
});
const lookup = subRoutesLookup(registry);

function flatten(nodes: readonly NavNode[], depth = 1): { node: NavNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flatten(node.children ?? [], depth + 1)]);
}

function counted(sessions: SessionStore) {
  const stats = { gets: 0, handles: 0, subscribes: 0, active: 0 };
  const wrapper: Pick<SessionStore, 'get' | 'subscribe' | 'sectionHandle'> = {
    get: (projectId) => { stats.gets += 1; return sessions.get(projectId); },
    sectionHandle: (projectId, sectionId) => { stats.handles += 1; return sessions.sectionHandle(projectId, sectionId); },
    subscribe: (listener) => {
      stats.subscribes += 1; stats.active += 1;
      const off = sessions.subscribe(listener);
      let done = false;
      return () => { if (!done) { done = true; stats.active -= 1; } off(); };
    },
  };
  return { wrapper, stats };
}

function setup() {
  const core = createDesignCore(createFakeStorage());
  const payloads = sectionPayloadsFor(core.sessions);
  const { wrapper, stats } = counted(core.sessions);
  const source = createDesignNavSource({ registry, sessions: wrapper, payloads });
  return { core, payloads, stats, source };
}

test('nodes are the descriptors, exactly: areas, sections and fixed views only', () => {
  const nodes = buildDesignNavNodes(registry);
  const shape = (items: readonly NavNode[]): unknown => items.map((node) => [node.id, node.label, node.destination, ...(node.children ? [shape(node.children)] : [])]);
  assert.deepEqual(shape(nodes), [
    ['area:projects', 'Projects', 'projects', [['section:projects', 'Projects', 'projects/projects']]],
    ['area:resources', 'Resources', 'resources', [
      ['section:components', 'Components', 'resources/components', [
        ['view:components:tokens', 'Tokens', 'resources/components/tokens'],
        ['view:components:motion', 'Motion', 'resources/components/motion'],
      ]],
      ['section:flows', 'Flows', 'resources/flows'],
    ]],
    ['area:review', 'Review', 'review', [
      ['section:canvas', 'Canvas', 'review/canvas'],
      ['section:compare', 'Compare', 'review/compare', [
        ['view:compare:strip', 'Strip', 'review/compare/strip'],
        ['view:compare:before-after', 'Before / after', 'review/compare/before-after'],
        ['view:compare:swipe', 'Swipe stage', 'review/compare/swipe'],
        ['view:compare:matrix', 'Matrix', 'review/compare/matrix'],
      ]],
    ]],
    ['area:requests', 'Requests', 'requests'],
    ['area:runs', 'Runs', 'runs'],
  ]);
  assert.deepEqual(nodes.map((node) => node.id), DESIGN_NAV_IDS.map((nav) => `area:${nav}`));
});

test('nothing is invented: no Library level, Flows has no children, Components has only its two fixed views', () => {
  const all = flatten(buildDesignNavNodes(registry)).map(({ node }) => node);
  assert.ok(!all.some((node) => /library|catalog|item/iu.test(node.id) || /library|catalog/iu.test(node.label)));
  assert.equal(all.find((node) => node.id === 'section:flows')?.children, undefined, 'navChildren false adds no children');
  assert.deepEqual(all.find((node) => node.id === 'section:components')?.children?.map((node) => node.id), ['view:components:tokens', 'view:components:motion']);
  assert.ok(all.every((node) => node.lazy === undefined && node.icon === undefined && node.count === undefined && node.status === undefined));
});

test('the node tree is valid under K: ids, labels, destinations, depth and count', () => {
  const flat = flatten(buildDesignNavNodes(registry));
  const ids = flat.map(({ node }) => node.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  assert.ok(flat.length <= K.nodes);
  for (const { node, depth } of flat) {
    assert.match(node.id, K_ID);
    assert.ok(node.id.length <= K.id);
    assert.ok(node.label.length > 0 && node.label.length <= K.label, node.id);
    assert.ok(node.destination !== null && node.destination.length > 0 && node.destination.length <= K.destination, node.id);
    assert.ok(depth <= K.depth);
  }
});

test('a section with a hostile id still produces valid nodes or none, never a malformed one', () => {
  // Ids are bounded by the registry (at most 64 characters of [a-z0-9-]) so the longest node id fits K's 128.
  const longId = `a${'b'.repeat(62)}c`;
  const hostile = buildRegistry({
    [`../../${longId}/design-module.ts`]: entry(longId, 'resources', { subRoutes: { fixed: [{ id: `x${'y'.repeat(30)}`, title: 'T' }], navChildren: true } }),
  });
  assert.deepEqual(hostile.rejected, []);
  for (const { node } of flatten(buildDesignNavNodes(hostile))) {
    assert.match(node.id, K_ID);
    assert.ok(node.id.length <= K.id, `${node.id.length}`);
    assert.ok((node.destination ?? '').length <= K.destination);
  }
});

test('every node destination parses back to its own node: the tree and the routes cannot drift apart', () => {
  const { source } = setup();
  for (const { node } of flatten(buildDesignNavNodes(registry))) {
    const destination = node.destination!;
    const location = parseDestination(destination, lookup);
    assert.equal(formatDestination(location), destination, `${node.id} is a canonical destination`);
    const id = source.currentId('alpha', destination);
    if (node.id.startsWith('area:')) {
      // A bare area opens its first (or remembered) section; an area with no sections is itself current.
      const inside = flatten(node.children ?? []).map((item) => item.node.id);
      assert.ok(inside.length === 0 ? id === node.id : id !== null && inside.includes(id), `${node.id} resolves into its own area`);
    } else {
      // A bare section destination shows its effective view: Compare's default leaf. Components has no default view.
      assert.equal(id, node.id === 'section:compare' ? 'view:compare:strip' : node.id, `${node.id} is current at its own destination`);
    }
  }
});

test('getSnapshot returns one immutable array without touching sessions, section code or I/O', () => {
  const { source, stats } = setup();
  loaded.length = 0;
  const first = source.getSnapshot('alpha');
  assert.equal(source.getSnapshot('beta'), first, 'one static tree, not rebuilt per call or project');
  assert.equal(source.getSnapshot('alpha'), first);
  assert.ok(Array.isArray(first));
  assert.deepEqual(stats, { gets: 0, handles: 0, subscribes: 0, active: 0 });
  assert.deepEqual(loaded, [], 'no section loader ran');
  assert.equal(source.activate, undefined, 'nothing loads lazily, so there is nothing to activate');
});

test('invalid project ids are refused', () => {
  const { source, stats } = setup();
  for (const projectId of ['', 'p'.repeat(NAV_SOURCE_LIMITS.projectId + 1)]) {
    assert.throws(() => source.getSnapshot(projectId), RangeError);
    assert.throws(() => source.subscribe(projectId, () => undefined), RangeError);
    assert.equal(source.currentId(projectId, 'review/compare'), null);
  }
  assert.throws(() => Reflect.apply(source.getSnapshot, source, [7]), RangeError, 'a non-string project id');
  assert.equal(source.getSnapshot('p'.repeat(NAV_SOURCE_LIMITS.projectId)).length, 5, 'exactly 128 characters is allowed');
  assert.equal(stats.active, 0);
  assert.equal(stats.subscribes, 0, 'a refused subscription attaches nothing');
});

test('currentId: an explicit valid view beats the remembered one, which beats the default', () => {
  const { source, payloads } = setup();
  assert.equal(source.currentId('alpha', 'review/compare'), 'view:compare:strip', 'default');
  payloads.setView('alpha', 'compare', 'swipe');
  assert.equal(source.currentId('alpha', 'review/compare'), 'view:compare:swipe', 'remembered');
  assert.equal(source.currentId('alpha', 'review/compare/matrix'), 'view:compare:matrix', 'explicit');
  assert.equal(source.currentId('alpha', 'review/compare/nope'), 'view:compare:swipe', 'an invalid explicit view is ignored');
  assert.equal(source.currentId('beta', 'review/compare'), 'view:compare:strip', 'another project keeps its own');
});

test('currentId: section-only nodes, item views and bare areas', () => {
  const { source, payloads, core } = setup();
  assert.equal(source.currentId('alpha', 'review/canvas'), 'section:canvas');
  assert.equal(source.currentId('alpha', 'resources/flows'), 'section:flows', 'Flows declares no nav children');
  assert.equal(source.currentId('alpha', 'resources/flows/board'), 'section:flows');
  assert.equal(source.currentId('alpha', 'resources/components'), 'section:components', 'an item section has no default view');
  assert.equal(source.currentId('alpha', 'resources/components/item/Button%20Primary'), 'section:components', 'an item is not a node, so its section is current');
  assert.equal(source.currentId('alpha', 'resources/components/motion'), 'view:components:motion');
  payloads.setView('alpha', 'components', 'item/Button%20Primary');
  assert.equal(source.currentId('alpha', 'resources/components'), 'section:components');
  assert.equal(source.currentId('alpha', 'review'), 'section:canvas', 'a bare area is its first section until another is remembered');
  core.sessions.setLastSection('alpha', 'review', 'compare');
  payloads.setView('alpha', 'compare', 'matrix');
  assert.equal(source.currentId('alpha', 'review'), 'view:compare:matrix', 'a bare area follows the remembered section and view');
  assert.equal(source.currentId('alpha', 'runs'), 'area:runs');
  assert.equal(source.currentId('alpha', 'home'), 'section:projects', 'an unknown destination falls back like the chrome does');
  assert.equal(Reflect.apply(source.currentId, source, ['alpha', 7]), null, 'a non-string destination');
});

test('currentId never writes: resolving a destination leaves the session untouched', () => {
  const { source, core, stats } = setup();
  core.deactivate();
  const before = core.sessions.version();
  source.currentId('alpha', 'review/compare');
  source.currentId('alpha', 'review');
  source.currentId('alpha', 'resources/components/item/x');
  assert.equal(core.sessions.version(), before);
  assert.equal(core.sessions.get('alpha').sections.compare, undefined);
  assert.equal(stats.subscribes, 0);
});

test('subscribe notifies only the project whose remembered section or view changed', () => {
  const { source, payloads, core } = setup();
  const alpha: string[] = [];
  const beta: string[] = [];
  const offAlpha = source.subscribe('alpha', () => alpha.push('a'));
  const offBeta = source.subscribe('beta', () => beta.push('b'));
  payloads.setView('alpha', 'compare', 'swipe');
  assert.equal(alpha.length, 1);
  assert.equal(beta.length, 0, 'no cross-project notification');
  payloads.setView('alpha', 'compare', 'swipe');
  assert.equal(alpha.length, 1, 'an unchanged view is not a change');
  core.sessions.setLastSection('beta', 'review', 'compare');
  assert.equal(beta.length, 1);
  assert.equal(alpha.length, 1);
  core.sessions.setLastSection('alpha', 'review', 'compare');
  assert.equal(alpha.length, 2);
  // Section data, panel layout and sections without views are not navigation changes.
  payloads.dataHandle('alpha', 'compare').write({ pair: [1, 2] });
  core.sessions.sectionHandle('alpha', 'canvas').write({ zoom: 3 });
  core.sessions.setPanels('alpha', core.sessions.get('alpha').panels);
  assert.equal(alpha.length, 2);
  payloads.setView('alpha', 'flows', 'board');
  assert.equal(alpha.length, 3);
  offAlpha(); offBeta();
});

test('subscribe notifies on restore and sees the restored view', () => {
  const { source, payloads, core } = setup();
  payloads.setView('alpha', 'compare', 'matrix');
  const text = core.serialize('alpha')!;
  payloads.setView('alpha', 'compare', 'strip');
  let calls = 0;
  const off = source.subscribe('alpha', () => { calls += 1; });
  assert.deepEqual(core.restore('alpha', text), { status: 'restored' });
  assert.equal(calls, 1);
  assert.equal(source.currentId('alpha', 'review/compare'), 'view:compare:matrix');
  off();
});

test('cleanup is idempotent and stops notifications immediately', () => {
  const { source, payloads, stats } = setup();
  let first = 0;
  let second = 0;
  const offFirst = source.subscribe('alpha', () => { first += 1; });
  const offSecond = source.subscribe('alpha', () => { second += 1; });
  assert.equal(stats.active, 1, 'one session subscription serves every listener');
  offFirst(); offFirst(); offFirst();
  assert.equal(stats.active, 1, 'repeating a cleanup does not release the other listener');
  payloads.setView('alpha', 'compare', 'swipe');
  assert.deepEqual([first, second], [0, 1]);
  offSecond(); offSecond();
  assert.equal(stats.active, 0, 'the session subscription is released with the last listener');
  payloads.setView('alpha', 'compare', 'matrix');
  assert.deepEqual([first, second], [0, 1], 'no late notification');
});

test('the same listener function subscribed twice is two independent subscriptions', () => {
  const { source, payloads } = setup();
  let calls = 0;
  const listener = () => { calls += 1; };
  const one = source.subscribe('alpha', listener);
  const two = source.subscribe('alpha', listener);
  payloads.setView('alpha', 'compare', 'swipe');
  assert.equal(calls, 2);
  one(); one();
  payloads.setView('alpha', 'compare', 'matrix');
  assert.equal(calls, 3, 'cleaning up one leaves the other');
  two();
});

test('the session subscription is held only while something listens and re-attached later', () => {
  const { source, payloads, stats } = setup();
  assert.equal(stats.active, 0);
  const off = source.subscribe('alpha', () => undefined);
  const offOther = source.subscribe('beta', () => undefined);
  assert.deepEqual([stats.subscribes, stats.active], [1, 1]);
  off();
  assert.equal(stats.active, 1);
  offOther();
  assert.equal(stats.active, 0);
  let calls = 0;
  const again = source.subscribe('alpha', () => { calls += 1; });
  assert.deepEqual([stats.subscribes, stats.active], [2, 1]);
  payloads.setView('alpha', 'flows', 'outline');
  assert.equal(calls, 1);
  again();
  assert.equal(stats.active, 0);
});

test('a failing or self-removing subscriber cannot starve the others or break the store', () => {
  const { source, payloads } = setup();
  const seen: string[] = [];
  const offBad = source.subscribe('alpha', () => { throw new Error('boom'); });
  let offSelf: () => void = () => undefined;
  offSelf = source.subscribe('alpha', () => { seen.push('self'); offSelf(); });
  const offGood = source.subscribe('alpha', () => { seen.push('good'); });
  assert.doesNotThrow(() => payloads.setView('alpha', 'compare', 'swipe'));
  assert.deepEqual(seen, ['self', 'good']);
  assert.doesNotThrow(() => payloads.setView('alpha', 'compare', 'matrix'));
  assert.deepEqual(seen, ['self', 'good', 'good'], 'the self-removing subscriber ran once');
  offBad(); offGood();
});

test('limits: 32 projects and 16 listeners per project; a refusal leaves nothing attached', () => {
  const { source, payloads, stats } = setup();
  const offs: (() => void)[] = [];
  for (let index = 0; index < NAV_SOURCE_LIMITS.projects; index += 1) offs.push(source.subscribe(`p${index}`, () => undefined));
  assert.equal(stats.subscribes, 1);
  assert.throws(() => source.subscribe('one-too-many', () => undefined), RangeError);
  assert.equal(stats.subscribes, 1);
  // An existing project can still take more listeners, up to its own cap.
  for (let index = 1; index < NAV_SOURCE_LIMITS.listenersPerProject; index += 1) offs.push(source.subscribe('p0', () => undefined));
  assert.throws(() => source.subscribe('p0', () => undefined), RangeError);
  // The refused project never became a listener: notifying it later does nothing and nothing leaks.
  payloads.setView('one-too-many', 'compare', 'swipe');
  offs.splice(0).forEach((off) => off());
  assert.equal(stats.active, 0, 'everything released');
  // Capacity is returned.
  const reused = source.subscribe('one-too-many', () => undefined);
  reused();
  assert.equal(stats.active, 0);
  assert.throws(() => Reflect.apply(source.subscribe, source, ['alpha', 'not a function']), RangeError, 'a non-function listener');
  assert.equal(stats.active, 0);
});

test('navigation reads no storage and runs no section code', () => {
  loaded.length = 0;
  const storage = createFakeStorage();
  const core = createDesignCore(storage);
  const source = createDesignNavSource({ registry, sessions: core.sessions });
  const off = source.subscribe('alpha', () => undefined);
  source.getSnapshot('alpha');
  source.currentId('alpha', 'review/compare/swipe');
  sectionPayloadsFor(core.sessions).setView('alpha', 'compare', 'swipe');
  off();
  assert.deepEqual(loaded, []);
  assert.equal(storage.writes.length, 0, 'nothing is persisted until the session flushes');
});
