import { describe, expect, it } from 'vitest';
import { TOOL_IDS, checkRunSubmission, type ToolId } from '../../core';
import { WORKBENCH_EXAMPLES } from '../fixtures/examples';
import type { ImportedValue } from '../imports';
import { REQUIRED_KEYS, buildInput, defaultAsOf, emptyForm, formFromInput, isAsOfDateTime, nativeWarnings, type ToolFields, type ToolForm } from '../inputs';

const NOW = new Date('2026-10-20T09:30:15.250Z');
const file = (value: unknown, name = 'input.json'): ImportedValue => ({ value, origin: { kind: 'file', name, bytes: 100 } });

function form<T extends ToolId>(tool: T, fields: Partial<ToolFields[T]>): ToolForm<T> {
  const empty = emptyForm(tool, NOW);
  return { ...empty, fields: { ...empty.fields, ...fields } } as ToolForm<T>;
}

/** Key order matters to a reader comparing with the worker, so compare serialized objects too. */
function expectExact(actual: Record<string, unknown>, expected: Record<string, unknown>) {
  expect(actual).toStrictEqual(expected);
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
}

describe('form and import builders produce the exact native input', () => {
  it('Writing studio: notes, format, audience and intent; blanks omitted for native defaults', () => {
    const full = buildInput(form('x-studio', { notes: 'Cupping hour notes', format: 'thread', audience: 'Tea clubs', intent: 'Invite questions' }));
    expect(full.problems).toEqual([]);
    expectExact(full.input, { notes: 'Cupping hour notes', format: 'thread', audience: 'Tea clubs', intent: 'Invite questions' });
    expectExact(buildInput(form('x-studio', { notes: 'Only notes', audience: '  ' })).input, { notes: 'Only notes', format: 'short_post' });
    expect(buildInput(form('x-studio', { notes: ' ' })).problems).toEqual([{ field: 'notes', message: 'Add your rough notes.' }]);
  });

  it('Channel preview: caption with the fixed text format', () => {
    expectExact(buildInput(form('social-publisher', { caption: 'Three steeping times.' })).input, { caption: 'Three steeping times.', format: 'text' });
    expect(buildInput(form('social-publisher', { caption: '' })).problems[0]?.field).toBe('caption');
    // 30,000 code points pass; one more fails. Astral characters count once, as Python len() does.
    expect(buildInput(form('social-publisher', { caption: '🍵'.repeat(30_000) })).problems).toEqual([]);
    expect(buildInput(form('social-publisher', { caption: '🍵'.repeat(30_001) })).problems[0]?.message).toBe('Use at most 30,000 characters.');
  });

  it('Signal inbox: topic, normalized terms and items from a feed file plus typed rows', () => {
    const feed = file({ version: 'https://jsonfeed.org/version/1.1', items: [{ id: 'feed-1', content_html: '<p>Imported</p>', tags: ['tea'] }] }, 'feed.json');
    const built = buildInput(form('x-intelligence', {
      topic: 'Neighborhood tea', terms: [' oolong ', 'steeping', 'oolong', ''], feed,
      rows: [{ id: 'row-1', title: '', content_text: 'Typed text', url: 'https://example.invalid/a' }],
    }));
    expect(built.problems).toEqual([]);
    expectExact(built.input, {
      topic: 'Neighborhood tea', terms: ['oolong', 'steeping'],
      items: [{ id: 'feed-1', content_html: '<p>Imported</p>', tags: ['tea'] }, { id: 'row-1', content_text: 'Typed text', url: 'https://example.invalid/a' }],
    });
    const fields = buildInput(form('x-intelligence', { topic: '', rows: [{ id: '', title: '', content_text: '', url: '' }] })).problems.map((problem) => problem.field);
    expect(fields).toEqual(['topic', 'terms', 'rows.0.id', 'rows.0.content_text']);
    expect(buildInput(form('x-intelligence', { topic: 't', terms: ['a'] })).problems).toEqual([{ field: 'rows', message: 'Add at least one item, or import a JSON Feed file.' }]);
    expect(buildInput(form('x-intelligence', { topic: 't', terms: ['a'], feed: file({ entries: [] }) })).problems[0]?.message).toMatch(/not a JSON Feed/u);
  });

  it('TikTok signals: niche, as_of and 1–20 manifest/records batches, passed through unchanged', () => {
    const niche = { name: 'Fictional niche', anything: { nested: [1, 2] } };
    const built = buildInput(form('tiktok-intelligence', {
      niche: file(niche), asOf: '2026-10-01T12:00:00Z',
      batches: [{ manifest: file({ batch_id: 'b1', files: ['ignored by worker'] }), records: file([{ post: 1 }]) }, { manifest: file({ batch_id: 'b2' }), records: file({ shape: 'any JSON' }) }],
    }));
    expect(built.problems).toEqual([]);
    expectExact(built.input, {
      niche, as_of: '2026-10-01T12:00:00Z',
      batches: [{ manifest: { batch_id: 'b1', files: ['ignored by worker'] }, records: [{ post: 1 }] }, { manifest: { batch_id: 'b2' }, records: { shape: 'any JSON' } }],
    });
    const many = Array.from({ length: 21 }, () => ({ manifest: file({}), records: file([]) }));
    expect(buildInput(form('tiktok-intelligence', { niche: file({}), batches: many })).problems.map((problem) => problem.message)).toContain('Supply 1–20 snapshot batches.');
    const missing = buildInput(form('tiktok-intelligence', { niche: file([]), asOf: 'yesterday', batches: [{ manifest: null, records: null }] })).problems.map((problem) => problem.field);
    expect(missing).toEqual(['niche', 'asOf', 'batches.0.manifest', 'batches.0.records']);
  });

  it('SEO workbench: config, packets flattened from files, and a date as_of', () => {
    const built = buildInput(form('seo-studio', {
      config: file({ site: 'example.invalid' }), packets: [file([{ slug: 'a' }, { slug: 'b' }]), file({ slug: 'c' })], asOf: '2026-10-01',
    }));
    expect(built.problems).toEqual([]);
    expectExact(built.input, { config: { site: 'example.invalid' }, packets: [{ slug: 'a' }, { slug: 'b' }, { slug: 'c' }], as_of: '2026-10-01' });
    const fields = buildInput(form('seo-studio', { config: null, packets: [file(['not a packet'])], asOf: '2026-10-01T00:00:00Z' })).problems.map((problem) => problem.field);
    expect(fields).toEqual(['config', 'packets', 'asOf']);
  });

  it('Search visibility: panel, entities, inventory and answer rows', () => {
    const built = buildInput(form('search-visibility', {
      panel: file({ name: 'p' }), entities: file([{ name: 'e' }]), inventory: file({ pages: [] }), answers: file([{ query: 'q' }, { query: 'r' }], 'batch.jsonl'),
    }));
    expect(built.problems).toEqual([]);
    expectExact(built.input, { panel: { name: 'p' }, entities: [{ name: 'e' }], inventory: { pages: [] }, answers: [{ query: 'q' }, { query: 'r' }] });
    expect(buildInput(form('search-visibility', { panel: file({}), entities: file([]), inventory: file([]), answers: file({ not: 'rows' }) })).problems[0]?.field).toBe('answers');
  });

  it('Reddit opportunities: bundle and as_of', () => {
    const built = buildInput(form('reddit-opportunities', { bundle: file({ posts: [] }), asOf: '2026-10-01T12:00:00+02:00' }));
    expect(built.problems).toEqual([]);
    expectExact(built.input, { bundle: { posts: [] }, as_of: '2026-10-01T12:00:00+02:00' });
  });

  it('Creator fit: batch with account_id, topic chips, optional brand topics and as_of', () => {
    const batch = { account_id: 'acct', creators: [{ handle: 'c' }] };
    expectExact(buildInput(form('creator-relationships', { batch: file(batch), nicheTopics: ['tea', ' tea ', 'mornings'], brandTopics: ['tea'], asOf: '2026-10-01T12:00:00Z' })).input,
      { batch, niche_topics: ['tea', 'mornings'], brand_topics: ['tea'], as_of: '2026-10-01T12:00:00Z' });
    expectExact(buildInput(form('creator-relationships', { batch: file(batch), nicheTopics: ['tea'], asOf: '2026-10-01T12:00:00Z' })).input,
      { batch, niche_topics: ['tea'], as_of: '2026-10-01T12:00:00Z' });
    const problems = buildInput(form('creator-relationships', { batch: file({ creators: [] }) })).problems;
    expect(problems.map((problem) => problem.message)).toEqual(['The creator batch needs a text "account_id".', 'Add at least one niche topic.']);
  });
});

describe('examples, Advanced JSON and pass-through', () => {
  it.each(TOOL_IDS)('%s: a loaded example fills the form and rebuilds the identical, submittable input', (tool) => {
    const example = WORKBENCH_EXAMPLES[tool];
    const filled = formFromInput(tool, example, { kind: 'example' }, NOW);
    expect(filled.ok).toBe(true);
    if (!filled.ok) return;
    const built = buildInput(filled.form);
    expect(built.problems).toEqual([]);
    expect(built.input).toStrictEqual(example);
    expect(checkRunSubmission(tool, built.input, true).ok).toBe(true);
    expect(nativeWarnings(tool, example, NOW)).toEqual([]);
  });

  it('keeps top-level keys the form has no field for', () => {
    const filled = formFromInput('x-studio', { notes: 'n', future_option: { on: true } }, { kind: 'json' }, NOW);
    expect(filled.ok && buildInput(filled.form).input).toStrictEqual({ notes: 'n', format: 'short_post', future_option: { on: true } });
  });

  it('refuses to show a form for values it cannot represent, so nothing is silently changed', () => {
    expect(formFromInput('x-studio', { notes: 42 }, { kind: 'json' }, NOW)).toEqual({ ok: false, message: 'The form can\'t show this input: "notes" must be text. Keep editing it in Advanced JSON.' });
    expect(formFromInput('social-publisher', { caption: 'c', format: 'video' }, { kind: 'json' }, NOW).ok).toBe(false);
    expect(formFromInput('tiktok-intelligence', { batches: [{ manifest: {}, records: [], extra: 1 }] }, { kind: 'json' }, NOW).ok).toBe(false);
  });

  it('typed Signal inbox items stay rows; richer feed items stay an imported list', () => {
    const rich = formFromInput('x-intelligence', { topic: 't', terms: ['a'], items: [{ id: '1', content_html: '<p>x</p>' }] }, { kind: 'json' }, NOW);
    expect(rich.ok && rich.form.tool === 'x-intelligence' && rich.form.fields.feed?.value).toEqual([{ id: '1', content_html: '<p>x</p>' }]);
    expect(rich.ok && buildInput(rich.form).input.items).toEqual([{ id: '1', content_html: '<p>x</p>' }]);
  });

  it.each(TOOL_IDS)('%s: Advanced JSON warns about every key the worker reads without a default', (tool) => {
    const messages = nativeWarnings(tool, {}, NOW).map((warning) => warning.message);
    for (const key of REQUIRED_KEYS[tool]) expect(messages).toContain(`Missing "${key}": the tool reads it and the run would fail.`);
  });

  it('defaults and validates as_of the way the delivered examples write it', () => {
    expect(defaultAsOf(NOW)).toBe('2026-10-20T09:30:15Z');
    expect(emptyForm('seo-studio', NOW).fields.asOf).toBe('2026-10-20');
    for (const ok of ['2026-09-23T15:00:00Z', '2026-10-01T12:00Z', '2026-10-01T12:00:00.5+05:30']) expect(isAsOfDateTime(ok)).toBe(true);
    for (const bad of ['2026-10-01', '2026-02-30T12:00:00Z', '2026-10-01T24:00:00Z', '2026-10-01 12:00:00Z']) expect(isAsOfDateTime(bad)).toBe(false);
  });
});
