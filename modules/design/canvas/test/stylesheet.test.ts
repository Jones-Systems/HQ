import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const source = readFileSync(new URL('../src/view/canvas.css', import.meta.url), 'utf8');
const css = source.replace(/\/\*[\s\S]*?\*\//gu, '');

describe('canvas stylesheet', () => {
  it('takes every duration and easing from the shared motion tokens, so reduced motion reaches all of them', () => {
    const literal = [...css.matchAll(/(?<![\w.#-])(\d*\.?\d+)(ms|s)(?![\w-])/gu)].map((match) => match[0]).filter((text) => text !== '0s');
    assert.deepEqual(literal, [], 'a duration written as a number would ignore the reduced-motion tokens');
    assert.doesNotMatch(css, /cubic-bezier\(/u);
    assert.doesNotMatch(css, /(?<![\w-])ease(-in|-out|-in-out)?(?![\w-])/u);
    assert.match(css, /var\(--hq-duration-/u);
    assert.match(css, /var\(--hq-ease-/u);
  });

  it('registers the three camera numbers, so the browser can animate them and CSS can derive everything from them', () => {
    for (const name of ['--hq-canvas-x', '--hq-canvas-y', '--hq-canvas-zoom']) {
      assert.match(css, new RegExp(`@property ${name} \\{ syntax: '<number>'; inherits: true; initial-value: [-\\d.]+; \\}`, 'u'), name);
    }
  });

  it('derives the world transform from the camera numbers, so an eased camera moves the world', () => {
    assert.match(css, /\.hq-canvas-world\s*\{[^}]*translate\(calc\(var\(--hq-canvas-x\) \* var\(--hq-canvas-zoom\) \* -1px\)/u);
    assert.match(css, /scale\(var\(--hq-canvas-zoom\)\)/u);
  });

  it('colours with the shared roles, never a literal colour that would ignore the theme', () => {
    const literal = [...css.matchAll(/#[0-9a-fA-F]{3,8}\b/gu)].map((match) => match[0]);
    assert.deepEqual(literal, []);
  });
});
