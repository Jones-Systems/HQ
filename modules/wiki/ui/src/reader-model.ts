// Pure reader helpers over the safe AST: headings and their stable ids for the outline, the sentence or list item in
// a source page that links to a target (backlink previews), a short summary for link previews, and out-link groups.
// No DOM, no React: everything here is unit-testable and treats every string as untrusted text.

import {
  pageKeyEquals,
  pageKeyId,
  type BlockNode,
  type HeadingNode,
  type InlineNode,
  type LinkTarget,
  type MarkdownDocument,
  type OutLink,
  type Page,
  type PageKey,
} from '../../contract/src/index.ts';

// ---- plain text ----

export function inlineText(nodes: readonly InlineNode[]): string {
  let text = '';
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'inlineCode') text += node.value;
    else text += inlineText(node.children);
  }
  return text;
}

export function blockText(block: BlockNode): string {
  switch (block.type) {
    case 'heading':
    case 'paragraph':
      return inlineText(block.children);
    case 'list':
      return block.items.map((item) => item.children.map(blockText).join(' ')).join(' ');
    case 'quote':
      return block.children.map(blockText).join(' ');
    case 'fence':
      return block.text;
    default:
      return [block.header, ...block.rows].map((row) => row.cells.map((cell) => inlineText(cell.children)).join(' ')).join(' ');
  }
}

const squash = (text: string): string => text.replace(/\s+/gu, ' ').trim();

/** Cuts at a word boundary and adds an ellipsis; never splits a surrogate pair. */
export function clip(text: string, max: number): string {
  const points = Array.from(squash(text));
  if (points.length <= max) return points.join('');
  const head = points.slice(0, max);
  const lastSpace = head.lastIndexOf(' ');
  const cut = lastSpace > max * 0.6 ? head.slice(0, lastSpace) : head;
  return `${cut.join('').trimEnd()}…`;
}

// ---- headings and the outline ----

export interface HeadingInfo {
  /** Stable element id (`wiki-h-<n>`, counting rendered headings from 1 in document order). */
  readonly id: string;
  /** Rendered level: 2 to 6 (the page title is the h1). */
  readonly level: 2 | 3 | 4 | 5 | 6;
}

export interface OutlineItem {
  readonly id: string;
  readonly level: 2 | 3;
  readonly text: string;
}

export interface DocumentHeadings {
  readonly info: ReadonlyMap<HeadingNode, HeadingInfo>;
  /** A leading heading that repeats the page title; it is not rendered (the page header already shows it). */
  readonly skipped: HeadingNode | null;
  readonly outline: readonly OutlineItem[];
}

function eachBlock(blocks: readonly BlockNode[], visit: (block: BlockNode) => void): void {
  for (const block of blocks) {
    visit(block);
    if (block.type === 'quote') eachBlock(block.children, visit);
    else if (block.type === 'list') for (const item of block.items) eachBlock(item.children, visit);
  }
}

/** Equal ignoring case and runs of whitespace. */
export const sameText = (a: string, b: string): boolean => squash(a).toLocaleLowerCase() === squash(b).toLocaleLowerCase();

/**
 * Ids and levels for every heading. The shallowest remaining heading becomes h2 so levels never skip, and a leading
 * level-1 heading that repeats `title` is dropped from the page and the outline (WF-3: the title must not appear twice).
 */
export function documentHeadings(document: MarkdownDocument, title: string): DocumentHeadings {
  const first = document.children[0];
  const skipped = first !== undefined && first.type === 'heading' && first.depth === 1 && sameText(inlineText(first.children), title) ? first : null;
  const headings: HeadingNode[] = [];
  eachBlock(document.children, (block) => {
    if (block.type === 'heading' && block !== skipped) headings.push(block);
  });
  const shallowest = headings.reduce((least, heading) => Math.min(least, heading.depth), 6);
  const info = new Map<HeadingNode, HeadingInfo>();
  const outline: OutlineItem[] = [];
  headings.forEach((heading, index) => {
    const level = Math.min(6, Math.max(2, heading.depth - shallowest + 2)) as HeadingInfo['level'];
    const id = `wiki-h-${index + 1}`;
    info.set(heading, { id, level });
    const text = squash(inlineText(heading.children));
    if (level <= 3 && text.length > 0) outline.push({ id, level: level as 2 | 3, text });
  });
  return { info, skipped, outline };
}

// ---- backlink context ----

export interface ContextSegment {
  readonly text: string;
  /** True for the words of the link that points at the target. */
  readonly match: boolean;
}

export interface BacklinkContext {
  readonly kind: 'sentence' | 'list-item' | 'heading' | 'table-row';
  readonly segments: readonly ContextSegment[];
  /** How many links to the target the source page contains. */
  readonly mentions: number;
}

const CONTEXT_MAX = 260;

interface Flat {
  readonly text: string;
  /** Half-open character ranges of links to the target. */
  readonly matches: readonly (readonly [number, number])[];
}

function pointsTo(target: LinkTarget, key: PageKey): boolean {
  return target.kind === 'page' && pageKeyEquals(target.key, key);
}

function flatten(nodes: readonly InlineNode[], key: PageKey): Flat {
  let text = '';
  const matches: [number, number][] = [];
  const walk = (list: readonly InlineNode[], inMatch: boolean): void => {
    for (const node of list) {
      if (node.type === 'text' || node.type === 'inlineCode') {
        text += node.value;
      } else if (node.type === 'emphasis') {
        walk(node.children, inMatch);
      } else {
        const hit = !inMatch && pointsTo(node.target, key);
        const start = text.length;
        walk(node.children, inMatch || hit);
        if (hit && text.length > start) matches.push([start, text.length]);
      }
    }
  };
  walk(nodes, false);
  return { text, matches };
}

/** Sentence ranges `[start, end)` of `text`, split after . ! or ? followed by space; always covers the whole string. */
function sentenceRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  let start = 0;
  for (const boundary of text.matchAll(/[.!?]["')\]]*\s+/gu)) {
    const end = boundary.index + boundary[0].length;
    ranges.push([start, end]);
    start = end;
  }
  if (start < text.length) ranges.push([start, text.length]);
  return ranges;
}

function segmentsOf(text: string, from: number, to: number, matches: Flat['matches']): ContextSegment[] {
  const segments: ContextSegment[] = [];
  let cursor = from;
  for (const [start, end] of matches) {
    if (end <= from || start >= to) continue;
    const s = Math.max(start, from);
    const e = Math.min(end, to);
    if (s > cursor) segments.push({ text: text.slice(cursor, s), match: false });
    segments.push({ text: text.slice(s, e), match: true });
    cursor = e;
  }
  if (cursor < to) segments.push({ text: text.slice(cursor, to), match: false });
  return segments;
}

/** The segments of `flat` inside `[from, to)`, whitespace squashed and bounded around the first link. */
function windowed(flat: Flat, from: number, to: number): ContextSegment[] {
  let start = from;
  let end = to;
  const first = flat.matches.find(([s, e]) => e > from && s < to);
  let before = '';
  let after = '';
  if (end - start > CONTEXT_MAX && first !== undefined) {
    const room = Math.max(40, Math.floor((CONTEXT_MAX - (first[1] - first[0])) / 2));
    if (first[0] - start > room) {
      start = first[0] - room;
      before = '…';
    }
    if (end - first[1] > room) {
      end = first[1] + room;
      after = '…';
    }
  } else if (end - start > CONTEXT_MAX) {
    end = start + CONTEXT_MAX;
    after = '…';
  }
  const raw = segmentsOf(flat.text, start, end, flat.matches);
  const segments = raw.map((segment) => ({ text: segment.text.replace(/\s+/gu, ' '), match: segment.match }));
  if (segments.length > 0) {
    const head = segments[0]!;
    segments[0] = { text: `${before}${head.text.replace(/^\s+/u, '')}`, match: head.match };
    const tail = segments[segments.length - 1]!;
    segments[segments.length - 1] = { text: `${tail.text.replace(/\s+$/u, '')}${after}`, match: tail.match };
  }
  return segments.filter((segment) => segment.text.length > 0);
}

function sentenceContext(inlines: readonly InlineNode[], key: PageKey): ContextSegment[] | null {
  const flat = flatten(inlines, key);
  const first = flat.matches[0];
  if (first === undefined) return null;
  const range = sentenceRanges(flat.text).find(([s, e]) => first[0] >= s && first[0] < e) ?? [0, flat.text.length];
  return windowed(flat, range[0], range[1]);
}

function wholeContext(inlines: readonly InlineNode[], key: PageKey): ContextSegment[] | null {
  const flat = flatten(inlines, key);
  return flat.matches.length === 0 ? null : windowed(flat, 0, flat.text.length);
}

function countLinks(nodes: readonly InlineNode[], key: PageKey): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === 'link') count += (pointsTo(node.target, key) ? 1 : 0) + countLinks(node.children, key);
    else if (node.type === 'emphasis') count += countLinks(node.children, key);
  }
  return count;
}

/**
 * The first place in `document` that links to `target`, as the sentence (paragraph), list item, heading or table
 * row around it, with the link's own words marked. Null when the AST has no such link (a raw page, or a link the
 * index saw that the AST does not carry).
 */
export function backlinkContext(document: MarkdownDocument, target: PageKey): BacklinkContext | null {
  let found: { kind: BacklinkContext['kind']; segments: ContextSegment[] } | null = null;
  let mentions = 0;
  const visit = (blocks: readonly BlockNode[], inItem: boolean): void => {
    for (const block of blocks) {
      switch (block.type) {
        case 'paragraph': {
          mentions += countLinks(block.children, target);
          if (found === null) {
            const segments = inItem ? wholeContext(block.children, target) : sentenceContext(block.children, target);
            if (segments !== null) found = { kind: inItem ? 'list-item' : 'sentence', segments };
          }
          break;
        }
        case 'heading': {
          mentions += countLinks(block.children, target);
          if (found === null) {
            const segments = wholeContext(block.children, target);
            if (segments !== null) found = { kind: 'heading', segments };
          }
          break;
        }
        case 'list':
          for (const item of block.items) visit(item.children, true);
          break;
        case 'quote':
          visit(block.children, false);
          break;
        case 'table':
          for (const row of [block.header, ...block.rows]) {
            const cells = row.cells.map((cell) => cell.children);
            const here = cells.reduce((sum, cell) => sum + countLinks(cell, target), 0);
            mentions += here;
            if (found === null && here > 0) {
              const joined: InlineNode[] = [];
              cells.forEach((cell, index) => {
                if (index > 0) joined.push({ type: 'text', value: ' · ' });
                joined.push(...cell);
              });
              const segments = wholeContext(joined, target);
              if (segments !== null) found = { kind: 'table-row', segments };
            }
          }
          break;
        default:
          break;
      }
    }
  };
  visit(document.children, false);
  const result = found as { kind: BacklinkContext['kind']; segments: ContextSegment[] } | null;
  return result === null ? null : { kind: result.kind, segments: result.segments, mentions };
}

// ---- page summary ----

export const SUMMARY_LENGTH = 240;

/** The first ~240 characters of prose: paragraphs, lists and quotes, skipping headings, code and a repeated title. */
export function pageSummary(page: Page, max = SUMMARY_LENGTH): string {
  const { content } = page;
  if (content.state === 'raw') return clip(content.text, max);
  const parts: string[] = [];
  let length = 0;
  eachBlock(content.ast.children, (block) => {
    if (length > max * 2) return;
    if (block.type === 'paragraph') {
      const text = squash(inlineText(block.children));
      if (text.length > 0) {
        parts.push(text);
        length += text.length;
      }
    }
  });
  return clip(parts.join(' '), max);
}

// ---- out-links ----

export type OutLinkGroupKind = 'page' | 'ambiguous' | 'missing' | 'external';

export const OUT_LINK_GROUPS: readonly { readonly kind: OutLinkGroupKind; readonly label: string }[] = [
  { kind: 'page', label: 'Pages' },
  { kind: 'ambiguous', label: 'Ambiguous' },
  { kind: 'missing', label: 'Missing' },
  { kind: 'external', label: 'External' },
];

function targetId(target: LinkTarget): string {
  switch (target.kind) {
    case 'page':
      return `page:${pageKeyId(target.key)}`;
    case 'ambiguous':
      return `ambiguous:${target.candidates.map(pageKeyId).join('\u0001')}`;
    case 'missing':
      return `missing:${target.label}`;
    default:
      return `external:${target.url}`;
  }
}

export interface OutLinkGroup {
  readonly kind: OutLinkGroupKind;
  readonly label: string;
  readonly links: readonly OutLink[];
}

/** Out-links without exact repeats (same words and target), grouped Pages / Ambiguous / Missing / External. */
export function groupOutLinks(links: readonly OutLink[]): readonly OutLinkGroup[] {
  const seen = new Set<string>();
  const unique: OutLink[] = [];
  for (const link of links) {
    const id = `${link.text}\u0000${targetId(link.target)}`;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(link);
  }
  return OUT_LINK_GROUPS.map((group) => ({ ...group, links: unique.filter((link) => link.target.kind === group.kind) })).filter((group) => group.links.length > 0);
}
