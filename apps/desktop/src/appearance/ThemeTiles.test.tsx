import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { DEFAULT_PALETTE_ID, PALETTE_PRESETS, paletteTokens } from '@hq/ui';
import type { Appearance } from '@hq/contracts';
import { ThemeTiles } from './ThemeTiles';

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
});
afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-hq-motion'); });

function Harness({ initial = 'light', onChange }: { initial?: Appearance; onChange?: (value: Appearance) => void }) {
  const [appearance, setAppearance] = useState<Appearance>(initial);
  return <ThemeTiles appearance={appearance} onChange={value => { onChange?.(value); setAppearance(value); }} />;
}
const radios = () => within(screen.getByRole('radiogroup', { name: 'Color theme' })).getAllByRole('radio');

it('is a radio group of Light, Dark and System with one tab stop on the selected tile', () => {
  render(<Harness initial="dark" />);
  expect(radios()).toHaveLength(3);
  for (const name of ['Light', 'Dark', 'System']) expect(screen.getByRole('radio', { name })).toBeTruthy();
  expect(radios().map(radio => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
  expect(radios().map(radio => radio.tabIndex)).toEqual([-1, 0, -1]);
});

it('moves the selection and focus with the arrow keys and wraps around', () => {
  const onChange = vi.fn();
  render(<Harness initial="light" onChange={onChange} />);
  const [light, dark, system] = radios() as [HTMLElement, HTMLElement, HTMLElement];
  light.focus();
  fireEvent.keyDown(light, { key: 'ArrowRight' });
  expect(onChange).toHaveBeenLastCalledWith('dark');
  expect(dark.getAttribute('aria-checked')).toBe('true');
  expect(document.activeElement).toBe(dark);
  fireEvent.keyDown(dark, { key: 'ArrowDown' });
  expect(onChange).toHaveBeenLastCalledWith('system');
  expect(document.activeElement).toBe(system);
  fireEvent.keyDown(system, { key: 'ArrowRight' });
  expect(onChange).toHaveBeenLastCalledWith('light');
  expect(document.activeElement).toBe(light);
  fireEvent.keyDown(light, { key: 'ArrowLeft' });
  expect(onChange).toHaveBeenLastCalledWith('system');
  expect(onChange).toHaveBeenCalledTimes(4);
});

it('selects a tile on click and ignores a click on the one already selected', () => {
  const onChange = vi.fn();
  render(<Harness initial="light" onChange={onChange} />);
  fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
  expect(onChange).toHaveBeenCalledOnce();
  expect(onChange).toHaveBeenCalledWith('dark');
});

it('says what System follows on this device', () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
  render(<Harness initial="system" />);
  expect(screen.getByText('Following your device: Dark')).toBeTruthy();
  cleanup();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener() {}, removeEventListener() {} });
  render(<Harness initial="system" />);
  expect(screen.getByText('Following your device: Light')).toBeTruthy();
});

it('draws the Dark tile with the selected dark palette and keeps the Light tile in the light scheme', () => {
  const colors = PALETTE_PRESETS[DEFAULT_PALETTE_ID].colors;
  render(<Harness initial="light" />);
  const [light, dark] = radios().map(radio => radio.querySelector<HTMLElement>('.theme-tile-layer')!) as [HTMLElement, HTMLElement];
  expect(light.style.getPropertyValue('color-scheme')).toBe('light');
  expect(dark.style.getPropertyValue('color-scheme')).toBe('dark');
  const [role, value] = Object.entries(paletteTokens(colors))[0]!;
  expect(dark.style.getPropertyValue(role)).toBe(value);
  expect(light.style.getPropertyValue(role)).not.toBe(dark.style.getPropertyValue(role));
});

it('hides the miniature art from assistive technology and names each tile by its label', () => {
  render(<Harness initial="light" />);
  for (const radio of radios()) {
    expect(radio.querySelector('.theme-tile-art')?.getAttribute('aria-hidden')).toBe('true');
    const label = document.getElementById(radio.getAttribute('aria-labelledby')!)!;
    expect(label.textContent).toMatch(/^(Light|Dark|System)$/);
  }
});
