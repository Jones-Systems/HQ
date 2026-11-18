import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReferenceId } from '../src/contract.ts';
import { fakePorts } from '../src/fakes.ts';
import { ReferenceLibrary } from '../src/service.ts';
import { buildLibraryView, gridFocusTarget, lightboxPosition } from '../ui/view-model.ts';
import { appScreenshot, nativeReference, screenshot } from './fixtures.ts';

const none = { query: '', collectionId: null, selectedId: null };

async function setup() {
  const library = await ReferenceLibrary.open(fakePorts());
  const ids: ReferenceId[] = [];
  for (const candidate of [screenshot(), appScreenshot(), nativeReference()]) {
    ids.push((await library.importReference(candidate) as { id: ReferenceId }).id);
  }
  return { library, ids };
}

test('cards are marked as queued for Taste only for the ids the handoff holds', async () => {
  const { library, ids } = await setup();
  const plain = buildLibraryView(library.state, library.access, none, null);
  assert.ok(plain.cards.every((card) => !card.queuedForTaste), 'no queue given: nothing is marked');
  const queued = buildLibraryView(library.state, library.access, none, null, { queuedForTaste: [ids[1]!, 'ref_not_in_library'] });
  assert.deepEqual(queued.cards.filter((card) => card.queuedForTaste).map((card) => card.id), [ids[1]]);
  const fromSet = buildLibraryView(library.state, library.access, none, null, { queuedForTaste: new Set<string>([ids[0]!, ids[2]!]) });
  assert.deepEqual(fromSet.cards.filter((card) => card.queuedForTaste).map((card) => card.id).sort(), [ids[0]!, ids[2]!].sort());
});

test('lightbox position follows the visible cards and ends at the first and last', async () => {
  const { library, ids } = await setup();
  const view = buildLibraryView(library.state, library.access, none, null);
  const order = view.cards.map((card) => card.id);
  assert.deepEqual(lightboxPosition(view.cards, order[0]!), { position: 1, total: 3, previous: null, next: order[1] });
  assert.deepEqual(lightboxPosition(view.cards, order[1]!), { position: 2, total: 3, previous: order[0], next: order[2] });
  assert.deepEqual(lightboxPosition(view.cards, order[2]!), { position: 3, total: 3, previous: order[1], next: null });
  assert.equal(lightboxPosition(view.cards, null), null);
  assert.equal(lightboxPosition(view.cards, 'ref_not_shown' as ReferenceId), null, 'a reference the search hides has no position');
  const filtered = buildLibraryView(library.state, library.access, { query: 'notes', collectionId: null, selectedId: ids[1]! }, null);
  assert.equal(lightboxPosition(filtered.cards, ids[1]!)?.total, filtered.cards.length);
});

test('grid focus: arrows step by one or by a row, and clamp at the edges', () => {
  // Seven items in three columns:  0 1 2 / 3 4 5 / 6
  assert.equal(gridFocusTarget('ArrowRight', 0, 7, 3), 1);
  assert.equal(gridFocusTarget('ArrowRight', 6, 7, 3), 6);
  assert.equal(gridFocusTarget('ArrowLeft', 4, 7, 3), 3);
  assert.equal(gridFocusTarget('ArrowLeft', 0, 7, 3), 0);
  assert.equal(gridFocusTarget('ArrowDown', 1, 7, 3), 4);
  assert.equal(gridFocusTarget('ArrowUp', 4, 7, 3), 1);
  assert.equal(gridFocusTarget('ArrowUp', 1, 7, 3), 1, 'no row above: stay');
});

test('grid focus: down from a column with nothing below lands on the last item, never past it', () => {
  assert.equal(gridFocusTarget('ArrowDown', 4, 7, 3), 6, 'short last row: go to its last item');
  assert.equal(gridFocusTarget('ArrowDown', 5, 7, 3), 6);
  assert.equal(gridFocusTarget('ArrowDown', 6, 7, 3), 6, 'already on the last row: stay');
  assert.equal(gridFocusTarget('ArrowDown', 2, 6, 3), 5);
  assert.equal(gridFocusTarget('ArrowDown', 5, 6, 3), 5);
});

test('grid focus: Home and End, single column, odd widths, empty grids and other keys', () => {
  assert.equal(gridFocusTarget('Home', 5, 7, 3), 0);
  assert.equal(gridFocusTarget('End', 1, 7, 3), 6);
  assert.equal(gridFocusTarget('ArrowDown', 0, 3, 1), 1);
  assert.equal(gridFocusTarget('ArrowUp', 2, 3, 1), 1);
  assert.equal(gridFocusTarget('ArrowDown', 0, 3, 0), 1, 'a zero width is treated as one column');
  assert.equal(gridFocusTarget('ArrowDown', 0, 3, 2.9), 2, 'a fractional width is floored');
  assert.equal(gridFocusTarget('ArrowRight', 0, 0, 3), null);
  assert.equal(gridFocusTarget('Enter', 0, 3, 3), null);
  assert.equal(gridFocusTarget('a', 0, 3, 3), null);
});
