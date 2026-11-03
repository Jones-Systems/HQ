// Page analysis: bytes -> everything the index and the reader need, in one place so that the index
// (built once per commit) and `getPage` (parsed again on demand) can never disagree about a page.

import {
  MAX_FIELD_VALUE_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_OUT_LINKS,
  MAX_PAGE_BLOB_BYTES,
  validateMarkdownDocument,
  validatePage,
  type LinkTarget,
  type OutLink,
  type Page,
  type PageField,
  type RawReason,
} from '../../contract/src/index.ts';
import { collectLinks, documentText, firstH1, resolveDocument, type DraftDocument, type LinkRef, type RawLink } from './draft.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { parseMarkdown } from './markdown.ts';
import type { SourceProfile } from './profile.ts';
import { resolveLink, targetId, type PageDirectory } from './resolver.ts';
import { cleanLabel, fileStem, normalizeAlias } from './text.ts';

export interface PageAnalysis {
  readonly byteLength: number;
  readonly title: string;
  readonly fields: readonly PageField[];
  /** Null frontmatter values and null list items that were omitted (aggregate reporting only). */
  readonly nullOmissions: number;
  readonly rawReason: RawReason | null;
  /** The full decoded text, present exactly for raw pages. */
  readonly rawText: string | null;
  readonly draft: DraftDocument | null;
  /** Relationship-field links first, then body links, in document order. */
  readonly links: readonly LinkRef[];
  /** Names the page answers to: title, alias fields, file stem. */
  readonly names: readonly string[];
  /** Topic labels from the profile's topic fields. */
  readonly topics: readonly string[];
  /** Title and alias text (weighted more in search). */
  readonly titleText: string;
  /** Plain body text plus string field values. */
  readonly bodyText: string;
}

const MAX_NAMES = 80;
const MAX_TOPICS_PER_PAGE = 64;
const PROBE_COMMIT = '0'.repeat(40);

function utf8Width(codePoint: number): number {
  return codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
}

/** Cut text so its UTF-8 encoding fits `maxBytes`, on a code point boundary. */
export function truncateUtf8(text: string, maxBytes: number): string {
  let bytes = 0;
  let end = 0;
  for (const ch of text) {
    const width = utf8Width(ch.codePointAt(0) as number);
    if (bytes + width > maxBytes) break;
    bytes += width;
    end += ch.length;
  }
  return text.slice(0, end);
}

interface Decoded {
  readonly text: string;
  readonly notText: boolean;
}

function decode(bytes: Uint8Array): Decoded {
  if (!bytes.includes(0)) {
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), notText: false };
    } catch {
      // fall through to the lossy decode below
    }
  }
  // Replacement characters can expand each invalid byte to three, so the shown text is capped again.
  const lossy = new TextDecoder('utf-8').decode(bytes).replaceAll('\u0000', '�');
  return { text: truncateUtf8(lossy, MAX_PAGE_BLOB_BYTES), notText: true };
}

function dummyResolve(link: RawLink): LinkTarget {
  return link.kind === 'external' ? { kind: 'external', url: link.url } : { kind: 'missing', label: 'x' };
}

function scalarText(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function fieldValues(fields: readonly PageField[], name: string): string[] {
  const field = fields.find((f) => f.name === name);
  if (field === undefined) return [];
  const raw = Array.isArray(field.value) ? field.value : [field.value];
  return raw.map(scalarText).filter((text) => text !== '');
}

function wikiTarget(value: string): string {
  const wrapped = /^\s*\[\[(.*)\]\]\s*$/.exec(value);
  const inner = wrapped === null ? value : (wrapped[1] as string);
  const bar = inner.indexOf('|');
  const target = bar < 0 ? inner : inner.slice(0, bar);
  const hash = target.indexOf('#');
  return (hash < 0 ? target : target.slice(0, hash)).trim();
}

function fieldsAreValid(fields: readonly PageField[]): boolean {
  const probe = {
    key: { namespace: 'bl', path: 'probe.md' },
    title: 'probe',
    commit: PROBE_COMMIT,
    byteLength: 0,
    fields,
    outLinks: [],
    content: { state: 'raw', reason: 'not-text', text: '' },
  };
  return validatePage(probe).ok;
}

function dedupeCapped(values: readonly string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = normalizeAlias(value);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

/** Analyse one page blob. Total: hostile input degrades to a raw page, never throws. */
export function analyzePage(path: string, bytes: Uint8Array, profile: SourceProfile): PageAnalysis {
  const stem = cleanLabel(fileStem(path, profile.pageExtensions)) || 'page';
  const byteLength = bytes.length;
  const decoded = decode(bytes);

  if (decoded.notText) {
    return {
      byteLength,
      title: stem,
      fields: [],
      nullOmissions: 0,
      rawReason: 'not-text',
      rawText: decoded.text,
      draft: null,
      links: [],
      names: [stem],
      topics: [],
      titleText: stem,
      bodyText: '',
    };
  }

  const text = decoded.text;
  const front = parseFrontmatter(text);
  let rawReason: RawReason | null = null;
  let fields: readonly PageField[] = [];
  let nullOmissions = 0;
  if (front.status === 'unsupported') rawReason = 'frontmatter-unsupported';
  else if (front.status === 'ok') {
    if (fieldsAreValid(front.fields)) {
      fields = front.fields;
      nullOmissions = front.nullOmissions;
    } else rawReason = 'frontmatter-unsupported';
  }

  const parsed = parseMarkdown(front.body);
  let draft: DraftDocument | null = null;
  let bodyLinks: readonly LinkRef[];
  if (parsed.ok) {
    bodyLinks = collectLinks(parsed.doc);
    if (rawReason === null) {
      if (validateMarkdownDocument(resolveDocument(parsed.doc, dummyResolve)).ok) draft = parsed.doc;
      else rawReason = 'markdown-unsupported';
    }
  } else {
    bodyLinks = parsed.links;
    if (rawReason === null) rawReason = 'markdown-unsupported';
  }

  const h1Text = parsed.ok ? firstH1(parsed.doc) : null;
  const mappedTitle = profile.fieldMappings.title === null ? [] : fieldValues(fields, profile.fieldMappings.title);
  const title = cleanLabel(mappedTitle[0] ?? '') || cleanLabel(h1Text ?? '') || stem;

  const aliasValues = profile.fieldMappings.aliases.flatMap((name) => fieldValues(fields, name)).map((v) => cleanLabel(v));
  const names = dedupeCapped([title, ...aliasValues, stem], MAX_NAMES);

  const relationshipLinks: LinkRef[] = [];
  for (const name of profile.fieldMappings.relationships) {
    for (const value of fieldValues(fields, name)) {
      const target = wikiTarget(value);
      if (target !== '') relationshipLinks.push({ text: cleanLabel(target), link: { kind: 'wiki', target } });
    }
  }

  const topics =
    profile.topicMode === 'field'
      ? dedupeCapped(profile.fieldMappings.topics.flatMap((name) => fieldValues(fields, name)).map((v) => cleanLabel(v)), MAX_TOPICS_PER_PAGE)
      : [];

  const fieldText = fields
    .flatMap((field) => (Array.isArray(field.value) ? field.value : [field.value]))
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.slice(0, MAX_FIELD_VALUE_LENGTH))
    .join('\n');
  const body = draft !== null ? documentText(draft) : front.body;

  return {
    byteLength,
    title,
    fields,
    nullOmissions,
    rawReason,
    rawText: rawReason === null ? null : text,
    draft,
    links: [...relationshipLinks, ...bodyLinks],
    names,
    topics,
    titleText: names.join('\n'),
    bodyText: fieldText === '' ? body : `${body}\n${fieldText}`,
  };
}

/** A resolved link as the index keeps it: the unique targets, uncapped, in discovery order. */
export function resolveTargets(analysis: PageAnalysis, dir: PageDirectory, path: string): LinkTarget[] {
  const seen = new Set<string>();
  const out: LinkTarget[] = [];
  for (const ref of analysis.links) {
    const target = resolveLink(dir, ref.link, path);
    const id = targetId(target);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(target);
  }
  return out;
}

function describe(target: LinkTarget): string {
  switch (target.kind) {
    case 'page':
      return target.key.path;
    case 'ambiguous':
      return target.candidates[0]?.path ?? 'ambiguous';
    case 'missing':
      return target.label;
    case 'external':
      return target.url;
  }
}

/** Page.outLinks: de-duplicated by target, capped. The index keeps the uncapped target list. */
export function buildOutLinks(analysis: PageAnalysis, dir: PageDirectory, path: string): OutLink[] {
  const seen = new Set<string>();
  const out: OutLink[] = [];
  for (const ref of analysis.links) {
    const target = resolveLink(dir, ref.link, path);
    const id = targetId(target);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ text: cleanLabel(ref.text, MAX_LABEL_LENGTH) || cleanLabel(describe(target), MAX_LABEL_LENGTH) || 'link', target });
    if (out.length >= MAX_OUT_LINKS) break;
  }
  return out;
}

/** Assemble the contract `Page` for an analysed blob. The caller validates the result. */
export function buildPage(analysis: PageAnalysis, dir: PageDirectory, path: string, commit: string): Page {
  const key = { namespace: dir.namespace, path };
  const content: Page['content'] =
    analysis.draft !== null
      ? { state: 'parsed', ast: resolveDocument(analysis.draft, (link) => resolveLink(dir, link, path)) }
      : { state: 'raw', reason: analysis.rawReason ?? 'markdown-unsupported', text: analysis.rawText ?? '' };
  return {
    key,
    title: analysis.title,
    commit,
    byteLength: analysis.byteLength,
    fields: analysis.fields,
    outLinks: buildOutLinks(analysis, dir, path),
    content,
  };
}
