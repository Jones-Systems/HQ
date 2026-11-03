import { expect, it } from 'vitest';
import { canonicalJSON, safeBundlePath, validateManifest } from './bundle';
import { CAPABILITIES, ENTRIES } from './capabilities';

function manifest() {
  return {
    schema: 'jones-preview-bundle/v1', product: 'hq-desktop', target: 'browser',
    source: { repository: 'Jones-Systems/HQ', revision: 'a'.repeat(40), dirty: false },
    build: { node: 'v24.22.1', tool: 'vite@8.3.4', lockfileSha256: 'b'.repeat(64), configSha256: 'c'.repeat(64) },
    fixture: { id: 'hq-examples', version: 1 }, environment: { storage: 'memory', polyfills: ['crypto.randomUUID:insecure-context'] },
    layout: { width: 1280, minWidth: 760 }, capabilities: CAPABILITIES, entries: ENTRIES,
    files: ['empty.html', 'index.html'].map(path => ({ path, sha256: 'd'.repeat(64), bytes: 42 })),
  };
}
it('canonicalizes nested manifest keys and accepts the closed producer contract', () => {
  expect(canonicalJSON({ z: 1, a: { y: 2, b: 'é' } })).toBe('{"a":{"b":"é","y":2},"z":1}');
  expect(() => validateManifest(manifest())).not.toThrow();
});
it('rejects unknown nested fields, dirty sources, duplicate entries, unsafe or incomplete inventory', () => {
  const cases = [
    { ...manifest(), surprise: true },
    { ...manifest(), source: { ...manifest().source, dirty: true } },
    { ...manifest(), layout: { width: 1280, minWidth: 760, extra: 1 } },
    { ...manifest(), entries: [...ENTRIES, ENTRIES[0]] },
    { ...manifest(), files: manifest().files.slice(0, 1) },
    { ...manifest(), files: [...manifest().files].reverse() },
    { ...manifest(), files: [{ path: '../escape', sha256: 'd'.repeat(64), bytes: 42 }] },
  ];
  for (const value of cases) expect(() => validateManifest(value)).toThrow();
  for (const path of ['/abs', '../x', 'a/../b', '.hidden', 'a/.hidden', 'a\\b', 'a//b', 'a?x']) expect(safeBundlePath(path)).toBe(false);
  expect(safeBundlePath('assets/main-123.js')).toBe(true);
});
