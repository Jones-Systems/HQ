import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildRegistry } from '../../../ui/src/registry.ts';
import { designModule as annotations } from '../../../annotations/design-module.ts';
import { designModule as canvas } from '../../../canvas/design-module.ts';
import { designModule as compare } from '../../../compare/design-module.ts';
import { designModule as components } from '../../../components/design-module.ts';
import { designModule as discovery } from '../../../discovery/design-module.ts';
import { designModule as flows } from '../../../flows/design-module.ts';
import { designModule as imports } from '../../../imports/design-module.ts';
import { designModule as projects } from '../../../projects/design-module.ts';
import { designModule as taste } from '../../../taste/design-module.ts';

import { designModule as requests } from '../../../requests/design-module.ts';
import { designModule as connector } from '../../../connector/design-module.ts';
import { designModule as references } from '../../../references/design-module.ts';

const DESCRIPTORS = { requests, connector, references, annotations, canvas, compare, components, discovery, flows, imports, projects, taste };
const entries = Object.fromEntries(Object.entries(DESCRIPTORS).map(([id, designModule]) => [`../../${id}/design-module.ts`, { designModule }]));
const DESIGN = fileURLToPath(new URL('../../../', import.meta.url));

describe('production descriptors through T14\'s buildRegistry', () => {
  const registry = buildRegistry(entries);

  it('are accepted with zero rejections, one per section', () => {
    assert.deepEqual(registry.rejected, []);
    assert.deepEqual(registry.sections.map((section) => section.id).sort(), Object.keys(DESCRIPTORS).sort());
  });

  it('carry the provisional placement T14 suggested', () => {
    const placement = (nav: 'projects' | 'resources' | 'review' | 'requests' | 'runs') => registry.byNav[nav].map((section) => section.id);
    assert.deepEqual(placement('projects'), ['projects', 'discovery']);
    assert.deepEqual(placement('resources'), ['references', 'components', 'flows']);
    assert.deepEqual(placement('review'), ['canvas', 'compare', 'annotations', 'taste']);
    assert.deepEqual(placement('requests'), ['requests', 'imports']);
    assert.deepEqual(placement('runs'), ['connector']);
  });

  it('keep ids equal to their directory, cheap descriptors, and lazy view loaders (not evaluated here)', () => {
    for (const section of registry.sections) assert.equal(section.path, `../../${section.id}/design-module.ts`);
    for (const descriptor of Object.values(DESCRIPTORS)) {
      assert.equal(descriptor.schema, 'hq.design.section/v1');
      assert.equal(typeof descriptor.view, 'function');
      assert.deepEqual(Object.keys(descriptor).sort(), ['id', 'nav', 'order', 'schema', 'title', 'view']);
    }
  });

  it('are marked provisional in every descriptor file', () => {
    for (const id of Object.keys(DESCRIPTORS)) {
      assert.match(readFileSync(new URL(`../../../${id}/design-module.ts`, import.meta.url), 'utf8'), /PLACEMENT IS PROVISIONAL/u, id);
    }
  });
});

describe('registration surface', () => {
  it('registers no design-module.ts for the app or preview directories, which the production glob would otherwise treat as sections', () => {
    for (const directory of ['app', 'preview']) assert.equal(existsSync(`${DESIGN}${directory}/design-module.ts`), false, directory);
  });

  it('creates descriptors for exactly twelve composed sections with no held cones', () => {
    const present = readdirSync(DESIGN, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(`${DESIGN}${entry.name}/design-module.ts`)).map((entry) => entry.name);
    assert.equal(present.length, 12);
    assert.deepEqual(present.sort(), Object.keys(DESCRIPTORS).sort());
    assert.ok(Object.keys(DESCRIPTORS).every((id) => present.includes(id)));
  });
});
