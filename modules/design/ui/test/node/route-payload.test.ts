import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DesignLocation, JsonValue } from '../../contract.ts';
import { createDesignCore } from '../../src/domain-core.ts';
import { createFakeStorage } from '../../src/fakes.ts';
import { DEFAULT_LOCATION, formatDestination, isFixedSubId, itemIdOf, itemSub, parseDestination, sameLocation } from '../../src/navigation.ts';
import { crumbFor, resolveDesignRoute, subRoutesLookup } from '../../src/nav-source.ts';
import { buildCommands } from '../../src/palette.ts';
import { buildRegistry } from '../../src/registry.ts';
import { MAX_SECTION_STATE, sessionKey } from '../../src/session.ts';
import { MAX_VIEW, readPayload, sectionPayloadsFor } from '../../src/section-payload.ts';
import { entry } from './fixtures.ts';

const COMPARE = { fixed: [
  { id: 'strip', title: 'Strip' }, { id: 'before-after', title: 'Before / after' }, { id: 'swipe', title: 'Swipe stage' }, { id: 'matrix', title: 'Matrix' },
], navChildren: true };
const FLOWS = { fixed: [
  { id: 'player', title: 'Player' }, { id: 'storyboards', title: 'Storyboards' }, { id: 'outline', title: 'Outline' }, { id: 'board', title: 'Board' },
], navChildren: false };
const COMPONENTS = { fixed: [{ id: 'tokens', title: 'Tokens' }, { id: 'motion', title: 'Motion' }], navChildren: true, itemPrefix: 'item' };

const registry = buildRegistry({
  '../../projects/design-module.ts': entry('projects', 'projects'),
  '../../canvas/design-module.ts': entry('canvas', 'review'),
  '../../compare/design-module.ts': entry('compare', 'review', { subRoutes: COMPARE }),
  '../../components/design-module.ts': entry('components', 'resources', { subRoutes: COMPONENTS }),
  '../../flows/design-module.ts': entry('flows', 'resources', { subRoutes: FLOWS }),
});
const lookup = subRoutesLookup(registry);

test('the fixture registry accepts the three descriptors', () => {
  assert.deepEqual(registry.rejected, []);
  assert.deepEqual(registry.get('compare')?.subRoutes, COMPARE);
});

test('legacy two-segment routes parse, format and compare exactly as before', () => {
  for (const destination of ['projects', 'resources', 'review', 'requests', 'runs', 'review/compare', 'review/canvas', 'resources/flows']) {
    assert.equal(formatDestination(parseDestination(destination, lookup)), destination);
    assert.equal(formatDestination(parseDestination(destination)), destination);
  }
  assert.deepEqual(parseDestination('review/compare', lookup), { nav: 'review', section: 'compare' }, 'no sub key appears on a legacy route');
  assert.deepEqual(parseDestination('home', lookup), DEFAULT_LOCATION);
  assert.deepEqual(parseDestination('review/Bad Id', lookup), { nav: 'review', section: null });
  assert.deepEqual(parseDestination('review/', lookup), { nav: 'review', section: null });
  assert.deepEqual(parseDestination('https://example.invalid/review/compare', lookup), DEFAULT_LOCATION);
  assert.deepEqual(parseDestination('projects?entity=x', lookup), DEFAULT_LOCATION);
});

test('every declared fixed view and item view round-trips as an exact destination', () => {
  const routes = [
    'review/compare/strip', 'review/compare/before-after', 'review/compare/swipe', 'review/compare/matrix',
    'resources/flows/player', 'resources/flows/storyboards', 'resources/flows/outline', 'resources/flows/board',
    'resources/components/tokens', 'resources/components/motion',
    'resources/components/item/Button%20Primary', 'resources/components/item/%C3%9Cn%C3%AF%2F%C3%A7', "resources/components/item/it's-(ok)!~*",
  ];
  for (const destination of routes) {
    const location = parseDestination(destination, lookup);
    assert.ok(typeof location.sub === 'string', destination);
    assert.equal(formatDestination(location), destination, 'the exact string survives');
  }
  assert.deepEqual(parseDestination('review/compare/swipe', lookup), { nav: 'review', section: 'compare', sub: 'swipe' });
  assert.equal(itemIdOf(parseDestination('resources/components/item/%C3%9Cn%C3%AF%2F%C3%A7', lookup).sub!), 'Ünï/ç');
});

test('a component literally named "tokens" is distinct from the fixed Tokens view', () => {
  const fixed = parseDestination('resources/components/tokens', lookup);
  const named = parseDestination('resources/components/item/tokens', lookup);
  assert.equal(fixed.sub, 'tokens');
  assert.equal(named.sub, 'item/tokens');
  assert.equal(itemIdOf(named.sub!), 'tokens');
  assert.equal(itemIdOf('tokens'), null);
  assert.equal(sameLocation(fixed, named), false);
  assert.equal(isFixedSubId('item'), false, 'the item prefix is never a fixed id');
  assert.equal(itemSub('tokens'), 'item/tokens');
});

test('an invalid view leaves the same valid section with sub null', () => {
  const invalid = [
    'review/compare/nope', 'review/compare/Swipe', 'review/compare/swipe/extra', 'review/compare/', 'review/compare/item/x',
    'resources/flows/item/x', 'resources/flows/tokens', 'review/canvas/swipe',
    'resources/components/item/', 'resources/components/item/%', 'resources/components/item/%E0%A4%A', 'resources/components/item/%C3',
    'resources/components/item/%41', 'resources/components/item/a/b', 'resources/components/item/a b', 'resources/components/items/x',
  ];
  for (const destination of invalid) {
    const [nav, section] = destination.split('/');
    assert.deepEqual(parseDestination(destination, lookup), { nav, section, sub: null }, destination);
  }
  assert.deepEqual(parseDestination('review/a/b/c', lookup), { nav: 'review', section: 'a', sub: null });
});

test('the legacy fallback still applies when the section or area is not valid', () => {
  assert.deepEqual(parseDestination('review/Bad/swipe', lookup), DEFAULT_LOCATION);
  assert.deepEqual(parseDestination('nope/compare/swipe', lookup), DEFAULT_LOCATION);
  assert.deepEqual(parseDestination('review//swipe', lookup), DEFAULT_LOCATION);
});

test('without a descriptor lookup a third segment is never kept, so legacy callers see no new route', () => {
  assert.deepEqual(parseDestination('review/compare/swipe'), { nav: 'review', section: 'compare', sub: null });
  assert.equal(formatDestination(parseDestination('review/compare/swipe')), 'review/compare');
});

test('destinations over 512 characters and over-long ids yield sub null on the same section', () => {
  const prefix = 'resources/components/item/';
  const exact = prefix + 'a'.repeat(512 - prefix.length);
  assert.equal(exact.length, 512);
  assert.equal(parseDestination(exact, lookup).sub, exact.slice('resources/components/'.length), '512 characters is allowed');
  assert.equal(formatDestination(parseDestination(exact, lookup)), exact);
  const long = prefix + 'a'.repeat(513 - prefix.length);
  assert.deepEqual(parseDestination(long, lookup), { nav: 'resources', section: 'components', sub: null });
  assert.deepEqual(parseDestination(`resources/components/${'a'.repeat(600)}`, lookup), { nav: 'resources', section: 'components', sub: null });
  assert.deepEqual(parseDestination(`review/${'b'.repeat(70)}/item/x`, lookup), DEFAULT_LOCATION);
  assert.deepEqual(parseDestination('x'.repeat(2000), lookup), DEFAULT_LOCATION);
  // A huge destination costs only its leading segments.
  assert.deepEqual(parseDestination(`review/compare/${'x'.repeat(1_000_000)}`, lookup), { nav: 'review', section: 'compare', sub: null });
  // Formatting never emits a destination the shell would reject.
  const tooLong: DesignLocation = { nav: 'resources', section: 'components', sub: `item/${'a'.repeat(600)}` };
  assert.equal(formatDestination(tooLong), 'resources/components');
  assert.equal(itemSub(''), null);
  assert.equal(itemSub('\ud800'), null, 'a lone surrogate cannot be encoded');
  assert.equal(itemSub('Button Primary'), 'item/Button%20Primary');
});

test('format drops a malformed view and equality treats absent and null as the same', () => {
  assert.equal(formatDestination({ nav: 'review', section: 'compare', sub: 'bad/segment' }), 'review/compare');
  assert.equal(formatDestination({ nav: 'review', section: 'compare', sub: null }), 'review/compare');
  assert.equal(formatDestination({ nav: 'review', section: null, sub: 'swipe' }), 'review');
  assert.equal(sameLocation({ nav: 'review', section: 'compare' }, { nav: 'review', section: 'compare', sub: null }), true);
  assert.equal(sameLocation({ nav: 'review', section: 'compare', sub: 'swipe' }, { nav: 'review', section: 'compare', sub: 'matrix' }), false);
  assert.equal(sameLocation({ nav: 'review', section: 'compare', sub: 'swipe' }, { nav: 'review', section: 'compare' }), false);
  assert.equal(sameLocation({ nav: 'review', section: 'compare' }, { nav: 'resources', section: 'compare' }), false);
});

function harness() {
  const core = createDesignCore(createFakeStorage());
  const payloads = sectionPayloadsFor(core.sessions);
  const route = (projectId: string, destination: string) => resolveDesignRoute({
    requested: parseDestination(destination, lookup), registry, lastSection: core.sessions.get(projectId).lastSection,
    remembered: (sectionId) => payloads.view(projectId, sectionId),
  });
  return { core, payloads, route };
}

test('precedence: an explicit valid view beats the remembered one, which beats the default', () => {
  const { payloads, route } = harness();
  assert.deepEqual(route('alpha', 'review/compare'), { location: { nav: 'review', section: 'compare' }, sub: 'strip', subExplicit: false });
  assert.equal(route('alpha', 'resources/components').sub, null, 'an item section has no default view; it chooses its first entry');
  assert.equal(payloads.setView('alpha', 'compare', 'swipe'), true);
  assert.deepEqual(route('alpha', 'review/compare'), { location: { nav: 'review', section: 'compare' }, sub: 'swipe', subExplicit: false });
  assert.deepEqual(route('alpha', 'review/compare/matrix'), { location: { nav: 'review', section: 'compare', sub: 'matrix' }, sub: 'matrix', subExplicit: true });
  assert.equal(route('alpha', 'review/compare/nope').sub, 'swipe', 'an invalid explicit view falls back to the remembered one');
  assert.equal(route('alpha', 'review/compare/nope').subExplicit, false);
  assert.equal(route('alpha', 'review/canvas/swipe').sub, null, 'a section without views ignores one');
});

test('precedence is per project and per section', () => {
  const { payloads, route } = harness();
  payloads.setView('alpha', 'compare', 'swipe');
  payloads.setView('alpha', 'flows', 'board');
  assert.equal(route('beta', 'review/compare').sub, 'strip');
  assert.equal(route('alpha', 'resources/flows').sub, 'board');
  assert.equal(route('beta', 'resources/flows').sub, 'player');
  payloads.setView('beta', 'compare', 'matrix');
  assert.equal(route('alpha', 'review/compare').sub, 'swipe');
  assert.equal(route('beta', 'review/compare').sub, 'matrix');
});

test('a remembered view the descriptor no longer declares is ignored, an item view is kept', () => {
  const { payloads, route } = harness();
  payloads.setView('alpha', 'flows', 'retired');
  assert.equal(route('alpha', 'resources/flows').sub, 'player');
  payloads.setView('alpha', 'components', 'item/Button%20Primary');
  assert.equal(route('alpha', 'resources/components').sub, 'item/Button%20Primary');
  assert.equal(route('alpha', 'resources/components').subExplicit, false, 'a remembered item is not an explicit route, so a section may fall back silently');
  assert.equal(route('alpha', 'resources/components/item/Gone').subExplicit, true, 'an explicit unknown item is explicit, so a section may say it is missing');
});

test('bare, restored and returned destinations are shown with the effective view but never rewritten', () => {
  const { core, payloads, route } = harness();
  core.sessions.setLastSection('alpha', 'review', 'compare');
  payloads.setView('alpha', 'compare', 'swipe');
  for (const destination of ['review', 'review/compare']) {
    const shown = route('alpha', destination);
    assert.equal(shown.sub, 'swipe', destination);
    assert.equal(shown.subExplicit, false, destination);
    assert.equal(formatDestination(shown.location), 'review/compare', 'the location carries no remembered view, so nothing is rewritten');
  }
  // A return string with an explicit view restores exactly, even over a different remembered view.
  const returned = route('alpha', 'review/compare/matrix');
  assert.equal(formatDestination(returned.location), 'review/compare/matrix');
  assert.equal(returned.sub, 'matrix');
  assert.equal(payloads.view('alpha', 'compare'), 'swipe', 'resolving a route never changes what is remembered');
});

test('an area-only destination resolves to the remembered section, and a wrong area falls back like before', () => {
  const { core, route } = harness();
  core.sessions.setLastSection('alpha', 'review', 'compare');
  assert.deepEqual(route('alpha', 'review').location, { nav: 'review', section: 'compare' });
  assert.equal(route('alpha', 'resources/compare/swipe').location.section, 'components', 'compare is not in resources');
  assert.equal(route('alpha', 'resources/compare/swipe').subExplicit, false);
  assert.deepEqual(route('alpha', 'runs').location, { nav: 'runs', section: null });
});

test('the crumb names group, section and view', () => {
  const { payloads, route } = harness();
  assert.deepEqual(crumbFor(route('alpha', 'review/canvas'), registry), ['Review', 'Canvas']);
  assert.deepEqual(crumbFor(route('alpha', 'review/compare'), registry), ['Review', 'Compare', 'Strip']);
  payloads.setView('alpha', 'compare', 'swipe');
  assert.deepEqual(crumbFor(route('alpha', 'review/compare'), registry), ['Review', 'Compare', 'Swipe stage']);
  assert.deepEqual(crumbFor(route('alpha', 'resources/components/item/Button%20Primary'), registry), ['Resources', 'Components', 'Button Primary']);
  assert.deepEqual(crumbFor(route('alpha', 'runs'), registry), ['Runs']);
});

const commandSections = registry.sections.map((section) => ({
  id: section.id, title: section.title, nav: section.nav, commands: section.commands,
  ...(section.subRoutes === undefined ? {} : { subRoutes: section.subRoutes }),
}));
const startLocation: DesignLocation = { nav: 'projects', section: null };
const baseView = { location: startLocation, sectionsByNav: registry.byNav, visible: { sidebar: true, inspector: true }, lastSection: {} };

test('command destinations: each fixed view has an explicit command that round-trips as a destination', () => {
  const commands = buildCommands({ ...baseView, sections: commandSections, currentProjectId: 'alpha' });
  const sub = commands.filter((command) => command.id.startsWith('sub:'));
  assert.deepEqual(sub.map((command) => command.id), [
    'sub:components:tokens', 'sub:components:motion',
    'sub:flows:player', 'sub:flows:storyboards', 'sub:flows:outline', 'sub:flows:board',
    'sub:compare:strip', 'sub:compare:before-after', 'sub:compare:swipe', 'sub:compare:matrix',
  ], 'section order, then declared view order');
  const swipe = commands.find((command) => command.id === 'sub:compare:swipe');
  assert.equal(swipe?.title, 'Open Compare · Swipe stage');
  assert.equal(swipe?.group, 'Sections');
  assert.deepEqual(swipe?.action, { type: 'navigate', location: { nav: 'review', section: 'compare', sub: 'swipe' } });
  assert.ok(!commands.some((command) => command.id.startsWith('sub:components:item')), 'no per-entry commands are invented');
  for (const command of commands) {
    if (command.action.type !== 'navigate') continue;
    const destination = formatDestination(command.action.location);
    assert.deepEqual(parseDestination(destination, lookup), command.action.location, command.id);
  }
  // Commands of one section stay contiguous in their group, after the section's own entry.
  const ids = commands.map((command) => command.id);
  assert.equal(ids.indexOf('sub:compare:strip'), ids.indexOf('section:compare') + 1);
  assert.deepEqual(commands.filter((command) => command.group === 'Sections').map((command) => command.id).slice(0, 4), ['section:projects', 'section:components', 'sub:components:tokens', 'sub:components:motion']);
});

test('existing section and project commands are preserved alongside view commands', () => {
  const commands = buildCommands({ ...baseView, sections: commandSections, currentProjectId: 'alpha', projects: [{ id: 'alpha', name: 'A' }, { id: 'beta', name: 'B' }] });
  for (const id of ['nav:review', 'section:compare', 'section:flows', 'toggle:sidebar', 'toggle:inspector', 'project:beta']) assert.ok(commands.some((command) => command.id === id), id);
  assert.ok(!commands.some((command) => command.id === 'project:alpha'));
});

// ---- payload owner ----

test('legacy section state is wrapped, not lost, when a view is first remembered', () => {
  const { core, payloads } = harness();
  const raw = core.sessions.sectionHandle('alpha', 'compare');
  assert.equal(raw.write({ draft: 'keep me' }), true);
  assert.deepEqual(readPayload(raw.read()), { kind: 'legacy', data: { draft: 'keep me' } });
  const data = payloads.dataHandle('alpha', 'compare');
  assert.deepEqual(data.read(), { draft: 'keep me' }, 'a section still reads its legacy state');
  assert.equal(payloads.view('alpha', 'compare'), null);
  assert.equal(payloads.setView('alpha', 'compare', 'swipe'), true);
  assert.deepEqual(raw.read(), { v: 1, view: 'swipe', data: { draft: 'keep me' } });
  assert.deepEqual(data.read(), { draft: 'keep me' });
  assert.equal(payloads.view('alpha', 'compare'), 'swipe');
});

test('writes are read-modify-write: view and data never clobber each other', () => {
  const { core, payloads } = harness();
  const data = payloads.dataHandle('alpha', 'flows');
  assert.equal(data.read(), undefined);
  assert.equal(payloads.setView('alpha', 'flows', 'board'), true);
  assert.equal(data.read(), undefined, 'a view alone is not section data');
  assert.equal(data.write({ selected: 3 }), true);
  assert.equal(payloads.view('alpha', 'flows'), 'board');
  assert.equal(payloads.setView('alpha', 'flows', 'outline'), true);
  assert.deepEqual(data.read(), { selected: 3 });
  assert.deepEqual(core.sessions.sectionHandle('alpha', 'flows').read(), { v: 1, view: 'outline', data: { selected: 3 } });
  assert.equal(payloads.setView('alpha', 'flows', null), true);
  assert.deepEqual(data.read(), { selected: 3 });
  assert.equal(payloads.view('alpha', 'flows'), null);
  assert.equal(payloads.dataHandle('alpha', 'flows'), data, 'the derived handle is stable');
});

test('the derived handle keeps the existing bounds and never exposes the view', () => {
  const { core, payloads } = harness();
  const data = payloads.dataHandle('alpha', 'compare');
  assert.equal(data.write('x'.repeat(MAX_SECTION_STATE + 1)), false);
  assert.equal(data.write(Number.NaN), false, 'a non-finite number is not JSON');
  assert.equal(data.read(), undefined);
  payloads.setView('alpha', 'compare', 'swipe');
  assert.ok(!JSON.stringify(data.read() ?? null).includes('swipe'));
  assert.equal(payloads.setView('alpha', 'compare', ''), false);
  assert.equal(payloads.setView('alpha', 'compare', 'v'.repeat(MAX_VIEW + 1)), false);
  assert.equal(payloads.view('alpha', 'compare'), 'swipe');
  assert.equal(core.sessions.get('alpha').sections.compare !== undefined, true);
});

test('classification: empty, legacy, malformed envelope and envelope', () => {
  assert.deepEqual(readPayload(undefined), { kind: 'empty' });
  assert.deepEqual(readPayload(null), { kind: 'legacy', data: null });
  assert.deepEqual(readPayload([1, 2]), { kind: 'legacy', data: [1, 2] });
  assert.deepEqual(readPayload({ v: 1, view: 5, data: 1 }), { kind: 'legacy', data: { v: 1, view: 5, data: 1 } }, 'a malformed envelope is preserved as data');
  assert.deepEqual(readPayload({ v: 1, view: 'swipe', data: { a: 1 }, extra: true }), { kind: 'legacy', data: { v: 1, view: 'swipe', data: { a: 1 }, extra: true } });
  assert.deepEqual(readPayload({ v: 1, view: null, data: null }), { kind: 'envelope', view: null, data: null });
  assert.deepEqual(readPayload({ v: 1, view: 'swipe', data: { a: 1 } }), { kind: 'envelope', view: 'swipe', data: { a: 1 } });
});

test('a newer payload is read-only: its data is readable, writes are refused and the view lives in memory', () => {
  const stored: JsonValue = { v: 2, view: 'matrix', data: { future: true }, more: [1] };
  const storage = createFakeStorage();
  const core = createDesignCore(storage);
  const payloads = sectionPayloadsFor(core.sessions);
  const raw = core.sessions.sectionHandle('alpha', 'compare');
  assert.equal(raw.write(stored), true);
  assert.deepEqual(readPayload(raw.read()), { kind: 'future', version: 2, data: { future: true } });
  const data = payloads.dataHandle('alpha', 'compare');
  assert.deepEqual(data.read(), { future: true });
  assert.equal(data.write({ future: false }), false, 'a newer payload is never overwritten');
  assert.equal(payloads.view('alpha', 'compare'), null, 'its stored view is not interpreted by this build');
  assert.equal(payloads.setView('alpha', 'compare', 'swipe'), true);
  assert.equal(payloads.view('alpha', 'compare'), 'swipe', 'kept in memory for this session');
  assert.deepEqual(raw.read(), stored, 'the stored payload is untouched');
  core.deactivate();
  assert.deepEqual(JSON.parse(storage.data.get(sessionKey('alpha'))!).sections.compare, stored);
  assert.equal(payloads.view('beta', 'compare'), null, 'the in-memory view is per project');
});

test('held storage stays truthful: choices change memory, the held text is untouched until Start fresh', () => {
  const heldText = '{"schema":';
  const storage = createFakeStorage({ [sessionKey('alpha')]: heldText });
  const core = createDesignCore(storage);
  const payloads = sectionPayloadsFor(core.sessions);
  assert.equal(core.sessions.persistence('alpha').status, 'held');
  assert.equal(payloads.setView('alpha', 'compare', 'swipe'), true);
  assert.equal(payloads.view('alpha', 'compare'), 'swipe');
  core.deactivate();
  assert.equal(storage.data.get(sessionKey('alpha')), heldText);
  assert.equal(storage.writes.length, 0);
  assert.equal(core.sessions.persistence('alpha').status, 'held');
  core.sessions.startFresh('alpha');
  core.deactivate();
  assert.deepEqual(JSON.parse(storage.data.get(sessionKey('alpha'))!).sections.compare, { v: 1, view: 'swipe', data: null });
});

test('unavailable storage keeps the choice in memory and reports it', () => {
  const storage = createFakeStorage();
  storage.failWrites = true;
  const core = createDesignCore(storage);
  const payloads = sectionPayloadsFor(core.sessions);
  payloads.setView('alpha', 'compare', 'swipe');
  core.deactivate();
  assert.equal(core.sessions.persistence('alpha').status, 'unavailable');
  assert.equal(payloads.view('alpha', 'compare'), 'swipe');
  storage.failWrites = false;
  core.deactivate();
  assert.equal(core.sessions.persistence('alpha').status, 'ok');
  assert.deepEqual(JSON.parse(storage.data.get(sessionKey('alpha'))!).sections.compare, { v: 1, view: 'swipe', data: null });
});

test('the envelope survives serialize and restore and keeps unrelated sections', () => {
  const first = createDesignCore(createFakeStorage());
  const payloads = sectionPayloadsFor(first.sessions);
  first.sessions.sectionHandle('alpha', 'canvas').write({ zoom: 2 });
  payloads.dataHandle('alpha', 'compare').write({ pair: [1, 2] });
  payloads.setView('alpha', 'compare', 'before-after');
  const text = first.serialize('alpha')!;
  const second = createDesignCore(null);
  assert.deepEqual(second.restore('alpha', text), { status: 'restored' });
  const again = sectionPayloadsFor(second.sessions);
  assert.equal(again.view('alpha', 'compare'), 'before-after');
  assert.deepEqual(again.dataHandle('alpha', 'compare').read(), { pair: [1, 2] });
  assert.deepEqual(second.sessions.sectionHandle('alpha', 'canvas').read(), { zoom: 2 });
  assert.equal(JSON.parse(text).schema, 'hq.design.ui-session/v1', 'the session schema is unchanged');
});

test('a section without views keeps its raw slot: the owner is only used for sections that declare views', () => {
  const { core } = harness();
  const canvas = core.sessions.sectionHandle('alpha', 'canvas');
  canvas.write({ viewport: { x: 1 } });
  assert.deepEqual(canvas.read(), { viewport: { x: 1 } });
  assert.equal(registry.get('canvas')?.subRoutes, undefined);
});
