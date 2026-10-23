import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const workspace: Readonly<Record<string, string>> = {
  '@hq/ui': resolve(root, '../../../../packages/hq-ui/src/index.ts'),
  '@hq/contracts': resolve(root, '../../../../packages/contracts/src/index.ts'),
};

function resolveSource(from: string, specifier: string): string {
  const base = resolve(dirname(from), specifier);
  const target = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((path) => existsSync(path) && statSync(path).isFile());
  assert.ok(target, `${from}: unresolved import ${specifier}`);
  return target;
}

const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
function runtimeImports(source: string): string[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const imports: string[] = [];
  const statements = /\b(?:import|export)\s+(?!type\b)(?:[^;'"]*?\sfrom\s*)?['"]([^'"]+)['"]/g;
  for (const match of clean.matchAll(statements)) imports.push(match[1]!);
  for (const match of clean.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) imports.push(match[1]!);
  assert.doesNotMatch(clean, /\bimport\s*\(\s*[^'"\s]/, 'dynamic imports must be literal and walkable');
  return imports;
}
function forbidden(specifier: string): boolean {
  return specifier.startsWith('node:') || builtins.has(specifier) || specifier === 'electron'
    || /(?:^|\/)(?:storage|producer)(?:\/|$)|(?:^|\/)node\.ts$|packages\/design-store/.test(specifier);
}

test('all section runtime imports remain renderer-safe; no descriptors or producer mounting', () => {
  const visited = new Set<string>();
  const visit = (path: string) => {
    if (visited.has(path) || path.endsWith('.css')) return;
    assert.equal(forbidden(path), false, path);
    visited.add(path);
    const text = readFileSync(path, 'utf8');
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(/\bprocess\s*\.|\bBuffer\b|\brequire\s*\(|URL\.createObjectURL|\bfetch\s*\(|\bWebSocket\b/.test(code), false, path);
    for (const specifier of runtimeImports(text)) {
      assert.equal(forbidden(specifier), false, `${path}: ${specifier}`);
      if (specifier.startsWith('.')) visit(resolveSource(path, specifier));
      else if (Object.hasOwn(workspace, specifier)) visit(workspace[specifier]!);
      else assert.ok(['react', 'react/jsx-runtime'].includes(specifier), `unqualified package: ${specifier}`);
    }
  };
  for (const section of ['requests', 'runs', 'references']) {
    for (const name of readdirSync(resolve(root, section))) {
      if (/\.test\.tsx?$/.test(name)) continue;
      assert.notEqual(name, 'design-module.ts');
      const path = resolve(root, section, name);
      visit(path);
    }
  }
  assert.ok(visited.has(workspace['@hq/ui']!), 'the shared kit is scanned, not exempted');
  assert.ok(visited.has(resolve(root, '../../../../packages/hq-ui/src/components/Button.tsx')));
  assert.ok(visited.size > 20, 'follow the lane imports, not just section entry points');
});

test('import scanner catches side effects, reexports, mixed and dynamic imports', () => {
  assert.deepEqual(runtimeImports(`
    import type { Port } from './storage/types.ts';
    import { type A, value } from './mixed.ts';
    import 'node:fs';
    export { value } from './node.ts';
    const lazy = import('electron');
  `), ['./mixed.ts', 'node:fs', './node.ts', 'electron']);
  for (const specifier of ['node:fs', 'fs', 'electron', '../storage/index.ts', '../producer/src/run.ts', './node.ts']) {
    assert.equal(forbidden(specifier), true, specifier);
  }
});
