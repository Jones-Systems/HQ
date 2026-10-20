import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';

it('the provider runtime graph is renderer-safe and imports no other domain or storage', () => {
  const entry = fileURLToPath(new URL('../index.ts', import.meta.url));
  const root = fileURLToPath(new URL('../../../../../', import.meta.url));
  const visited = new Set<string>();
  function walk(path: string) {
    if (visited.has(path)) return;
    visited.add(path);
    assert.doesNotMatch(path, /\/(?:social|work|wiki|storage)\/|\/node\.ts$|\/packages\/design-store\//u);
    const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
    assert.doesNotMatch(code, /\b(?:require\s*\(|import\s*\(|import\.meta|process\.|Buffer\.)/u);
    // Mirrors the existing app guard's static-import scan. Every import/export
    // with a module target must match; unfamiliar syntax fails closed.
    const statements = [...code.matchAll(/\b(?:import|export)\s+(?:type\s+)?(?:[^;]*?\bfrom\s*)?['"][^'"]+['"]\s*;/gu)];
    for (const [statement] of statements) {
      const match = /^(?:import|export)\s+(type\s+)?[^;]*?['"]([^'"]+)['"]\s*;$/u.exec(statement);
      assert.ok(match, statement);
      const target = match[2]; assert.ok(target);
      if (path === entry && target === '@hq/contracts') assert.ok(match[1], 'canonical types must be erased');
      if (match[1]) continue;
      assert.doesNotMatch(target, /^(?:node:|electron$)|(?:social|work|wiki|storage|design-store)/u);
      if (target === '@hq/contracts') walk(resolve(root, 'packages/contracts/src/index.ts'));
      else { assert.ok(target.startsWith('.'), target); walk(resolve(dirname(path), target)); }
    }
    const remainder = statements.reduce((text, [statement]) => text.replace(statement, ''), code);
    assert.doesNotMatch(remainder, /\bimport\b|\bexport\s+[^;]*?\bfrom\s*['"]/u);
  }
  walk(entry);
  assert.ok(visited.size >= 3);
});
