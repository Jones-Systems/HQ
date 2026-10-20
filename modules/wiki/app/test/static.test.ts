// Static rules for the assembly: renderer code reaches nothing it should not, the stylesheets are plain files that
// satisfy `style-src 'self'`, the package is declared for T2, and the data in the repository is synthetic only.

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

const WIKI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(WIKI, 'app', 'src');

function walk(dir: string, accept: (path: string) => boolean): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((entry) => {
      const full = join(dir, entry);
      if (entry === 'node_modules') return [];
      return statSync(full).isDirectory() ? walk(full, accept) : accept(full) ? [full] : [];
    });
}
const read = (path: string): string => readFileSync(path, 'utf8');
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const sources = walk(SRC, (p) => p.endsWith('.ts'));

describe('renderer source', () => {
  test('the expected files exist', () => {
    assert.deepEqual(sources.map((p) => relative(SRC, p)), ['client.ts', 'domain.ts', 'index.ts', 'port.ts']);
  });

  const FORBIDDEN: readonly [string, RegExp][] = [
    ['node: imports', /['"`]node:/u],
    ['electron / ipcRenderer / contextBridge', /['"`]electron['"`]|\b(?:ipcRenderer|contextBridge)\b/u],
    ['the Wiki core (host side)', /core\/src/u],
    ['child_process / spawn / exec', /child_process|\bspawn\s*\(|\bexecFile?\s*\(/u],
    ['fetch / XMLHttpRequest / sockets', /\bfetch\s*\(|XMLHttpRequest|\b(?:WebSocket|EventSource|sendBeacon)\b/u],
    ['eval / Function constructor', /\beval\s*\(|new\s+Function\b|\bFunction\s*\(/u],
    ['unsafe HTML', /dangerouslySetInnerHTML|\b(?:inner|outer)HTML\b|insertAdjacentHTML|document\s*\.\s*write/u],
    ['window or global access', /\b(?:window|globalThis|document|localStorage|sessionStorage)\b/u],
    ['inline style', /\bstyle\s*[:=]|<style|cssText|adoptedStyleSheets|CSSStyleSheet/u],
    ['dynamic import / require', /\bimport\s*\(|\brequire\s*\(/u],
    ['a refresh or migration call', /\.(?:refresh|migrate\w*)\s*\(/u],
  ];
  for (const [name, pattern] of FORBIDDEN) {
    test(`no ${name}`, () => {
      for (const path of sources) assert.ok(!pattern.test(stripComments(read(path))), `${relative(SRC, path)} matches ${name}`);
    });
  }

  test('imports are limited to react, the contract, the UI and this module', () => {
    const allowed = [/^react$/, /^\.\.\/\.\.\/contract\/src\/index\.ts$/, /^\.\.\/\.\.\/ui\/src\/index\.ts$/, /^\.\/[a-z-]+\.ts$/, /^\.\.\/\.\.\/ui\/src\/wiki-view\.css$/, /^\.\/wiki-domain\.css$/];
    for (const path of sources) {
      const code = stripComments(read(path));
      for (const match of code.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"`]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) {
        const specifier = (match[1] ?? match[2]) as string;
        assert.ok(allowed.some((rule) => rule.test(specifier)), `${relative(SRC, path)} imports ${specifier}`);
      }
    }
  });

  test('the descriptor and client files can load without a stylesheet', () => {
    for (const name of ['client.ts', 'domain.ts', 'port.ts']) assert.ok(!/\.css['"]/.test(read(join(SRC, name))), name);
  });
});

describe('stylesheets', () => {
  const entry = stripComments(read(join(SRC, 'index.ts')));
  const imported = [...entry.matchAll(/^\s*import\s*['"]([^'"]+\.css)['"]/gm)].map((m) => m[1] as string);

  test('the entry imports exactly the two stylesheet files, and both exist', () => {
    assert.deepEqual(imported, ['../../ui/src/wiki-view.css', './wiki-domain.css']);
    for (const file of imported) assert.ok(existsSync(resolve(SRC, file)), file);
  });

  for (const file of imported) {
    const css = (): string => stripComments(read(resolve(SRC, file)));

    test(`${file}: plain CSS with no import, remote, data or script reference`, () => {
      assert.ok(!/@import|@font-face|url\s*\(|expression\s*\(|behavior\s*:|-moz-binding|javascript:/iu.test(css()));
      assert.ok(!/https?:\/\//iu.test(css()));
    });

    test(`${file}: every rule is scoped under .wiki-view or .wiki-domain`, () => {
      // Drop at-rule wrappers (@media) but keep their contents; then read each `selector { … }` head.
      const flat = css().replace(/@media[^{]*\{/g, '').replace(/\}\s*\}/g, '}');
      const heads = [...flat.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => (m[1] as string).trim());
      assert.ok(heads.length > 0);
      for (const head of heads) {
        for (const selector of head.split(',').map((s) => s.trim())) {
          assert.match(selector, /^\.wiki-(?:view|domain)\b/, `unscoped selector: ${selector}`);
        }
      }
    });
  }
});

describe('package and test layout', () => {
  const pkg = JSON.parse(read(join(WIKI, 'package.json'))) as Record<string, unknown>;

  test('@hq/wiki is a private ES module package exporting the production entry', () => {
    assert.equal(pkg['name'], '@hq/wiki');
    assert.equal(pkg['private'], true);
    assert.equal(pkg['type'], 'module');
    assert.deepEqual(pkg['exports'], { '.': './app/src/index.ts' });
    assert.ok(existsSync(join(WIKI, 'app', 'src', 'index.ts')));
  });

  test('the only runtime dependency is react, pinned to the repository version', () => {
    assert.deepEqual(Object.keys(pkg['dependencies'] as object), ['react']);
    const root = JSON.parse(read(join(WIKI, '..', '..', 'package-lock.json'))) as { packages: Record<string, { version?: string }> };
    assert.equal((pkg['dependencies'] as Record<string, string>)['react'], root.packages['node_modules/react']?.version);
  });

  test('the Node test runner needs Node >=22.18 for TypeScript type stripping, and this process has it', () => {
    assert.deepEqual(pkg['engines'], { node: '>=22.18.0' });
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    assert.ok(major > 22 || (major === 22 && minor >= 18), `running on Node ${process.versions.node}`);
  });

  test('the test script is node --test over every Wiki suite and does not use Vitest', () => {
    const script = (pkg['scripts'] as Record<string, string>)['test'] as string;
    assert.match(script, /^node --test /);
    for (const dir of ['contract', 'core', 'ui', 'app']) assert.ok(script.includes(`"${dir}/test/*.test.ts"`), dir);
    assert.ok(!/vitest/i.test(script));
  });

  test('every test file under modules/wiki is a node:test suite (none would run, or fail, under Vitest)', () => {
    const tests = walk(WIKI, (p) => /\.test\.tsx?$/.test(p));
    assert.ok(tests.length > 0);
    for (const path of tests) {
      assert.ok(path.endsWith('.test.ts'), `${relative(WIKI, path)} must not be a .test.tsx (Vitest's DOM project)`);
      assert.match(read(path), /from 'node:test'/, `${relative(WIKI, path)} must use node:test`);
    }
  });
});

describe('public safety', () => {
  // This lane's own files only: the assembly directory and the module package files.
  const files = [...walk(join(WIKI, 'app'), (p) => /\.(?:ts|md|json|css)$/.test(p)), join(WIKI, 'package.json'), join(WIKI, 'tsconfig.json')];
  const PRIVATE: readonly [string, RegExp][] = [
    ['a home or user path', /\/(?:home|Users)\/[A-Za-z0-9._-]+/],
    ['an IPv4 address', /\b(?:\d{1,3}\.){3}\d{1,3}\b/],
    // Built from fragments so this file does not match its own rule.
    ['a token or key', new RegExp(`\\b(?:${['gh', 'p_'].join('')}|${['github', '_pat_'].join('')}|${['s', 'k-'].join('')}[A-Za-z0-9]{8}|xox[bp]-|AKIA[0-9A-Z]{12})`)],
    ['an email address other than a reserved example domain', /[A-Za-z0-9._%+-]+@(?!example\.invalid\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
    ['a private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ];
  for (const [name, pattern] of PRIVATE) {
    test(`no ${name} in the assembly files`, () => {
      for (const path of files) {
        assert.ok(!pattern.test(read(path)), `${relative(WIKI, path)} matches ${name}`);
      }
    });
  }

  test('the corpus fixture is labelled synthetic and every remote is a reserved example domain', () => {
    assert.match(read(join(WIKI, 'app', 'fixtures', 'README.md')), /\*\*synthetic\*\*/);
    const corpus = walk(join(WIKI, 'app', 'fixtures', 'corpus'), () => true);
    assert.ok(corpus.length >= 10);
    for (const path of corpus) for (const url of read(path).match(/https?:\/\/[^\s)'"]+/g) ?? []) assert.match(url, /^https:\/\/example\.invalid\//, relative(WIKI, path));
    assert.match(read(join(WIKI, 'app', 'test', 'corpus.ts')), /REMOTE = 'https:\/\/example\.invalid\//);
  });
});
