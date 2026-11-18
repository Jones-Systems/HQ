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

const stylesheets = files.filter((name) => name.endsWith('.css'));

test('production source is erasable TypeScript (.ts only, no JSX, no CSS-in-JS) plus wiki-*.css files', () => {
  assert.ok(files.length >= 10);
  for (const name of files) assert.ok(name.endsWith('.ts') || /^wiki-[a-z-]+\.css$/u.test(name), name);
  assert.ok(stylesheets.includes('wiki-view.css'), 'the base stylesheet exists');
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

/** Every rule head with its enclosing at-rule (null at the top level). Comments are removed first. */
function ruleHeads(css: string): { readonly head: string; readonly parent: string | null }[] {
  const heads: { head: string; parent: string | null }[] = [];
  const stack: string[] = [];
  let buffer = '';
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//gu, '')) {
    if (ch === '{') {
      const head = buffer.trim();
      heads.push({ head, parent: stack.at(-1) ?? null });
      stack.push(head);
      buffer = '';
    } else if (ch === '}') {
      stack.pop();
      buffer = '';
    } else if (ch === ';') {
      buffer = '';
    } else {
      buffer += ch;
    }
  }
  assert.equal(stack.length, 0, 'balanced braces');
  return heads;
}

const AT_RULES = /^@(?:media|supports|container|starting-style)\b|^@keyframes wiki-[a-z0-9-]+$/u;
const KEYFRAME_SELECTOR = /^(?:from|to|\d+(?:\.\d+)?%)(?:\s*,\s*(?:from|to|\d+(?:\.\d+)?%))*$/u;

test('the base stylesheet maps the shared appearance roles', () => {
  const css = readFileSync(new URL('wiki-view.css', SRC), 'utf8');
  assert.match(css, /--wiki-bg:\s*var\(--hq-surface\)/u);
  assert.match(css, /--wiki-text:\s*var\(--hq-text\)/u);
  assert.match(css, /--wiki-accent:\s*var\(--hq-accent-text\)/u);
});

for (const file of stylesheets) {
  test(`${file}: wiki- scoped selectors, wiki- keyframes, no resource loads`, () => {
    const css = readFileSync(new URL(file, SRC), 'utf8');
    assert.equal(/@import|url\(|@font-face/iu.test(css), false, 'no remote or file loads');
    for (const { head, parent } of ruleHeads(css)) {
      if (parent !== null && parent.startsWith('@keyframes')) {
        assert.match(head, KEYFRAME_SELECTOR, `keyframe selector ${head} in ${parent}`);
        continue;
      }
      if (head.startsWith('@')) {
        assert.match(head, AT_RULES, `at-rule ${head} is not allowed`);
        continue;
      }
      for (const part of head.split(',').map((item) => item.trim()).filter((item) => item.length > 0)) {
        assert.match(part, /^(?:\.wiki-|:root)/u, `selector ${part} is not wiki- scoped`);
      }
    }
  });

  test(`${file}: motion is timed by the shared duration tokens`, () => {
    const css = readFileSync(new URL(file, SRC), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
    for (const match of css.matchAll(/\b(transition(?:-duration)?|animation(?:-duration)?)\s*:\s*([^;}]+)/gu)) {
      const [, property, value] = match as unknown as [string, string, string];
      if (/^\s*none\s*$/u.test(value)) continue;
      assert.match(value, /var\(--hq-duration-[a-z]+\)/u, `${property}: ${value.trim()} uses a token duration`);
      assert.equal(/(?<![\w-])\d+(?:\.\d+)?m?s\b/u.test(value.replace(/var\([^)]*\)/gu, '')), false, `${property}: ${value.trim()} has a raw duration`);
    }
  });
}
