import { describe, expect, it } from 'vitest';
import { MAX_ID_LENGTH, MAX_LABEL_LENGTH, clientEventId, isIdentifier, projectId, subjectId, type AppendResult } from '../../src/contract.ts';
import {
  DRAG_THRESHOLD, choiceDirection, choiceForKey, choiceText, classifyAppend, deckImageUrl, deckLabel, deckOrigin,
  deckSubject, deckSubjectId, dragIntent, exitOffset, prepareRating, pushRecent, scaleFocusTarget, snapshotHasCommand,
} from '../../src/ui/deck-model.ts';
import type { TasteQueueItem } from '../../src/ui/queue-context.ts';
import { GENERAL, PROJECT_A, openService } from '../helpers.ts';

function sequentialIds() {
  let next = 0;
  return () => `deck-${(next += 1)}`;
}

const PROJECT_A_ID = projectId('project-a');
const ITEM: TasteQueueItem = { id: 'pricing', kind: 'reference', label: 'Larkspur pricing', from: 'references' };

describe('deck keys', () => {
  it('maps arrows and numbers to the rating the legend promises', () => {
    expect(choiceForKey({ key: 'ArrowLeft' })).toEqual({ kind: 'rate', value: 2 });
    expect(choiceForKey({ key: 'ArrowRight' })).toEqual({ kind: 'rate', value: 4 });
    expect(choiceForKey({ key: 'ArrowUp' })).toEqual({ kind: 'rate', value: 5 });
    expect(choiceForKey({ key: 'ArrowDown' })).toEqual({ kind: 'skip' });
    expect(choiceForKey({ key: 's' })).toEqual({ kind: 'skip' });
    expect(choiceForKey({ key: 'S' })).toEqual({ kind: 'skip' });
    for (const value of [1, 2, 3, 4, 5] as const) expect(choiceForKey({ key: String(value) })).toEqual({ kind: 'rate', value });
  });

  it('leaves other keys and chorded keys alone', () => {
    expect(choiceForKey({ key: 'Enter' })).toBe(null);
    expect(choiceForKey({ key: '0' })).toBe(null);
    expect(choiceForKey({ key: '6' })).toBe(null);
    expect(choiceForKey({ key: 'ArrowRight', metaKey: true })).toBe(null);
    expect(choiceForKey({ key: '4', ctrlKey: true })).toBe(null);
    expect(choiceForKey({ key: 's', altKey: true })).toBe(null);
  });

  it('words a choice the way the stamp and legend do', () => {
    expect(choiceText({ kind: 'rate', value: 4 })).toBe('Like · 4');
    expect(choiceText({ kind: 'rate', value: 2 })).toBe('Not for me · 2');
    expect(choiceText({ kind: 'rate', value: 5 })).toBe('Love · 5');
    expect(choiceText({ kind: 'skip' })).toBe('Skip');
    expect(choiceDirection({ kind: 'rate', value: 2 })).toBe('left');
    expect(choiceDirection({ kind: 'rate', value: 4 })).toBe('right');
    expect(choiceDirection({ kind: 'rate', value: 5 })).toBe('up');
    expect(choiceDirection({ kind: 'skip' })).toBe('down');
  });
});

describe('deck drag', () => {
  it('reads left as 2, right as 4 and up as 5 once past the threshold', () => {
    expect(dragIntent(-DRAG_THRESHOLD, 0).choice).toEqual({ kind: 'rate', value: 2 });
    expect(dragIntent(DRAG_THRESHOLD, 4).choice).toEqual({ kind: 'rate', value: 4 });
    expect(dragIntent(2, -DRAG_THRESHOLD).choice).toEqual({ kind: 'rate', value: 5 });
    expect(dragIntent(DRAG_THRESHOLD, 0).armed).toBe(true);
    expect(dragIntent(DRAG_THRESHOLD - 1, 0).armed).toBe(false);
  });

  it('ramps the stamp with distance and ignores small or downward drags', () => {
    expect(dragIntent(4, 3).choice).toBe(null);
    expect(dragIntent(0, 140).choice).toBe(null);
    expect(dragIntent(DRAG_THRESHOLD / 2, 0).progress).toBe(0.5);
    expect(dragIntent(DRAG_THRESHOLD * 3, 0).progress).toBe(1);
    // A drag that is mostly vertical is judged on the vertical axis.
    expect(dragIntent(60, -90).choice).toEqual({ kind: 'rate', value: 5 });
    expect(dragIntent(90, -60).choice).toEqual({ kind: 'rate', value: 4 });
  });

  it('throws a card further in the direction it was thrown', () => {
    expect(exitOffset('left', { dx: -100, dy: 0 }).dx < -100).toBeTruthy();
    expect(exitOffset('right', { dx: 100, dy: 0 }).dx > 100).toBeTruthy();
    expect(exitOffset('up', { dx: 0, dy: -100 }).dy < -100).toBeTruthy();
    expect(exitOffset('down', { dx: 0, dy: 0 }).dy > 0).toBeTruthy();
  });
});

describe('rating row keys', () => {
  it('moves focus along the row, wrapping, and never picks a value', () => {
    expect(scaleFocusTarget('ArrowRight', 0, 5)).toBe(1);
    expect(scaleFocusTarget('ArrowRight', 4, 5)).toBe(0);
    expect(scaleFocusTarget('ArrowLeft', 0, 5)).toBe(4);
    expect(scaleFocusTarget('ArrowDown', 2, 5)).toBe(3);
    expect(scaleFocusTarget('ArrowUp', 2, 5)).toBe(1);
    expect(scaleFocusTarget('Home', 3, 5)).toBe(0);
    expect(scaleFocusTarget('End', 1, 5)).toBe(4);
    expect(scaleFocusTarget(' ', 1, 5)).toBe(null);
    expect(scaleFocusTarget('Enter', 1, 5)).toBe(null);
    expect(scaleFocusTarget('3', 1, 5)).toBe(null);
  });
});

describe('deck subjects', () => {
  it('derives a valid, stable id from kind and id', () => {
    const id = deckSubjectId('reference', 'pricing');
    expect(id).toBe('reference:pricing');
    expect(deckSubjectId('reference', 'pricing')).toBe(id);
    expect(subjectId(id)).toBe(id);
    expect(deckSubject(ITEM)).toEqual({ id: subjectId('reference:pricing'), kind: 'reference', label: 'Larkspur pricing' });
  });

  it('keeps the same id under different kinds apart', () => {
    const ids = (['reference', 'component', 'flow', 'other'] as const).map((kind) => deckSubjectId(kind, 'shared-id'));
    expect(new Set(ids).size).toBe(4);
  });

  it('always yields something subjectId accepts, however awkward the source id', () => {
    const awkward = [
      ' leading', 'trailing ', 'tab\there', 'line\nbreak', 'nul\u0000byte', 'del\u007f', ' nbsp', 'a b', 'emoji 🙂 id',
      '100%', '%41', 'A', 'tilde~tail', 'x'.repeat(500), '🙂'.repeat(200), 'lone\ud800surrogate', '',
    ];
    for (const raw of awkward) {
      const id = deckSubjectId('component', raw);
      expect(isIdentifier(id), `invalid id for ${JSON.stringify(raw)}: ${JSON.stringify(id)}`).toBeTruthy();
      expect(id.length <= MAX_ID_LENGTH).toBeTruthy();
      expect(subjectId(id)).toBe(id);
    }
  });

  it('does not collide when escaping or shortening', () => {
    // An id that already looks like an escape never equals the id it would be read as.
    expect(deckSubjectId('flow', '%41')).not.toBe(deckSubjectId('flow', 'A'));
    expect(deckSubjectId('flow', 'a b')).not.toBe(deckSubjectId('flow', 'a%20b'));
    expect(deckSubjectId('flow', 'a~b')).not.toBe(deckSubjectId('flow', 'a%7eb'));
    // Long ids that share a long prefix stay distinct, and stay distinct from a short id that looks like their result.
    const a = deckSubjectId('reference', `${'p'.repeat(200)}a`);
    const b = deckSubjectId('reference', `${'p'.repeat(200)}b`);
    expect(a).not.toBe(b);
    expect(a.length <= MAX_ID_LENGTH && b.length <= MAX_ID_LENGTH).toBeTruthy();
    expect(deckSubjectId('reference', a)).not.toBe(a);
    // Never cuts through an escape or a surrogate pair.
    const cut = deckSubjectId('other', `${'x'.repeat(130)}\u0001\u0001\u0001\u0001\u0001\u0001\u0001\u0001\u0001\u0001`);
    expect(!/%[0-9a-f]?~/u.test(cut), cut).toBeTruthy();
    const pairs = deckSubjectId('other', '🙂'.repeat(120));
    expect(pairs.isWellFormed()).toBeTruthy();
  });

  it('keeps a label Taste accepts', () => {
    expect(deckLabel('  Pricing  ', 'id')).toBe('Pricing');
    expect(deckLabel('', 'fallback-id')).toBe('fallback-id');
    expect(deckLabel('  ', '')).toBe('Untitled');
    expect(deckLabel('line\nbreak', 'x')).toBe('line break');
    const long = deckLabel('w'.repeat(1000), 'x');
    expect(long.length).toBe(MAX_LABEL_LENGTH);
    expect(long.endsWith('…')).toBeTruthy();
    expect(deckLabel('🙂'.repeat(400), 'x').isWellFormed()).toBeTruthy();
  });

  it('names where an item came from', () => {
    expect(deckOrigin('references', () => 'References')).toBe('References');
    expect(deckOrigin('references')).toBe('References');
    expect(deckOrigin('design-discovery', () => '')).toBe('Design discovery');
    expect(deckOrigin('', undefined)).toBe('another view');
  });
});

describe('deck images', () => {
  const origin = 'http://127.0.0.1:5284';
  it('accepts data images and same-document addresses only', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(deckImageUrl(png, origin)).toBe(png);
    expect(deckImageUrl('/assets/a.png', origin)).toBe('/assets/a.png');
    expect(deckImageUrl('assets/a.png', origin)).toBe('assets/a.png');
    expect(deckImageUrl(`${origin}/a.png`, origin)).toBe(`${origin}/a.png`);
    expect(deckImageUrl(`blob:${origin}/3b1c`, origin)).toBe(`blob:${origin}/3b1c`);
  });

  it('refuses anything that would reach another origin or run code', () => {
    for (const url of ['https://example.com/a.png', '//example.com/a.png', 'http://127.0.0.1:9999/a.png', 'blob:https://example.com/x',
      'javascript:alert(1)', 'data:text/html,<script>1</script>', 'file:///etc/passwd', 'ftp://127.0.0.1/a.png', '', '   ', undefined]) {
      expect(deckImageUrl(url, origin), String(url)).toBe(null);
    }
  });
});

describe('deck outcomes', () => {
  const record = { seq: 1 } as never;
  it('counts only a confirmed append, or the same entry already there, as saved', () => {
    expect(classifyAppend({ status: 'appended', record })).toEqual({ kind: 'saved' });
    expect(classifyAppend({ status: 'duplicate', record })).toEqual({ kind: 'saved' });
  });

  it('treats a fault that may have written as unknown, never as failed', () => {
    for (const reason of ['write-failed', 'partial-write', 'sync-failed'] as const) {
      expect(classifyAppend({ status: 'fail-closed', reason })).toEqual({ kind: 'unknown' });
    }
  });

  it('reports a refusal in plain words and keeps it a failure', () => {
    const results: AppendResult[] = [
      { status: 'rejected', reason: 'stale-supersede' }, { status: 'conflict', existing: record },
      { status: 'fail-closed', reason: 'hash-mismatch' }, { status: 'closed' },
    ];
    for (const result of results) {
      const outcome = classifyAppend(result);
      expect(outcome.kind).toBe('failed');
      expect(outcome.kind === 'failed' && outcome.message.length > 0).toBeTruthy();
    }
    expect((classifyAppend({ status: 'rejected', reason: 'stale-supersede' }) as { message: string }).message).toMatch(/changed elsewhere/u);
  });
});

describe('deck ratings', () => {
  it('records an overall liking assessment for the item in the current scope', async () => {
    const { service, journal } = await openService();
    const subject = deckSubject(ITEM);
    const prepared = prepareRating(await service.snapshot(PROJECT_A_ID), PROJECT_A, subject, 4, sequentialIds());
    expect(prepared.kind).toBe('command');
    if (prepared.kind !== 'command') return;
    const event = prepared.command.event;
    expect(event.type).toBe('assessment.recorded');
    if (event.type !== 'assessment.recorded') return;
    expect(event.scope).toEqual(PROJECT_A);
    expect(event.subject).toEqual(subject);
    expect(event.judgment).toBe('liking');
    expect(event.target).toEqual({ kind: 'overall' });
    expect(event.value).toBe(4);
    expect(event.supersedes).toBe(null);
    expect(classifyAppend(await service.submit(prepared.command)).kind).toBe('saved');
    await journal.close();
  });

  it('supersedes an earlier rating, treats the same value as already saved, and reads the journal back', async () => {
    const { service, journal } = await openService();
    const subject = deckSubject(ITEM);
    const newId = sequentialIds();
    const first = prepareRating(await service.snapshot(null), GENERAL, subject, 2, newId);
    expect(first.kind).toBe('command');
    if (first.kind !== 'command') return;
    const before = await service.snapshot(null);
    expect(snapshotHasCommand(before, first.command)).toBe(false);
    await service.submit(first.command);
    const after = await service.snapshot(null);
    expect(snapshotHasCommand(after, first.command)).toBe(true);
    expect(prepareRating(after, GENERAL, subject, 2, newId)).toEqual({ kind: 'already-saved' });
    const second = prepareRating(after, GENERAL, subject, 5, newId);
    expect(second.kind).toBe('command');
    if (second.kind === 'command' && second.command.event.type === 'assessment.recorded') {
      const current = after.assessments.find((item) => item.supersededBy === null);
      expect(second.command.event.supersedes).toBe(current?.assessmentId);
    }
    await journal.close();
  });

  it('does not mistake a command for a different kind of entry for a saved rating', async () => {
    const { service, journal } = await openService();
    const note = { clientEventId: clientEventId('n1'), event: { type: 'project-contribution.set', projectId: PROJECT_A_ID, contributesToGeneral: true } } as const;
    expect(snapshotHasCommand(await service.snapshot(null), note)).toBe(false);
    await journal.close();
  });
});

describe('just rated', () => {
  it('lists newest first, replaces a repeat, and stays short', () => {
    let list = pushRecent([], { key: 'a', label: 'A', value: 4 });
    list = pushRecent(list, { key: 'b', label: 'B', value: 5 });
    expect(list.map((entry) => entry.key)).toEqual(['b', 'a']);
    list = pushRecent(list, { key: 'a', label: 'A', value: 2 });
    expect(list.map((entry) => [entry.key, entry.value])).toEqual([['a', 2], ['b', 5]]);
    for (const key of 'cdefghij') list = pushRecent(list, { key, label: key, value: 3 });
    expect(list.length).toBe(6);
    expect(list[0]?.key).toBe('j');
  });
});
