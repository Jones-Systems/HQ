import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerId, projectId } from '../src/contract.ts';
import { createProviderRegistry } from '../src/providers.ts';
import { PROVENANCE_LABELS, inspect } from '../src/inspector.ts';
import { setLocked } from '../src/arrangement.ts';
import { createFakeProvider } from '../src/fakes.ts';
import { A, B, BOARD, C, PROJECT, VIEWS, ref, sampleArrangement, sampleProvider } from './fixtures.ts';

test('registry refuses duplicate providers and unregisters only its own entry', () => {
  const registry = createProviderRegistry();
  let notified = 0;
  registry.subscribe(() => { notified += 1; });
  const unregister = registry.register(sampleProvider());
  assert.throws(() => registry.register(sampleProvider()), /already registered/u);
  assert.equal(registry.providers().length, 1);
  unregister();
  unregister();
  assert.equal(registry.get(VIEWS), undefined);
  assert.equal(notified, 2);
});

test('a missing provider or revision keeps the placement and reports it', () => {
  const registry = createProviderRegistry();
  const arrangement = sampleArrangement();
  const missing = inspect(arrangement, [B], registry);
  assert.equal(missing.kind, 'item');
  if (missing.kind !== 'item') return;
  assert.equal(missing.source, 'missing-provider');
  assert.equal(missing.title, 'view-home @ version-2');
  assert.deepEqual(missing.ref, ref('view-home', 'version-2'));
  registry.register(createFakeProvider(VIEWS, 'Views', [{ entityId: 'view-home', revision: 'version-9', title: 'Home v9' }]));
  assert.equal(registry.describe(ref('view-home', 'version-2')).status, 'missing-item', 'no fallback to another or latest revision');
});

test('a provider that answers for a different revision is rejected', () => {
  const registry = createProviderRegistry();
  registry.register({
    id: providerId('rebinding'), label: 'Rebinding provider',
    describe: (requested) => ({ ref: { ...requested, revision: 'latest' }, title: 't', kind: 'k', intrinsicSize: { width: 1, height: 1 }, provenance: 'unspecified' }),
  });
  const description = registry.describe({ providerId: providerId('rebinding'), entityId: 'e', revision: 'r1' });
  assert.equal(description.status, 'error');
  registry.register({ id: providerId('throws'), label: 'Throwing', describe: () => { throw new Error('boom'); } });
  assert.deepEqual(registry.describe({ providerId: providerId('throws'), entityId: 'e', revision: 'r' }), { status: 'error', providerLabel: 'Throwing', message: 'boom' });
});

test('provider changes notify registry subscribers; catalog lists per provider', () => {
  const registry = createProviderRegistry();
  const provider = sampleProvider();
  registry.register(provider);
  let notified = 0;
  registry.subscribe(() => { notified += 1; });
  provider.update(provider.items.slice(0, 1));
  assert.equal(notified, 1);
  const catalog = registry.catalog(PROJECT);
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0]!.items.length, 1);
  const scoped = createFakeProvider('scoped', 'Scoped', [{ entityId: 'e', revision: 'r', title: 't' }], projectId('only-this'));
  registry.register(scoped);
  assert.equal(registry.catalog(PROJECT).find((entry) => entry.provider.id === scoped.id)?.items.length, 0);
});

test('inspector exposes useful item, artboard and multi-select properties with provenance', () => {
  const registry = createProviderRegistry();
  registry.register(sampleProvider());
  const arrangement = sampleArrangement();
  const item = inspect(arrangement, [C], registry);
  assert.equal(item.kind, 'item');
  if (item.kind === 'item') {
    assert.equal(item.title, 'Pricing v7');
    assert.equal(item.itemKind, 'view-version');
    assert.equal(item.provenance, PROVENANCE_LABELS['web-approximation']);
    assert.match(item.provenance ?? '', /not native evidence/u);
    assert.equal(item.scale, 0.5);
    assert.equal(item.providerLabel, 'Synthetic views (fake)');
  }
  const inBoard = inspect(arrangement, [A], registry);
  assert.equal(inBoard.kind === 'item' && inBoard.artboardName, 'Desktop');
  const board = inspect(arrangement, [BOARD], registry);
  assert.deepEqual(board.kind === 'artboard' && [board.name, board.childCount], ['Desktop', 1]);
  const multiple = inspect(setLocked(arrangement, [B], true), [B, C], registry);
  assert.equal(multiple.kind, 'multiple');
  if (multiple.kind === 'multiple') {
    assert.equal(multiple.locked, null);
    assert.equal(multiple.canDistribute, false);
    assert.deepEqual(multiple.bounds, { x: 1200, y: 40, width: 320, height: 480 });
  }
  assert.deepEqual(inspect(arrangement, [], registry), { kind: 'empty', itemCount: 3, artboardCount: 1 });
});
