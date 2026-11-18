import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildRegistry } from '../../src/registry.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const productionGlob = fileURLToPath(new URL('../../src/registry-glob.ts', import.meta.url));
// Exact per-run scratch inside this section's cone; removed on success and failure.
const run = `${here}scratch/run-${process.pid}-${Date.now()}`;

const stub = (id: string, nav: string) => `export const designModule = {
  schema: 'hq.design.section/v1', id: '${id}', title: 'Stub ${id}', nav: '${nav}',
  view: async () => () => null,
};
`;

describe('renderer glob', () => {
  afterAll(async () => {
    await rm(run, { recursive: true, force: true });
    await rmdir(`${here}scratch`).catch(() => undefined); // only if no other run is using it
  });

  it('a stub module added next to existing sections appears with no registry edit', async () => {
    // Mirror modules/design/: <run>/ui/src/registry-glob.ts is a byte-identical copy of
    // production, so its '../../*/design-module.ts' pattern sees <run>/*/design-module.ts.
    const source = await readFile(productionGlob, 'utf8');
    await mkdir(`${run}/ui/src`, { recursive: true });
    await writeFile(`${run}/ui/src/registry-glob.ts`, source);
    await mkdir(`${run}/canvas`, { recursive: true });
    await writeFile(`${run}/canvas/design-module.ts`, stub('canvas', 'review'));
    // The new directory: nothing else changes.
    await mkdir(`${run}/zz-stub`, { recursive: true });
    await writeFile(`${run}/zz-stub/design-module.ts`, stub('zz-stub', 'resources'));

    expect(await readFile(`${run}/ui/src/registry-glob.ts`, 'utf8')).toBe(source);
    const { SECTION_ENTRIES } = await import(/* @vite-ignore */ `${run}/ui/src/registry-glob.ts`) as { SECTION_ENTRIES: Record<string, unknown> };
    expect(Object.keys(SECTION_ENTRIES).sort()).toEqual(['../../canvas/design-module.ts', '../../zz-stub/design-module.ts']);

    const registry = buildRegistry(SECTION_ENTRIES);
    expect(registry.rejected).toEqual([]);
    expect(registry.sections.map((section) => section.id)).toEqual(['zz-stub', 'canvas']);
    expect(registry.byNav.resources.map((section) => section.title)).toEqual(['Stub zz-stub']);
    expect(typeof await registry.get('zz-stub')!.view()).toBe('function');
  });

  it('the production glob only matches sibling design-module.ts entries', async () => {
    const { SECTION_ENTRIES } = await import('../../src/registry-glob.ts');
    for (const path of Object.keys(SECTION_ENTRIES)) expect(path).toMatch(/^\.\.\/\.\.\/[a-z][a-z0-9-]*\/design-module\.ts$/u);
    expect(buildRegistry(SECTION_ENTRIES).rejected).toEqual([]);
  });
});
