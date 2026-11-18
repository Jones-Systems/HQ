import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PALETTE_ID, PALETTE_IDS, PALETTE_PRESETS, PALETTE_ROLES, PALETTE_ROLE_INFO, isPaletteHex, normalizeHex,
  paletteContrast, paletteTokens, resolvePalette, weakestContrast,
} from '../src/palettes';
import { HQ_ARTWORK_TOKENS, HQ_COLOR_ROLES } from '../src/tokens';

describe('palette presets', () => {
  it('offers the four owner-selected palettes with Warm Graphite as the initial dark palette', () => {
    expect(PALETTE_IDS).toEqual(['slate', 'graphite', 'harbor', 'sage']);
    expect(PALETTE_IDS.map((id) => PALETTE_PRESETS[id].name)).toEqual(['Slate', 'Warm Graphite', 'Harbor', 'Sage']);
    expect(DEFAULT_PALETTE_ID).toBe('graphite');
  });

  it('varies colour only: every preset has the same keys and a canonical hex for every role', () => {
    for (const id of PALETTE_IDS) {
      const preset = PALETTE_PRESETS[id];
      expect(Object.keys(preset).sort()).toEqual(['colors', 'description', 'id', 'name']);
      expect(Object.keys(preset.colors).sort()).toEqual([...PALETTE_ROLES].sort());
      for (const role of PALETTE_ROLES) expect(isPaletteHex(preset.colors[role]), `${id}.${role}`).toBe(true);
    }
  });

  it('meets every declared text (4.5:1) and control/focus (3:1) pair in every preset', () => {
    for (const id of PALETTE_IDS) {
      const failures = paletteContrast(PALETTE_PRESETS[id].colors).filter((row) => !row.pass);
      expect(failures, id).toEqual([]);
    }
  });

  it('labels every editable role and keeps the always-open editor to the primary roles', () => {
    for (const role of PALETTE_ROLES) expect(PALETTE_ROLE_INFO[role].label.length).toBeGreaterThan(2);
    const primary = PALETTE_ROLES.filter((role) => PALETTE_ROLE_INFO[role].group !== 'More colors');
    expect(primary).toEqual(['canvas', 'nav', 'surface', 'raised', 'accent', 'onAccent', 'control', 'controlBorder',
      'selected', 'selectedText', 'text', 'muted', 'accentText']);
  });
});

describe('palette tokens', () => {
  it('sets exactly the shared colour roles and never the artwork, radius or size tokens', () => {
    for (const id of PALETTE_IDS) {
      const tokens = paletteTokens(PALETTE_PRESETS[id].colors);
      expect(Object.keys(tokens).sort()).toEqual([...HQ_COLOR_ROLES].sort());
      for (const artwork of HQ_ARTWORK_TOKENS) expect(tokens).not.toHaveProperty(artwork);
      for (const value of Object.values(tokens)) expect(value).toMatch(/^(#[0-9A-F]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|0\.\d+)\))$/);
    }
  });

  it('maps the Warm Graphite study tokens onto the actual chrome roles', () => {
    const tokens = paletteTokens(PALETTE_PRESETS.graphite.colors);
    expect(tokens['--hq-canvas']).toBe('#33302D');
    expect(tokens['--hq-surface-selected']).toBe('#614A3D');
    expect(tokens['--hq-text-selected']).toBe('#FFF6EC');
    expect(tokens['--hq-control']).toBe('#4E4843');
    expect(tokens['--hq-accent']).toBe('#F2A27C');
    expect(tokens['--hq-accent-soft']).toBe('rgba(242, 162, 124, 0.14)');
  });
});

describe('colour input', () => {
  it('normalizes 3- and 6-digit hex with or without # and rejects everything else', () => {
    expect(normalizeHex('#f2a27c')).toBe('#F2A27C');
    expect(normalizeHex(' f2a27c ')).toBe('#F2A27C');
    expect(normalizeHex('#abc')).toBe('#AABBCC');
    for (const bad of ['', '#', '#F2A27', '#F2A27C0', 'red', 'url(x)', '#GGGGGG', 'var(--hq-text)', '#F2A27C;color:red']) {
      expect(normalizeHex(bad), bad).toBeNull();
    }
    expect(isPaletteHex('#f2a27c')).toBe(false);
  });

  it('applies valid overrides and ignores invalid values', () => {
    const colors = resolvePalette('sage', { accent: '#112233', text: 'red', muted: '#abc' });
    expect(colors.accent).toBe('#112233');
    expect(colors.text).toBe(PALETTE_PRESETS.sage.colors.text);
    expect(colors.muted).toBe(PALETTE_PRESETS.sage.colors.muted);
  });

  it('keeps a valid low-contrast custom colour and reports its weakest pair', () => {
    const colors = resolvePalette('graphite', { text: '#4A4540' });
    expect(colors.text).toBe('#4A4540');
    const weakest = weakestContrast(colors, 'text');
    expect(weakest).toMatchObject({ fg: 'text', min: 4.5, pass: false });
    expect(weakest!.ratio).toBeLessThan(1.5);
    expect(weakestContrast(colors, 'disabled')).toBeNull();
  });
});
