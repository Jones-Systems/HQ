import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
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

function staticText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return staticText(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
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
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  function add(node: ts.Node | undefined) {
    if (node) { const value = staticText(node); if (value !== null) specifiers.push(value); }
  }
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (callee.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(callee) && callee.text === 'require')
        || (ts.isPropertyAccessExpression(callee) && (callee.name.text === 'require'
          || (ts.isIdentifier(callee.expression) && callee.expression.text === 'require' && callee.name.text === 'resolve')))) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
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
    "// import './hq-records/comment.js';",
  ].join('\n'));
  expect(imports).toHaveLength(9);
  expect(imports.every(specifier => isRecordsImport(join(repo, 'apps/fixture.ts'), specifier))).toBe(true);
  expect(isRecordsImport(join(repo, 'apps/fixture.ts'), './unrelated.js')).toBe(false);
  expect(importSpecifiers('fixture.html', '<script type="module" src="./hq-records/keys.js"></script><script>import("./hq-records/canonical.js")</script>'))
    .toEqual(['./hq-records/keys.js', './hq-records/canonical.js']);
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
  const files = sourceFiles(records);
  expect(files.map(path => relative(records, path)).sort()).toEqual([
    'adoption-classifier.ts', 'canonical.ts', 'keys.ts', 'projects-registry.ts', 'write-fence.ts',
  ]);
  for (const path of files) {
    const source = readFileSync(path, 'utf8');
    for (const specifier of importSpecifiers(path, source)) {
      expect(specifier).toMatch(/^(?:node:crypto|\.\/(?:canonical|keys|projects-registry|adoption-classifier|write-fence)\.js)$/u);
    }
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    for (const statement of file.statements) {
      expect(ts.isExpressionStatement(statement)).toBe(false);
      if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
        if (!declaration.initializer) continue;
        expect(ts.isNewExpression(declaration.initializer)).toBe(false);
        if (ts.isCallExpression(declaration.initializer)) {
          expect(relative(records, path)).toBe('write-fence.ts');
          expect(declaration.initializer.expression.getText(file)).toBe('Object.freeze');
        }
      }
    }
  }
});
