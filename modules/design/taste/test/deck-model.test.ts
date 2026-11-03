import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_ID_LENGTH, MAX_LABEL_LENGTH, clientEventId, isIdentifier, projectId, subjectId, type AppendResult } from '../src/contract.ts';
import {
  DRAG_THRESHOLD, choiceDirection, choiceForKey, choiceText, classifyAppend, deckImageUrl, deckLabel, deckOrigin,
  deckSubject, deckSubjectId, dragIntent, exitOffset, prepareRating, pushRecent, scaleFocusTarget, snapshotHasCommand,
} from '../src/ui/deck-model.ts';
import type { TasteQueueItem } from '../src/ui/queue-context.ts';
import { GENERAL, PROJECT_A, openService } from './helpers.ts';

function sequentialIds() {
  let next = 0;
  return () => `deck-${(next += 1)}`;
}

const PROJECT_A_ID = projectId('project-a');
const ITEM: TasteQueueItem = { id: 'pricing', kind: 'reference', label: 'Larkspur pricing', from: 'references' };

describe('deck keys', () => {
  it('maps arrows and numbers to the rating the legend promises', () => {
    assert.deepEqual(choiceForKey({ key: 'ArrowLeft' }), { kind: 'rate', value: 2 });
    assert.deepEqual(choiceForKey({ key: 'ArrowRight' }), { kind: 'rate', value: 4 });
    assert.deepEqual(choiceForKey({ key: 'ArrowUp' }), { kind: 'rate', value: 5 });
    assert.deepEqual(choiceForKey({ key: 'ArrowDown' }), { kind: 'skip' });
    assert.deepEqual(choiceForKey({ key: 's' }), { kind: 'skip' });
    assert.deepEqual(choiceForKey({ key: 'S' }), { kind: 'skip' });
    for (const value of [1, 2, 3, 4, 5] as const) assert.deepEqual(choiceForKey({ key: String(value) }), { kind: 'rate', value });
  });

  it('leaves other keys and chorded keys alone', () => {
    assert.equal(choiceForKey({ key: 'Enter' }), null);
    assert.equal(choiceForKey({ key: '0' }), null);
    assert.equal(choiceForKey({ key: '6' }), null);
    assert.equal(choiceForKey({ key: 'ArrowRight', metaKey: true }), null);
    assert.equal(choiceForKey({ key: '4', ctrlKey: true }), null);
    assert.equal(choiceForKey({ key: 's', altKey: true }), null);
  });

  it('words a choice the way the stamp and legend do', () => {
    assert.equal(choiceText({ kind: 'rate', value: 4 }), 'Like · 4');
    assert.equal(choiceText({ kind: 'rate', value: 2 }), 'Not for me · 2');
    assert.equal(choiceText({ kind: 'rate', value: 5 }), 'Love · 5');
    assert.equal(choiceText({ kind: 'skip' }), 'Skip');
    assert.equal(choiceDirection({ kind: 'rate', value: 2 }), 'left');
    assert.equal(choiceDirection({ kind: 'rate', value: 4 }), 'right');
    assert.equal(choiceDirection({ kind: 'rate', value: 5 }), 'up');
    assert.equal(choiceDirection({ kind: 'skip' }), 'down');
  });
});

describe('deck drag', () => {
  it('reads left as 2, right as 4 and up as 5 once past the threshold', () => {
    assert.deepEqual(dragIntent(-DRAG_THRESHOLD, 0).choice, { kind: 'rate', value: 2 });
    assert.deepEqual(dragIntent(DRAG_THRESHOLD, 4).choice, { kind: 'rate', value: 4 });
    assert.deepEqual(dragIntent(2, -DRAG_THRESHOLD).choice, { kind: 'rate', value: 5 });
    assert.equal(dragIntent(DRAG_THRESHOLD, 0).armed, true);
    assert.equal(dragIntent(DRAG_THRESHOLD - 1, 0).armed, false);
  });

  it('ramps the stamp with distance and ignores small or downward drags', () => {
    assert.equal(dragIntent(4, 3).choice, null);
    assert.equal(dragIntent(0, 140).choice, null);
    assert.equal(dragIntent(DRAG_THRESHOLD / 2, 0).progress, 0.5);
    assert.equal(dragIntent(DRAG_THRESHOLD * 3, 0).progress, 1);
    // A drag that is mostly vertical is judged on the vertical axis.
    assert.deepEqual(dragIntent(60, -90).choice, { kind: 'rate', value: 5 });
    assert.deepEqual(dragIntent(90, -60).choice, { kind: 'rate', value: 4 });
  });

  it('throws a card further in the direction it was thrown', () => {
    assert.ok(exitOffset('left', { dx: -100, dy: 0 }).dx < -100);
    assert.ok(exitOffset('right', { dx: 100, dy: 0 }).dx > 100);
    assert.ok(exitOffset('up', { dx: 0, dy: -100 }).dy < -100);
    assert.ok(exitOffset('down', { dx: 0, dy: 0 }).dy > 0);
  });
});

describe('rating row keys', () => {
  it('moves focus along the row, wrapping, and never picks a value', () => {
    assert.equal(scaleFocusTarget('ArrowRight', 0, 5), 1);
    assert.equal(scaleFocusTarget('ArrowRight', 4, 5), 0);
    assert.equal(scaleFocusTarget('ArrowLeft', 0, 5), 4);
    assert.equal(scaleFocusTarget('ArrowDown', 2, 5), 3);
    assert.equal(scaleFocusTarget('ArrowUp', 2, 5), 1);
    assert.equal(scaleFocusTarget('Home', 3, 5), 0);
    assert.equal(scaleFocusTarget('End', 1, 5), 4);
    assert.equal(scaleFocusTarget(' ', 1, 5), null);
    assert.equal(scaleFocusTarget('Enter', 1, 5), null);
    assert.equal(scaleFocusTarget('3', 1, 5), null);
  });
});

describe('deck subjects', () => {
  it('derives a valid, stable id from kind and id', () => {
    const id = deckSubjectId('reference', 'pricing');
    assert.equal(id, 'reference:pricing');
    assert.equal(deckSubjectId('reference', 'pricing'), id);
    assert.equal(subjectId(id), id);
    assert.deepEqual(deckSubject(ITEM), { id: subjectId('reference:pricing'), kind: 'reference', label: 'Larkspur pricing' });
  });

  it('keeps the same id under different kinds apart', () => {
    const ids = (['reference', 'component', 'flow', 'other'] as const).map((kind) => deckSubjectId(kind, 'shared-id'));
    assert.equal(new Set(ids).size, 4);
  });

  it('always yields something subjectId accepts, however awkward the source id', () => {
    const awkward = [
      ' leading', 'trailing ', 'tab\there', 'line\nbreak', 'nul\u0000byte', 'del\u007f', ' nbsp', 'a b', 'emoji 🙂 id',
      '100%', '%41', 'A', 'tilde~tail', 'x'.repeat(500), '🙂'.repeat(200), 'lone\ud800surrogate', '',
    ];
    for (const raw of awkward) {
      const id = deckSubjectId('component', raw);
      assert.ok(isIdentifier(id), `invalid id for ${JSON.stringify(raw)}: ${JSON.stringify(id)}`);
      assert.ok(id.length <= MAX_ID_LENGTH);
      assert.equal(subjectId(id), id);
    }
  });

  it('does not collide when escaping or shortening', () => {
    // An id that already looks like an escape never equals the id it would be read as.
    assert.notEqual(deckSubjectId('flow', '%41'), deckSubjectId('flow', 'A'));
    assert.notEqual(deckSubjectId('flow', 'a b'), deckSubjectId('flow', 'a%20b'));
    assert.notEqual(deckSubjectId('flow', 'a~b'), deckSubjectId('flow', 'a%7eb'));
    // Long ids that share a long prefix stay distinct, and stay distinct from a short id that looks like their result.
    const a = deckSubjectId('reference', `${'p'.repeat(200)}a`);
    const b = deckSubjectId('reference', `${'p'.repeat(200)}b`);
    assert.notEqual(a, b);
    assert.ok(a.length <= MAX_ID_LENGTH && b.length <= MAX_ID_LENGTH);
    assert.notEqual(deckSubjectId('reference', a), a);
    // Never cuts through an escape or a surrogate pair.
    const cut = deckSubjectId('other', `${'x'.repeat(130)}\u0001\u0001\u0001\u0001\u0001\u0001\u0001\u0001\u0001\u0001`);
    assert.ok(!/%[0-9a-f]?~/u.test(cut), cut);
    const pairs = deckSubjectId('other', '🙂'.repeat(120));
    assert.ok(pairs.isWellFormed());
  });

  it('keeps a label Taste accepts', () => {
    assert.equal(deckLabel('  Pricing  ', 'id'), 'Pricing');
    assert.equal(deckLabel('', 'fallback-id'), 'fallback-id');
    assert.equal(deckLabel('  ', ''), 'Untitled');
    assert.equal(deckLabel('line\nbreak', 'x'), 'line break');
    const long = deckLabel('w'.repeat(1000), 'x');
    assert.equal(long.length, MAX_LABEL_LENGTH);
    assert.ok(long.endsWith('…'));
    assert.ok(deckLabel('🙂'.repeat(400), 'x').isWellFormed());
  });

  it('names where an item came from', () => {
    assert.equal(deckOrigin('references', () => 'References'), 'References');
    assert.equal(deckOrigin('references'), 'References');
    assert.equal(deckOrigin('design-discovery', () => ''), 'Design discovery');
    assert.equal(deckOrigin('', undefined), 'another view');
  });
});

describe('deck images', () => {
  const origin = 'http://127.0.0.1:5284';
  it('accepts data images and same-document addresses only', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    assert.equal(deckImageUrl(png, origin), png);
    assert.equal(deckImageUrl('/assets/a.png', origin), '/assets/a.png');
    assert.equal(deckImageUrl('assets/a.png', origin), 'assets/a.png');
    assert.equal(deckImageUrl(`${origin}/a.png`, origin), `${origin}/a.png`);
    assert.equal(deckImageUrl(`blob:${origin}/3b1c`, origin), `blob:${origin}/3b1c`);
  });

  it('refuses anything that would reach another origin or run code', () => {
    for (const url of ['https://example.com/a.png', '//example.com/a.png', 'http://127.0.0.1:9999/a.png', 'blob:https://example.com/x',
      'javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'ftp://127.0.0.1/a.png', '', '   ', undefined]) {
      assert.equal(deckImageUrl(url, origin), null, String(url));
    }
  });
});

describe('deck outcomes', () => {
  const record = { seq: 1 } as never;
  it('counts only a confirmed append, or the same entry already there, as saved', () => {
    assert.deepEqual(classifyAppend({ status: 'appended', record }), { kind: 'saved' });
    assert.deepEqual(classifyAppend({ status: 'duplicate', record }), { kind: 'saved' });
  });

  it('treats a fault that may have written as unknown, never as failed', () => {
    for (const reason of ['write-failed', 'partial-write', 'sync-failed'] as const) {
      assert.deepEqual(classifyAppend({ status: 'fail-closed', reason }), { kind: 'unknown' });
    }
  });

  it('reports a refusal in plain words and keeps it a failure', () => {
    const results: AppendResult[] = [
      { status: 'rejected', reason: 'stale-supersede' }, { status: 'conflict', existing: record },
      { status: 'fail-closed', reason: 'hash-mismatch' }, { status: 'closed' },
    ];
    for (const result of results) {
      const outcome = classifyAppend(result);
      assert.equal(outcome.kind, 'failed');
      assert.ok(outcome.kind === 'failed' && outcome.message.length > 0);
    }
    assert.match((classifyAppend({ status: 'rejected', reason: 'stale-supersede' }) as { message: string }).message, /changed elsewhere/u);
  });
});

describe('deck ratings', () => {
  it('records an overall liking assessment for the item in the current scope', async () => {
    const { service, journal } = await openService();
    const subject = deckSubject(ITEM);
    const prepared = prepareRating(await service.snapshot(PROJECT_A_ID), PROJECT_A, subject, 4, sequentialIds());
    assert.equal(prepared.kind, 'command');
    if (prepared.kind !== 'command') return;
    const event = prepared.command.event;
    assert.equal(event.type, 'assessment.recorded');
    if (event.type !== 'assessment.recorded') return;
    assert.deepEqual(event.scope, PROJECT_A);
    assert.deepEqual(event.subject, subject);
    assert.equal(event.judgment, 'liking');
    assert.deepEqual(event.target, { kind: 'overall' });
    assert.equal(event.value, 4);
    assert.equal(event.supersedes, null);
    assert.equal(classifyAppend(await service.submit(prepared.command)).kind, 'saved');
    await journal.close();
  });

  it('supersedes an earlier rating, treats the same value as already saved, and reads the journal back', async () => {
    const { service, journal } = await openService();
    const subject = deckSubject(ITEM);
    const newId = sequentialIds();
    const first = prepareRating(await service.snapshot(null), GENERAL, subject, 2, newId);
    assert.equal(first.kind, 'command');
    if (first.kind !== 'command') return;
    const before = await service.snapshot(null);
    assert.equal(snapshotHasCommand(before, first.command), false);
    await service.submit(first.command);
    const after = await service.snapshot(null);
    assert.equal(snapshotHasCommand(after, first.command), true);
    assert.deepEqual(prepareRating(after, GENERAL, subject, 2, newId), { kind: 'already-saved' });
    const second = prepareRating(after, GENERAL, subject, 5, newId);
    assert.equal(second.kind, 'command');
    if (second.kind === 'command' && second.command.event.type === 'assessment.recorded') {
      const current = after.assessments.find((item) => item.supersededBy === null);
      assert.equal(second.command.event.supersedes, current?.assessmentId);
    }
    await journal.close();
  });

  it('does not mistake a command for a different kind of entry for a saved rating', async () => {
    const { service, journal } = await openService();
    const note = { clientEventId: clientEventId('n1'), event: { type: 'project-contribution.set', projectId: PROJECT_A_ID, contributesToGeneral: true } } as const;
    assert.equal(snapshotHasCommand(await service.snapshot(null), note), false);
    await journal.close();
  });
});

describe('just rated', () => {
  it('lists newest first, replaces a repeat, and stays short', () => {
    let list = pushRecent([], { key: 'a', label: 'A', value: 4 });
    list = pushRecent(list, { key: 'b', label: 'B', value: 5 });
    assert.deepEqual(list.map((entry) => entry.key), ['b', 'a']);
    list = pushRecent(list, { key: 'a', label: 'A', value: 2 });
    assert.deepEqual(list.map((entry) => [entry.key, entry.value]), [['a', 2], ['b', 5]]);
    for (const key of 'cdefghij') list = pushRecent(list, { key, label: key, value: 3 });
    assert.equal(list.length, 6);
    assert.equal(list[0]?.key, 'j');
  });
});
