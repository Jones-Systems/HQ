import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTE_PRESETS } from '@hq/ui';
import {
  DEFAULT_PALETTE_STATE, PALETTE_KEY, activeColors, isEdited, parsePaletteState, readPaletteState, resetPaletteColor,
  resetPreset, selectPreset, serializePaletteState, setPaletteColor,
} from './palette-state';

describe('stored palette preference', () => {
  it('defaults to Warm Graphite with no overrides when missing', () => {
    expect(parsePaletteState(null)).toEqual(DEFAULT_PALETTE_STATE);
    expect(DEFAULT_PALETTE_STATE.preset).toBe('graphite');
  });

  it.each(['{', 'null', '[]', '"slate"', '42', '{"preset":7}'])('falls back safely for malformed value %s', (raw) => {
    expect(parsePaletteState(raw)).toEqual(DEFAULT_PALETTE_STATE);
  });

  it('keeps each valid preset, role and colour and drops only the invalid parts', () => {
    const state = parsePaletteState(JSON.stringify({
      version: 1, preset: 'harbor',
      overrides: {
        harbor: { accent: '#112233', text: 'red', unknown: '#FFFFFF', muted: '#abcdef', canvas: PALETTE_PRESETS.harbor.colors.canvas },
        sage: { nav: '#010203' }, mystery: { accent: '#445566' }, slate: 'oops',
      },
    }));
    expect(state.preset).toBe('harbor');
    expect(state.overrides.harbor).toEqual({ accent: '#112233' });
    expect(state.overrides.sage).toEqual({ nav: '#010203' });
    expect(state.overrides.slate).toEqual({});
    expect(state.overrides).not.toHaveProperty('mystery');
  });

  it('reads through a failing storage port without throwing', () => {
    expect(readPaletteState({ getItem: () => { throw new Error('denied'); }, setItem: () => {} })).toEqual(DEFAULT_PALETTE_STATE);
    expect(PALETTE_KEY).toBe('hq.palette.v1');
  });

  it('round-trips through serialization, storing only canonical overrides', () => {
    let state = selectPreset(DEFAULT_PALETTE_STATE, 'sage');
    state = setPaletteColor(state, 'accent', '#123456');
    const raw = serializePaletteState(state);
    expect(JSON.parse(raw)).toEqual({ version: 1, preset: 'sage', overrides: { sage: { accent: '#123456' } } });
    expect(parsePaletteState(raw)).toEqual(state);
  });
});

describe('palette edits', () => {
  it('keeps edits separate per preset and resets one colour or one preset without touching others', () => {
    let state = setPaletteColor(DEFAULT_PALETTE_STATE, 'accent', '#111111');
    state = setPaletteColor(state, 'text', '#EEEEEE');
    state = selectPreset(state, 'slate');
    state = setPaletteColor(state, 'accent', '#222222');
    expect(activeColors(state).accent).toBe('#222222');
    expect(activeColors(state, 'graphite').accent).toBe('#111111');
    expect(activeColors(state, 'harbor')).toEqual(PALETTE_PRESETS.harbor.colors);

    state = resetPreset(state);
    expect(isEdited(state, 'slate')).toBe(false);
    expect(state.overrides.graphite).toEqual({ accent: '#111111', text: '#EEEEEE' });

    state = selectPreset(state, 'graphite');
    state = resetPaletteColor(state, 'accent');
    expect(state.overrides.graphite).toEqual({ text: '#EEEEEE' });
    expect(activeColors(state).accent).toBe(PALETTE_PRESETS.graphite.colors.accent);
  });

  it('treats the preset value as no override and refuses non-canonical colours', () => {
    const edited = setPaletteColor(DEFAULT_PALETTE_STATE, 'accent', '#111111');
    expect(setPaletteColor(edited, 'accent', PALETTE_PRESETS.graphite.colors.accent).overrides.graphite).toEqual({});
    expect(setPaletteColor(DEFAULT_PALETTE_STATE, 'accent', 'red')).toBe(DEFAULT_PALETTE_STATE);
    expect(setPaletteColor(DEFAULT_PALETTE_STATE, 'accent', '#abcdef')).toBe(DEFAULT_PALETTE_STATE);
  });
});

it('removes the selected-domain side stripe from the rail styling', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  const selected = [...css.matchAll(/[^{}]*\.domain-button\[aria-current="page"\][^{]*\{([^}]*)\}/g)].map(match => match[1]).join(';');
  expect(selected).toContain('background: var(--hq-selected-bg)');
  expect(css).not.toMatch(/box-shadow:\s*inset\s+[1-9]/);
});
