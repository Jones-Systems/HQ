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

const ROUTES = { fixed: [{ id: 'strip', title: 'Strip' }, { id: 'swipe', title: 'Swipe stage' }], navChildren: true };

test('sub-route metadata is validated and copied, never shared with the descriptor', () => {
  const source = { fixed: [{ id: 'strip', title: 'Strip' }], navChildren: false, itemPrefix: 'item' };
  const registry = buildRegistry({
    '../../compare/design-module.ts': entry('compare', 'review', { subRoutes: source }),
    '../../canvas/design-module.ts': entry('canvas', 'review'),
  });
  assert.deepEqual(registry.rejected, []);
  const copied = registry.get('compare')?.subRoutes;
  assert.deepEqual(copied, source);
  assert.notEqual(copied, source);
  assert.notEqual(copied?.fixed, source.fixed);
  assert.notEqual(copied?.fixed[0], source.fixed[0]);
  assert.equal('subRoutes' in registry.get('canvas')!, false, 'a section without views has no key at all');
  const plain = buildRegistry({ '../../compare/design-module.ts': entry('compare', 'review', { subRoutes: ROUTES }) }).get('compare')?.subRoutes;
  assert.deepEqual(plain, ROUTES);
  assert.equal('itemPrefix' in plain!, false, 'itemPrefix is present only when declared');
});

test('sub-route views keep their declared order and an item-only section is valid', () => {
  const registry = buildRegistry({ '../../components/design-module.ts': entry('components', 'resources', { subRoutes: { fixed: [], navChildren: false, itemPrefix: 'item' } }) });
  assert.deepEqual(registry.rejected, []);
  assert.deepEqual(registry.get('components')?.subRoutes, { fixed: [], navChildren: false, itemPrefix: 'item' });
  const ordered = buildRegistry({ '../../flows/design-module.ts': entry('flows', 'resources', { subRoutes: { fixed: [{ id: 'zeta', title: 'Z' }, { id: 'alpha', title: 'A' }], navChildren: true } }) });
  assert.deepEqual(ordered.get('flows')?.subRoutes?.fixed.map((view) => view.id), ['zeta', 'alpha']);
});

test('invalid sub-route metadata rejects the whole descriptor, reported rather than repaired', () => {
  const cases: readonly (readonly [string, unknown, RegExp])[] = [
    ['not a record', 'strip', /subRoutes has unexpected shape/u],
    ['null', null, /subRoutes has unexpected shape/u],
    ['an array', [], /subRoutes has unexpected shape/u],
    ['an extra key', { ...ROUTES, default: 'strip' }, /subRoutes has unexpected shape/u],
    ['fixed missing', { navChildren: true }, /fixed must be an array/u],
    ['fixed not an array', { fixed: 'strip', navChildren: true }, /fixed must be an array/u],
    ['too many views', { fixed: Array.from({ length: 9 }, (_, index) => ({ id: `v${index}`, title: 'V' })), navChildren: true }, /at most 8/u],
    ['navChildren missing', { fixed: ROUTES.fixed }, /navChildren must be a boolean/u],
    ['navChildren not a boolean', { fixed: ROUTES.fixed, navChildren: 'yes' }, /navChildren must be a boolean/u],
    ['a wrong itemPrefix', { ...ROUTES, itemPrefix: 'entry' }, /itemPrefix must be "item"/u],
    ['no views and no items', { fixed: [], navChildren: true }, /at least one view/u],
    ['a view with an extra key', { fixed: [{ id: 'strip', title: 'S', href: 'x' }], navChildren: true }, /unexpected shape/u],
    ['a view that is not a record', { fixed: ['strip'], navChildren: true }, /unexpected shape/u],
    ['a duplicate view id', { fixed: [{ id: 'strip', title: 'A' }, { id: 'strip', title: 'B' }], navChildren: true }, /unique/u],
    ['the reserved id item', { fixed: [{ id: 'item', title: 'Item' }], navChildren: true }, /not "item"/u],
    ['an uppercase id', { fixed: [{ id: 'Strip', title: 'S' }], navChildren: true }, /lowercase/u],
    ['a slash in an id', { fixed: [{ id: 'a/b', title: 'S' }], navChildren: true }, /lowercase/u],
    ['an id over 32 characters', { fixed: [{ id: `a${'b'.repeat(32)}`, title: 'S' }], navChildren: true }, /32 characters/u],
    ['an id starting with a digit', { fixed: [{ id: '1up', title: 'S' }], navChildren: true }, /lowercase/u],
    ['an empty title', { fixed: [{ id: 'strip', title: '' }], navChildren: true }, /1–80/u],
    ['a padded title', { fixed: [{ id: 'strip', title: ' Strip ' }], navChildren: true }, /1–80/u],
    ['a title over 80 characters', { fixed: [{ id: 'strip', title: 'T'.repeat(81) }], navChildren: true }, /1–80/u],
    ['a control character in a title', { fixed: [{ id: 'strip', title: 'S\u0007' }], navChildren: true }, /1–80/u],
  ];
  for (const [label, subRoutes, reason] of cases) {
    const registry = buildRegistry({ '../../compare/design-module.ts': entry('compare', 'review', { subRoutes }) });
    assert.deepEqual(registry.sections, [], label);
    assert.equal(registry.rejected.length, 1, label);
    assert.match(registry.rejected[0]!.reason, reason, label);
  }
});

test('a title of exactly 80 characters and eight views are accepted', () => {
  const fixed = Array.from({ length: 8 }, (_, index) => ({ id: `v${index}`, title: index === 0 ? 'T'.repeat(80) : 'V' }));
  const registry = buildRegistry({ '../../compare/design-module.ts': entry('compare', 'review', { subRoutes: { fixed, navChildren: true } }) });
  assert.deepEqual(registry.rejected, []);
  assert.equal(registry.get('compare')?.subRoutes?.fixed.length, 8);
});
