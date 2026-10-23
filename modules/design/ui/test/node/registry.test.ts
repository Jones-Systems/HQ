import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRegistry, sectionDirectory } from '../../src/registry.ts';
import { entry } from './fixtures.ts';

const base = {
  '../../canvas/design-module.ts': entry('canvas', 'review'),
  '../../projects/design-module.ts': entry('projects', 'projects'),
};

test('a stub section added under modules/design/* appears with no registry edit', () => {
  const before = buildRegistry(base);
  assert.deepEqual(before.sections.map((s) => s.id), ['projects', 'canvas']);
  // Simulates the glob result after a new directory is added; buildRegistry is untouched.
  const after = buildRegistry({ ...base, '../../stub/design-module.ts': entry('stub', 'resources') });
  assert.deepEqual(after.sections.map((s) => s.id), ['projects', 'stub', 'canvas']);
  assert.equal(after.get('stub')?.nav, 'resources');
  assert.deepEqual(after.byNav.resources.map((s) => s.id), ['stub']);
  assert.deepEqual(after.rejected, []);
});

test('ordering is deterministic regardless of glob key order', () => {
  const keys = { a: entry('alpha', 'review', { order: 5 }), b: entry('beta', 'review', { order: 1 }), c: entry('gamma', 'projects') };
  const forward = buildRegistry({ '../../alpha/design-module.ts': keys.a, '../../beta/design-module.ts': keys.b, '../../gamma/design-module.ts': keys.c });
  const reverse = buildRegistry({ '../../gamma/design-module.ts': keys.c, '../../beta/design-module.ts': keys.b, '../../alpha/design-module.ts': keys.a });
  assert.deepEqual(forward.sections.map((s) => s.id), ['gamma', 'beta', 'alpha']);
  assert.deepEqual(reverse.sections.map((s) => s.id), ['gamma', 'beta', 'alpha']);
});

test('invalid entries are reported, not silently dropped or repaired', () => {
  const registry = buildRegistry({
    '../../wrongid/design-module.ts': entry('other', 'review'),
    '../../badnav/design-module.ts': entry('badnav', 'settings' as never),
    '../../noview/design-module.ts': entry('noview', 'review', { view: 'not a function' }),
    '../../extra/design-module.ts': entry('extra', 'review', { launch: () => undefined }),
    '../../oldschema/design-module.ts': entry('oldschema', 'review', { schema: 'hq.design.section/v0' }),
    '../../missing/design-module.ts': {},
    '../../title/design-module.ts': entry('title', 'review', { title: ' padded ' }),
    '../../cmds/design-module.ts': entry('cmds', 'review', { commands: [{ id: 'a', title: 'A' }, { id: 'a', title: 'B' }] }),
  });
  assert.deepEqual(registry.sections, []);
  const reasons = Object.fromEntries(registry.rejected.map((r) => [sectionDirectory(r.path), r.reason]));
  assert.match(reasons.wrongid!, /must equal its directory/u);
  assert.match(reasons.badnav!, /nav must be one of/u);
  assert.match(reasons.noview!, /lazy loader/u);
  assert.match(reasons.extra!, /unexpected fields/u);
  assert.match(reasons.oldschema!, /schema must be/u);
  assert.match(reasons.missing!, /missing/u);
  assert.match(reasons.title!, /title/u);
  assert.match(reasons.cmds!, /unique/u);
});

test('ambiguous duplicate ids reject every claimant', () => {
  const registry = buildRegistry({
    'a/canvas/design-module.ts': entry('canvas', 'review'),
    'b/canvas/design-module.ts': entry('canvas', 'review'),
    'c/compare/design-module.ts': entry('compare', 'review'),
  });
  assert.deepEqual(registry.sections.map((s) => s.id), ['compare']);
  assert.equal(registry.rejected.length, 2);
  assert.ok(registry.rejected.every((r) => /duplicate/u.test(r.reason)));
});

test('the ui host directory is never registered as a section', () => {
  const registry = buildRegistry({ '../../ui/design-module.ts': entry('ui', 'projects') });
  assert.deepEqual(registry.sections, []);
  assert.deepEqual(registry.rejected, []);
});

test('section commands are validated and copied', () => {
  const registry = buildRegistry({ '../../canvas/design-module.ts': entry('canvas', 'review', { commands: [{ id: 'fit', title: 'Fit to screen', keywords: ['zoom'] }] }) });
  assert.deepEqual(registry.get('canvas')?.commands, [{ id: 'fit', title: 'Fit to screen', keywords: ['zoom'] }]);
});
