import { afterEach, describe, expect, it } from 'vitest';
import { resetSocialSessions, socialSession, type ToolId } from '../../core';
import { HANDOFF_TARGETS, fitsOf, handOff, previewHandoff, type HandoffSlot, type HandoffTarget } from '../handoff';
import type { ImportedValue } from '../imports';
import { buildInput, emptyForm } from '../inputs';
import { WORKBENCH_EXAMPLES } from '../fixtures/examples';
import { newDraft, setDraft, toolDraft, workbenchView, type ToolDraft } from '../state';

const NOW = new Date('2026-10-20T09:30:15.250Z');
const file = (value: unknown, name = 'input.json'): ImportedValue => ({ value, origin: { kind: 'file', name, bytes: 100 } });
const target = (tool: ToolId, slot: HandoffSlot): HandoffTarget => HANDOFF_TARGETS.find((item) => item.tool === tool && item.slot === slot)!;
const session = () => socialSession('handoff-test');
const draftOf = (tool: ToolId): ToolDraft => toolDraft(workbenchView(session().getState()), tool, NOW);

afterEach(() => resetSocialSessions());

const FEED = { version: 'https://jsonfeed.org/version/1.1', items: [{ id: 'a', title: 'A', content_text: 'Text', url: 'https://example.invalid/a' }, { id: 'b', title: 'B' }] };

describe('which workbench slots accept a file', () => {
  it('recognizes a JSON Feed for the Signal inbox, and says why', () => {
    const fits = fitsOf(FEED, 'json', NOW);
    const feed = fits.find((fit) => fit.tool === 'x-intelligence' && fit.slot === 'feed');
    expect(feed).toMatchObject({ strength: 'recognized', label: 'JSON Feed file', reason: '2 items with a text id, in a JSON Feed' });
    // It is also an object, so the generic object slots remain possible, listed after the recognized fit.
    expect(fits[0]).toBe(feed);
    expect(fits.filter((fit) => fit.strength === 'recognized')).toHaveLength(1);
  });

  it('recognizes signal rows, but only suggests a bare list of ids', () => {
    expect(fitsOf([{ id: 'a', title: 'A' }], 'json', NOW).find((fit) => fit.slot === 'feed')?.strength).toBe('recognized');
    expect(fitsOf([{ id: 'a', other: 1 }], 'json', NOW).find((fit) => fit.slot === 'feed')?.strength).toBe('possible');
    // An item without a text id fails the tool's own check, so it is not offered at all.
    expect(fitsOf([{ id: 1 }], 'json', NOW).find((fit) => fit.slot === 'feed')).toBeUndefined();
    expect(fitsOf({ items: [] }, 'json', NOW).find((fit) => fit.slot === 'feed')).toBeUndefined();
  });

  it('offers JSON Lines only to the slot that reads JSON Lines, because every other slot reads whole JSON', () => {
    const fits = fitsOf([{ q: 'a' }, { q: 'b' }], 'jsonl', NOW);
    expect(fits.map((fit) => `${fit.tool}:${fit.slot}:${fit.strength}`)).toStrictEqual(['search-visibility:answers:recognized']);
    expect(fitsOf([{ q: 'a' }], 'json', NOW).find((fit) => fit.slot === 'answers')?.strength).toBe('possible');
  });

  it('recognizes a creator batch by its text account_id, and a whole input by the keys its tool needs', () => {
    expect(fitsOf({ account_id: 'acct-1', creators: [] }, 'json', NOW)[0]).toMatchObject({ tool: 'creator-relationships', slot: 'batch', strength: 'recognized' });
    expect(fitsOf({ account_id: 1 }, 'json', NOW).find((fit) => fit.slot === 'batch')).toBeUndefined();
    const whole = fitsOf(WORKBENCH_EXAMPLES['reddit-opportunities'], 'json', NOW)[0]!;
    expect(whole).toMatchObject({ tool: 'reddit-opportunities', slot: 'input', strength: 'recognized' });
    expect(whole.reason).toBe('has the keys this tool reads: bundle, as_of');
    // Missing a required key: not a whole input.
    expect(fitsOf({ bundle: {} }, 'json', NOW).find((fit) => fit.slot === 'input')).toBeUndefined();
    // A key whose value the form cannot show is not recognized either.
    expect(fitsOf({ caption: 5 }, 'json', NOW).find((fit) => fit.slot === 'input')).toBeUndefined();
  });

  it('says nothing is recognized when only the shape fits, and offers nothing for a value no slot takes', () => {
    const fits = fitsOf({ anything: 1 }, 'json', NOW);
    expect(fits.length).toBeGreaterThan(3);
    expect(fits.every((fit) => fit.strength === 'possible')).toBe(true);
    expect(fitsOf('text', 'json', NOW).filter((fit) => fit.slot !== 'entities' && fit.slot !== 'inventory' && fit.slot !== 'records')).toStrictEqual([]);
  });
});

describe('loading a file into a workbench form', () => {
  it('fills every slot so the tool page builds the file back into its native input (the table cannot drift from the forms)', () => {
    const value = { marker: 'the file' };
    const rows = [{ id: 'row-1', content_text: 'Text' }];
    const read: Record<HandoffSlot, (input: Record<string, unknown>) => unknown> = {
      input: () => undefined,
      feed: (input) => input.items, niche: (input) => input.niche,
      manifest: (input) => (input.batches as { manifest: unknown }[])[0]!.manifest, records: (input) => (input.batches as { records: unknown }[])[0]!.records,
      config: (input) => input.config, packets: (input) => (input.packets as unknown[])[0],
      panel: (input) => input.panel, entities: (input) => input.entities, inventory: (input) => input.inventory, answers: (input) => input.answers,
      bundle: (input) => input.bundle, batch: (input) => input.batch,
    };
    for (const slot of HANDOFF_TARGETS.filter((item) => item.slot !== 'input')) {
      resetSocialSessions();
      const content = slot.slot === 'feed' ? rows : slot.slot === 'answers' ? [value] : value;
      const result = handOff(session(), slot, file(content), NOW);
      expect(result.ok, `${slot.tool}/${slot.slot}`).toBe(true);
      const built = buildInput(draftOf(slot.tool).form).input;
      const stored = read[slot.slot](built);
      expect(stored, `${slot.tool}/${slot.slot}`).toStrictEqual(content);
    }
  });

  it('loads a whole input into the form and reports what the page still needs, without running anything', () => {
    const result = handOff(session(), target('x-intelligence', 'input'), file({ topic: 'Neighborhood tea', terms: ['oolong'], items: [{ id: 'a', content_text: 'Text' }] }), NOW);
    expect(result).toStrictEqual({ ok: true, tool: 'x-intelligence', remaining: [] });
    const draft = draftOf('x-intelligence');
    expect(draft.mode).toBe('form');
    expect(buildInput(draft.form).input).toStrictEqual({ topic: 'Neighborhood tea', terms: ['oolong'], items: [{ id: 'a', content_text: 'Text' }] });

    const partial = handOff(session(), target('tiktok-intelligence', 'niche'), file({ name: 'Fictional niche' }, 'niche.json'), NOW);
    expect(partial.ok && partial.remaining.map((problem) => problem.field)).toStrictEqual(['batches.0.manifest', 'batches.0.records']);
  });

  it('turns a loaded example into an edited one, so the file is what runs, and keeps an untouched form untouched', () => {
    setDraft(session(), 'social-publisher', { ...newDraft('social-publisher', NOW), example: 'loaded', exampleInput: { caption: 'Example', format: 'text' } });
    const result = handOff(session(), target('social-publisher', 'input'), file({ caption: 'My caption' }), NOW);
    expect(result.ok).toBe(true);
    const draft = draftOf('social-publisher');
    expect(draft.example).toBe('edited');
    expect(draft.exampleInput).toBeUndefined();
    expect(buildInput(draft.form).input).toStrictEqual({ caption: 'My caption', format: 'text' });
    // A page that never loaded an example stays "none".
    handOff(session(), target('seo-studio', 'config'), file({ site: 'example.invalid' }), NOW);
    expect(draftOf('seo-studio').example).toBe('none');
  });

  it('fills the first empty batch slot, then adds a batch, and stops at twenty', () => {
    const tiktok = session();
    handOff(tiktok, target('tiktok-intelligence', 'manifest'), file({ batch: 1 }, 'm1.json'), NOW);
    handOff(tiktok, target('tiktok-intelligence', 'manifest'), file({ batch: 2 }, 'm2.json'), NOW);
    handOff(tiktok, target('tiktok-intelligence', 'records'), file([{ post: 1 }], 'r1.json'), NOW);
    const form = draftOf('tiktok-intelligence').form;
    expect(form.tool === 'tiktok-intelligence' && form.fields.batches.map((batch) => [batch.manifest?.value, batch.records?.value])).toStrictEqual([
      [{ batch: 1 }, [{ post: 1 }]], [{ batch: 2 }, undefined],
    ]);
    for (let index = 0; index < 30; index += 1) handOff(tiktok, target('tiktok-intelligence', 'manifest'), file({ index }), NOW);
    const full = draftOf('tiktok-intelligence').form;
    expect(full.tool === 'tiktok-intelligence' && full.fields.batches).toHaveLength(20);
    const refused = handOff(tiktok, target('tiktok-intelligence', 'manifest'), file({}), NOW);
    expect(refused).toStrictEqual({ ok: false, reason: 'Batch manifest has no room for another file.' });
  });

  it('appends article packets and replaces a single-file slot', () => {
    handOff(session(), target('seo-studio', 'packets'), file([{ slug: 'a' }], 'a.json'), NOW);
    handOff(session(), target('seo-studio', 'packets'), file({ slug: 'b' }, 'b.json'), NOW);
    expect(buildInput(draftOf('seo-studio').form).input.packets).toStrictEqual([{ slug: 'a' }, { slug: 'b' }]);
    handOff(session(), target('reddit-opportunities', 'bundle'), file({ posts: 1 }, 'one.json'), NOW);
    handOff(session(), target('reddit-opportunities', 'bundle'), file({ posts: 2 }, 'two.json'), NOW);
    expect(buildInput(draftOf('reddit-opportunities').form).input.bundle).toStrictEqual({ posts: 2 });
  });

  it('says what it would overwrite before it does', () => {
    expect(previewHandoff(session(), target('reddit-opportunities', 'bundle'), NOW).replaces).toBeNull();
    expect(previewHandoff(session(), target('x-studio', 'input'), NOW).replaces).toBeNull();
    handOff(session(), target('reddit-opportunities', 'bundle'), file({ posts: 1 }, 'one.json'), NOW);
    expect(previewHandoff(session(), target('reddit-opportunities', 'bundle'), NOW).replaces).toBe('one.json · 100 bytes');
    // Typing on the page counts: a whole input would replace it. A later as-of default alone does not.
    const typed = { ...draftOf('x-studio'), form: { ...emptyForm('x-studio', NOW), fields: { ...emptyForm('x-studio', NOW).fields, notes: 'My notes' } } as ToolDraft['form'] };
    setDraft(session(), 'x-studio', typed);
    expect(previewHandoff(session(), target('x-studio', 'input'), NOW).replaces).toBe('what is already entered on that tool page');
    setDraft(session(), 'creator-relationships', newDraft('creator-relationships', NOW));
    expect(previewHandoff(session(), target('creator-relationships', 'input'), new Date('2027-01-01T00:00:00Z')).replaces).toBeNull();
  });

  it('carries valid Advanced JSON into the form, and leaves invalid Advanced JSON alone', () => {
    setDraft(session(), 'reddit-opportunities', { ...newDraft('reddit-opportunities', NOW), mode: 'json', json: '{"bundle":{"posts":[]},"as_of":"2026-10-01T12:00:00Z"}' });
    const ok = handOff(session(), target('reddit-opportunities', 'bundle'), file({ posts: 3 }), NOW);
    expect(ok.ok).toBe(true);
    const draft = draftOf('reddit-opportunities');
    expect(draft.mode).toBe('form');
    expect(buildInput(draft.form).input).toStrictEqual({ bundle: { posts: 3 }, as_of: '2026-10-01T12:00:00Z' });

    const broken = { ...newDraft('x-studio', NOW), mode: 'json' as const, json: '{ not json' };
    setDraft(session(), 'x-studio', broken);
    const refused = handOff(session(), target('x-studio', 'input'), file({ notes: 'Mine' }), NOW);
    expect(refused).toStrictEqual({ ok: false, reason: "The Advanced JSON on that tool page can't be shown as a form, so HQ left it alone. Fix it there first." });
    expect(draftOf('x-studio')).toBe(broken);
  });

  it('refuses a whole input that is not an object the tool can show', () => {
    expect(handOff(session(), target('x-studio', 'input'), file([1, 2]), NOW)).toStrictEqual({ ok: false, reason: 'That file is not a JSON object, so it cannot be a whole input.' });
    const bad = handOff(session(), target('x-studio', 'input'), file({ notes: 5 }), NOW);
    expect(bad.ok).toBe(false);
  });
});
