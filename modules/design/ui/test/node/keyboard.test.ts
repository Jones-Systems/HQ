import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DESIGN_NAV_IDS, type DesignLocation } from '../../contract.ts';
import { HOSTED_REGIONS, navTarget, ownsPalette, regionStop, resolveShortcut, rovingNext, SHORTCUT_HINTS, shortcutHints, tabStops, type ChromeView, type KeyInput } from '../../src/focus.ts';
import { formatDestination } from '../../src/navigation.ts';
import { buildCommands, filterCommands, paletteReduce, CLOSED_PALETTE } from '../../src/palette.ts';
import { chromeView, SYNTHETIC_SECTIONS } from './fixtures.ts';

interface MachineState {
  readonly view: ChromeView;
  readonly focus: string;
  readonly palette: number | null;
}

const key = (state: MachineState) => `${formatDestination(state.view.location)}|${state.view.visible.sidebar}|${state.view.visible.inspector}|${state.focus}|${state.palette}|${JSON.stringify(state.view.lastSection)}`;

function go(view: ChromeView, location: DesignLocation): ChromeView {
  return { ...view, location, lastSection: location.section === null ? view.lastSection : { ...view.lastSection, [location.nav]: location.section } };
}

/** Keys only: Tab, Shift+Tab, Enter, F6, Mod+K, ArrowDown and Enter inside the palette. */
function step(state: MachineState, input: string): MachineState {
  const stops = tabStops(state.view);
  if (state.palette !== null) {
    const commands = buildCommands({ ...state.view, sections: SYNTHETIC_SECTIONS.map((s) => ({ ...s, commands: [] })), currentProjectId: 'p1' });
    if (input === 'ArrowDown') return { ...state, palette: (state.palette + 1) % commands.length };
    if (input === 'Escape') return { ...state, palette: null };
    if (input !== 'Enter') return state;
    const action = commands[state.palette]!.action;
    if (action.type === 'navigate') return { ...state, palette: null, view: go(state.view, action.location) };
    if (action.type === 'toggle-panel') return { ...state, palette: null, view: { ...state.view, visible: { ...state.view.visible, [action.panel]: !state.view.visible[action.panel] } } };
    return { ...state, palette: null };
  }
  const index = stops.findIndex((stop) => stop.id === state.focus);
  const at = (i: number) => stops[(i + stops.length) % stops.length]!.id;
  switch (input) {
    case 'Tab': return { ...state, focus: at(index + 1) };
    case 'Shift+Tab': return { ...state, focus: at(index - 1) };
    case 'F6': return { ...state, focus: regionStop(stops, state.focus, false)?.id ?? state.focus };
    case 'Mod+K': return { ...state, palette: 0 };
    case 'Enter': {
      const action = stops[index]?.action;
      if (action?.type === 'navigate') {
        const view = go(state.view, action.location);
        return { ...state, view, focus: tabStops(view).some((s) => s.id === state.focus) ? state.focus : 'nav:projects' };
      }
      if (action?.type === 'toggle-panel') return { ...state, view: { ...state.view, visible: { ...state.view.visible, [action.panel]: !state.view.visible[action.panel] } } };
      if (action?.type === 'open-palette') return { ...state, palette: 0 };
      return state;
    }
    default: return state;
  }
}

const allTargets = [
  ...DESIGN_NAV_IDS.filter((nav) => !SYNTHETIC_SECTIONS.some((s) => s.nav === nav)),
  ...SYNTHETIC_SECTIONS.map((s) => `${s.nav}/${s.id}`),
];

/** Breadth-first search over key presses; stops once every target has been visited. */
function reachable(start: MachineState, inputs: readonly string[]): Set<string> {
  const seen = new Set([key(start)]);
  const locations = new Set<string>();
  const queue = [start];
  for (let index = 0; index < queue.length; index += 1) {
    const state = queue[index]!;
    locations.add(formatDestination(state.view.location));
    if (allTargets.every((target) => locations.has(target))) break;
    for (const input of inputs) {
      const next = step(state, input);
      const id = key(next);
      if (!seen.has(id)) { seen.add(id); queue.push(next); }
    }
  }
  return locations;
}

test('every navigation target is reachable with Tab and Enter alone', () => {
  const locations = reachable({ view: chromeView(), focus: 'nav:projects', palette: null }, ['Tab', 'Shift+Tab', 'Enter']);
  for (const target of allTargets) assert.ok(locations.has(target), `unreachable: ${target}`);
});

test('every navigation target stays reachable with both panels hidden', () => {
  const view = chromeView({ visible: { sidebar: false, inspector: false } });
  assert.deepEqual(tabStops(view).filter((stop) => stop.region === 'sidebar').map((stop) => stop.id), ['splitter:sidebar']);
  const locations = reachable({ view, focus: 'nav:projects', palette: null }, ['Tab', 'Enter']);
  for (const target of allTargets) assert.ok(locations.has(target), `unreachable: ${target}`);
});

test('every navigation target is reachable through the command palette alone', () => {
  const locations = reachable({ view: chromeView({ visible: { sidebar: false, inspector: false } }), focus: 'workspace', palette: null }, ['Mod+K', 'ArrowDown', 'Enter']);
  for (const target of allTargets) assert.ok(locations.has(target), `unreachable: ${target}`);
});

test('tab stops are unique, ordered by region, and every nav area is a stop', () => {
  const stops = tabStops(chromeView({ location: { nav: 'review', section: 'canvas' } }));
  assert.equal(new Set(stops.map((s) => s.id)).size, stops.length);
  const regions = stops.map((s) => s.region);
  assert.deepEqual([...new Set(regions)], ['bar', 'sidebar', 'main', 'inspector']);
  for (const nav of DESIGN_NAV_IDS) assert.ok(stops.some((s) => s.id === `nav:${nav}`));
  assert.deepEqual(stops.filter((s) => s.region === 'sidebar').map((s) => s.id), ['section:canvas', 'section:compare', 'splitter:sidebar']);
});

test('a nav area returns to its last section', () => {
  const stops = tabStops(chromeView({ lastSection: { review: 'compare' } }));
  assert.deepEqual(stops.find((s) => s.id === 'nav:review')?.action, { type: 'navigate', location: { nav: 'review', section: 'compare' } });
  const stale = tabStops(chromeView({ lastSection: { review: 'gone' } }));
  assert.deepEqual(stale.find((s) => s.id === 'nav:review')?.action, { type: 'navigate', location: { nav: 'review', section: 'canvas' } });
});

test('F6 cycles populated regions including the collapsed panel restoration grips', () => {
  const stops = tabStops(chromeView({ visible: { sidebar: false, inspector: true } }));
  assert.equal(regionStop(stops, 'nav:runs', false)?.id, 'splitter:sidebar');
  assert.equal(regionStop(stops, 'workspace', false)?.id, 'splitter:inspector');
  assert.equal(regionStop(stops, 'inspector', false)?.id, 'nav:projects');
  assert.equal(regionStop(stops, 'nav:projects', true)?.id, 'splitter:inspector');
  assert.equal(regionStop(stops, null, false)?.id, 'nav:projects');
});

test('arrow keys rove within the sub-navigation and section lists', () => {
  const ids = DESIGN_NAV_IDS.map((nav) => `nav:${nav}`);
  assert.equal(rovingNext(ids, 'nav:projects', 'ArrowRight', 'horizontal'), 'nav:resources');
  assert.equal(rovingNext(ids, 'nav:projects', 'ArrowLeft', 'horizontal'), 'nav:runs');
  assert.equal(rovingNext(ids, 'nav:review', 'End', 'horizontal'), 'nav:runs');
  assert.equal(rovingNext(ids, 'nav:review', 'Home', 'horizontal'), 'nav:projects');
  assert.equal(rovingNext(ids, 'nav:review', 'ArrowDown', 'horizontal'), null);
  assert.equal(rovingNext(['a', 'b'], 'b', 'ArrowDown', 'vertical'), 'a');
});

const input = (overrides: Partial<KeyInput>): KeyInput => ({ key: '', code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, editable: false, ...overrides });

test('shortcuts use Cmd on macOS and Ctrl elsewhere', () => {
  assert.deepEqual(resolveShortcut(input({ key: 'k', metaKey: true }), true), { type: 'palette' });
  assert.equal(resolveShortcut(input({ key: 'k', ctrlKey: true }), true), null);
  assert.deepEqual(resolveShortcut(input({ key: 'K', ctrlKey: true }), false), { type: 'palette' });
  assert.deepEqual(resolveShortcut(input({ key: '\\', ctrlKey: true }), false), { type: 'toggle-panel', panel: 'sidebar' });
  assert.deepEqual(resolveShortcut(input({ key: '|', ctrlKey: true, shiftKey: true }), false), { type: 'toggle-panel', panel: 'inspector' });
});

test('Alt+digit reaches all five areas using the physical key, even when macOS remaps the character', () => {
  DESIGN_NAV_IDS.forEach((nav, index) => {
    assert.deepEqual(resolveShortcut(input({ key: '¡', code: `Digit${index + 1}`, altKey: true }), true), { type: 'nav', nav });
  });
  assert.equal(resolveShortcut(input({ key: '6', code: 'Digit6', altKey: true }), false), null);
});

test('typing in a field never triggers navigation shortcuts, but palette, F6 and Escape still work', () => {
  assert.equal(resolveShortcut(input({ key: '1', code: 'Digit1', altKey: true, editable: true }), false), null);
  assert.equal(resolveShortcut(input({ key: '\\', ctrlKey: true, editable: true }), false), null);
  assert.deepEqual(resolveShortcut(input({ key: 'k', ctrlKey: true, editable: true }), false), { type: 'palette' });
  assert.deepEqual(resolveShortcut(input({ key: 'F6', shiftKey: true, editable: true }), false), { type: 'region', backwards: true });
  assert.deepEqual(resolveShortcut(input({ key: 'Escape', editable: true }), false), { type: 'dismiss' });
});

test('palette filtering ranks prefix matches and highlighting never executes', () => {
  const commands = buildCommands({ ...chromeView(), sections: SYNTHETIC_SECTIONS.map((s) => ({ ...s, commands: s.id === 'canvas' ? [{ id: 'fit', title: 'Fit to screen' }] : [] })), currentProjectId: 'p1' });
  assert.equal(filterCommands(commands, 'comp')[0]?.id, 'section:components');
  assert.equal(filterCommands(commands, 'fit')[0]?.id, 'command:canvas:fit');
  assert.deepEqual(filterCommands(commands, 'zzzz'), []);
  assert.equal(filterCommands(commands, '  ').length, commands.length);
  let state = paletteReduce(CLOSED_PALETTE, { type: 'open', returnFocus: 'nav:review' });
  state = paletteReduce(state, { type: 'move', by: 'previous', count: 3 });
  assert.equal(state.active, 2);
  state = paletteReduce(state, { type: 'query', query: 'run' });
  assert.equal(state.active, 0);
  assert.equal(paletteReduce(state, { type: 'close' }).open, false);
  assert.equal(state.returnFocus, 'nav:review');
});

test('responsive squeeze omits unavailable edges but manually collapsed panels retain keyboard grips', () => {
  const collapsed = chromeView({ visible: { sidebar: false, inspector: false } });
  const stops = tabStops(collapsed);
  assert.ok(stops.some((stop) => stop.id === 'splitter:sidebar'));
  assert.ok(stops.some((stop) => stop.id === 'splitter:inspector'));
  const squeezed = tabStops({ ...collapsed, squeezed: ['sidebar', 'inspector'] });
  assert.ok(!squeezed.some((stop) => stop.id.startsWith('splitter:')));
  assert.equal(regionStop(squeezed, 'nav:runs', false)?.id, 'workspace');
});

const hostedView = (overrides: Partial<ChromeView> = {}): ChromeView => chromeView({ hosted: true, location: { nav: 'review', section: 'canvas' }, ...overrides });

test('hosted, the shell owns navigation: no area buttons, section list, sidebar splitter or sidebar toggle are stops', () => {
  const stops = tabStops(hostedView());
  assert.deepEqual(stops.map((stop) => stop.id), ['palette', 'toggle:inspector', 'workspace', 'splitter:inspector', 'inspector']);
  assert.equal(new Set(stops.map((stop) => stop.id)).size, stops.length);
  assert.ok(!stops.some((stop) => stop.id.startsWith('nav:') || stop.id.startsWith('section:') || stop.id === 'splitter:sidebar' || stop.id === 'toggle:sidebar'));
  const collapsed = tabStops(hostedView({ visible: { sidebar: false, inspector: false } }));
  assert.deepEqual(collapsed.map((stop) => stop.id), ['palette', 'toggle:inspector', 'workspace', 'splitter:inspector']);
  assert.deepEqual(tabStops(hostedView({ squeezed: ['inspector'] })).map((stop) => stop.id), ['palette', 'toggle:inspector', 'workspace', 'inspector'], 'squeezed omits only the grip');
});

test('hosted false or absent leaves the standalone stops exactly as before', () => {
  const standalone = tabStops(chromeView({ location: { nav: 'review', section: 'canvas' } }));
  assert.deepEqual(tabStops(chromeView({ location: { nav: 'review', section: 'canvas' }, hosted: false })), standalone);
  assert.deepEqual(standalone.map((stop) => stop.id).slice(0, 8), ['nav:projects', 'nav:resources', 'nav:review', 'nav:requests', 'nav:runs', 'palette', 'toggle:sidebar', 'toggle:inspector']);
});

test('hosted, every control that remains is reachable with Tab and Enter, and the palette still reaches every target', () => {
  const view = hostedView();
  const stops = tabStops(view);
  const palette = stops.find((stop) => stop.id === 'palette');
  assert.deepEqual(palette?.action, { type: 'open-palette' });
  assert.deepEqual(stops.find((stop) => stop.id === 'toggle:inspector')?.action, { type: 'toggle-panel', panel: 'inspector' });
  const locations = reachable({ view, focus: 'palette', palette: null }, ['Mod+K', 'ArrowDown', 'Enter']);
  for (const target of allTargets) assert.ok(locations.has(target), `unreachable: ${target}`);
});

test('hosted F6 cycles the workspace and the inspector only', () => {
  const stops = tabStops(hostedView());
  const forward = (from: string | null) => regionStop(stops, from, false, HOSTED_REGIONS)?.id;
  const backward = (from: string | null) => regionStop(stops, from, true, HOSTED_REGIONS)?.id;
  assert.equal(forward('workspace'), 'splitter:inspector', 'the first stop of the inspector region');
  assert.equal(forward('inspector'), 'workspace');
  assert.equal(backward('workspace'), 'splitter:inspector');
  assert.equal(backward('inspector'), 'workspace');
  assert.equal(forward('palette'), 'workspace', 'from the page head, F6 enters the cycle at its start');
  assert.equal(forward(null), 'workspace');
  const single = tabStops(hostedView({ visible: { sidebar: true, inspector: false }, squeezed: ['inspector'] }));
  assert.deepEqual(single.map((stop) => stop.id), ['palette', 'toggle:inspector', 'workspace']);
  assert.equal(regionStop(single, 'workspace', false, HOSTED_REGIONS)?.id, 'workspace', 'one populated region cycles to itself');
  assert.equal(regionStop([], 'workspace', false, HOSTED_REGIONS), null);
  // The default cycle is unchanged for standalone callers.
  assert.equal(regionStop(tabStops(chromeView()), 'nav:runs', false)?.id, 'section:projects');
});

test('Mod+\\ is forwarded to the shell when hosted and never toggles Design\'s own sidebar', () => {
  const sidebar = input({ key: '\\', ctrlKey: true });
  assert.deepEqual(resolveShortcut(sidebar, false, true), { type: 'host-nav-toggle' });
  assert.deepEqual(resolveShortcut(input({ key: '\\', metaKey: true }), true, true), { type: 'host-nav-toggle' });
  assert.deepEqual(resolveShortcut(sidebar, false, false), { type: 'toggle-panel', panel: 'sidebar' }, 'standalone is unchanged');
  assert.deepEqual(resolveShortcut(sidebar, false), { type: 'toggle-panel', panel: 'sidebar' }, 'the default is standalone');
  assert.deepEqual(resolveShortcut(input({ key: '|', ctrlKey: true, shiftKey: true }), false, true), { type: 'toggle-panel', panel: 'inspector' }, 'the inspector stays Design\'s');
  assert.equal(resolveShortcut(input({ key: '\\', ctrlKey: true, editable: true }), false, true), null, 'typing never toggles anything');
  assert.equal(resolveShortcut(input({ key: '\\', ctrlKey: true, altKey: true }), false, true), null);
});

test('other shortcuts are the same hosted and standalone', () => {
  for (const hosted of [false, true]) {
    assert.deepEqual(resolveShortcut(input({ key: 'k', ctrlKey: true }), false, hosted), { type: 'palette' });
    assert.deepEqual(resolveShortcut(input({ key: 'F6' }), false, hosted), { type: 'region', backwards: false });
    assert.deepEqual(resolveShortcut(input({ key: 'Escape' }), false, hosted), { type: 'dismiss' });
    assert.deepEqual(resolveShortcut(input({ key: '2', code: 'Digit2', altKey: true }), false, hosted), { type: 'nav', nav: 'resources' });
  }
});

test('hosted, Design opens its own palette only for a Mod+K that starts inside its chrome', () => {
  assert.equal(ownsPalette(false, false), true, 'standalone always owns it');
  assert.equal(ownsPalette(false, true), true);
  assert.equal(ownsPalette(true, true), true);
  assert.equal(ownsPalette(true, false), false, 'body focus, the shell navigation and other domains reach the shell palette');
});

test('the inspector hint for Mod+\\ names what it does in each mode', () => {
  assert.equal(shortcutHints(false), SHORTCUT_HINTS);
  const hosted = shortcutHints(true);
  assert.equal(hosted.length, SHORTCUT_HINTS.length);
  assert.equal(hosted.find((hint) => hint.keys === 'Mod+\\')?.action, 'Expand or compact navigation');
  assert.deepEqual(hosted.filter((hint) => hint.keys !== 'Mod+\\'), SHORTCUT_HINTS.filter((hint) => hint.keys !== 'Mod+\\'));
});

test('navTarget needs only the sections and the remembered section', () => {
  assert.deepEqual(navTarget({ sectionsByNav: chromeView().sectionsByNav, lastSection: { review: 'compare' } }, 'review'), { nav: 'review', section: 'compare' });
  assert.deepEqual(navTarget({ sectionsByNav: chromeView().sectionsByNav, lastSection: {} }, 'runs'), { nav: 'runs', section: 'connector' });
});

const viewSections = SYNTHETIC_SECTIONS.map((section) => ({
  ...section, commands: [],
  ...(section.id === 'compare' ? { subRoutes: { fixed: [{ id: 'strip', title: 'Strip' }, { id: 'swipe', title: 'Swipe stage' }], navChildren: true } } : {}),
}));

test('the palette lists each declared view and still reaches every section; hosted drops only the sidebar toggle', () => {
  const standalone = buildCommands({ ...chromeView(), sections: viewSections, currentProjectId: 'p1' });
  const hosted = buildCommands({ ...chromeView({ hosted: true }), sections: viewSections, currentProjectId: 'p1' });
  assert.ok(standalone.some((command) => command.id === 'toggle:sidebar'));
  assert.ok(!hosted.some((command) => command.id === 'toggle:sidebar'));
  assert.ok(hosted.some((command) => command.id === 'toggle:inspector'));
  assert.deepEqual(hosted.filter((command) => command.id !== 'toggle:sidebar' && command.id !== 'toggle:inspector').map((command) => command.id),
    standalone.filter((command) => command.id !== 'toggle:sidebar' && command.id !== 'toggle:inspector').map((command) => command.id), 'every other command is the same');
  assert.deepEqual(standalone.filter((command) => command.id.startsWith('sub:')).map((command) => command.id), ['sub:compare:strip', 'sub:compare:swipe']);
  assert.deepEqual(filterCommands(standalone, 'swipe')[0]?.action, { type: 'navigate', location: { nav: 'review', section: 'compare', sub: 'swipe' } });
  assert.equal(filterCommands(standalone, 'stage')[0]?.id, 'sub:compare:swipe', 'a view is found by its title');
  for (const section of SYNTHETIC_SECTIONS) assert.ok(standalone.some((command) => command.id === `section:${section.id}`), section.id);
});
