/** Static boundary checks over this section's own source files. */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import * as entry from '../src/index.ts';

const srcDir = new URL('../src/', import.meta.url);
const sources = readdirSync(srcDir).filter((name) => name.endsWith('.ts'));
const importsOf = (name: string) =>
  [...readFileSync(new URL(name, srcDir), 'utf8').matchAll(/from '([^']+)'/gu)].map((match) => match[1] ?? '');

describe('connector boundaries', () => {
  it('production modules never import the labelled fakes', () => {
    for (const name of sources.filter((item) => item !== 'fakes.ts')) {
      assert.ok(!importsOf(name).includes('./fakes.ts'), `${name} imports fakes.ts`);
    }
  });

  it('imports only its own files, react and nothing from other sections or Node', () => {
    for (const name of sources) {
      for (const specifier of importsOf(name)) {
        const allowed = /^\.\/[A-Za-z-]+\.ts$/u.test(specifier) || specifier === 'react';
        assert.ok(allowed, `${name} imports ${specifier}`);
      }
    }
  });

  it('the public entry exposes no fake factory', () => {
    const names = Object.keys(entry);
    assert.ok(names.includes('createOutbox'));
    // The fake label constant is exported so UI can name the fake; no fake factory or fixture is.
    assert.ok(!names.some((name) => /^create(Fake|Memory)|^synthetic|^createTrace/u.test(name)), names.join(','));
  });
});
