/**
 * Static renderer-safety proof for the Design production entry and everything compose adds.
 *
 * Walks the RUNTIME import graph from `app/index.ts`, every compose module and every section
 * descriptor: static imports, side-effect imports, dynamic `import()`, `export … from`, and
 * `import.meta.glob`. Only `import type` / `export type` edges are erased. It asserts that no runtime
 * path reaches `storage/node.ts`, `packages/design-store/src/**`, a Node
 * builtin, or electron, and that reachable source uses no `process`/`Buffer`/`require` globals.
 * Runtime entry to storage is only through storage/index.ts; its graph is then walked. Erased type
 * imports of storage may name only `storage/index.ts`, never `node.ts` or another storage file.
 *
 * The analyzer follows the approach of STORE's storage/test/renderer-safe.test.ts (read, not imported),
 * tightened so a type-only edge can never mask a neighbouring runtime edge. It is exercised on
 * in-memory fixtures below, so each violation kind is shown to be caught.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------------------ analyzer

interface Host {
  /** File text, or null when the path is not a file. */
  read(path: string): string | null;
  /** Entry names of a directory (empty when absent). */
  list(dir: string): readonly string[];
}

interface Layout {
  readonly designDir: string;
  readonly appDir: string;
  readonly storageDir: string;
  readonly storeSrc: string;
  /** Workspace packages followed like relative imports (bare specifier -> entry file). */
  readonly workspace: Readonly<Record<string, string>>;
}

interface Edge {
  readonly specifier: string;
  readonly typeOnly: boolean;
  readonly kind: 'static' | 'side-effect' | 'dynamic' | 'reexport' | 'glob';
}

interface Analysis {
  readonly files: readonly string[];
  readonly typeTargets: readonly { readonly from: string; readonly target: string }[];
  readonly external: readonly string[];
  readonly violations: readonly string[];
}

const BUILTINS = new Set(builtinModules.map((name) => name.replace(/^node:/u, '')));
const CODE = /\.(?:ts|tsx)$/u;
const IDENT = String.raw`[\w$]+`;
const STATEMENT_IMPORT = new RegExp(
  String.raw`\bimport\s+(type\s+)?(?:${IDENT}\s*,\s*)?(?:\*\s+as\s+${IDENT}|\{[^}]*\}|${IDENT})\s+from\s*['"]([^'"]+)['"]`, 'gu');
const STATEMENT_EXPORT = new RegExp(String.raw`\bexport\s+(type\s+)?(?:\*(?:\s+as\s+${IDENT})?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]`, 'gu');

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');

function edgesOf(source: string): { readonly edges: Edge[]; readonly unanalysable: string[] } {
  const code = stripComments(source);
  const edges: Edge[] = [];
  const unanalysable: string[] = [];
  for (const match of code.matchAll(STATEMENT_IMPORT)) edges.push({ specifier: match[2]!, typeOnly: match[1] !== undefined, kind: 'static' });
  for (const match of code.matchAll(STATEMENT_EXPORT)) edges.push({ specifier: match[2]!, typeOnly: match[1] !== undefined, kind: 'reexport' });
  for (const match of code.matchAll(/(?:^|;)[ \t]*import\s*['"]([^'"\n]+)['"]/gmu)) edges.push({ specifier: match[1]!, typeOnly: false, kind: 'side-effect' });
  for (const match of code.matchAll(/(?<![\w$.])import\s*\(\s*(['"`])([^'"`]+)\1\s*[,)]/gu)) edges.push({ specifier: match[2]!, typeOnly: false, kind: 'dynamic' });
  for (const match of code.matchAll(/(?<![\w$.])import\s*\(\s*(?!['"`])/gu)) unanalysable.push(`non-literal dynamic import near "${code.slice(match.index, match.index + 30).replace(/\s+/gu, ' ')}"`);
  for (const match of code.matchAll(/\bimport\.meta\.glob(?:Eager)?\s*\(\s*(?:\[([^\]]*)\]|(['"`])([^'"`]+)\2)/gu)) {
    const patterns = match[1] === undefined ? [match[3]!] : [...match[1].matchAll(/['"`]([^'"`]+)['"`]/gu)].map((pattern) => pattern[1]!);
    for (const pattern of patterns) edges.push({ specifier: pattern, typeOnly: false, kind: 'glob' });
  }
  return { edges, unanalysable };
}

/** Quoted strings blanked so prose such as "process." in a label is not mistaken for a global. */
const withoutStrings = (source: string): string => stripComments(source).replace(/(['"])(?:\\.|(?!\1)[^\\\n])*\1/gu, '""');
const NODE_GLOBALS = /\bprocess\s*[.[]|\bBuffer\b|\brequire\s*\(|__dirname|__filename|\bglobalThis\.(?:process|Buffer)\b/u;

function resolveRelative(host: Host, from: string, specifier: string): string | null {
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) if (host.read(candidate) !== null) return candidate;
  return null;
}

/** Expand a Vite glob whose wildcards sit in whole directory segments or the file stem (`../../*\/design-module.ts`). */
function expandGlob(host: Host, from: string, pattern: string): string[] {
  const segments = resolve(dirname(from), pattern).split('/').filter((part) => part !== '');
  let current = ['/'];
  for (const segment of segments) {
    const next: string[] = [];
    const matcher = new RegExp(`^${segment.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/gu, '\\$&')).join('[^/]*')}$`, 'u');
    for (const base of current) {
      if (!segment.includes('*')) { next.push(join(base, segment)); continue; }
      for (const name of host.list(base)) if (matcher.test(name)) next.push(join(base, name));
    }
    current = next;
  }
  return current.filter((path) => host.read(path) !== null);
}

const workspaceEntry = (layout: Layout, specifier: string): string | null => layout.workspace[specifier] ?? null;

function analyze(host: Host, layout: Layout): Analysis {
  const roots = new Set<string>();
  roots.add(join(layout.appDir, 'index.ts'));
  const compose = join(layout.appDir, 'compose');
  const walkCompose = (dir: string): void => {
    for (const name of host.list(dir)) {
      const path = join(dir, name);
      if (name === 'test') continue;
      if (host.read(path) !== null) { if (CODE.test(name)) roots.add(path); } else walkCompose(path);
    }
  };
  walkCompose(compose);
  for (const name of host.list(layout.designDir)) {
    const descriptor = join(layout.designDir, name, 'design-module.ts');
    if (host.read(descriptor) !== null) roots.add(descriptor);
  }

  const files = new Set<string>();
  const parent = new Map<string, string>();
  const violations: string[] = [];
  const external = new Set<string>();
  const typeTargets: { from: string; target: string }[] = [];
  const rel = (path: string): string => relative(layout.designDir, path);
  const chain = (file: string): string => {
    const hops: string[] = [];
    for (let at: string | undefined = file; at !== undefined && hops.length < 12; at = parent.get(at)) hops.unshift(rel(at));
    return hops.join(' -> ');
  };
  const inside = (path: string, dir: string): boolean => path === dir || path.startsWith(`${dir}/`);
  const flag = (file: string, message: string): void => { violations.push(`${chain(file)}: ${message}`); };

  const queue = [...roots];
  for (const root of roots) parent.delete(root);
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (files.has(file)) continue;
    files.add(file);
    const source = host.read(file);
    if (source === null || !CODE.test(file)) continue;
    if (NODE_GLOBALS.test(withoutStrings(source))) flag(file, 'Node global (process/Buffer/require)');
    const { edges, unanalysable } = edgesOf(source);
    for (const message of unanalysable) flag(file, message);
    for (const edge of edges) {
      const { specifier } = edge;
      if (!specifier.startsWith('.')) {
        if (edge.typeOnly) continue;
        const workspace = workspaceEntry(layout, specifier);
        if (workspace !== null) {
          if (host.read(workspace) === null) flag(file, `unresolved workspace package ${specifier}`);
          else { if (!files.has(workspace) && !parent.has(workspace) && !roots.has(workspace)) parent.set(workspace, file); queue.push(workspace); }
          continue;
        }
        const bare = specifier.replace(/^node:/u, '');
        if (specifier.startsWith('node:') || BUILTINS.has(bare.split('/')[0]!) || BUILTINS.has(bare)) flag(file, `${edge.kind} import of Node builtin ${specifier}`);
        else if (specifier === 'electron' || specifier.startsWith('electron/')) flag(file, `${edge.kind} import of electron`);
        else external.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!);
        continue;
      }
      const targets = edge.kind === 'glob' ? expandGlob(host, file, specifier) : [resolveRelative(host, file, specifier)];
      if (edge.kind === 'glob' && targets.length === 0) { flag(file, `import.meta.glob ${specifier} matched nothing`); continue; }
      for (const target of targets) {
        if (target === null) { flag(file, `unresolved ${edge.kind} import ${specifier}`); continue; }
        if (edge.typeOnly) {
          typeTargets.push({ from: file, target });
          if (!inside(file, layout.storageDir) && inside(target, layout.storageDir) && target !== join(layout.storageDir, 'index.ts')) flag(file, `type-only import of storage module ${rel(target)} (only storage/index.ts is allowed)`);
          if (!inside(file, layout.storageDir) && inside(target, layout.storeSrc)) flag(file, `type-only import of design-store ${relative(layout.storeSrc, target)}`);
          continue;
        }
        if (inside(target, layout.storageDir) && (target === join(layout.storageDir, 'node.ts')
          || (!inside(file, layout.storageDir) && target !== join(layout.storageDir, 'index.ts')))) flag(file, `${edge.kind} import reaches storage module ${rel(target)}`);
        if (inside(target, layout.storeSrc)) { flag(file, `${edge.kind} import reaches design-store ${relative(layout.storeSrc, target)}`); continue; }
        if (!files.has(target) && !parent.has(target) && !roots.has(target)) parent.set(target, file);
        queue.push(target);
      }
    }
  }
  return { files: [...files], typeTargets, external: [...external].sort(), violations };
}

// ------------------------------------------------------------------------------ real tree

const DESIGN = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const LAYOUT: Layout = {
  designDir: DESIGN,
  appDir: join(DESIGN, 'app'),
  storageDir: join(DESIGN, 'app/storage'),
  storeSrc: resolve(DESIGN, '../../packages/design-store/src'),
  workspace: {
    '@hq/contracts': resolve(DESIGN, '../../packages/contracts/src/index.ts'),
    '@hq/ui': resolve(DESIGN, '../../packages/hq-ui/src/index.ts'),
  },
};
const diskHost: Host = {
  read: (path) => (existsSync(path) && statSync(path).isFile() ? readFileSync(path, 'utf8') : null),
  list: (dir) => (existsSync(dir) && statSync(dir).isDirectory() ? readdirSync(dir) : []),
};

/** Bare packages the production graph is allowed to name at runtime (renderer-side libraries only). */
const ALLOWED_EXTERNAL = new Set(['react', 'react-dom']);

describe('production entry, compose and descriptors are renderer-safe', () => {
  const analysis = analyze(diskHost, LAYOUT);

  it('reach no storage/node.ts, design-store file, Node builtin, electron or Node global at runtime', () => {
    assert.deepEqual(analysis.violations, []);
  });

  it('actually walked the production graph (the proof is not vacuous)', () => {
    const names = analysis.files.map((file) => relative(DESIGN, file));
    for (const expected of [
      '../../packages/hq-ui/src/index.ts', '../../packages/hq-ui/src/components/Button.tsx',
      'app/compose/reference-reads.ts',
      'app/compose/thumbnail-port.ts',
      'app/compose/compare-catalog.ts',
      'app/index.ts', 'app/compose/workspace.ts', 'app/compose/bridge-documents.ts', 'app/storage/index.ts', 'app/storage/projects.ts', 'app/compose/storage-seam.ts', 'app/compose/views/CanvasView.tsx',
      'ui/src/registry-glob.ts', 'canvas/design-module.ts', 'imports/design-module.ts',
      'requests/design-module.ts', 'connector/design-module.ts', 'references/design-module.ts',
      'app/sections/requests/View.tsx', 'app/sections/runs/View.tsx', 'app/sections/references/View.tsx',
      'app/sections/requests/env.ts', 'app/sections/runs/pipeline.ts', 'app/sections/references/env.ts',
    ]) assert.ok(names.includes(expected), `graph includes ${expected}`);
    assert.equal(names.includes('app/storage/node.ts'), false);
    assert.equal(names.some((name) => name.startsWith('app/compose/test/')), false);
  });

  it('names only allowed bare packages at runtime', () => {
    assert.deepEqual(analysis.external.filter((name) => !ALLOWED_EXTERNAL.has(name)), []);
  });

  it('points every erased storage import at storage/index.ts, never node.ts or another storage file', () => {
    const storage = analysis.typeTargets.filter(({ from, target }) => !from.startsWith(`${LAYOUT.storageDir}/`) && target.startsWith(`${LAYOUT.storageDir}/`));
    assert.ok(storage.length > 0, 'compose has at least one type-only storage import');
    assert.deepEqual([...new Set(storage.map(({ target }) => relative(DESIGN, target)))], ['app/storage/index.ts']);
    assert.deepEqual(analysis.typeTargets.filter(({ from, target }) => from.startsWith(`${LAYOUT.appDir}/compose/`) && target.startsWith(`${LAYOUT.storeSrc}/`)), []);
  });

  it('uses only storage/index.ts as the compose storage seam', () => {
    const offenders: string[] = [];
    const scan = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { if (name !== 'test') scan(path); continue; }
        if (!CODE.test(name)) continue;
        for (const edge of edgesOf(readFileSync(path, 'utf8')).edges) if (/(^|\/)storage(\/|$)/u.test(edge.specifier) && !edge.specifier.endsWith('/storage/index.ts')) offenders.push(`${relative(DESIGN, path)}: ${edge.specifier}`);
      }
    };
    scan(join(DESIGN, 'app/compose'));
    assert.deepEqual(offenders, []);
  });
});

// ------------------------------------------------------------------------------ analyzer self-test

const ROOT = '/virtual';
const VLAYOUT: Layout = {
  designDir: `${ROOT}/modules/design`,
  appDir: `${ROOT}/modules/design/app`,
  storageDir: `${ROOT}/modules/design/app/storage`,
  storeSrc: `${ROOT}/packages/design-store/src`,
  workspace: {
    '@hq/contracts': `${ROOT}/packages/contracts/src/index.ts`,
    '@hq/ui': `${ROOT}/packages/hq-ui/src/index.ts`,
  },
};

/** A renderer-safe baseline; each scenario overrides or adds files. */
function baseline(): Record<string, string> {
  return {
    'modules/design/app/index.ts': "import { a } from './compose/a.ts';\nexport const entry = a;\n",
    'modules/design/app/compose/a.ts': "export const a = 1;\n",
    'modules/design/app/storage/index.ts': "export * from './backing.ts';\n",
    'modules/design/app/storage/backing.ts': "export const backing = 1;\n",
    'modules/design/app/storage/node.ts': "import { open } from 'node:fs/promises';\nexport const nodeFs = open;\n",
    'packages/design-store/src/fs.ts': "import { open } from 'node:fs/promises';\nexport const storeFs = open;\n",
    'packages/design-store/src/contract.ts': 'export type Doc = string;\n',
    'packages/contracts/src/index.ts': 'export const isDestination = (value: string) => value.length > 0;\n',
    'packages/hq-ui/src/index.ts': "import './theme.css';\nexport { Button } from './components';\n",
    'packages/hq-ui/src/theme.css': ':root { --hq-text: #20232a; }',
    'packages/hq-ui/src/components/index.ts': "export { Button } from './Button';\n",
    'packages/hq-ui/src/components/Button.tsx': "import { createElement } from 'react';\nexport const Button = () => createElement('button');\n",
  };
}

function run(overrides: Record<string, string>): Analysis {
  const files = new Map(Object.entries({ ...baseline(), ...overrides }).map(([path, text]) => [`${ROOT}/${path}`, text]));
  const host: Host = {
    read: (path) => files.get(path) ?? null,
    list: (dir) => {
      const names = new Set<string>();
      for (const path of files.keys()) if (path.startsWith(`${dir}/`)) names.add(path.slice(dir.length + 1).split('/')[0]!);
      return [...names];
    },
  };
  return analyze(host, VLAYOUT);
}

const A = 'modules/design/app/compose/a.ts';

describe('the analyzer catches each kind of violation (in-memory fixtures)', () => {
  it('passes the clean baseline and treats a type-only import of storage/index.ts as erased', () => {
    assert.deepEqual(run({}).violations, []);
    const ok = run({ [A]: "import type { backing } from '../storage/index.ts';\nexport type A = typeof backing;\n" });
    assert.deepEqual(ok.violations, []);
    assert.equal(ok.files.some((file) => file.includes('/storage/')), false, 'an erased import does not enter the runtime graph');
    assert.equal(ok.typeTargets.length, 1);
  });

  it('allows the runtime storage seam and continues walking its exports', () => {
    const result = run({ [A]: "import { backing } from '../storage/index.ts';\nexport const a = backing;\n" });
    assert.deepEqual(result.violations, []);
    assert.ok(result.files.includes(`${ROOT}/modules/design/app/storage/backing.ts`));
  });

  const cases: ReadonlyArray<readonly [string, Record<string, string>, RegExp]> = [
    ['a direct node: import', { [A]: "import { readFile } from 'node:fs/promises';\nexport const a = readFile;\n" }, /compose\/a\.ts: static import of Node builtin node:fs\/promises/u],
    ['a bare Node builtin without the node: prefix', { [A]: "import { join } from 'path';\nexport const a = join;\n" }, /import of Node builtin path/u],
    ['electron', { [A]: "import { app } from 'electron';\nexport const a = app;\n" }, /import of electron/u],
    ['a transitive import through an intermediate module to storage/node.ts', {
      [A]: "export * from '../../lane/src/mid.ts';\n",
      'modules/design/lane/src/mid.ts': "export { nodeFs } from '../../app/storage/node.ts';\n",
    }, /compose\/a\.ts -> lane\/src\/mid\.ts: reexport import reaches storage module app\/storage\/node\.ts/u],
    ['a runtime import of storage/index.ts that re-exports a Node path', {
      [A]: "import { backing } from '../storage/index.ts';\nexport const a = backing;\n",
      'modules/design/app/storage/index.ts': "export * from './backing.ts';\nexport * from './node.ts';\n",
    }, /reexport import reaches storage module app\/storage\/node\.ts/u],
    ['a dynamic import of a module that reaches Node', {
      [A]: "export const lazy = () => import('./lazy.ts');\n",
      'modules/design/app/compose/lazy.ts': "import { open } from 'node:fs';\nexport const l = open;\n",
    }, /lazy\.ts: static import of Node builtin node:fs/u],
    ['a dynamic import of a Node builtin', { [A]: "export const lazy = () => import('node:fs');\n" }, /dynamic import of Node builtin node:fs/u],
    ['a dynamic import of storage/node.ts', { [A]: "export const lazy = () => import('../storage/node.ts');\n" }, /dynamic import reaches storage module app\/storage\/node\.ts/u],
    ['a non-literal dynamic import', { [A]: 'export const lazy = (name: string) => import(name);\n' }, /non-literal dynamic import/u],
    ['export … from a Node path', { [A]: "export { open } from 'node:fs/promises';\n" }, /reexport import of Node builtin node:fs\/promises/u],
    ['export * from storage/node.ts', { [A]: "export * from '../storage/node.ts';\n" }, /reexport import reaches storage module app\/storage\/node\.ts/u],
    ['a side-effect import of storage/node.ts', { [A]: "import '../storage/node.ts';\nexport const a = 1;\n" }, /side-effect import reaches storage module app\/storage\/node\.ts/u],
    ['a type-only import of storage/node.ts', { [A]: "import type { nodeFs } from '../storage/node.ts';\nexport type A = typeof nodeFs;\n" }, /type-only import of storage module app\/storage\/node\.ts/u],
    ['a type-only import of another storage module', { [A]: "export type { backing } from '../storage/backing.ts';\n" }, /type-only import of storage module app\/storage\/backing\.ts/u],
    ['a type-only import of design-store', { [A]: "import type { Doc } from '../../../../packages/design-store/src/contract.ts';\nexport type A = Doc;\n" }, /type-only import of design-store contract\.ts/u],
    ['a runtime import of design-store', { [A]: "export { storeFs } from '../../../../packages/design-store/src/fs.ts';\n" }, /reexport import reaches design-store fs\.ts/u],
    ['a direct storage adapter import', { [A]: "import { backing } from '../storage/projects.ts';\n", 'modules/design/app/storage/projects.ts': 'export const backing = 1;' }, /static import reaches storage module app\/storage\/projects\.ts/u],
    ['storage seam reaching design-store runtime', { [A]: "import '../storage/index.ts';\n", 'modules/design/app/storage/index.ts': "export * from '../../../../packages/design-store/src/fs.ts';\n" }, /reexport import reaches design-store fs\.ts/u],
    ['a type-only export hiding a neighbouring runtime re-export', {
      [A]: "export type A = string\nexport { nodeFs } from '../storage/node.ts';\n",
    }, /reexport import reaches storage module app\/storage\/node\.ts/u],
    ['a Vite glob that matches a violating descriptor', {
      [A]: "export const all = import.meta.glob('../../*/design-module.ts', { eager: true });\n",
      'modules/design/leaky/design-module.ts': "import '../app/storage/node.ts';\nexport const designModule = {};\n",
    }, /leaky\/design-module\.ts: side-effect import reaches storage module app\/storage\/node\.ts/u],
    ['a section descriptor that reaches Node', { 'modules/design/leaky/design-module.ts': "import { cwd } from 'node:process';\nexport const designModule = cwd;\n" }, /leaky\/design-module\.ts: static import of Node builtin node:process/u],
    ['a compose module nothing imports that reaches Node', { 'modules/design/app/compose/orphan.ts': "import { join } from 'node:path';\nexport const o = join;\n" }, /compose\/orphan\.ts: static import of Node builtin node:path/u],
    ['a compose .tsx view that reaches storage/node.ts', { 'modules/design/app/compose/views/V.tsx': "import { nodeFs } from '../../storage/node.ts';\nexport const V = nodeFs;\n" }, /views\/V\.tsx: static import reaches storage module app\/storage\/node\.ts/u],
    ['a Node global in compose code', { [A]: 'export const a = process.cwd();\n' }, /Node global/u],
    ['Buffer in compose code', { [A]: 'export const a = Buffer.from("x");\n' }, /Node global/u],
    ['an unresolved relative import', { [A]: "export * from './missing.ts';\n" }, /unresolved reexport import \.\/missing\.ts/u],
  ];
  for (const [name, overrides, expected] of cases) {
    it(`flags ${name}`, () => {
      const { violations } = run(overrides);
      assert.ok(violations.some((violation) => expected.test(violation)), `expected ${expected}, got ${JSON.stringify(violations)}`);
    });
  }

  it('does not mistake prose in strings or comments for a Node global or an import', () => {
    const { violations } = run({
      [A]: "// import { x } from 'node:fs'\n/* process.cwd() */\nexport const label = 'process.env and Buffer';\n",
    });
    assert.deepEqual(violations, []);
  });

  it('records bare runtime packages instead of walking them, but walks workspace packages', () => {
    assert.deepEqual(run({ [A]: "import { useState } from 'react';\nexport const a = useState;\n" }).external, ['react']);
    const walked = run({ [A]: "import { isDestination } from '@hq/contracts';\nexport const a = isDestination;\n" });
    assert.deepEqual(walked.external, []);
    assert.ok(walked.files.includes(`${ROOT}/packages/contracts/src/index.ts`));
  });

  it('walks the shared UI kit through CSS, directory exports and extensionless component imports', () => {
    const walked = run({ [A]: "import { Button } from '@hq/ui';\nexport const a = Button;\n" });
    assert.deepEqual(walked.violations, []);
    assert.deepEqual(walked.external, ['react']);
    for (const path of ['index.ts', 'theme.css', 'components/index.ts', 'components/Button.tsx']) {
      assert.ok(walked.files.includes(`${ROOT}/packages/hq-ui/src/${path}`));
    }
  });

  it('does not let a shared UI dependency bypass Node globals, builtins or protected storage boundaries', () => {
    for (const source of [
      "import { open } from 'node:fs';\nexport const Button = open;\n",
      'export const Button = process.cwd();\n',
      "export { nodeFs as Button } from '../../../../modules/design/app/storage/node.ts';\n",
      "export { storeFs as Button } from '../../../design-store/src/fs.ts';\n",
    ]) {
      const result = run({ [A]: "import { Button } from '@hq/ui';\nexport const a = Button;\n", 'packages/hq-ui/src/components/Button.tsx': source });
      assert.ok(result.violations.length > 0, source);
    }
  });

  it('flags a Node builtin reached through a workspace package', () => {
    const { violations } = run({
      [A]: "import { isDestination } from '@hq/contracts';\nexport const a = isDestination;\n",
      'packages/contracts/src/index.ts': "import { join } from 'node:path';\nexport const isDestination = join;\n",
    });
    assert.ok(violations.some((violation) => /contracts\/src\/index\.ts: static import of Node builtin node:path/u.test(violation)), JSON.stringify(violations));
  });
});
