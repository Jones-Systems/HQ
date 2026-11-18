import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HQ_COLOR_ROLES, HQ_TOKEN_NAMES } from '../src/tokens';

const css = readFileSync(new URL('../src/components/hq-ui.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Innermost `selector { declarations }` rules, with @keyframes bodies removed and @media wrappers flattened. */
function rules(source: string): { selectors: string[]; body: string }[] {
  const flat = source.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').replace(/@media[^{]+\{/g, '');
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]!.replace(/^[\s}]+/, '').split(',').map((s) => s.trim()).filter(Boolean),
    body: m[2]!,
  }));
}

describe('component stylesheet', () => {
  const parsed = rules(css);

  it('scopes every selector to an .hq-* class so shell and module elements are untouched', () => {
    expect(parsed.length).toBeGreaterThan(40);
    for (const { selectors } of parsed) for (const selector of selectors) expect(selector).toMatch(/^\.hq-/);
  });

  it('never targets preserved content and never uses filter, blend modes or opacity', () => {
    expect(css).not.toMatch(/data-hq-content/);
    for (const { body } of parsed) expect(body).not.toMatch(/(^|[;\s])(filter|backdrop-filter|mix-blend-mode|opacity)\s*:/);
  });

  it('only references declared --hq-* tokens and no raw colours outside forced-colours keywords', () => {
    const known = new Set<string>(HQ_TOKEN_NAMES);
    const used = [...css.matchAll(/var\((--hq-[a-z0-9-]+)\)/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(50);
    expect(used.filter((name) => !known.has(name))).toEqual([]);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });

  it('draws a --hq-focus ring on every interactive primitive', () => {
    const focus = parsed.find(({ body }) => body.includes('outline: var(--hq-size-focus-width) solid var(--hq-focus)'));
    expect(focus?.selectors).toEqual(expect.arrayContaining([
      '.hq-btn:focus-visible', '.hq-menu-item:focus-visible', '.hq-tab:focus-visible', '.hq-save-action:focus-visible',
      '.hq-tabpanel:focus-visible', '.hq-dialog:focus-visible',
    ]));
    expect(HQ_COLOR_ROLES).toContain('--hq-focus');
  });

  it('respects reduced motion for the spinner and skeleton sheen', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.hq-spinner \{ animation-duration: 2\.4s; \} \}/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.hq-skeleton::after \{ animation: none; \} \}/);
    // Transitions use token durations, which the token CSS sets to 0ms under reduced motion.
    for (const m of css.matchAll(/transition:([^;]+);/g)) expect(m[1]).toMatch(/var\(--hq-duration-/);
  });
});

describe('shared Warm Graphite control styling', () => {
  const parsed = rules(css);
  const body = (selector: string) => parsed.filter(({ selectors }) => selectors.includes(selector)).map((rule) => rule.body).join(';');
  const tokens = readFileSync(new URL('../src/tokens/hq-tokens.css', import.meta.url), 'utf8');

  it('draws selection as a fill with no side or underline stripe', () => {
    expect(css).not.toMatch(/inset\s+-?[1-9]\d*px\s+0/);
    expect(css).not.toMatch(/aria-selected="true"\]::after/);
    expect(body('.hq-tab[aria-selected="true"]')).toMatch(/background: var\(--hq-selected-bg\)/);
    expect(body('.hq-btn--secondary[aria-pressed="true"]')).toMatch(/background: var\(--hq-selected-bg\)/);
    // Module nav items still draw an indicator inset; the token now equals their fill, so no stripe shows.
    expect(tokens).toContain('--hq-nav-item-indicator: var(--hq-surface-selected);');
    expect(tokens).toContain('--hq-rail-item-indicator: var(--hq-surface-selected);');
  });

  it('gives every button size one control radius and coherent secondary, ghost and disabled states', () => {
    expect(body('.hq-btn')).toMatch(/border-radius: var\(--hq-radius-control\)/);
    expect(body('.hq-btn--sm')).not.toMatch(/border-radius/);
    expect(body('.hq-btn--secondary')).toMatch(/background: var\(--hq-button-secondary-bg\)/);
    expect(body('.hq-btn--secondary:hover')).toMatch(/var\(--hq-button-secondary-bg-hover\)/);
    expect(body('.hq-btn--secondary:active')).toMatch(/var\(--hq-button-secondary-bg-pressed\)/);
    expect(body('.hq-btn--ghost:hover')).toMatch(/var\(--hq-button-ghost-bg-hover\)/);
    expect(body('.hq-btn:disabled')).toMatch(/var\(--hq-button-disabled-bg\)/);
    expect(tokens).toContain('--hq-radius-control: 8px;');
  });

  it('re-resolves component roles inside a palette preview scope', () => {
    expect(tokens).toMatch(/\[data-hq-token-scope\] \{[^}]*--hq-button-secondary-bg: var\(--hq-control\);[^}]*\}/);
  });
});
