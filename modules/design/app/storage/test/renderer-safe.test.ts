/**
 * Static proof that storage/index.ts is renderer-safe: its import graph contains no node:* module,
 * no electron, no bare package, and nothing from the store's Node code. The only edge into the
 * store is an erased `import type` of the contract, which itself must have no imports.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeDir, proveCleanup, removeDir } from './helpers.ts';

proveCleanup();

const STORAGE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STORE_CONTRACT = resolve(STORAGE, '../../../../packages/design-store/src/contract.ts');
const NODE_GLOBALS = /\b(?:process\.|require\(|Buffer\b|__dirname|__filename)/u;

interface Edge {
  readonly specifier: string;
  readonly typeOnly: boolean;
}

function edgesOf(source: string): Edge[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
  const edges: Edge[] = [];
  const statement = /\b(import|export)\s+(type\s+)?([^'";]*?)\bfrom\s*['"]([^'"]+)['"]/gu;
  for (const match of code.matchAll(statement)) edges.push({ specifier: match[4]!, typeOnly: match[2] !== undefined });
  for (const match of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/gu)) edges.push({ specifier: match[1]!, typeOnly: false });
  for (const match of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu)) edges.push({ specifier: match[1]!, typeOnly: false });
  return edges;
}

export function analyze(entry: string, storeContract: string): { readonly files: string[]; readonly violations: string[] } {
  const files = new Set<string>();
  const violations: string[] = [];
  const visit = (file: string): void => {
    if (files.has(file)) return;
    files.add(file);
    const source = readFileSync(file, 'utf8');
    if (NODE_GLOBALS.test(source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, ''))) violations.push(`${relative(STORAGE, file)}: Node global`);
    for (const edge of edgesOf(source)) {
      const from = relative(STORAGE, file);
      if (!edge.specifier.startsWith('.')) {
        violations.push(`${from}: non-relative import ${edge.specifier}`);
        continue;
      }
      const target = resolve(dirname(file), edge.specifier);
      // Type-only edges are erased at runtime; the declarations-only store contract is reachable only this way.
      if (target === storeContract) {
        if (edge.typeOnly) visit(target);
        else violations.push(`${from}: runtime import of the store contract`);
      }
      else if (target.startsWith(`${dirname(storeContract)}/`)) violations.push(`${from}: ${edge.typeOnly ? 'type import of ' : ''}store implementation file ${relative(dirname(storeContract), target)}`);
      else if (!existsSync(target)) violations.push(`${from}: unresolved ${edge.specifier}`);
      else visit(target);
    }
  };
  visit(entry);
  if (files.has(storeContract) && edgesOf(readFileSync(storeContract, 'utf8')).length > 0) violations.push('store contract has imports');
  return { files: [...files], violations };
}

describe('storage/index.ts is renderer-safe', () => {
  it('reaches only pure modules and the declarations-only store contract', () => {
    const { files, violations } = analyze(join(STORAGE, 'index.ts'), STORE_CONTRACT);
    assert.deepEqual(violations, []);
    const names = files.map((file) => relative(STORAGE, file)).sort();
    assert.deepEqual(names, [
      '../../../../packages/design-store/src/contract.ts',
      'backing.ts', 'canonical.ts', 'canvas.ts', 'export.ts', 'index.ts', 'outbox.ts', 'requests.ts',
    ].sort(), 'the graph is exactly the expected renderer-safe set');
  });

  it('keeps the Node wiring and the unaccepted proposal out of the graph', () => {
    const { files } = analyze(join(STORAGE, 'index.ts'), STORE_CONTRACT);
    const names = files.map((file) => relative(STORAGE, file));
    for (const banned of ['node.ts', 'proposal/imports-txn.ts']) assert.equal(names.includes(banned), false, banned);
    assert.equal(names.some((name) => /design-store\/src\/(?!contract\.ts)/u.test(name)), false, 'no store implementation file is reachable');
  });

  it('would catch each kind of violation (analyzer self-test on synthetic files)', () => {
    const dir = makeDir();
    try {
      const storeDir = join(dir, 'store');
      mkdirSync(storeDir);
      const contract = join(storeDir, 'contract.ts');
      writeFileSync(contract, 'export type X = string;\n');
      writeFileSync(join(storeDir, 'fs.ts'), "import { open } from 'node:fs/promises';\nexport const nodeFs = open;\n");
      const cases: Record<string, { files: Record<string, string>; expect: RegExp }> = {
        'node: import': { files: { 'entry.ts': "import { readFile } from 'node:fs/promises';\nexport const a = readFile;\n" }, expect: /non-relative import node:fs/u },
        electron: { files: { 'entry.ts': "import { app } from 'electron';\nexport { app };\n" }, expect: /non-relative import electron/u },
        'bare package': { files: { 'entry.ts': "export * from 'left-pad';\n" }, expect: /non-relative import left-pad/u },
        'transitive node: import': {
          files: { 'entry.ts': "export * from './mid.ts';\n", 'mid.ts': "import { join } from 'node:path';\nexport const j = join;\n" },
          expect: /mid\.ts: non-relative import node:path/u,
        },
        'runtime import of store fs code': {
          files: { 'entry.ts': "export { nodeFs } from '../store/fs.ts';\n" },
          expect: /store implementation file fs\.ts/u,
        },
        'type import of a non-contract file': {
          files: { 'entry.ts': "import type { F } from '../store/fs.ts';\nexport type G = F;\n" },
          expect: /type import of store implementation file fs\.ts/u,
        },
        'runtime import of the contract': { files: { 'entry.ts': "export { X } from '../store/contract.ts';\n" }, expect: /runtime import of the store contract/u },
        'node global': { files: { 'entry.ts': 'export const p = process.cwd();\n' }, expect: /Node global/u },
        'dynamic import': { files: { 'entry.ts': "export const l = () => import('node:fs');\n" }, expect: /non-relative import node:fs/u },
      };
      for (const [name, scenario] of Object.entries(cases)) {
        const sub = join(dir, name.replace(/\W+/gu, '-'));
        const entry = join(sub, 'entry.ts');
        mkdirSync(sub, { recursive: true });
        for (const [file, text] of Object.entries(scenario.files)) writeFileSync(join(sub, file), text);
        const { violations } = analyze(entry, contract);
        assert.ok(violations.some((violation) => scenario.expect.test(violation)), `${name}: expected a violation, got ${JSON.stringify(violations)}`);
      }
    } finally {
      removeDir(dir);
    }
  });
});
