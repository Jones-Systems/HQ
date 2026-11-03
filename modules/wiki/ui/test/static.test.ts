// Static guards over production source: no unsafe rendering, no execution or network, no cross-cone imports.

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const SRC = new URL('../src/', import.meta.url);
const files = readdirSync(SRC).filter((name) => !name.startsWith('.'));
const sources = files.map((name) => ({ name, text: readFileSync(new URL(name, SRC), 'utf8') }));

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:'"`])\/\/.*$/gmu, '$1');
}

test('production source is erasable TypeScript (.ts only, no JSX, no CSS-in-JS)', () => {
  assert.ok(files.length >= 10);
  for (const name of files) assert.ok(name.endsWith('.ts') || name === 'wiki-view.css', name);
});

const FORBIDDEN: readonly [string, RegExp][] = [
  ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/u],
  ['innerHTML/outerHTML', /\b(?:inner|outer)HTML\b/u],
  ['insertAdjacentHTML', /insertAdjacentHTML/u],
  ['document.write', /document\s*\.\s*write/u],
  ['href', /\bhref\b/iu],
  ['src/srcdoc attribute', /\b(?:srcDoc|srcdoc)\b/u],
  ['window.open', /\bwindow\s*\.\s*open\b|\bopen\s*\(\s*['"`]/u],
  ['location assignment', /\b(?:window\.)?location\s*(?:\.\s*(?:assign|replace|href)|=)/u],
  ['fetch', /\bfetch\s*\(/u],
  ['XMLHttpRequest', /XMLHttpRequest/u],
  ['WebSocket/EventSource/sendBeacon', /\b(?:WebSocket|EventSource|sendBeacon)\b/u],
  ['eval / Function constructor', /\beval\s*\(|new\s+Function\b|\bFunction\s*\(/u],
  ['timers carrying strings', /set(?:Timeout|Interval)\s*\(\s*['"`]/u],
  ['child_process / spawn / exec', /child_process|\bspawn\s*\(|\bexecFile?\s*\(/u],
  ['node: imports', /['"`]node:/u],
  ['electron', /\belectron\b/iu],
  ['dynamic import', /\bimport\s*\(/u],
  ['require', /\brequire\s*\(/u],
  ['inline style prop', /\bstyle\s*:/u],
  ['style element', /['"`]style['"`]/u],
  ['unsafe React escape hatches', /\b(?:findDOMNode|unstable_batchedUpdates)\b|createPortal|dangerously/u],
  ['process / env / fs', /\bprocess\s*\.|\bprocess\b\s*\[|\bfs\b\s*\./u],
];

for (const [label, pattern] of FORBIDDEN) {
  test(`production source never uses ${label}`, () => {
    for (const { name, text } of sources) {
      if (name.endsWith('.css')) continue;
      assert.equal(pattern.test(stripComments(text)), false, `${name} matches ${label}`);
    }
  });
}

test('imports are limited to react, relative src files and the accepted contract', () => {
  for (const { name, text } of sources) {
    if (name.endsWith('.css')) continue;
    for (const match of stripComments(text).matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)) {
      const specifier = match[1]!;
      const allowed = specifier === 'react' || /^\.\/[a-z-]+\.ts$/u.test(specifier) || specifier === '../../contract/src/index.ts';
      assert.ok(allowed, `${name} imports ${specifier}`);
    }
    assert.equal(/@hq\/|\/core\/|\/ui\/src|@hq\/ui|@hq\/contracts/u.test(text), false, `${name} reaches another cone`);
  }
});

test('the stylesheet uses wiki- classes and shared appearance roles without loading resources', () => {
  const css = readFileSync(new URL('wiki-view.css', SRC), 'utf8');
  assert.match(css, /--wiki-bg:\s*var\(--hq-surface\)/u);
  assert.match(css, /--wiki-text:\s*var\(--hq-text\)/u);
  assert.match(css, /--wiki-accent:\s*var\(--hq-accent-text\)/u);
  assert.equal(/@import|url\(/iu.test(css), false, 'no remote or file loads');
  const selectors = css.replace(/\/\*[\s\S]*?\*\//gu, '').match(/[^{}]+(?=\{)/gu) ?? [];
  for (const selector of selectors) {
    for (const part of selector.split(',').map((item) => item.trim()).filter((item) => item.length > 0)) {
      assert.match(part, /^(?:\.wiki-|:root|@media)/u, `selector ${part} is not wiki- scoped`);
    }
  }
});
