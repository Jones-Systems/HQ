import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.tsx?$/u.test(name) ? [path] : [];
  });
}

interface ImportLine {
  readonly typeOnly: boolean;
  readonly specifier: string;
}

function imports(path: string): ImportLine[] {
  const text = readFileSync(path, 'utf8');
  const out: ImportLine[] = [];
  for (const match of text.matchAll(/^(import|export)\s+(type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/gmu)) {
    out.push({ typeOnly: match[2] !== undefined, specifier: match[3]! });
  }
  for (const match of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/gu)) out.push({ typeOnly: false, specifier: match[1]! });
  return out;
}

describe('section boundaries', () => {
  test('preview agent has no import outside its folder, including types', () => {
    for (const path of files(join(SRC, 'preview-agent'))) {
      for (const line of imports(path)) {
        assert.ok(line.specifier.startsWith('./'), `${relative(ROOT, path)} imports ${line.specifier}`);
      }
    }
  });

  test('React and the public UI kit stay in ui/; no cross-section or app imports anywhere', () => {
    for (const path of files(SRC)) {
      const inUi = path.startsWith(`${join(SRC, 'ui')}${sep}`);
      for (const line of imports(path)) {
        // The shared kit is a React UI dependency only; core and preview-agent code remain isolated.
        if (line.specifier === '@hq/ui') {
          assert.ok(inUi, `${relative(ROOT, path)} imports the shared UI kit outside ui/`);
          continue;
        }
        if (line.specifier === 'react' || line.specifier.startsWith('react/') || line.specifier.startsWith('react-dom')) {
          assert.ok(inUi, `${relative(ROOT, path)} imports React outside ui/`);
          continue;
        }
        assert.ok(line.specifier.startsWith('.'), `${relative(ROOT, path)} imports package ${line.specifier}`);
        const target = resolve(dirname(path), line.specifier);
        assert.ok(target.startsWith(SRC), `${relative(ROOT, path)} reaches outside the section: ${line.specifier}`);
        assert.ok(/\.tsx?$/u.test(line.specifier), `${relative(ROOT, path)} uses an extensionless import ${line.specifier}`);
      }
    }
  });

  test('source has no Node, IPC or storage globals', () => {
    for (const path of files(SRC)) {
      const text = readFileSync(path, 'utf8');
      for (const forbidden of [/\brequire\(/u, /\bprocess\./u, /from 'node:/u, /\bipcRenderer\b/u, /\blocalStorage\b/u, /\bfetch\(/u]) {
        assert.doesNotMatch(text, forbidden, `${relative(ROOT, path)} uses ${forbidden}`);
      }
    }
  });
});
