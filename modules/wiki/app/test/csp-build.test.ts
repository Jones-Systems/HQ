// Proves the stylesheet claim by building the production entry with the repository's own Vite: the CSS must come out
// as an external file, and the JavaScript must not create style elements or inline styles. The shell's CSP is
// `style-src 'self'`, which allows exactly that. Build output goes to task-owned scratch and is removed afterwards.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { build } from 'vite';
import { createScratch, type Scratch } from './scratch.ts';

const WIKI = join(import.meta.dirname, '..', '..');
let scratch: Scratch;
let files: string[] = [];
let outDir = '';

before(async () => {
  scratch = createScratch('csp-build');
  outDir = join(scratch.root, 'dist');
  await build({
    root: WIKI,
    configFile: false,
    logLevel: 'silent',
    mode: 'production',
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      lib: { entry: join(WIKI, 'app', 'src', 'index.ts'), formats: ['es'], fileName: 'wiki' },
      rollupOptions: { external: ['react', 'react/jsx-runtime'] },
    },
  });
  files = readdirSync(outDir).sort();
});
after(() => scratch?.cleanup());

test('the build emits the stylesheets as an external CSS file', () => {
  const css = files.filter((name) => name.endsWith('.css'));
  assert.equal(css.length, 1, `emitted: ${files.join(', ')}`);
  const text = readFileSync(join(outDir, css[0] as string), 'utf8');
  assert.match(text, /\.wiki-view\b/);
  assert.match(text, /\.wiki-domain\b/);
  assert.match(text, /--wiki-bg:\s*var\(--hq-surface\)/);
  assert.match(text, /--wiki-text:\s*var\(--hq-text\)/);
  assert.ok(!/@import|url\s*\(/i.test(text), 'no further requests from the stylesheet');
});

test('the JavaScript injects no style and uses no network or page-writing API', () => {
  const js = files.filter((name) => name.endsWith('.js'));
  assert.deepEqual(js, ['wiki.js']);
  const code = readFileSync(join(outDir, 'wiki.js'), 'utf8');
  for (const [name, pattern] of [
    ['a created <style> element', /createElement\(\s*["']style["']\s*\)/],
    ['an inline style assignment', /\.style\.cssText|\.setAttribute\(\s*["']style["']/],
    ['constructable stylesheets', /adoptedStyleSheets|new\s+CSSStyleSheet/],
    ['innerHTML', /\.innerHTML\b|insertAdjacentHTML/],
    ['document.head, document.write or window.open', /\bdocument\.(?:head|write|writeln|styleSheets)\b|\bwindow\.(?:open|location)\b/],
    ['fetch', /\bfetch\s*\(/],
  ] as const) {
    assert.ok(!pattern.test(code), `the bundle contains ${name}`);
  }
  assert.match(code, /createWikiDomain/);
});
