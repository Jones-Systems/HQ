// Static guarantees over the core's own source: no network, no source mutation, no shell, no
// child_process outside the adapter, no React/Electron, pure modules free of node:*, one blob cap,
// erasable TypeScript, and a write cone that contains only what the task allows.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const coreDir = join(import.meta.dirname, '..');
const srcDir = join(coreDir, 'src');
const testDir = join(coreDir, 'test');
const ADAPTER = 'node-git-source.ts';

function files(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const sources = new Map(files(srcDir).map((name) => [name, stripComments(readFileSync(join(srcDir, name), 'utf8'))]));
const pure = [...sources.entries()].filter(([name]) => name !== ADAPTER);

function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) out.push((match[1] ?? match[2]) as string);
  return out;
}

describe('source inventory', () => {
  test('the core cone holds only src, test, tsconfig.json and README.md (scripts/ stays reserved and absent)', () => {
    assert.deepEqual(readdirSync(coreDir).sort(), ['README.md', 'src', 'test', 'tsconfig.json']);
  });

  test('every source file is erasable TypeScript', () => {
    for (const [name, source] of sources) {
      assert.doesNotMatch(source, /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s/m, `${name}: enum`);
      assert.doesNotMatch(source, /^\s*(?:export\s+)?(?:declare\s+)?namespace\s/m, `${name}: namespace`);
      assert.doesNotMatch(source, /constructor\s*\([^)]*\b(?:public|private|protected|readonly)\b/, `${name}: parameter property`);
    }
  });
});

describe('purity and boundaries', () => {
  test('pure modules import no node:* (nor any Node built-in) and use no process, Buffer or require', () => {
    for (const [name, source] of pure) {
      for (const spec of specifiers(source)) {
        assert.ok(spec.startsWith('.'), `${name} imports ${spec}`);
        assert.ok(!spec.startsWith('node:'), `${name} imports ${spec}`);
      }
      assert.doesNotMatch(source, /\bprocess\./, `${name}: process`);
      assert.doesNotMatch(source, /\bBuffer\b/, `${name}: Buffer`);
      assert.doesNotMatch(source, /\brequire\s*\(/, `${name}: require`);
      assert.doesNotMatch(source, /\bimport\s*\(/, `${name}: dynamic import`);
    }
  });

  test('the adapter imports only child_process execFile and fs/promises realpath and stat', () => {
    const adapter = sources.get(ADAPTER) as string;
    const nodeImports = specifiers(adapter).filter((spec) => spec.startsWith('node:'));
    assert.deepEqual(nodeImports.sort(), ['node:child_process', 'node:fs/promises']);
    assert.match(adapter, /import\s*\{\s*execFile as nodeExecFile\s*\}\s*from\s*'node:child_process'/);
    assert.match(adapter, /import\s*\{\s*realpath,\s*stat\s*\}\s*from\s*'node:fs\/promises'/);
  });

  test('only the barrel re-exports the adapter; nothing else imports it', () => {
    for (const [name, source] of sources) {
      if (name === 'index.ts') continue;
      assert.ok(!specifiers(source).some((spec) => spec.endsWith(ADAPTER)), `${name} imports the adapter`);
    }
  });

  test('the contract is consumed only through its public entry and never written', () => {
    for (const [name, source] of sources) {
      for (const spec of specifiers(source).filter((s) => s.includes('contract'))) assert.equal(spec, '../../contract/src/index.ts', name);
    }
    for (const name of files(testDir)) {
      const source = readFileSync(join(testDir, name), 'utf8');
      for (const spec of specifiers(source).filter((s) => s.includes('contract'))) assert.equal(spec, '../../contract/src/index.ts', name);
    }
  });

  test('no React, Electron or DOM', () => {
    for (const [name, source] of sources) {
      assert.doesNotMatch(source, /['"](?:react|react-dom|electron)(?:\/[^'"]*)?['"]/, name);
      assert.doesNotMatch(source, /\b(?:document|window|localStorage|navigator)\./, name);
    }
  });
});

describe('no shell, no network, no mutation', () => {
  test('child_process is used only by the adapter, only as execFile, never with a shell', () => {
    for (const [name, source] of sources) {
      if (name !== ADAPTER) assert.doesNotMatch(source, /child_process/, name);
    }
    const adapter = sources.get(ADAPTER) as string;
    assert.doesNotMatch(adapter, /import\s*\{[^}]*\b(?:exec|execSync|execFileSync|spawn|spawnSync|fork)\b[^}]*\}\s*from/);
    assert.doesNotMatch(adapter, /\b(?:execSync|execFileSync|spawn|spawnSync|fork)\b/);
    assert.doesNotMatch(adapter, /shell\s*:\s*(?:true|['"`])/);
    assert.match(adapter, /shell:\s*false/);
    assert.doesNotMatch(adapter, /\$\{[^}]*\}\s*['"`]\s*,\s*\{[^}]*shell/);
  });

  test('no network access of any kind', () => {
    for (const [name, source] of sources) {
      assert.doesNotMatch(source, /\bfetch\s*\(/, `${name}: fetch()`);
      assert.doesNotMatch(source, /\b(?:XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/, name);
      for (const spec of specifiers(source)) assert.doesNotMatch(spec, /^(?:node:)?(?:http|https|http2|net|tls|dgram|dns|undici)$/, `${name}: ${spec}`);
    }
  });

  test('no Git command that fetches, writes or changes the working state appears as an argument', () => {
    const forbidden = ['fetch', 'pull', 'push', 'clone', 'remote', 'checkout', 'reset', 'clean', 'gc', 'prune', 'update-ref', 'hash-object', 'commit', 'add', 'merge', 'rebase', 'worktree', 'init', 'repack', '-C', '--exec-path', '--upload-pack', '--receive-pack'];
    const adapter = sources.get(ADAPTER) as string;
    for (const word of forbidden) {
      assert.doesNotMatch(adapter, new RegExp(`[\\[,]\\s*['"\`]${word.replace(/[-]/g, '\\-')}['"\`]`), `argv token ${word}`);
    }
    const allowed = ['rev-parse', 'config', 'show', 'ls-tree', 'cat-file'];
    const subcommands = [...adapter.matchAll(/\[\s*'(rev-parse|config|show|ls-tree|cat-file)'/g)].map((m) => m[1]);
    assert.ok(subcommands.length >= 5 && subcommands.every((s) => allowed.includes(s as string)));
  });

  test('sources contain no filesystem writes', () => {
    for (const [name, source] of sources) {
      assert.doesNotMatch(
        source,
        /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|unlink|unlinkSync|rmSync|rmdir|mkdir|mkdirSync|rename|renameSync|copyFile|chmod|chown|symlink|truncate|createWriteStream|utimes)\b/,
        name,
      );
      assert.doesNotMatch(source, /\bfs\.rm\b|\brm\s*\(/, name);
    }
  });

  test('the adapter has no remote, URL or credential handling beyond comparing the configured value', () => {
    const adapter = sources.get(ADAPTER) as string;
    assert.doesNotMatch(adapter, /https?:\/\//);
    assert.doesNotMatch(adapter, /\b(?:token|password|credential)\b/i);
  });
});

describe('single blob cap, no private content', () => {
  test('no module defines a second page-size cap; the contract constant is imported where needed', () => {
    for (const [name, source] of sources) {
      assert.doesNotMatch(source, /2\s*\*\s*1024\s*\*\s*1024|2_?097_?152|2_?000_?000/, `${name}: a literal 2 MiB / 2 MB cap`);
      assert.doesNotMatch(source, /\b(?:const|let|var)\s+\w*(?:BLOB|PAGE)[A-Z_]*(?:BYTES|SIZE|CAP|LIMIT)\w*\s*=/, `${name}: defines a size constant`);
    }
    const usesCap = [...sources.entries()].filter(([, source]) => /MAX_PAGE_BLOB_BYTES/.test(source)).map(([name]) => name);
    assert.ok(usesCap.includes('analyze.ts') && usesCap.includes('build.ts') && usesCap.includes('host.ts') && usesCap.includes(ADAPTER), usesCap.join());
  });

  test('sources and tests contain no host paths, credentials or private corpus markers', () => {
    const all = [...files(srcDir).map((n) => [`src/${n}`, readFileSync(join(srcDir, n), 'utf8')] as const), ...files(testDir).filter((n) => n !== 'static.test.ts').map((n) => [`test/${n}`, readFileSync(join(testDir, n), 'utf8')] as const)];
    for (const [name, text] of all) {
      assert.doesNotMatch(text, /\/home\/[a-z]|\/Users\/[A-Za-z]|C:\\Users/, name);
      assert.doesNotMatch(text, /ghp_[A-Za-z0-9]{20}|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}/, name);
    }
  });

  test('tests do not skip, focus or park work', () => {
    for (const name of files(testDir)) {
      if (name === 'static.test.ts') continue;
      const text = readFileSync(join(testDir, name), 'utf8');
      assert.doesNotMatch(text, /\.(?:only|skip|todo)\s*\(|\b(?:xit|xdescribe|fit|fdescribe)\s*\(/, name);
    }
  });
});
