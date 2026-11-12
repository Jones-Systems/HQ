// Static guarantees over the tool's own source: it only reads, only prints through the closed report
// renderers or fixed strings, never echoes an error's message or stack, and stays small and dependency free.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

const scriptsDir = join(import.meta.dirname, '..');
const testDir = import.meta.dirname;

function names(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .sort();
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const tool = new Map(names(scriptsDir).map((name) => [name, stripComments(readFileSync(join(scriptsDir, name), 'utf8'))]));

function specifiers(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) out.push((match[1] ?? match[2]) as string);
  return out;
}

describe('inventory', () => {
  test('the tool is these modules and nothing else', () => {
    assert.deepEqual([...tool.keys()], ['classify.ts', 'cli.ts', 'collect.ts', 'config-file.ts', 'processes.ts', 'report.ts', 'validate-sources.ts']);
  });

  test('every module is erasable TypeScript', () => {
    for (const [name, source] of tool) {
      assert.doesNotMatch(source, /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s/m, `${name}: enum`);
      assert.doesNotMatch(source, /^\s*(?:export\s+)?(?:declare\s+)?namespace\s/m, `${name}: namespace`);
      assert.doesNotMatch(source, /constructor\s*\([^)]*\b(?:public|private|protected|readonly)\b/, `${name}: parameter property`);
    }
  });
});

describe('imports', () => {
  const allowedNode: Record<string, readonly string[]> = {
    'cli.ts': ['node:util'],
    'processes.ts': ['node:child_process'],
    'config-file.ts': ['node:fs', 'node:fs/promises'],
  };

  test('only the listed Node built-ins, nothing from the network, no new dependency', () => {
    for (const [name, source] of tool) {
      const imports = specifiers(source);
      const builtins = imports.filter((spec) => !spec.startsWith('.'));
      assert.deepEqual(builtins.sort(), [...(allowedNode[name] ?? [])].sort(), name);
      for (const spec of imports) assert.doesNotMatch(spec, /^(?:node:)?(?:http|https|http2|net|tls|dgram|dns|undici|os|worker_threads|vm)$/, `${name}: ${spec}`);
      for (const spec of imports.filter((s) => s.startsWith('.'))) assert.ok(spec.endsWith('.ts'), `${name}: ${spec}`);
      assert.doesNotMatch(source, /\bfetch\s*\(|\brequire\s*\(|\bimport\s*\(/, name);
    }
  });

  test('the Wiki contract and core are consumed only through their entry points, plus the text helper', () => {
    const allowed = new Set(['../../contract/src/index.ts', '../src/index.ts', '../src/text.ts', './classify.ts', './cli.ts', './collect.ts', './config-file.ts', './report.ts', './processes.ts']);
    for (const [name, source] of tool) for (const spec of specifiers(source).filter((s) => s.startsWith('.'))) assert.ok(allowed.has(spec), `${name}: ${spec}`);
  });
});

describe('read-only', () => {
  test('no filesystem write, rename, delete or permission change', () => {
    for (const [name, source] of tool) {
      assert.doesNotMatch(
        source,
        /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|unlink|unlinkSync|rm|rmSync|rmdir|rmdirSync|mkdir|mkdirSync|mkdtemp|mkdtempSync|rename|renameSync|copyFile|copyFileSync|cp|cpSync|chmod|chown|symlink|link|truncate|ftruncate|utimes|futimes|createWriteStream|watch)\s*\(/,
        name,
      );
    }
  });

  test('files are opened read-only and child processes are confined to the measured adapter seams', () => {
    const config = tool.get('config-file.ts') as string;
    const opens = config.split('\n').filter((line) => /\bopen\(/.test(line));
    assert.equal(opens.length, 1);
    assert.match(opens[0] as string, /constants\.O_RDONLY/);
    assert.doesNotMatch(config, /O_WRONLY|O_RDWR|O_CREAT|O_APPEND|O_TRUNC|O_EXCL/);
    for (const [name, source] of tool) {
      if (name !== 'processes.ts') assert.doesNotMatch(source, /child_process|\bexecFile\b|\bspawn\b|\bexec\s*\(/, name);
    }
    const collect = tool.get('collect.ts') as string;
    const processes = tool.get('processes.ts') as string;
    assert.match(processes, /import.*execFile, spawn/);
    assert.doesNotMatch(processes, /\b(?:execSync|execFileSync|spawnSync|fork)\b|shell\s*:/);
    assert.match(collect, /createNodeGitObjectSource\(profile,/);
    assert.match(collect, /await source\.close\(\)/);
    assert.match(collect, /await processes\.close\(\)/);
    assert.match(collect, /createMemoryIndexStore\(\)/);
    assert.doesNotMatch(collect, /\bIndexStore\b\s*=|write\s*\(/, 'the store is the core in-memory store; no custom persistence');
  });
});

describe('output', () => {
  test('stdout and stderr are written only by the entry file, through the io the CLI is given', () => {
    for (const [name, source] of tool) {
      if (name === 'validate-sources.ts') continue;
      assert.doesNotMatch(source, /\bprocess\.(?:stdout|stderr)\b|\bconsole\b/, name);
    }
    const entry = tool.get('validate-sources.ts') as string;
    assert.equal([...entry.matchAll(/process\.stdout\.write/g)].length, 1);
    assert.equal([...entry.matchAll(/process\.stderr\.write/g)].length, 2);
    assert.doesNotMatch(entry, /\bconsole\b/);
  });

  test('the CLI prints only the usage text, a rendered report or one of a few fixed messages', () => {
    const cli = tool.get('cli.ts') as string;
    const stdout = [...cli.matchAll(/io\.stdout\(([^;]*)\);/g)].map((m) => m[1]);
    assert.deepEqual(stdout, ['USAGE', 'args.json ? renderJson(report) : renderTable(report)']);
    const stderr = [...cli.matchAll(/io\.stderr\(([^;]*)\);/g)].map((m) => m[1]);
    assert.deepEqual(stderr, [
      '`wiki-validate: invalid arguments\\n${USAGE}`',
      'inputMessage(which, error)',
      "'wiki-validate: internal error\\n'",
      "'wiki-validate: one or more sources are unavailable\\n'",
      "'wiki-validate: internal error\\n'",
    ]);
    const message = /function inputMessage[\s\S]*?\n\}/.exec(cli)?.[0] ?? '';
    assert.match(message, /return `wiki-validate: invalid \$\{which\} file: \$\{failure\.code\}\$\{where\}\$\{why\}\\n`;/);
    assert.match(message, /const where = failure\.position === null \? '' : ` at position \$\{failure\.position\}`;/);
    assert.match(message, /const why = failure\.reason === null \? '' : ` \(\$\{failure\.reason\}\)`;/);
  });

  test('error text is never read: no .message, .stack, cause or String(error) anywhere', () => {
    for (const [name, source] of tool) {
      assert.doesNotMatch(source, /\.(?:message|stack|cause)\b|\bString\(error\)|`\$\{error\}`|\bconsole\b/, name);
    }
  });

  test('JSON.stringify is applied only to the checked report, and the entry installs handlers that print one fixed line', () => {
    const uses = [...tool.entries()].filter(([, source]) => /JSON\.stringify/.test(source)).map(([name]) => name);
    assert.deepEqual(uses, ['report.ts']);
    assert.match(tool.get('report.ts') as string, /if \(!isClosedReport\(report\)\) throw new ReportRejected\(\);\s*return `\$\{JSON\.stringify\(report, null, 2\)\}\\n`;/);
    const entry = tool.get('validate-sources.ts') as string;
    assert.match(entry, /process\.on\('uncaughtException', fixedFailure\)/);
    assert.match(entry, /process\.on\('unhandledRejection', fixedFailure\)/);
    assert.match(entry, /process\.stderr\.write\('wiki-validate: internal error\\n'\)/);
  });

  test('labels and candidate lists reach the report only through a classifier or a count', () => {
    const collect = tool.get('collect.ts') as string;
    assert.match(collect, /missingShapes\[missingShape\(link\.label, profile\.pageExtensions\)\]\+\+/);
    assert.match(collect, /ambiguousCandidates\[ambiguousBucket\(link\.candidates\.length\)\]\+\+/);
    assert.match(collect, /if \(page\.excerpt\.length >= MAX_EXCERPT_UNITS\) excerptsAtCap\+\+/);
  });
});

describe('public safety and hygiene', () => {
  const files = [...names(scriptsDir).map((n) => join(scriptsDir, n)), ...names(testDir).filter((n) => n !== 'static.test.ts').map((n) => join(testDir, n)), join(scriptsDir, 'README.md')];

  test('no host path, address, token or key in the tool, its tests or its README', () => {
    for (const path of files) {
      const text = readFileSync(path, 'utf8');
      assert.doesNotMatch(text, /\/home\/[a-z]|\/Users\/[A-Za-z]|C:\\Users/, path);
      assert.doesNotMatch(text, /\b(?:\d{1,3}\.){3}\d{1,3}\b/, path);
      assert.doesNotMatch(text, /ghp_[A-Za-z0-9]{20}|BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}/, path);
      assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@(?!example\.invalid\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, path);
    }
  });

  test('every test is a node:test suite and none is skipped, focused or parked', () => {
    for (const name of names(testDir).filter((n) => n.endsWith('.test.ts'))) {
      const text = readFileSync(join(testDir, name), 'utf8');
      assert.match(text, /from 'node:test'/, name);
      if (name === 'static.test.ts') continue;
      assert.doesNotMatch(text, /\.(?:only|skip|todo)\s*\(|\b(?:xit|xdescribe|fit|fdescribe)\s*\(/, name);
    }
  });
});
