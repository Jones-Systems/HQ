import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Node } from '@oxc-project/types';
import { parseAst } from 'rolldown/parseAst';
import { expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const records = join(repo, 'apps/desktop/electron/hq-records');
const generated = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'dist-design-host', 'dist-wiki-host', 'coverage', '.cache']);
const sourceExtension = /\.(?:[cm]?[jt]sx?|html|vue|svelte)$/u;
const testExtension = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink() || generated.has(entry.name)) return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && sourceExtension.test(entry.name) && !testExtension.test(entry.name) ? [path] : [];
  });
}

// TypeScript 7's root export is version metadata, not the legacy compiler API.
// Vite's locked Rolldown dependency already supplies a JS/TS parser.
function parseSource(path: string, source: string) {
  const lang = /\.d\.[cm]?ts$/u.test(path) ? 'dts'
    : /\.[cm]?tsx?$/u.test(path) ? (path.endsWith('x') ? 'tsx' : 'ts') : 'jsx';
  return parseAst(source, { lang, sourceType: 'unambiguous' }, path);
}

function staticText(node: Node): string | null {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node.type === 'ParenthesizedExpression') return staticText(node.expression);
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticText(node.left), right = staticText(node.right);
    return left !== null && right !== null ? left + right : null;
  }
  return null;
}

function importSpecifiers(path: string, source: string): string[] {
  if (/\.(?:html|vue|svelte)$/u.test(path)) {
    return [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/giu)].flatMap(script => {
      const src = /\bsrc\s*=\s*["']([^"']+)["']/iu.exec(script[1]);
      return [...(src ? [src[1]] : []), ...importSpecifiers(`${path}.ts`, script[2])];
    });
  }
  const file = parseSource(path, source);
  const specifiers: string[] = [];
  function add(node: Node | null | undefined) {
    if (node) { const value = staticText(node); if (value !== null) specifiers.push(value); }
  }
  function isNode(value: unknown): value is Node {
    return value !== null && typeof value === 'object' && 'type' in value && typeof value.type === 'string';
  }
  function visit(node: Node) {
    if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration'
      || node.type === 'ImportExpression' || node.type === 'TSImportType') add(node.source);
    if (node.type === 'TSExternalModuleReference') add(node.expression);
    if (node.type === 'CallExpression') {
      const callee = node.callee;
      if ((callee.type === 'Identifier' && callee.name === 'require')
        || (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier'
          && (callee.property.name === 'require'
            || (callee.object.type === 'Identifier' && callee.object.name === 'require' && callee.property.name === 'resolve')))) add(node.arguments[0]);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) { for (const child of value) if (isNode(child)) visit(child); }
      else if (isNode(value)) visit(value);
    }
  }
  visit(file);
  return specifiers;
}

function isRecordsImport(path: string, specifier: string): boolean {
  if (/(?:^|[/\\])hq-records(?:[/\\]|$)/u.test(specifier)) return true;
  if (!specifier.startsWith('.')) return false;
  const target = resolve(dirname(path), specifier);
  const within = relative(records, target);
  return within === '' || (!within.startsWith('..') && !within.startsWith('/'));
}

function expectInertTopLevel(path: string, source: string) {
  for (const exported of parseSource(path, source).body) {
    const statement = exported.type === 'ExportNamedDeclaration' ? exported.declaration : exported;
    expect(statement?.type).not.toBe('ExpressionStatement');
    if (statement?.type === 'VariableDeclaration') for (const declaration of statement.declarations) {
      if (!declaration.init) continue;
      expect(declaration.init.type).not.toBe('NewExpression');
      if (declaration.init.type === 'CallExpression') {
        expect(relative(records, path)).toBe('write-fence.ts');
        expect(source.slice(declaration.init.callee.start, declaration.init.callee.end)).toBe('Object.freeze');
      }
    }
  }
}

it('recognizes static, re-export, dynamic, CommonJS and type imports without mistaking ordinary strings for imports', () => {
  const imports = importSpecifiers('fixture.ts', [
    "import { x } from './hq-records/canonical.js';",
    "export * from './hq-records/keys.js';",
    "import('./hq-records/projects-registry.js');",
    'import(`./hq-records/write-fence.js`);',
    "require('./hq-' + 'records/adoption-classifier.js');",
    "module.require('./hq-records/canonical.js');",
    "require.resolve('./hq-records/keys.js');",
    "import c = require('./hq-records/canonical.js');",
    "type C = import('./hq-records/canonical.js').Digest;",
    "const documentation = 'hq-records/canonical.js';",
    'const example = "import(\'./hq-records/string.js\')";',
    "const template = `require('./hq-records/template.js')`;",
    "const pattern = /import('hq-records')/;",
    "// import './hq-records/comment.js';",
    "/* export * from './hq-records/block-comment.js'; */",
  ].join('\n'));
  expect(imports).toHaveLength(9);
  expect(imports.every(specifier => isRecordsImport(join(repo, 'apps/fixture.ts'), specifier))).toBe(true);
  expect(isRecordsImport(join(repo, 'apps/fixture.ts'), './unrelated.js')).toBe(false);
  expect(importSpecifiers('fixture.html', '<script type="module" src="./hq-records/keys.js"></script><script>import("./hq-records/canonical.js")</script>'))
    .toEqual(['./hq-records/keys.js', './hq-records/canonical.js']);
  expect(importSpecifiers('fixture.ts', [
    "import type { Digest } from './hq-records/canonical.js';",
    "export { type Digest } from './hq-records/canonical.js';",
    "require(('./hq-' + ('records/keys.js')));",
  ].join('\n'))).toEqual(['./hq-records/canonical.js', './hq-records/canonical.js', './hq-records/keys.js']);
  expect(importSpecifiers('fixture.tsx', 'const view = <div title="hq-records/text.js">{import("./hq-records/keys.js")}</div>;'))
    .toEqual(['./hq-records/keys.js']);
});

it('keeps identity contracts inert: no non-test production importer under apps, modules or packages', () => {
  const violations: string[] = [];
  const files = ['apps', 'modules', 'packages'].flatMap(root => sourceFiles(join(repo, root)));
  expect(files.length).toBeGreaterThan(0);
  for (const path of files) {
    if (dirname(path) === records) continue;
    for (const specifier of importSpecifiers(path, readFileSync(path, 'utf8'))) {
      if (isRecordsImport(path, specifier)) violations.push(`${relative(repo, path)} -> ${specifier}`);
    }
  }
  expect(violations).toEqual([]);
});

it('permits only local contract imports and node:crypto, with no host/store construction on import', () => {
  expect(() => expectInertTopLevel(join(records, 'canonical.ts'), 'openStore();')).toThrow();
  expect(() => expectInertTopLevel(join(records, 'canonical.ts'), 'export const store = new Store();')).toThrow();
  expect(() => expectInertTopLevel(join(records, 'canonical.ts'), 'export const plan = Object.freeze([]);')).toThrow();
  expect(() => expectInertTopLevel(join(records, 'write-fence.ts'), 'export const store = createStore();')).toThrow();
  expectInertTopLevel(join(records, 'write-fence.ts'), 'export const plan = Object.freeze([]);');
  const files = sourceFiles(records);
  expect(files.map(path => relative(records, path)).sort()).toEqual([
    'adoption-classifier.ts', 'canonical.ts', 'capture-evidence.ts', 'keys.ts', 'projects-registry.ts', 'write-fence.ts',
  ]);
  for (const path of files) {
    const source = readFileSync(path, 'utf8');
    for (const specifier of importSpecifiers(path, source)) {
      expect(specifier).toMatch(/^(?:node:crypto|\.\/(?:canonical|keys|projects-registry|adoption-classifier|write-fence)\.js)$/u);
    }
    expectInertTopLevel(path, source);
  }
});
