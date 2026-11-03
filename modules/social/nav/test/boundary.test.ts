import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ac.social-domain.001: across package boundaries, Social production code imports only `@hq/contracts` and
 * `@hq/ui` (plus React). Tests, fixtures' test harnesses and evidence pages are not production code.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXCLUDED_DIRS = new Set(['test', 'preview', 'harness', 'dist', 'node_modules']);
const ALLOWED_PACKAGES = new Set(['@hq/contracts', '@hq/ui', 'react']);

function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return EXCLUDED_DIRS.has(entry.name) ? [] : productionFiles(path);
    return /\.(ts|tsx)$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gu)) {
    found.push((match[1] ?? match[2] ?? match[3])!);
  }
  return found;
}

describe('Social package boundary', () => {
  const files = productionFiles(ROOT);

  it('finds the domain entry and navigation sources', () => {
    const names = files.map((file) => relative(ROOT, file).split(sep).join('/'));
    expect(names).toContain('index.tsx');
    expect(names).toContain('nav/SocialDomain.tsx');
    expect(names.some((name) => name.startsWith('core/'))).toBe(true);
  });

  it('imports only @hq/contracts, @hq/ui and React across package boundaries', () => {
    const outside: string[] = [];
    for (const file of files) {
      for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(file), specifier);
          if (target !== ROOT && !target.startsWith(ROOT + sep)) outside.push(`${relative(ROOT, file)} → ${specifier}`);
        } else if (!ALLOWED_PACKAGES.has(specifier)) {
          outside.push(`${relative(ROOT, file)} → ${specifier}`);
        }
      }
    }
    expect(outside).toStrictEqual([]);
  });
});
