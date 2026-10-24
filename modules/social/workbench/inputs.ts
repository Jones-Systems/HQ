import { codePoints, isJsonObject, isPlanningDate, type ToolId } from '../core';
import type { ImportedValue } from './imports';

/**
 * Form-first inputs for the eight workbenches (RR-2). Each builder produces the exact input object the
 * service's worker reads for that tool; see "Native input contracts" in
 * docs/evidence/hq-social-work/social-workbench/README.md. Nested imported documents (niche, manifests,
 * packets, panels, bundles, creator batches) are passed through unchanged: their inner shape is the native
 * tool's contract, and the native tool validates it.
 */

export const STUDIO_FORMATS = ['short_post', 'thread', 'article'] as const;
export type StudioFormat = (typeof STUDIO_FORMATS)[number];
export const STUDIO_FORMAT_LABELS: { readonly [F in StudioFormat]: string } = { short_post: 'Short post', thread: 'Thread', article: 'Article' };

/** The worker's caption ceiling for Channel preview, in characters (code points). */
export const MAX_CAPTION = 30_000;
/** The worker accepts 1–20 TikTok snapshot batches. */
export const TIKTOK_BATCHES = { min: 1, max: 20 } as const;

export interface SignalRow {
  readonly id: string;
  readonly title: string;
  readonly content_text: string;
  readonly url: string;
}

export interface SnapshotBatch {
  readonly manifest: ImportedValue | null;
  readonly records: ImportedValue | null;
}

export interface ToolFields {
  readonly 'x-studio': { readonly notes: string; readonly format: StudioFormat; readonly audience: string; readonly intent: string };
  readonly 'social-publisher': { readonly caption: string };
  readonly 'x-intelligence': { readonly topic: string; readonly terms: readonly string[]; readonly feed: ImportedValue | null; readonly rows: readonly SignalRow[] };
  readonly 'tiktok-intelligence': { readonly niche: ImportedValue | null; readonly asOf: string; readonly batches: readonly SnapshotBatch[] };
  readonly 'seo-studio': { readonly config: ImportedValue | null; readonly packets: readonly ImportedValue[]; readonly asOf: string };
  readonly 'search-visibility': { readonly panel: ImportedValue | null; readonly entities: ImportedValue | null; readonly inventory: ImportedValue | null; readonly answers: ImportedValue | null };
  readonly 'reddit-opportunities': { readonly bundle: ImportedValue | null; readonly asOf: string };
  readonly 'creator-relationships': { readonly batch: ImportedValue | null; readonly nicheTopics: readonly string[]; readonly brandTopics: readonly string[]; readonly asOf: string };
}

/** One tool's form. `extra` keeps top-level keys the form has no field for, so they are sent unchanged. */
export type ToolForm<T extends ToolId = ToolId> = { [K in T]: { readonly tool: K; readonly fields: ToolFields[K]; readonly extra: Readonly<Record<string, unknown>> } }[T];

export interface Problem {
  /** The form field the problem belongs to, used for its error text and focus. */
  readonly field: string;
  readonly message: string;
}

export interface BuiltInput {
  /** Built even when problems exist, so Advanced JSON can show the partial object. */
  readonly input: Record<string, unknown>;
  readonly problems: readonly Problem[];
}

export type FromInput<T extends ToolId = ToolId> = { readonly ok: true; readonly form: ToolForm<T> } | { readonly ok: false; readonly message: string };

const ISO_DATETIME = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,9})?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/u;

/** An ISO 8601 date-time with an explicit offset, the form the delivered examples use for `as_of`. */
export function isAsOfDateTime(value: string): boolean {
  const match = ISO_DATETIME.exec(value);
  return Boolean(match && isPlanningDate(match[1]!));
}

/** `as_of` default: now, to the second, in UTC. */
export function defaultAsOf(now: Date): string {
  return `${now.toISOString().slice(0, 19)}Z`;
}

export function normalizeTopics(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))];
}

function blank(value: string): boolean {
  return value.trim() === '';
}

function imported(value: unknown, origin: ImportedValue['origin']): ImportedValue {
  return { value, origin };
}

function present(slot: ImportedValue | null): unknown {
  return slot ? slot.value : null;
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** Items from an imported JSON Feed document, or from a bare list of items. */
export function feedItems(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (isJsonObject(value) && Array.isArray(value.items)) return value.items;
  return null;
}

function asOfProblem(field: string, value: string, kind: 'datetime' | 'date'): Problem | null {
  if (blank(value)) return { field, message: 'Add the as-of time the supplied data describes.' };
  if (kind === 'date' ? !isPlanningDate(value) : !isAsOfDateTime(value)) {
    return { field, message: kind === 'date' ? 'Use a YYYY-MM-DD as-of date.' : 'Use an ISO date and time with a zone, for example 2026-10-01T12:00:00Z.' };
  }
  return null;
}

function objectSlot(field: string, slot: ImportedValue | null, missing: string, notObject: string): Problem | null {
  if (!slot) return { field, message: missing };
  return isJsonObject(slot.value) ? null : { field, message: notObject };
}

function signalRowItem(row: SignalRow): Record<string, unknown> {
  return {
    id: row.id,
    ...(blank(row.title) ? {} : { title: row.title }),
    ...(blank(row.content_text) ? {} : { content_text: row.content_text }),
    ...(blank(row.url) ? {} : { url: row.url }),
  };
}

const SIGNAL_ROW_KEYS = ['id', 'title', 'content_text', 'url'] as const;

function asSignalRow(item: unknown): SignalRow | null {
  if (!isJsonObject(item) || typeof item.id !== 'string') return null;
  if (!Object.keys(item).every((key) => (SIGNAL_ROW_KEYS as readonly string[]).includes(key))) return null;
  if (!Object.values(item).every((value) => typeof value === 'string')) return null;
  return { id: item.id, title: (item.title as string | undefined) ?? '', content_text: (item.content_text as string | undefined) ?? '', url: (item.url as string | undefined) ?? '' };
}

/** Splits an input object into the keys a form shows and the keys it passes through. */
function split(input: Record<string, unknown>, known: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !known.includes(key)));
}

function cannot(key: string, expected: string): { ok: false; message: string } {
  return { ok: false, message: `The form can't show this input: "${key}" must be ${expected}. Keep editing it in Advanced JSON.` };
}

interface ToolInputSpec<T extends ToolId> {
  empty(now: Date): ToolFields[T];
  build(fields: ToolFields[T]): BuiltInput;
  fromInput(input: Record<string, unknown>, origin: ImportedValue['origin'], now: Date): { ok: true; fields: ToolFields[T]; known: readonly string[] } | { ok: false; message: string };
}

const SPECS: { readonly [T in ToolId]: ToolInputSpec<T> } = {
  'x-studio': {
    empty: () => ({ notes: '', format: 'short_post', audience: '', intent: '' }),
    build({ notes, format, audience, intent }) {
      const problems: Problem[] = [];
      if (blank(notes)) problems.push({ field: 'notes', message: 'Add your rough notes.' });
      // Blank audience and intent are omitted so the native defaults apply.
      return {
        input: { notes, format, ...(blank(audience) ? {} : { audience }), ...(blank(intent) ? {} : { intent }) },
        problems,
      };
    },
    fromInput(input) {
      for (const key of ['notes', 'audience', 'intent'] as const) {
        if (input[key] !== undefined && typeof input[key] !== 'string') return cannot(key, 'text');
      }
      const format = input.format ?? 'short_post';
      if (!(STUDIO_FORMATS as readonly unknown[]).includes(format)) return cannot('format', 'short_post, thread or article');
      return {
        ok: true, known: ['notes', 'format', 'audience', 'intent'],
        fields: { notes: (input.notes as string) ?? '', format: format as StudioFormat, audience: (input.audience as string) ?? '', intent: (input.intent as string) ?? '' },
      };
    },
  },
  'social-publisher': {
    empty: () => ({ caption: '' }),
    build({ caption }) {
      const problems: Problem[] = [];
      if (blank(caption)) problems.push({ field: 'caption', message: 'Add the text to check.' });
      else if (codePoints(caption) > MAX_CAPTION) problems.push({ field: 'caption', message: 'Use at most 30,000 characters.' });
      return { input: { caption, format: 'text' }, problems };
    },
    fromInput(input) {
      if (input.caption !== undefined && typeof input.caption !== 'string') return cannot('caption', 'text');
      if (input.format !== undefined && input.format !== 'text') return cannot('format', '"text" (this workbench checks text only)');
      return { ok: true, known: ['caption', 'format'], fields: { caption: (input.caption as string) ?? '' } };
    },
  },
  'x-intelligence': {
    empty: () => ({ topic: '', terms: [], feed: null, rows: [] }),
    build({ topic, terms, feed, rows }) {
      const problems: Problem[] = [];
      if (blank(topic)) problems.push({ field: 'topic', message: 'Name the topic.' });
      const cleanTerms = normalizeTopics(terms);
      if (cleanTerms.length === 0) problems.push({ field: 'terms', message: 'Add at least one matching term.' });
      const fromFeed = feed ? feedItems(feed.value) : [];
      if (feed && !fromFeed) problems.push({ field: 'feed', message: 'This file is not a JSON Feed: it needs an "items" list.' });
      (fromFeed ?? []).forEach((item, index) => {
        if (!isJsonObject(item) || typeof item.id !== 'string' || item.id === '') {
          problems.push({ field: 'feed', message: `Feed item ${index + 1} needs a text "id".` });
        }
      });
      rows.forEach((row, index) => {
        if (blank(row.id)) problems.push({ field: `rows.${index}.id`, message: `Item ${index + 1} needs an ID.` });
        if (blank(row.content_text) && blank(row.title)) problems.push({ field: `rows.${index}.content_text`, message: `Item ${index + 1} needs a title or text.` });
      });
      const items = [...(fromFeed ?? []), ...rows.map(signalRowItem)];
      if (items.length === 0) problems.push({ field: 'rows', message: 'Add at least one item, or import a JSON Feed file.' });
      return { input: { topic, terms: cleanTerms, items }, problems };
    },
    fromInput(input, origin) {
      if (input.topic !== undefined && typeof input.topic !== 'string') return cannot('topic', 'text');
      if (input.terms !== undefined && !isStringList(input.terms)) return cannot('terms', 'a list of text terms');
      if (input.items !== undefined && !Array.isArray(input.items)) return cannot('items', 'a list of feed items');
      const items = (input.items as unknown[] | undefined) ?? [];
      const rows = items.map(asSignalRow);
      const simple = rows.every((row) => row !== null);
      return {
        ok: true, known: ['topic', 'terms', 'items'],
        fields: {
          topic: (input.topic as string) ?? '', terms: (input.terms as string[]) ?? [],
          feed: simple || items.length === 0 ? null : imported(items, origin),
          rows: simple ? (rows as SignalRow[]) : [],
        },
      };
    },
  },
  'tiktok-intelligence': {
    empty: (now) => ({ niche: null, asOf: defaultAsOf(now), batches: [{ manifest: null, records: null }] }),
    build({ niche, asOf, batches }) {
      const problems: Problem[] = [];
      const nicheProblem = objectSlot('niche', niche, 'Import the niche definition file.', 'The niche file must contain a JSON object.');
      if (nicheProblem) problems.push(nicheProblem);
      const asOfProblemFound = asOfProblem('asOf', asOf, 'datetime');
      if (asOfProblemFound) problems.push(asOfProblemFound);
      if (batches.length < TIKTOK_BATCHES.min || batches.length > TIKTOK_BATCHES.max) {
        problems.push({ field: 'batches', message: 'Supply 1–20 snapshot batches.' });
      }
      batches.forEach((batch, index) => {
        const manifest = objectSlot(`batches.${index}.manifest`, batch.manifest, `Batch ${index + 1} needs its manifest file.`, `Batch ${index + 1}: the manifest must be a JSON object.`);
        if (manifest) problems.push(manifest);
        if (!batch.records) problems.push({ field: `batches.${index}.records`, message: `Batch ${index + 1} needs its records file.` });
      });
      return {
        input: { niche: present(niche), as_of: asOf, batches: batches.map((batch) => ({ manifest: present(batch.manifest), records: present(batch.records) })) },
        problems,
      };
    },
    fromInput(input, origin, now) {
      if (input.niche !== undefined && !isJsonObject(input.niche)) return cannot('niche', 'a JSON object');
      if (input.as_of !== undefined && typeof input.as_of !== 'string') return cannot('as_of', 'text');
      if (input.batches !== undefined && !Array.isArray(input.batches)) return cannot('batches', 'a list of batches');
      const batches: SnapshotBatch[] = [];
      for (const [index, batch] of ((input.batches as unknown[] | undefined) ?? []).entries()) {
        if (!isJsonObject(batch) || !Object.keys(batch).every((key) => key === 'manifest' || key === 'records')) {
          return cannot(`batches[${index}]`, 'an object with only "manifest" and "records"');
        }
        batches.push({ manifest: batch.manifest === undefined ? null : imported(batch.manifest, origin), records: batch.records === undefined ? null : imported(batch.records, origin) });
      }
      return {
        ok: true, known: ['niche', 'as_of', 'batches'],
        fields: {
          niche: input.niche === undefined ? null : imported(input.niche, origin),
          asOf: (input.as_of as string | undefined) ?? defaultAsOf(now),
          batches: input.batches === undefined ? [{ manifest: null, records: null }] : batches,
        },
      };
    },
  },
  'seo-studio': {
    empty: (now) => ({ config: null, packets: [], asOf: defaultAsOf(now).slice(0, 10) }),
    build({ config, packets, asOf }) {
      const problems: Problem[] = [];
      const configProblem = objectSlot('config', config, 'Import the site configuration file.', 'The configuration file must contain a JSON object.');
      if (configProblem) problems.push(configProblem);
      const all: unknown[] = [];
      packets.forEach((packet, index) => {
        const values = Array.isArray(packet.value) ? packet.value : [packet.value];
        if (!values.every(isJsonObject)) problems.push({ field: 'packets', message: `Packet file ${index + 1} must contain a packet object or a list of packet objects.` });
        all.push(...values);
      });
      if (all.length === 0) problems.push({ field: 'packets', message: 'Import at least one article packet.' });
      const asOfProblemFound = asOfProblem('asOf', asOf, 'date');
      if (asOfProblemFound) problems.push(asOfProblemFound);
      return { input: { config: present(config), packets: all, as_of: asOf }, problems };
    },
    fromInput(input, origin, now) {
      if (input.config !== undefined && !isJsonObject(input.config)) return cannot('config', 'a JSON object');
      if (input.packets !== undefined && !Array.isArray(input.packets)) return cannot('packets', 'a list of packets');
      if (input.as_of !== undefined && typeof input.as_of !== 'string') return cannot('as_of', 'text');
      const packets = (input.packets as unknown[] | undefined) ?? [];
      return {
        ok: true, known: ['config', 'packets', 'as_of'],
        fields: {
          config: input.config === undefined ? null : imported(input.config, origin),
          packets: packets.length ? [imported(packets, origin)] : [],
          asOf: (input.as_of as string | undefined) ?? defaultAsOf(now).slice(0, 10),
        },
      };
    },
  },
  'search-visibility': {
    empty: () => ({ panel: null, entities: null, inventory: null, answers: null }),
    build({ panel, entities, inventory, answers }) {
      const problems: Problem[] = [];
      const panelProblem = objectSlot('panel', panel, 'Import the query panel file.', 'The panel file must contain a JSON object.');
      if (panelProblem) problems.push(panelProblem);
      if (!entities) problems.push({ field: 'entities', message: 'Import the entities file.' });
      if (!inventory) problems.push({ field: 'inventory', message: 'Import the content inventory file.' });
      if (!answers) problems.push({ field: 'answers', message: 'Import the answer observations (JSON Lines or a JSON list).' });
      else if (!Array.isArray(answers.value)) problems.push({ field: 'answers', message: 'Answer observations must be a list: one JSON value per line, or a JSON array.' });
      return { input: { panel: present(panel), entities: present(entities), inventory: present(inventory), answers: present(answers) }, problems };
    },
    fromInput(input, origin) {
      if (input.panel !== undefined && !isJsonObject(input.panel)) return cannot('panel', 'a JSON object');
      if (input.answers !== undefined && !Array.isArray(input.answers)) return cannot('answers', 'a list of answer rows');
      const slot = (key: string) => (input[key] === undefined ? null : imported(input[key], origin));
      return { ok: true, known: ['panel', 'entities', 'inventory', 'answers'], fields: { panel: slot('panel'), entities: slot('entities'), inventory: slot('inventory'), answers: slot('answers') } };
    },
  },
  'reddit-opportunities': {
    empty: (now) => ({ bundle: null, asOf: defaultAsOf(now) }),
    build({ bundle, asOf }) {
      const problems: Problem[] = [];
      const bundleProblem = objectSlot('bundle', bundle, 'Import the corpus bundle file.', 'The corpus bundle must contain a JSON object.');
      if (bundleProblem) problems.push(bundleProblem);
      const asOfProblemFound = asOfProblem('asOf', asOf, 'datetime');
      if (asOfProblemFound) problems.push(asOfProblemFound);
      return { input: { bundle: present(bundle), as_of: asOf }, problems };
    },
    fromInput(input, origin, now) {
      if (input.bundle !== undefined && !isJsonObject(input.bundle)) return cannot('bundle', 'a JSON object');
      if (input.as_of !== undefined && typeof input.as_of !== 'string') return cannot('as_of', 'text');
      return { ok: true, known: ['bundle', 'as_of'], fields: { bundle: input.bundle === undefined ? null : imported(input.bundle, origin), asOf: (input.as_of as string | undefined) ?? defaultAsOf(now) } };
    },
  },
  'creator-relationships': {
    empty: (now) => ({ batch: null, nicheTopics: [], brandTopics: [], asOf: defaultAsOf(now) }),
    build({ batch, nicheTopics, brandTopics, asOf }) {
      const problems: Problem[] = [];
      const batchProblem = objectSlot('batch', batch, 'Import the creator batch file.', 'The creator batch must contain a JSON object.');
      if (batchProblem) problems.push(batchProblem);
      else if (typeof (batch!.value as Record<string, unknown>).account_id !== 'string') {
        problems.push({ field: 'batch', message: 'The creator batch needs a text "account_id".' });
      }
      const niche = normalizeTopics(nicheTopics);
      const brand = normalizeTopics(brandTopics);
      if (niche.length === 0) problems.push({ field: 'nicheTopics', message: 'Add at least one niche topic.' });
      const asOfProblemFound = asOfProblem('asOf', asOf, 'datetime');
      if (asOfProblemFound) problems.push(asOfProblemFound);
      // Brand topics are optional natively; an empty list is omitted.
      return { input: { batch: present(batch), niche_topics: niche, ...(brand.length ? { brand_topics: brand } : {}), as_of: asOf }, problems };
    },
    fromInput(input, origin, now) {
      if (input.batch !== undefined && !isJsonObject(input.batch)) return cannot('batch', 'a JSON object');
      if (input.niche_topics !== undefined && !isStringList(input.niche_topics)) return cannot('niche_topics', 'a list of text topics');
      if (input.brand_topics !== undefined && !isStringList(input.brand_topics)) return cannot('brand_topics', 'a list of text topics');
      if (input.as_of !== undefined && typeof input.as_of !== 'string') return cannot('as_of', 'text');
      return {
        ok: true, known: ['batch', 'niche_topics', 'brand_topics', 'as_of'],
        fields: {
          batch: input.batch === undefined ? null : imported(input.batch, origin),
          nicheTopics: (input.niche_topics as string[] | undefined) ?? [], brandTopics: (input.brand_topics as string[] | undefined) ?? [],
          asOf: (input.as_of as string | undefined) ?? defaultAsOf(now),
        },
      };
    },
  },
};

export function emptyForm<T extends ToolId>(tool: T, now: Date): ToolForm<T> {
  return { tool, fields: SPECS[tool].empty(now), extra: {} } as ToolForm<T>;
}

/** The exact native input for a form, plus any problems that block a form-mode Run. */
export function buildInput(form: ToolForm): BuiltInput {
  const spec = SPECS[form.tool] as ToolInputSpec<ToolId>;
  const built = spec.build(form.fields as never);
  const extra = Object.fromEntries(Object.entries(form.extra).filter(([key]) => !(key in built.input)));
  return { input: { ...built.input, ...extra }, problems: built.problems };
}

/** Fills a form from a native input object, such as a loaded example or edited Advanced JSON. */
export function formFromInput<T extends ToolId>(tool: T, input: Record<string, unknown>, origin: ImportedValue['origin'], now: Date): FromInput<T> {
  const spec = SPECS[tool] as ToolInputSpec<ToolId>;
  const result = spec.fromInput(input, origin, now);
  if (!result.ok) return result;
  return { ok: true, form: { tool, fields: result.fields, extra: split(input, result.known) } as ToolForm<T> };
}

/**
 * Checks shown in Advanced JSON mode. They warn but never block: JSON mode keeps parity with the
 * delivered recipes, and the service and native tool remain the authority.
 */
export function nativeWarnings(tool: ToolId, input: Record<string, unknown>, now: Date): readonly Problem[] {
  const missing = REQUIRED_KEYS[tool].filter((key) => input[key] === undefined)
    .map((key) => ({ field: 'json', message: `Missing "${key}": the tool reads it and the run would fail.` }));
  const filled = formFromInput(tool, input, { kind: 'json' }, now);
  if (!filled.ok) return [...missing, { field: 'json', message: filled.message }];
  return [...missing, ...buildInput(filled.form).problems];
}

/** Top-level keys the worker reads without a default, per tool. */
export const REQUIRED_KEYS: { readonly [T in ToolId]: readonly string[] } = {
  'x-studio': ['notes'],
  'social-publisher': ['caption'],
  'x-intelligence': ['topic', 'terms', 'items'],
  'tiktok-intelligence': ['niche', 'as_of', 'batches'],
  'seo-studio': ['config', 'packets', 'as_of'],
  'search-visibility': ['panel', 'entities', 'inventory', 'answers'],
  'reddit-opportunities': ['bundle', 'as_of'],
  'creator-relationships': ['batch', 'niche_topics', 'as_of'],
};
