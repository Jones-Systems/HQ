import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HQ_TOKEN_NAMES } from '../src/tokens';
import { MOTION_DURATIONS, MOTION_EASINGS } from '../src/motion/motion';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const json = JSON.parse(read('../src/tokens/hq-tokens.json')) as {
  motion: Record<string, string>;
  'motion-reduced': { values: Record<string, string> };
};
const tokensCss = read('../src/tokens/hq-tokens.css');
const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '');
const sheets = { motion: strip(read('../src/motion/motion.css')), feedback: strip(read('../src/feedback/feedback.css')) };

/** Innermost rule bodies with @keyframes removed and @media wrappers flattened (same reading as styles.test.ts). */
function rules(source: string): { selectors: string[]; body: string }[] {
  const flat = source.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').replace(/@media[^{]+\{/g, '');
  return [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: m[1]!.replace(/^[\s}]+/, '').split(',').map((s) => s.trim()).filter(Boolean),
    body: m[2]!,
  }));
}

describe('motion tokens', () => {
  it('script constants equal the JSON source', () => {
    for (const [name, ms] of Object.entries(MOTION_DURATIONS)) expect(json.motion[`duration-${name}`]).toBe(`${ms}ms`);
    for (const [name, easing] of Object.entries(MOTION_EASINGS)) expect(json.motion[`ease-${name}`]).toBe(easing);
  });

  it('collapse every duration, distance, scale and stagger under reduced motion and the shell override', () => {
    const reduced = json['motion-reduced'].values;
    for (const name of Object.keys(json.motion).filter((key) => !key.startsWith('ease-'))) expect(reduced).toHaveProperty(name);
    expect(Object.entries(reduced).every(([name, value]) => (name.includes('scale') ? value === '1' : /^0(ms|px)$/.test(value)))).toBe(true);
    const media = /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/.exec(tokensCss)?.[1] ?? '';
    const override = /:root\[data-hq-motion="reduce"\] \{([^}]*)\}/.exec(tokensCss)?.[1] ?? '';
    for (const [name, value] of Object.entries(reduced)) {
      expect(media).toContain(`--hq-${name}: ${value};`);
      expect(override).toContain(`--hq-${name}: ${value};`);
    }
  });
});

describe.each(Object.entries(sheets))('%s stylesheet', (_name, css) => {
  const parsed = rules(css);

  it('scopes selectors to .hq-* classes, presence attributes or view-transition pseudo-elements', () => {
    expect(parsed.length).toBeGreaterThan(10);
    for (const { selectors } of parsed) {
      for (const selector of selectors) expect(selector).toMatch(/^(\.hq-|\[data-hq-presence=|\[data-hq-motion=|:root\[data-hq-motion="reduce"\]|::view-transition-|:root:active-view-transition-type\(hq-nav-[a-z]+\)::view-transition-)/);
    }
  });

  it('never targets preserved content and keeps opacity, filter and blend modes out of resting rules', () => {
    expect(css).not.toMatch(/data-hq-content/);
    for (const { body } of parsed) expect(body).not.toMatch(/(^|[;\s])(filter|backdrop-filter|mix-blend-mode|opacity)\s*:/);
  });

  it('uses only declared tokens and no raw colours', () => {
    const known = new Set<string>([...HQ_TOKEN_NAMES, '--hq-skeleton-w', '--hq-skeleton-h']);
    const used = [...css.matchAll(/var\((--hq-[a-z0-9-]+)/g)].map((m) => m[1]!);
    expect(used.filter((name) => !known.has(name))).toEqual([]);
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
  });

  it('times every animation and transition with motion tokens', () => {
    for (const m of css.matchAll(/(?:^|[;{\s])transition:([^;]+);/g)) expect(m[1]).toMatch(/var\(--hq-duration-/);
    for (const m of css.matchAll(/(?:^|[;{\s])animation:([^;]+);/g)) {
      if (/^\s*none/.test(m[1]!)) continue;
      // Looping progress and the colour-only flash have fixed timing and their own reduced-motion handling.
      if (/hq-shimmer-text|hq-flash/.test(m[1]!)) continue;
      expect(m[1]).toMatch(/var\(--hq-duration-/);
    }
  });
});
