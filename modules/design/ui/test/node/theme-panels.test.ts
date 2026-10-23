import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_LOCATION, formatDestination, parseDestination } from '../../src/navigation.ts';
import { DEFAULT_LAYOUT, fitSidebar, MAIN_MIN, naturalSidebar, PANEL_BOUNDS, parseLayout, resizePanel, setPanelSize, resolveLayout, sidebarPadding, splitterKey, togglePanel } from '../../src/panels.ts';
import { chromeTheme, FALLBACK_TOKENS, isCssColor, surfaceProps } from '../../src/theme.ts';

test('dark tokens recolour every chrome variable', () => {
  const light = chromeTheme('light', FALLBACK_TOKENS.light);
  const dark = chromeTheme('dark', FALLBACK_TOKENS.dark);
  for (const name of Object.keys(light.vars) as (keyof typeof light.vars)[]) assert.notEqual(light.vars[name], dark.vars[name], name);
});

test('shell-supplied tokens are used; unsafe values fall back and are reported', () => {
  const theme = chromeTheme('dark', { ...FALLBACK_TOKENS.dark, accent: 'oklch(0.7 0.1 250)', text: 'red;} body{display:none', line: 'url(x)' });
  assert.equal(theme.vars['--hqd-accent'], 'oklch(0.7 0.1 250)');
  assert.equal(theme.vars['--hqd-text'], `var(--hq-text, ${FALLBACK_TOKENS.dark.text})`);
  assert.equal(theme.vars['--hqd-line'], `var(--hq-border, ${FALLBACK_TOKENS.dark.line})`);
  assert.deepEqual(theme.rejected, ['text', 'line']);
  assert.ok(!isCssColor('var(--x)'));
  assert.ok(isCssColor('#abcd'));
});

test('capture and preview surfaces are independent of appearance', () => {
  // surfaceProps takes no appearance; it is the same object shape for any theme.
  assert.equal(surfaceProps.length, 1);
  const capture = surfaceProps('capture');
  assert.deepEqual(capture.style, {
    colorScheme: 'normal', filter: 'none', mixBlendMode: 'normal', opacity: 1,
    isolation: 'isolate', forcedColorAdjust: 'none', backgroundColor: 'transparent',
  });
  assert.ok(!JSON.stringify(capture).includes('--hqd-'), 'no chrome token reaches a surface');
  assert.equal(surfaceProps('preview', 'dark').style.colorScheme, 'dark', 'a preview may declare its own scheme');
});

test('destinations round-trip and tolerate the shell default', () => {
  assert.deepEqual(parseDestination('home'), DEFAULT_LOCATION);
  assert.deepEqual(parseDestination('review/canvas'), { nav: 'review', section: 'canvas' });
  assert.deepEqual(parseDestination('review/Bad Id'), { nav: 'review', section: null });
  assert.deepEqual(parseDestination('review/a/b'), DEFAULT_LOCATION);
  assert.deepEqual(parseDestination('https://x'), DEFAULT_LOCATION);
  assert.equal(formatDestination(parseDestination('runs/connector')), 'runs/connector');
});

test('resizing one panel never changes the other panel', () => {
  const width = 1400;
  const wider = resizePanel(DEFAULT_LAYOUT, 'sidebar', 40, width);
  assert.equal(wider.sidebar.size, 280);
  assert.deepEqual(wider.inspector, DEFAULT_LAYOUT.inspector);
  const narrower = resizePanel(wider, 'inspector', -30, width);
  assert.equal(narrower.inspector.size, 270);
  assert.deepEqual(narrower.sidebar, wider.sidebar);
});

test('panels clamp to their bounds and keep the workspace at its minimum', () => {
  assert.equal(resizePanel(DEFAULT_LAYOUT, 'sidebar', -500, 1400).sidebar.size, PANEL_BOUNDS.sidebar.min);
  assert.equal(resizePanel(DEFAULT_LAYOUT, 'sidebar', 5000, 3000).sidebar.size, PANEL_BOUNDS.sidebar.max);
  const tight = resizePanel(DEFAULT_LAYOUT, 'sidebar', 5000, 900);
  assert.equal(tight.sidebar.size, 900 - DEFAULT_LAYOUT.inspector.size - MAIN_MIN);
  assert.ok(resolveLayout(tight, 900).main >= MAIN_MIN);
});

test('narrow windows squeeze effective widths without rewriting stored preferences', () => {
  const resolved = resolveLayout(DEFAULT_LAYOUT, 700);
  assert.ok(resolved.main >= MAIN_MIN);
  assert.equal(resolved.sidebar + resolved.inspector + resolved.main, 700);
  const tiny = resolveLayout(DEFAULT_LAYOUT, 500);
  assert.deepEqual(tiny.squeezed, ['inspector']);
  assert.equal(tiny.sidebar, 500 - MAIN_MIN);
  assert.deepEqual(DEFAULT_LAYOUT.inspector, { size: 300, collapsed: false });
});

test('splitter keyboard model: arrows move the edge, Home collapses, End expands, Enter toggles', () => {
  const width = 1400;
  assert.equal(splitterKey(DEFAULT_LAYOUT, 'sidebar', 'ArrowRight', false, width)?.sidebar.size, 256);
  assert.equal(splitterKey(DEFAULT_LAYOUT, 'sidebar', 'ArrowLeft', true, width)?.sidebar.size, 176);
  assert.equal(splitterKey(DEFAULT_LAYOUT, 'inspector', 'ArrowLeft', false, width)?.inspector.size, 316);
  assert.equal(splitterKey(DEFAULT_LAYOUT, 'inspector', 'Home', false, width)?.inspector.collapsed, true);
  assert.equal(splitterKey(DEFAULT_LAYOUT, 'inspector', 'End', false, width)?.inspector.size, PANEL_BOUNDS.inspector.max);
  assert.equal(splitterKey(DEFAULT_LAYOUT, 'sidebar', 'Enter', false, width)?.sidebar.collapsed, true);
  assert.equal(splitterKey(DEFAULT_LAYOUT, 'sidebar', 'a', false, width), null);
  assert.equal(resizePanel(togglePanel(DEFAULT_LAYOUT, 'sidebar'), 'sidebar', 16, width).sidebar.collapsed, false, 'resizing reopens');
});

test('stored layouts are validated strictly', () => {
  assert.deepEqual(parseLayout(DEFAULT_LAYOUT), DEFAULT_LAYOUT);
  assert.equal(parseLayout({ ...DEFAULT_LAYOUT, sidebar: { size: 10, collapsed: false } }), null);
  assert.equal(parseLayout({ ...DEFAULT_LAYOUT, extra: 1 }), null);
  assert.equal(parseLayout({ ...DEFAULT_LAYOUT, inspector: { size: 300.5, collapsed: false } }), null);
});

test('dragging either panel fully closed retains its stored width and restores it', () => {
  for (const panel of ['sidebar', 'inspector'] as const) {
    const original = setPanelSize(DEFAULT_LAYOUT, panel, 340, 1600);
    const closed = setPanelSize(original, panel, 0, 1600);
    assert.deepEqual(closed[panel], { size: 340, collapsed: true });
    assert.equal(resolveLayout(closed, 1600)[panel], 0);
    assert.deepEqual(parseLayout(JSON.parse(JSON.stringify(closed))), closed);
    assert.deepEqual(togglePanel(closed, panel), original);
    const restored = resizePanel(closed, panel, 16, 1600);
    assert.deepEqual(restored, original);
    assert.equal(setPanelSize(closed, panel, PANEL_BOUNDS[panel].min, 1600)[panel].collapsed, false);
  }
});

test('keyboard shrinking stops at the floor; Home closes and Enter restores', () => {
  for (const panel of ['sidebar', 'inspector'] as const) {
    const minimum = setPanelSize(DEFAULT_LAYOUT, panel, PANEL_BOUNDS[panel].min, 1600);
    const inward = panel === 'sidebar' ? 'ArrowLeft' : 'ArrowRight';
    assert.deepEqual(splitterKey(minimum, panel, inward, false, 1600), minimum);
    const closed = splitterKey(minimum, panel, 'Home', false, 1600)!;
    assert.equal(closed[panel].collapsed, true);
    assert.deepEqual(splitterKey(closed, panel, 'Enter', false, 1600), minimum);
  }
});

test('absent shell tokens use only trusted kit variable names with literal standalone fallbacks', () => {
  const theme = chromeTheme('light', undefined);
  assert.equal(theme.vars['--hqd-background'], `var(--hq-canvas, ${FALLBACK_TOKENS.light.background})`);
  assert.equal(theme.vars['--hqd-accent'], `var(--hq-accent-strong, ${FALLBACK_TOKENS.light.accent})`);
  assert.deepEqual(theme.rejected, []);
  assert.equal(isCssColor('var(--hq-text)'), false);
  assert.equal(isCssColor('url(https://example.invalid)'), false);
});

test('sidebar accepts narrow resting widths and keyboard stops at its floor', () => {
  for (const size of [150, 120, 96, 81, 80]) {
    const layout = setPanelSize(DEFAULT_LAYOUT, 'sidebar', size, 1600);
    assert.equal(layout.sidebar.size, size);
    assert.equal(resolveLayout(layout, 1600).sidebar, size);
    assert.deepEqual(parseLayout(layout), layout);
  }
  const floor = setPanelSize(DEFAULT_LAYOUT, 'sidebar', 80, 1600);
  assert.deepEqual(splitterKey(floor, 'sidebar', 'ArrowLeft', false, 1600), floor);
  assert.equal(setPanelSize(DEFAULT_LAYOUT, 'sidebar', 60, 1600).sidebar.size, 80);
  const closed = setPanelSize(DEFAULT_LAYOUT, 'sidebar', 39, 1600);
  assert.deepEqual(closed.sidebar, { size: 240, collapsed: true });
  assert.deepEqual(splitterKey(closed, 'sidebar', 'Enter', false, 1600), DEFAULT_LAYOUT);
});

test('sidebar fits its labels: padding gives way first and the open width never drops below the labels', () => {
  assert.deepEqual([80, 88, 100, 120, 240].map(sidebarPadding), [4, 4, 7, 12, 12]);
  // Widest label box (text plus item padding and margins) of 76px needs 76 + 2 × 4.
  assert.equal(naturalSidebar(76), 84);
  for (const content of [76, 81, 82, 82.5, 92, 95, 140]) {
    const size = naturalSidebar(content);
    assert.ok(size - 2 * sidebarPadding(size) >= content, `${content}px of labels fit at ${size}`);
    assert.ok(size === PANEL_BOUNDS.sidebar.min || size - 1 - 2 * sidebarPadding(size - 1) < content, `${size} is the smallest fit for ${content}`);
  }
  assert.equal(naturalSidebar(20), PANEL_BOUNDS.sidebar.min);
  assert.equal(naturalSidebar(1000), PANEL_BOUNDS.sidebar.max);
  const narrow = setPanelSize(DEFAULT_LAYOUT, 'sidebar', 80, 1600);
  assert.equal(fitSidebar(narrow, 84).sidebar.size, 84);
  assert.equal(fitSidebar(DEFAULT_LAYOUT, 84), DEFAULT_LAYOUT, 'wider preferences are kept');
  assert.equal(fitSidebar(narrow, null), narrow);
  assert.equal(resolveLayout(fitSidebar(narrow, 84), 80 + 320).sidebar, 80, 'window pressure may still squeeze to the minimum');
});
