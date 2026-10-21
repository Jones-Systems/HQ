import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PALETTE_PRESETS } from '@hq/ui';
vi.mock('../modules', () => ({ designReferenceReads: { list: vi.fn(async () => []), read: vi.fn(async () => ({ status: 'unavailable' as const })) }, DOMAIN_LABELS: { design: 'Design', social: 'Social', work: 'Work', wiki: 'Wiki' }, MODULES: { design: () => <div>Design stub</div>, wiki: () => <div>Wiki stub</div> }, MODULE_PRESENTATION: { design: 'fill' } }));
import { App } from '../App';
import { PALETTE_KEY } from './palette-state';

const root = () => document.documentElement;
const token = (name: string) => root().style.getPropertyValue(name);
function systemDark(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches, addEventListener() {}, removeEventListener() {} });
}
function openAppearance() {
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
  return screen.getByRole('region', { name: 'Settings page' });
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });

it('offers four presets, applies Warm Graphite by default in dark mode and switches the actual chrome immediately', () => {
  systemDark(true); window.localStorage.clear();
  render(<App />);
  expect(root().dataset.theme).toBe('dark');
  expect(token('--hq-canvas')).toBe(PALETTE_PRESETS.graphite.colors.canvas);
  const settings = openAppearance();
  const group = within(settings).getByRole('radiogroup', { name: 'Dark palette' });
  const radios = within(group).getAllByRole('radio');
  expect(radios.map(radio => radio.querySelector('strong')?.textContent)).toEqual(['Slate', 'Warm Graphite', 'Harbor', 'Sage']);
  expect(within(group).getByRole('radio', { checked: true }).textContent).toContain('Warm Graphite');
  expect(window.localStorage.getItem(PALETTE_KEY)).toBeNull();

  fireEvent.click(radios[2]!);
  expect(token('--hq-canvas')).toBe(PALETTE_PRESETS.harbor.colors.canvas);
  expect(token('--hq-surface-selected')).toBe(PALETTE_PRESETS.harbor.colors.selected);
  expect(JSON.parse(window.localStorage.getItem(PALETTE_KEY)!).preset).toBe('harbor');
  fireEvent.keyDown(radios[2]!, { key: 'ArrowRight' });
  expect(within(group).getByRole('radio', { checked: true }).textContent).toContain('Sage');
  expect(document.activeElement).toBe(radios[3]);
  // The preview scope carries the palette's own colour roles, not the chrome's.
  const preview = settings.querySelector<HTMLElement>('[data-hq-token-scope]')!;
  expect(preview.style.getPropertyValue('--hq-accent')).toBe(PALETTE_PRESETS.sage.colors.accent);
});

it('keeps a stored light appearance, leaves light tokens generated, and still edits the dark palette', () => {
  systemDark(true); window.localStorage.setItem('hq.appearance.v1', 'light');
  render(<App />);
  expect(root().dataset.theme).toBe('light');
  expect(token('--hq-canvas')).toBe('');
  const settings = openAppearance();
  expect(within(settings).getByText(/HQ is light right now/)).toBeTruthy();
  fireEvent.click(within(settings).getByRole('radio', { name: /Slate/ }));
  expect(token('--hq-canvas')).toBe('');
  expect(window.localStorage.getItem('hq.appearance.v1')).toBe('light');
  fireEvent.click(within(within(settings).getByRole('group', { name: 'Color theme' })).getByRole('button', { name: 'Dark' }));
  expect(token('--hq-canvas')).toBe(PALETTE_PRESETS.slate.colors.canvas);
  fireEvent.click(within(within(settings).getByRole('group', { name: 'Color theme' })).getByRole('button', { name: 'Light' }));
  expect(token('--hq-canvas')).toBe('');
  expect(token('--hq-artwork-matte')).toBe('');
});

it('edits a colour by picker and hex, keeps the last good value for partial or invalid hex, and resets', () => {
  systemDark(true); window.localStorage.clear();
  render(<App />);
  const settings = openAppearance();
  const hex = within(settings).getByRole('textbox', { name: 'Primary button hex value' }) as HTMLInputElement;
  fireEvent.change(hex, { target: { value: '#12' } });
  expect(token('--hq-accent')).toBe(PALETTE_PRESETS.graphite.colors.accent);
  fireEvent.change(hex, { target: { value: '#12ab34' } });
  expect(token('--hq-accent')).toBe('#12AB34');
  fireEvent.change(hex, { target: { value: 'url(x)' } }); fireEvent.blur(hex);
  expect(hex.getAttribute('aria-invalid')).toBe('true');
  expect(token('--hq-accent')).toBe('#12AB34');
  expect(within(settings).getByText(/Still using #12AB34/)).toBeTruthy();

  fireEvent.change(within(settings).getByLabelText('Selected fill color picker'), { target: { value: '#204060' } });
  expect(token('--hq-surface-selected')).toBe('#204060');
  expect(JSON.parse(window.localStorage.getItem(PALETTE_KEY)!).overrides.graphite).toEqual({ accent: '#12AB34', selected: '#204060' });

  fireEvent.click(within(settings).getByRole('button', { name: 'Reset Primary button' }));
  expect(token('--hq-accent')).toBe(PALETTE_PRESETS.graphite.colors.accent);
  fireEvent.click(within(settings).getByRole('button', { name: 'Reset Warm Graphite' }));
  fireEvent.click(within(settings).getByRole('button', { name: 'Restore original colors' }));
  expect(token('--hq-surface-selected')).toBe(PALETTE_PRESETS.graphite.colors.selected);
  expect(JSON.parse(window.localStorage.getItem(PALETTE_KEY)!).overrides).toEqual({});
});

it('shows low contrast beside a valid custom colour without rewriting it', () => {
  systemDark(true); window.localStorage.clear();
  render(<App />);
  const settings = openAppearance();
  const hex = within(settings).getByRole('textbox', { name: 'Text hex value' });
  fireEvent.change(hex, { target: { value: '#4A4540' } });
  expect(token('--hq-text')).toBe('#4A4540');
  expect(within(within(settings).getByRole('group', { name: /^Text · Edited/ })).getByText(/Low contrast 1\.0:1, needs 4\.5:1/)).toBeTruthy();
});

it('restores per-preset edits after restart and keeps other presets untouched', () => {
  systemDark(true); window.localStorage.clear();
  const first = render(<App />);
  let settings = openAppearance();
  fireEvent.change(within(settings).getByRole('textbox', { name: 'Navigation hex value' }), { target: { value: '#101010' } });
  fireEvent.click(within(settings).getByRole('radio', { name: /Slate/ }));
  fireEvent.change(within(settings).getByRole('textbox', { name: 'Navigation hex value' }), { target: { value: '#202020' } });
  first.unmount();
  expect(token('--hq-nav')).toBe('');

  render(<App />);
  expect(token('--hq-nav')).toBe('#202020');
  settings = openAppearance();
  expect(within(settings).getByRole('radio', { name: /Warm Graphite/ }).textContent).toContain('Edited');
  fireEvent.click(within(settings).getByRole('radio', { name: /Warm Graphite/ }));
  expect(token('--hq-nav')).toBe('#101010');
  fireEvent.click(within(settings).getByRole('radio', { name: /Harbor/ }));
  expect(token('--hq-nav')).toBe(PALETTE_PRESETS.harbor.colors.nav);
});

it('falls back from a corrupt preference and reports when changes cannot be saved', () => {
  systemDark(true); window.localStorage.setItem(PALETTE_KEY, '{"preset":"neon","overrides":');
  render(<App />);
  expect(token('--hq-canvas')).toBe(PALETTE_PRESETS.graphite.colors.canvas);
  expect(window.localStorage.getItem(PALETTE_KEY)).toBe('{"preset":"neon","overrides":');
  const settings = openAppearance();
  vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  fireEvent.click(within(settings).getByRole('radio', { name: /Sage/ }));
  expect(token('--hq-canvas')).toBe(PALETTE_PRESETS.sage.colors.canvas);
  expect(within(settings).getByRole('alert').textContent).toMatch(/could not be saved/);
});

it('removes the selected-domain side stripe from the rail styling', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const selected = [...css.matchAll(/[^{}]*\.domain-button\[aria-current="page"\][^{]*\{([^}]*)\}/g)].map(match => match[1]).join(';');
  expect(selected).toContain('background: var(--hq-selected-bg)');
  expect(css).not.toMatch(/box-shadow:\s*inset\s+[1-9]/);
});
