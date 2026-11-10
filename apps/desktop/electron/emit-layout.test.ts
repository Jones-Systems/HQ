import { expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
function files(root: string): string[] { return readdirSync(root, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(root, e.name)) : [join(root, e.name)]); }
it('additive emit keeps main/preload paths and a plain-Node Design closure without renderer code or .ts specifiers', () => {
  const root = 'apps/desktop/dist-electron';
  for (const path of ['main.js', 'preload.cjs', 'design-host/modules/design/app/storage/node.js', 'design-host/modules/design/app/storage/enabled-candidate.js', 'wiki-host/apps/desktop/electron/wiki-runtime.mjs']) expect(existsSync(join(root, path))).toBe(true);
  for (const path of files(root).filter(p => p.endsWith('.js') || p.endsWith('.cjs') || p.endsWith('.mjs'))) {
    const text = readFileSync(path, 'utf8');
    expect(text).not.toMatch(/(?:from\s+|import\s*\()["'][^"']+\.[cm]?ts["']/);
    expect(text).not.toMatch(/(?:from\s+|import\s*\()["'][^"']*(?:react|app\/compose|\/ui\/)[^"']*["']/);
    if (path.includes('/design-host/') || path.includes('/wiki-host/')) for (const match of text.matchAll(/(?:from\s+|import\s*\()["']([^"']+)["']/g)) expect(match[1]).toMatch(/^(?:node:|\.)/);
  }
});
it('domain bridge references are a source convention, not hard same-realm isolation', () => {
  for (const domain of ['design', 'social', 'work']) for (const path of files('modules/' + domain).filter(p => /\.[cm]?[jt]sx?$/.test(p))) {
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(domain === 'design' ? /hqServices\.(social|work)/ : /hqServices\.design/);
  }
});
