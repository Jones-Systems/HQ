/** Static guards: Node-only, no network, no reach from the app into the producer, nothing host-specific. */
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const producer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const references = path.resolve(producer, '..');

async function files(dir: string, accept: (name: string) => boolean, skip: (full: string) => boolean = () => false): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.name === 'node_modules' || skip(full)) continue;
    if (entry.isDirectory()) out.push(...await files(full, accept, skip));
    else if (accept(entry.name)) out.push(full);
  }
  return out.sort();
}

const SOURCE = (name: string): boolean => /\.(ts|tsx|css|html|mjs|js)$/u.test(name);
const IMPORT = /(?:^|[^\w.])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/gu;
const specifiers = (text: string): string[] => [...text.matchAll(IMPORT)].map((match) => match[1] ?? match[2] ?? match[3] ?? match[4]!);

const NETWORK = ['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns', 'dns/promises', 'inspector', 'cluster', 'child_process', 'worker_threads', 'vm', 'repl'];
const NETWORK_TOKENS = [/\bfetch\s*\(/u, /\bXMLHttpRequest\b/u, /\bWebSocket\b/u, /\bEventSource\b/u, /\bnavigator\.sendBeacon\b/u, /\bhttps?:\/\/(?!example\.test)/u];

describe('the producer source is Node-only and offline', () => {
  test('it imports only node built-ins, its own files, and the reference library under ../../src', async () => {
    const list = await files(path.join(producer, 'src'), SOURCE);
    assert.ok(list.length >= 12, 'the scan found the producer sources');
    for (const file of list) {
      for (const spec of specifiers(await fs.readFile(file, 'utf8'))) {
        const name = path.relative(references, file);
        if (spec.startsWith('node:')) { assert.equal(NETWORK.includes(spec.slice(5)), false, `${name} imports ${spec}`); continue; }
        assert.ok(spec.startsWith('./') || spec.startsWith('../'), `${name} imports the package ${spec}`);
        const resolved = path.resolve(path.dirname(file), spec);
        const inside = resolved.startsWith(path.join(producer, 'src') + path.sep);
        const library = resolved.startsWith(path.join(references, 'src') + path.sep);
        assert.ok(inside || library, `${name} reaches outside the producer and the reference library: ${spec}`);
        assert.equal(/\/ui\/|\/harness\//u.test(resolved), false, `${name} imports UI code`);
      }
    }
  });

  test('it names no network module and uses no network API', async () => {
    for (const file of await files(path.join(producer, 'src'), SOURCE)) {
      const text = await fs.readFile(file, 'utf8');
      const name = path.relative(references, file);
      for (const spec of specifiers(text)) assert.equal(NETWORK.includes(spec.replace(/^node:/u, '')), false, `${name}: ${spec}`);
      for (const token of NETWORK_TOKENS) assert.doesNotMatch(text, token, `${name}: ${token}`);
    }
  });

  test('the scan itself catches what it is meant to catch', () => {
    assert.deepEqual(specifiers("import net from 'node:net';\nconst x = await import('node:https');\nimport './side.ts';\nexport { a } from './b.ts';"), ['node:net', 'node:https', './side.ts', './b.ts']);
    assert.ok(NETWORK_TOKENS.some((token) => token.test('await fetch(url)')));
  });
});

describe('nothing in the app reaches the producer', () => {
  test('no source, UI, harness or test file outside the producer imports it', async () => {
    const list = await files(references, SOURCE, (full) => full === producer);
    assert.ok(list.length > 30);
    for (const file of list) {
      for (const spec of specifiers(await fs.readFile(file, 'utf8'))) {
        if (!spec.startsWith('.')) continue;
        const resolved = path.resolve(path.dirname(file), spec);
        assert.equal(resolved === producer || resolved.startsWith(producer + path.sep), false, `${path.relative(references, file)} imports ${spec}`);
      }
    }
  });

  test('no configuration of the references module lists the producer for the app bundle', async () => {
    for (const name of ['tsconfig.json', 'vitest.config.ts']) {
      const text = await fs.readFile(path.join(references, name), 'utf8');
      assert.doesNotMatch(text, /producer/u, name);
    }
    for (const file of await files(path.join(references, 'harness'), () => true)) assert.doesNotMatch(await fs.readFile(file, 'utf8'), /producer/u, file);
  });

  test('the repository sources outside the references module do not import it either', async () => {
    const root = path.resolve(references, '..', '..', '..');
    const skip = (full: string): boolean => full === references || /[\\/](\.git|dist|out|build|\.playwright-mcp|\.t3)$/u.test(full);
    for (const top of ['src', 'apps', 'packages', 'modules']) {
      const dir = path.join(root, top);
      if (!await fs.stat(dir).then((stat) => stat.isDirectory(), () => false)) continue;
      for (const file of await files(dir, SOURCE, skip)) {
        for (const spec of specifiers(await fs.readFile(file, 'utf8'))) {
          assert.equal(/design\/references\/producer/u.test(path.resolve(path.dirname(file), spec).split(path.sep).join('/')), false, `${path.relative(root, file)} imports ${spec}`);
        }
      }
    }
  });
});

describe('the producer files are public-safe', () => {
  // Built from fragments so this file does not contain the patterns it forbids.
  const FORBIDDEN: [string, RegExp][] = [
    ['a home directory path', new RegExp(`/(?:ho${'me'}|Us${'ers'})/[A-Za-z]`, 'u')],
    ['a check-lock file name', new RegExp(`hq-chec${'ks'}`, 'u')],
    ['a private network address', /\b(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/u],
    ['a credential-looking token', /\b(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/u],
    ['a private-key block', new RegExp(`-----BEGIN [A-Z ]*PRIV${'ATE'} KEY`, 'u')],
  ];
  test('no host path, address or credential in any producer file', async () => {
    const list = await files(producer, () => true);
    assert.ok(list.some((file) => file.endsWith('FORMATS.md')));
    for (const file of list) {
      const text = await fs.readFile(file, 'utf8');
      for (const [label, pattern] of FORBIDDEN) assert.doesNotMatch(text, pattern, `${path.relative(references, file)} contains ${label}`);
    }
  });

  test('every URL in the producer files is a reserved example domain', async () => {
    for (const file of await files(producer, () => true)) {
      for (const match of (await fs.readFile(file, 'utf8')).matchAll(/https?:\/\/[^\s'"`)<>\]]+/gu)) {
        assert.match(match[0], /^https?:\/\/(?:[a-z0-9-]+\.)*example\.test(?:[/:]|$)/u, `${path.relative(references, file)}: ${match[0]}`);
      }
    }
  });
});
