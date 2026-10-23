import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * ac.work-domain.001: across HQ workspace boundaries, Work production code imports only `@hq/contracts` and `@hq/ui`
 * (plus React). Tests, test harnesses and evidence pages are not production code.
 */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EXCLUDED_DIRS = new Set(['test', 'harness', 'evidence', 'preview', 'dist', 'node_modules']);
const ALLOWED_PACKAGES = new Set(['@hq/contracts', '@hq/ui', 'react']);

function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return EXCLUDED_DIRS.has(entry.name) ? [] : productionFiles(path);
    return /\.(ts|tsx|js)$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) && !/\.d\.ts$/u.test(entry.name) ? [path] : [];
  });
}

function specifiers(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/gu)) {
    found.push((match[1] ?? match[2] ?? match[3])!);
  }
  return found;
}

describe('Work package boundary', () => {
  const files = productionFiles(ROOT);
  const names = files.map((file) => relative(ROOT, file).split(sep).join('/'));

  it('finds the domain entry, navigation and the composed Work trees', () => {
    expect(names).toContain('index.tsx');
    expect(names).toContain('nav/WorkDomain.tsx');
    for (const tree of ['core/', 'views/', 'board/', 'detail/', 'capture/']) expect(names.some((name) => name.startsWith(tree))).toBe(true);
  });

  it('imports only @hq/contracts, @hq/ui and React across workspace boundaries', () => {
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
