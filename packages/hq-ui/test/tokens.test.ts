import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HQ_ARTWORK_TOKENS, HQ_COLOR_ROLES, HQ_SHADOW_TOKENS, HQ_TOKEN_NAMES } from '../src/tokens';

/** Published package artifacts stay synchronized with the canonical visual-system source and generated report. */
const COPIES = [
  { local: '../src/tokens/hq-tokens.css', upstream: 'tokens/hq-tokens.css' },
  { local: '../src/tokens/hq-tokens.json', upstream: 'tokens/hq-tokens.json' },
  { local: '../src/tokens/t0-bridge.css', upstream: 'tokens/t0-bridge.css' },
  { local: './fixtures/t2-contrast-report.md', upstream: 'tokens/contrast-report.md' },
] as const;
const read = (path: string) => readFileSync(new URL(path, import.meta.url));
const tokensCss = read('../src/tokens/hq-tokens.css').toString('utf8');
const tokensJson = JSON.parse(read('../src/tokens/hq-tokens.json').toString('utf8')) as {
  color: Record<string, { light: string; dark: string }>;
  invariant: Record<string, { value: string }>;
};
describe('canonical token copies', () => {
  it.each(COPIES)('$local matches the current canonical $upstream', ({ local, upstream }) => {
    expect(read(local)).toEqual(read(`../../../docs/design/hq-visual-system/${upstream}`));
  });
});

describe('token names', () => {
  const declared = [...new Set([...tokensCss.matchAll(/(--hq-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!))];

  it('exports exactly the custom properties the token CSS declares', () => {
    expect([...HQ_TOKEN_NAMES].sort()).toEqual([...declared].sort());
    expect(new Set(HQ_TOKEN_NAMES).size).toBe(HQ_TOKEN_NAMES.length);
  });

  it('has 39 colour roles, each a light-dark() pair equal to the JSON source', () => {
    expect(HQ_COLOR_ROLES).toHaveLength(39);
    expect(HQ_COLOR_ROLES.map((name) => name.slice('--hq-'.length))).toEqual(Object.keys(tokensJson.color));
    for (const role of HQ_COLOR_ROLES) {
      const { light, dark } = tokensJson.color[role.slice('--hq-'.length)]!;
      expect(tokensCss).toContain(`  ${role}: light-dark(${light}, ${dark});`);
    }
  });

  it('keeps the 4 artwork tokens theme-invariant', () => {
    expect(HQ_ARTWORK_TOKENS).toHaveLength(4);
    for (const token of HQ_ARTWORK_TOKENS) {
      const { value } = tokensJson.invariant[token.slice('--hq-'.length)]!;
      expect(tokensCss).toContain(`  ${token}: ${value};`);
      expect(value).not.toMatch(/light-dark/);
    }
  });

  it('switches shadows per scheme and scopes colour by [data-theme]', () => {
    for (const shadow of HQ_SHADOW_TOKENS) expect(tokensCss.split(`${shadow}:`)).toHaveLength(4);
    expect(tokensCss).toContain(':root { color-scheme: light dark; }');
    expect(tokensCss).toContain('[data-theme="light"] { color-scheme: light; }');
    expect(tokensCss).toContain('[data-theme="dark"] { color-scheme: dark; }');
  });

  it('pins preserved wells through --hq-content-scheme with no filter, blend or opacity', () => {
    const well = /\[data-hq-content\] \{([^}]*)\}/.exec(tokensCss)?.[1] ?? '';
    expect(well).toContain('color-scheme: var(--hq-content-scheme, normal);');
    expect(well).toContain('background: var(--hq-artwork-matte);');
    expect(well).toContain('filter: none;');
    expect(well).toContain('mix-blend-mode: normal;');
    expect(well).toContain('opacity: 1;');
  });
});
