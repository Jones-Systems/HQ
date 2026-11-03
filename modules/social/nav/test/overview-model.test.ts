import { describe, expect, it } from 'vitest';
import { FIXTURE_IDS, draftFields, isActiveRun, type Draft, type DraftEditor, type WorkspaceSnapshot } from '../../core';
import { createWorkbenchFixture } from '../../workbench/fixtures/examples';
import {
  ATTENTION_LIMIT, LIST_LIMIT, attentionItems, dateParts, nextUp, plannedLabel, relativeDay, unsavedLabel, whenLabel,
} from '../overview-model';

async function snapshot(): Promise<WorkspaceSnapshot> {
  return createWorkbenchFixture({ clock: () => new Date('2026-10-20T12:00:00Z') }).port.snapshot();
}

const draftOn = (base: Draft, id: string, planned: string, extra: Partial<Draft> = {}): Draft => ({ ...base, id, title: `Draft ${id}`, planned_date: planned, archived: 0, ...extra });
const editorOf = (draft: Draft, extra: Partial<DraftEditor> = {}, edits: Partial<Draft> = {}): DraftEditor => ({ base: draft, fields: { ...draftFields(draft), ...edits }, status: 'editing', ...extra });

describe('dates', () => {
  it('names the weekday, day and month of a planned date without time zones', () => {
    expect(dateParts('2026-10-24')).toStrictEqual({ weekday: 'Sat', day: 24, month: 'Oct' });
    expect(dateParts('2026-01-01')).toStrictEqual({ weekday: 'Thu', day: 1, month: 'Jan' });
  });

  it('adds the year only when it is not this year', () => {
    expect(plannedLabel('2026-10-24', '2026-10-20')).toBe('Sat 24 Oct');
    expect(plannedLabel('2027-01-02', '2026-10-20')).toBe('Sat 2 Jan 2027');
  });

  it('says how far a day is, in words', () => {
    expect(relativeDay('2026-10-20', '2026-10-20')).toBe('Today');
    expect(relativeDay('2026-10-21', '2026-10-20')).toBe('Tomorrow');
    expect(relativeDay('2026-10-19', '2026-10-20')).toBe('Yesterday');
    expect(relativeDay('2026-10-24', '2026-10-20')).toBe('in 4 days');
    expect(relativeDay('2026-10-14', '2026-10-20')).toBe('6 days ago');
    // Across a month and a year boundary.
    expect(relativeDay('2027-01-01', '2026-12-30')).toBe('in 2 days');
  });

  it('shortens a time to the time today, Yesterday, or a date', () => {
    const now = new Date(2026, 9, 20, 15, 0);
    expect(whenLabel(new Date(2026, 9, 20, 9, 5).toISOString(), now)).toMatch(/9:05/u);
    expect(whenLabel(new Date(2026, 9, 19, 9, 5).toISOString(), now)).toBe('Yesterday');
    expect(whenLabel(new Date(2026, 9, 3, 9, 5).toISOString(), now)).toMatch(/Oct/u);
    expect(whenLabel(new Date(2025, 9, 3, 9, 5).toISOString(), now)).toMatch(/2025/u);
    expect(whenLabel('not a date', now)).toBe('not a date');
  });
});

describe('nextUp', () => {
  it('lists planned drafts from today on, in date order, skipping archived and unplanned ones', async () => {
    const base = (await snapshot()).content[0]!;
    const drafts = [
      draftOn(base, 'later', '2026-11-02'), draftOn(base, 'soon', '2026-10-22'), draftOn(base, 'today', '2026-10-20'),
      draftOn(base, 'past', '2026-10-01'), draftOn(base, 'none', ''), draftOn(base, 'gone', '2026-10-21', { archived: 1 }),
    ];
    const result = nextUp(drafts, null, '2026-10-20');
    expect(result.past).toBe(false);
    expect(result.drafts.map((draft) => draft.id)).toStrictEqual(['today', 'soon', 'later']);
  });

  it('falls back to the nearest past dates, newest first, and says so', async () => {
    const base = (await snapshot()).content[0]!;
    const drafts = [draftOn(base, 'old', '2026-09-01'), draftOn(base, 'recent', '2026-10-10'), draftOn(base, 'mid', '2026-09-20')];
    const result = nextUp(drafts, null, '2026-10-20');
    expect(result.past).toBe(true);
    expect(result.drafts.map((draft) => draft.id)).toStrictEqual(['recent', 'mid', 'old']);
    expect(nextUp([], null, '2026-10-20')).toStrictEqual({ drafts: [], past: true });
  });

  it('limits the list, scopes it to the selected brand, and breaks date ties by title', async () => {
    const base = (await snapshot()).content[0]!;
    const many = Array.from({ length: LIST_LIMIT + 3 }, (_, index) => draftOn(base, `d${index}`, `2026-11-${String(index + 1).padStart(2, '0')}`));
    expect(nextUp(many, null, '2026-10-20').drafts).toHaveLength(LIST_LIMIT);
    const other = [draftOn(base, 'mine', '2026-11-01', { brand_id: FIXTURE_IDS.larkspur }), draftOn(base, 'theirs', '2026-11-01', { brand_id: FIXTURE_IDS.harbor })];
    expect(nextUp(other, FIXTURE_IDS.harbor, '2026-10-20').drafts.map((draft) => draft.id)).toStrictEqual(['theirs']);
    const tie = [draftOn(base, 'b', '2026-11-01', { title: 'Beta' }), draftOn(base, 'a', '2026-11-01', { title: 'Alpha' })];
    expect(nextUp(tie, null, '2026-10-20').drafts.map((draft) => draft.title)).toStrictEqual(['Alpha', 'Beta']);
  });
});

describe('attentionItems', () => {
  it('orders unsaved drafts before failed, interrupted and unknown runs, and leaves a calendar move out', async () => {
    const snap = await snapshot();
    const base = snap.content[0]!;
    const editors: Record<string, DraftEditor> = {
      [base.id]: editorOf(base, {}, { title: 'Edited title' }),
      'change:internal': editorOf(base, {}, { title: 'Moved' }),
      clean: editorOf(base),
    };
    const items = attentionItems(snap, editors, null, false);
    expect(items.map((item) => item.kind)).toStrictEqual(['unsaved', 'failed', 'interrupted']);
    expect(items[0]).toMatchObject({ kind: 'unsaved', key: base.id, save: 'unsaved' });
    expect(items.length).toBeLessThanOrEqual(ATTENTION_LIMIT);
  });

  it('treats runs still queued or running as unknown only when the service cannot be reached', async () => {
    const snap = await snapshot();
    const active = { ...snap.runs[0]!, id: 'active-run', status: 'running' as const, finished_at: null };
    const withActive: WorkspaceSnapshot = { ...snap, runs: [active, ...snap.runs] };
    expect(attentionItems(withActive, {}, null, false).some((item) => item.kind === 'unknown')).toBe(false);
    const offline = attentionItems(withActive, {}, null, true);
    const unknown = offline.flatMap((item) => (item.kind === 'unknown' ? [item.run.id] : []));
    expect(unknown).toContain('active-run');
    expect(unknown).toStrictEqual(withActive.runs.filter(isActiveRun).map((run) => run.id));
    expect(offline.map((item) => item.kind).at(-1)).toBe('unknown');
  });

  it('scopes unsaved drafts to the selected brand', async () => {
    const snap = await snapshot();
    const base = snap.content[0]!;
    const editors = { a: editorOf(base, {}, { brand_id: FIXTURE_IDS.larkspur, title: 'Mine' }), b: editorOf(base, {}, { brand_id: FIXTURE_IDS.harbor, title: 'Theirs' }) };
    const unsaved = (brand: string | null) => attentionItems({ ...snap, runs: [] }, editors, brand, false).map((item) => (item.kind === 'unsaved' ? item.key : ''));
    expect(unsaved(null)).toStrictEqual(['a', 'b']);
    expect(unsaved(FIXTURE_IDS.larkspur)).toStrictEqual(['a']);
    expect(unsaved(FIXTURE_IDS.harbor)).toStrictEqual(['b']);
  });
});

describe('unsavedLabel', () => {
  it('says plainly what happened to the text and that it is kept', async () => {
    const base = (await snapshot()).content[0]!;
    const edited = editorOf(base, {}, { title: 'Edited' });
    expect(unsavedLabel(edited, 'unsaved')).toMatchObject({ tone: 'warning', label: 'Unsaved changes' });
    expect(unsavedLabel({ ...edited, status: 'saving' }, 'saving')).toMatchObject({ tone: 'info', label: 'Saving' });
    expect(unsavedLabel({ ...edited, status: 'error' }, 'failed')).toMatchObject({ tone: 'danger', label: 'Not saved', meta: 'Your text is kept in this session' });
    expect(unsavedLabel({ ...edited, status: 'error' }, 'unknown')).toMatchObject({ tone: 'unknown', label: 'Save result unknown' });
    expect(unsavedLabel({ ...edited, status: 'conflict' }, 'failed')).toMatchObject({ tone: 'warning', label: 'Changed elsewhere' });
  });
});
