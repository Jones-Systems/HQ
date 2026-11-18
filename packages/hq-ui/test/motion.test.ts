// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HQ_TOKEN_NAMES } from '../src/tokens';
import { MOTION_DURATIONS, MOTION_EASINGS } from '../src/motion/motion';
import { useListMotion } from '../src/motion/useListMotion';

const read = (path: string) => readFileSync(new NodeURL(path, import.meta.url), 'utf8');
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

describe('stylesheet geometry', () => {
  it('lets an exiting toast slot shrink to nothing so the stack closes up', () => {
    const exit = rules(sheets.feedback).find(({ selectors }) => selectors.includes('.hq-toast-slot[data-hq-presence="exit"][data-hq-motion="toast"]'));
    // A flex item keeps its automatic minimum height otherwise, and the height animation would have no effect.
    expect(exit?.body).toMatch(/min-height:\s*0\b/);
  });
});

describe('useListMotion', () => {
  interface Glide { el: Element; keyframes: Keyframe[]; cancelled: boolean; cancel: () => void }
  let glides: Glide[];
  const glideDy = (glide: Glide) => Number(/translate\(0px, (-?[\d.]+)px\)/.exec(String(glide.keyframes[0]?.transform))?.[1] ?? 0);

  beforeEach(() => {
    glides = [];
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value(this: HTMLElement, keyframes: Keyframe[]) {
        const glide: Glide = { el: this, keyframes, cancelled: false, cancel: () => { glide.cancelled = true; } };
        glides.push(glide);
        return { cancel: glide.cancel, finished: new Promise(() => {}) };
      },
    });
    // Rows are 40px apart in DOM order. A glide that is still running leaves half its offset on the element, like a real one.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mock(this: HTMLElement) {
      const index = this.hasAttribute('data-hq-motion-key') ? [...this.parentElement!.children].indexOf(this) : 0;
      const running = glides.find((glide) => glide.el === this && !glide.cancelled);
      const top = index * 40 + (running ? glideDy(running) / 2 : 0);
      return { left: 0, top, right: 0, bottom: top, width: 0, height: 40, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });

  const List = ({ ids }: { ids: string[] }) => {
    const ref = useListMotion<HTMLUListElement>(ids);
    return createElement('ul', { ref }, ids.map((id) => createElement('li', { key: id, 'data-hq-motion-key': id }, id)));
  };

  it('glides moved items from their old place and fades in new ones', () => {
    const { rerender } = render(createElement(List, { ids: ['a', 'b', 'c'] }));
    expect(glides).toHaveLength(0);
    rerender(createElement(List, { ids: ['c', 'a', 'b', 'd'] }));
    const byText = (text: string) => glides.filter((glide) => glide.el.textContent === text);
    expect(byText('c').map(glideDy)).toEqual([80]);
    expect(byText('a').map(glideDy)).toEqual([-40]);
    expect(byText('b').map(glideDy)).toEqual([-40]);
    expect(byText('d')).toHaveLength(1);
    expect(String(byText('d')[0]!.keyframes[0]!.opacity)).toBe('0');
  });

  it('stops a glide still running before it measures the next order, so the item does not jump', () => {
    const { rerender } = render(createElement(List, { ids: ['a', 'b', 'c'] }));
    rerender(createElement(List, { ids: ['c', 'b', 'a'] }));
    const first = glides.filter((glide) => glide.el.textContent === 'a');
    expect(first.map(glideDy)).toEqual([-80]);
    // 'a' is now half way along its glide (-40px left over). The next reorder starts from where it is drawn: 40px, not 0.
    rerender(createElement(List, { ids: ['a', 'b', 'c'] }));
    expect(first[0]!.cancelled).toBe(true);
    const second = glides.filter((glide) => glide.el.textContent === 'a' && !glide.cancelled);
    expect(second.map(glideDy)).toEqual([40]);
  });

  it('does nothing under reduced motion', () => {
    document.documentElement.setAttribute('data-hq-motion', 'reduce');
    const { rerender } = render(createElement(List, { ids: ['a', 'b'] }));
    rerender(createElement(List, { ids: ['b', 'a'] }));
    document.documentElement.removeAttribute('data-hq-motion');
    expect(glides).toHaveLength(0);
  });
});
