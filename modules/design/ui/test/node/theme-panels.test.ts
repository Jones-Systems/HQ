import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_LOCATION, formatDestination, parseDestination } from '../../src/navigation.ts';
import { DEFAULT_LAYOUT, MAIN_MIN, PANEL_BOUNDS, parseLayout, resizePanel, resolveLayout, splitterKey, togglePanel } from '../../src/panels.ts';
import { chromeTheme, FALLBACK_TOKENS, isCssColor, surfaceProps } from '../../src/theme.ts';

test('dark tokens recolour every chrome variable', () => {
  const light = chromeTheme('light', FALLBACK_TOKENS.light);
  const dark = chromeTheme('dark', FALLBACK_TOKENS.dark);
  for (const name of Object.keys(light.vars) as (keyof typeof light.vars)[]) assert.notEqual(light.vars[name], dark.vars[name], name);
});

test('shell-supplied tokens are used; unsafe values fall back and are reported', () => {
  const theme = chromeTheme('dark', { ...FALLBACK_TOKENS.dark, accent: 'oklch(0.7 0.1 250)', text: 'red;} body{display:none', line: 'url(x)' });
  assert.equal(theme.vars['--hqd-accent'], 'oklch(0.7 0.1 250)');
  assert.equal(theme.vars['--hqd-text'], FALLBACK_TOKENS.dark.text);
  assert.equal(theme.vars['--hqd-line'], FALLBACK_TOKENS.dark.line);
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
  assert.equal(tiny.sidebar, PANEL_BOUNDS.sidebar.min);
  assert.deepEqual(DEFAULT_LAYOUT.inspector, { size: 300, collapsed: false });
});

test('splitter keyboard model: arrows move the edge, Home/End bound, Enter collapses', () => {
  const width = 1400;
  assert.equal(splitterKey(DEFAULT_LAYOUT, 'sidebar', 'ArrowRight', false, width)?.sidebar.size, 256);
  assert.equal(splitterKey(DEFAULT_LAYOUT, 'sidebar', 'ArrowLeft', true, width)?.sidebar.size, 180);
  assert.equal(splitterKey(DEFAULT_LAYOUT, 'inspector', 'ArrowLeft', false, width)?.inspector.size, 316);
  assert.equal(splitterKey(DEFAULT_LAYOUT, 'inspector', 'Home', false, width)?.inspector.size, PANEL_BOUNDS.inspector.min);
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
