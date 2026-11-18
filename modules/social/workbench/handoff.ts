import { isJsonObject, type SocialSession, type ToolId } from '../core';
import { describeOrigin, parseJsonText, type ImportedValue } from './imports';
import {
  REQUIRED_KEYS, TIKTOK_BATCHES, buildInput, emptyForm, feedItems, formFromInput,
  type Problem, type SnapshotBatch, type ToolForm,
} from './inputs';
import { setDraft, toolDraft, workbenchView } from './state';

/**
 * Sources → workbench hand-off. The Sources page checks a file on this device, asks which workbench slots accept a
 * file of that shape, and *Open in <workbench>* loads the parsed file into that tool's form (the same draft the tool
 * page edits). Nothing is sent and nothing runs: a run still needs the explicit Run click on the tool page.
 *
 * The slot table below mirrors the import slots in `ToolForms.tsx` and the shapes `inputs.ts` accepts. A test fills
 * every slot and reads the value back through `buildInput`, so the table cannot drift from the forms.
 */

/** `input` is a whole native input object for the tool; every other slot is one import field on its form. */
export type HandoffSlot =
  | 'input' | 'feed' | 'niche' | 'manifest' | 'records' | 'config' | 'packets' | 'panel' | 'entities' | 'inventory' | 'answers' | 'bundle' | 'batch';

/** `jsonl` is JSON Lines read as a list of rows; only a slot that reads `json-or-jsonl` can take it. */
export type FileKind = 'json' | 'jsonl';

export interface HandoffTarget {
  readonly tool: ToolId;
  readonly slot: HandoffSlot;
  /** What the tool page calls this field. */
  readonly label: string;
}

/** `recognized`: the contents match something distinctive. `possible`: only the shape fits; HQ cannot tell the intent. */
export type FitStrength = 'recognized' | 'possible';

export interface HandoffFit extends HandoffTarget {
  readonly strength: FitStrength;
  /** Why this fits, in plain words, from the contents' shape only. */
  readonly reason: string;
}

interface Judgement { readonly strength: FitStrength; readonly reason: string }
type Judge = (value: unknown, kind: FileKind, now: Date) => Judgement | null;

const recognized = (reason: string): Judgement => ({ strength: 'recognized', reason });
const possible = (reason: string): Judgement => ({ strength: 'possible', reason });

function plural(count: number, one: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : `${one}s`}`;
}

const anyJson: Judge = (value) => possible(Array.isArray(value) ? `a list of ${plural(value.length, 'value')}` : 'any JSON');
const anyObject: Judge = (value) => (isJsonObject(value) ? possible('a JSON object') : null);

/** A complete native input: it holds every key the tool reads without a default, and the form can show it. */
function wholeInput(tool: ToolId): Judge {
  return (value, _kind, now) => {
    if (!isJsonObject(value)) return null;
    const keys = REQUIRED_KEYS[tool];
    if (!keys.every((key) => value[key] !== undefined)) return null;
    if (!formFromInput(tool, value, { kind: 'json' }, now).ok) return null;
    return recognized(`has the keys this tool reads: ${keys.join(', ')}`);
  };
}

/** Items the Signal inbox reads: a JSON Feed, or a list of objects that each carry a text `id`. */
const feedJudge: Judge = (value) => {
  const items = feedItems(value);
  if (!items || items.length === 0) return null;
  if (!items.every((item) => isJsonObject(item) && typeof item.id === 'string' && item.id !== '')) return null;
  const rowLike = items.some((item) => isJsonObject(item) && ('title' in item || 'content_text' in item || 'url' in item));
  const feed = isJsonObject(value);
  const reason = `${plural(items.length, 'item')} with a text id${feed ? ', in a JSON Feed' : ''}`;
  return feed || rowLike ? recognized(reason) : possible(reason);
};

const packetsJudge: Judge = (value) => {
  const values = Array.isArray(value) ? value : [value];
  return values.length > 0 && values.every(isJsonObject) ? possible(Array.isArray(value) ? `a list of ${plural(values.length, 'object')}` : 'a JSON object') : null;
};

const answersJudge: Judge = (value, kind) => {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (kind === 'jsonl') return recognized(`${plural(value.length, 'row')} of JSON Lines`);
  return possible(`a list of ${plural(value.length, 'value')}`);
};

const creatorBatchJudge: Judge = (value) => (isJsonObject(value) && typeof value.account_id === 'string' ? recognized('a JSON object with a text account_id') : null);

interface Slot extends HandoffTarget {
  /** Whether the tool page's field reads JSON Lines (`json-or-jsonl`) or only whole JSON. */
  readonly jsonl: boolean;
  readonly judge: Judge;
}

const slot = (tool: ToolId, id: HandoffSlot, label: string, judge: Judge, jsonl = false): Slot => ({ tool, slot: id, label, judge, jsonl });

/** In the order a tool is presented in the catalog (Discover, Create, Measure, Plan, Connect). */
const SLOTS: readonly Slot[] = [
  slot('x-intelligence', 'input', 'Whole input', wholeInput('x-intelligence')),
  slot('x-intelligence', 'feed', 'JSON Feed file', feedJudge),
  slot('tiktok-intelligence', 'input', 'Whole input', wholeInput('tiktok-intelligence')),
  slot('tiktok-intelligence', 'niche', 'Niche definition', anyObject),
  slot('tiktok-intelligence', 'manifest', 'Batch manifest', anyObject),
  slot('tiktok-intelligence', 'records', 'Batch records', anyJson),
  slot('reddit-opportunities', 'input', 'Whole input', wholeInput('reddit-opportunities')),
  slot('reddit-opportunities', 'bundle', 'Corpus bundle', anyObject),
  slot('creator-relationships', 'input', 'Whole input', wholeInput('creator-relationships')),
  slot('creator-relationships', 'batch', 'Creator batch', creatorBatchJudge),
  slot('x-studio', 'input', 'Whole input', wholeInput('x-studio')),
  slot('seo-studio', 'input', 'Whole input', wholeInput('seo-studio')),
  slot('seo-studio', 'config', 'Site configuration', anyObject),
  slot('seo-studio', 'packets', 'Article packets', packetsJudge),
  slot('search-visibility', 'input', 'Whole input', wholeInput('search-visibility')),
  slot('search-visibility', 'panel', 'Query panel', anyObject),
  slot('search-visibility', 'entities', 'Entities', anyJson),
  slot('search-visibility', 'inventory', 'Content inventory', anyJson),
  slot('search-visibility', 'answers', 'Answer observations', answersJudge, true),
  slot('social-publisher', 'input', 'Whole input', wholeInput('social-publisher')),
];

/** Every slot a file can be handed to, for tests and callers that list them. */
export const HANDOFF_TARGETS: readonly HandoffTarget[] = SLOTS.map(({ tool, slot: id, label }) => ({ tool, slot: id, label }));

/**
 * Every workbench slot that accepts a file of this shape, recognized fits first. `possible` fits are listed because
 * many tools read "a JSON object" or "a list" and the contents alone cannot say which one is meant; the user chooses.
 */
export function fitsOf(value: unknown, kind: FileKind, now: Date): readonly HandoffFit[] {
  const fits: HandoffFit[] = [];
  for (const candidate of SLOTS) {
    if (kind === 'jsonl' && !candidate.jsonl) continue;
    const judged = candidate.judge(value, kind, now);
    if (judged) fits.push({ tool: candidate.tool, slot: candidate.slot, label: candidate.label, ...judged });
  }
  return [...fits.filter((fit) => fit.strength === 'recognized'), ...fits.filter((fit) => fit.strength === 'possible')];
}

function hasValue(form: ToolForm, slotName: HandoffSlot): ImportedValue | null {
  switch (form.tool) {
    case 'x-intelligence': return slotName === 'feed' ? form.fields.feed : null;
    case 'tiktok-intelligence': return slotName === 'niche' ? form.fields.niche : null;
    case 'seo-studio': return slotName === 'config' ? form.fields.config : null;
    case 'search-visibility': return slotName === 'panel' || slotName === 'entities' || slotName === 'inventory' || slotName === 'answers' ? form.fields[slotName] : null;
    case 'reddit-opportunities': return slotName === 'bundle' ? form.fields.bundle : null;
    case 'creator-relationships': return slotName === 'batch' ? form.fields.batch : null;
    default: return null;
  }
}

/** Puts the file into one slot of a form, or returns null when the form has no such slot (or no room left). */
function fill(form: ToolForm, slotName: HandoffSlot, imported: ImportedValue): ToolForm | null {
  switch (form.tool) {
    case 'x-intelligence':
      return slotName === 'feed' ? { ...form, fields: { ...form.fields, feed: imported } } : null;
    case 'tiktok-intelligence': {
      if (slotName === 'niche') return { ...form, fields: { ...form.fields, niche: imported } };
      if (slotName !== 'manifest' && slotName !== 'records') return null;
      // Fill the first batch whose slot is empty; otherwise add a batch (the worker takes 1–20).
      const batches: SnapshotBatch[] = [...form.fields.batches];
      let at = batches.findIndex((batch) => batch[slotName] === null);
      if (at < 0) {
        if (batches.length >= TIKTOK_BATCHES.max) return null;
        batches.push({ manifest: null, records: null });
        at = batches.length - 1;
      }
      batches[at] = { ...batches[at]!, [slotName]: imported };
      return { ...form, fields: { ...form.fields, batches } };
    }
    case 'seo-studio':
      if (slotName === 'config') return { ...form, fields: { ...form.fields, config: imported } };
      return slotName === 'packets' ? { ...form, fields: { ...form.fields, packets: [...form.fields.packets, imported] } } : null;
    case 'search-visibility':
      return slotName === 'panel' || slotName === 'entities' || slotName === 'inventory' || slotName === 'answers'
        ? { ...form, fields: { ...form.fields, [slotName]: imported } } : null;
    case 'reddit-opportunities':
      return slotName === 'bundle' ? { ...form, fields: { ...form.fields, bundle: imported } } : null;
    case 'creator-relationships':
      return slotName === 'batch' ? { ...form, fields: { ...form.fields, batch: imported } } : null;
    default:
      return null;
  }
}

/** The form fields without the as-of default, which is "now" and so differs between two untouched forms. */
function withoutAsOf(form: ToolForm): string {
  const { asOf: _asOf, ...rest } = form.fields as Record<string, unknown>;
  return JSON.stringify([rest, form.extra]);
}

function formOf(session: SocialSession, tool: ToolId, now: Date): { ok: true; form: ToolForm } | { ok: false; reason: string } {
  const draft = toolDraft(workbenchView(session.getState()), tool, now);
  if (draft.mode === 'form') return { ok: true, form: draft.form };
  // The tool page is showing Advanced JSON: carry its text into the form the way switching tabs does.
  const parsed = parseJsonText(draft.json);
  const shown = parsed.ok && isJsonObject(parsed.value) ? formFromInput(tool, parsed.value, { kind: 'json' }, now) : null;
  if (shown?.ok) return { ok: true, form: shown.form };
  return { ok: false, reason: "The Advanced JSON on that tool page can't be shown as a form, so HQ left it alone. Fix it there first." };
}

/** What loading a file would overwrite, said before the click: a file already in that slot, or text already typed. */
export function previewHandoff(session: SocialSession, target: HandoffTarget, now: Date): { readonly replaces: string | null } {
  const current = formOf(session, target.tool, now);
  if (!current.ok) return { replaces: null };
  if (target.slot === 'input') {
    return { replaces: withoutAsOf(current.form) === withoutAsOf(emptyForm(target.tool, now)) ? null : 'what is already entered on that tool page' };
  }
  const existing = hasValue(current.form, target.slot);
  return { replaces: existing ? describeOrigin(existing) : null };
}

export type HandoffResult =
  | {
    readonly ok: true;
    readonly tool: ToolId;
    /** What the form still needs before a Run, in the tool page's own words. Empty when the form is complete. */
    readonly remaining: readonly Problem[];
  }
  | { readonly ok: false; readonly reason: string };

/**
 * Loads a checked file into a tool's form: the Social session's draft for that tool, which the tool page opens as it
 * is. It never calls the Social service and never starts a run. A whole-input file replaces the form; a slot file
 * fills (or replaces) that one field, leaving the rest of the page as the user left it.
 */
export function handOff(session: SocialSession, target: HandoffTarget, imported: ImportedValue, now: Date): HandoffResult {
  const current = formOf(session, target.tool, now);
  if (!current.ok) return current;
  let form: ToolForm | null;
  if (target.slot === 'input') {
    const input = imported.value;
    if (!isJsonObject(input)) return { ok: false, reason: 'That file is not a JSON object, so it cannot be a whole input.' };
    const filled = formFromInput(target.tool, input, imported.origin, now);
    if (!filled.ok) return { ok: false, reason: filled.message };
    form = filled.form;
  } else {
    form = fill(current.form, target.slot, imported);
  }
  if (!form) return { ok: false, reason: `${target.label} has no room for another file.` };
  const draft = toolDraft(workbenchView(session.getState()), target.tool, now);
  const { jsonNote: _note, exampleInput: _example, ...rest } = draft;
  // A loaded example would otherwise be submitted unchanged; the user's file is now part of the form.
  setDraft(session, target.tool, { ...rest, mode: 'form', form, example: draft.example === 'none' ? 'none' : 'edited', showProblems: false });
  return { ok: true, tool: target.tool, remaining: buildInput(form).problems };
}
