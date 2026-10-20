/**
 * The preview registers every assembled section UI exactly once, through T14's
 * real registry builder, with no rejected descriptor. Node 24 type stripping;
 * the descriptors' lazy views are not loaded here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildRegistry } from '../../ui/src/registry.ts';

const designRoot = fileURLToPath(new URL('../../', import.meta.url));
const sectionsRoot = fileURLToPath(new URL('../sections/', import.meta.url));

/** Cones under modules/design/ that are not sections: T14's chrome and this preview. */
const NOT_SECTIONS = new Set(['ui', 'preview']);

const PLACEMENT: Readonly<Record<string, string>> = {
  projects: 'projects', discovery: 'projects',
  references: 'resources', components: 'resources', flows: 'resources',
  canvas: 'review', compare: 'review', annotations: 'review', taste: 'review',
  requests: 'requests', imports: 'requests',
  connector: 'runs',
};

async function loadEntries(): Promise<Record<string, unknown>> {
  const entries: Record<string, unknown> = {};
  for (const id of readdirSync(sectionsRoot).sort()) {
    entries[`./sections/${id}/design-module.ts`] = await import(new URL(`../sections/${id}/design-module.ts`, import.meta.url).href);
  }
  return entries;
}

test('every assembled section cone has exactly one preview descriptor', () => {
  const cones = readdirSync(designRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NOT_SECTIONS.has(entry.name)).map((entry) => entry.name).sort();
  assert.deepEqual(readdirSync(sectionsRoot).sort(), cones);
  assert.deepEqual(cones, Object.keys(PLACEMENT).sort());
  // The store is headless: assembled and checked, never mounted as a section.
  assert.ok(existsSync(fileURLToPath(new URL('../../../../packages/design-store/src/index.ts', import.meta.url))));
});

test('T14 registry accepts all preview descriptors with the suggested placement', async () => {
  const registry = buildRegistry(await loadEntries());
  assert.deepEqual(registry.rejected, []);
  assert.equal(registry.sections.length, Object.keys(PLACEMENT).length);
  for (const section of registry.sections) {
    assert.equal(section.nav, PLACEMENT[section.id], `${section.id} placement`);
    assert.equal(typeof section.view, 'function');
  }
});

test('preview descriptors stay out of the production section glob', () => {
  // T14's production glob is modules/design/*/design-module.ts (one level deep).
  assert.equal(existsSync(fileURLToPath(new URL('../design-module.ts', import.meta.url))), false);
});
