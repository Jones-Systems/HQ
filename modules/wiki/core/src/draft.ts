// Draft Markdown tree: the parser's output before link targets are resolved. Links carry a raw,
// context-free description (`RawLink`); resolving them to contract `LinkTarget`s needs the whole
// namespace (page paths, aliases) and happens later, so the same parse serves both indexing and reading.

import type {
  BlockNode,
  InlineNode,
  LinkTarget,
  MarkdownDocument,
  TableAlign,
  TableRowNode,
} from '../../contract/src/index.ts';

/** Thrown when input exceeds a structural bound of the parser; the page then falls back to raw text. */
export class Overflow extends Error {}

export type RawLink =
  /** Absolute http/https/mailto URL that already passed `validateExternalUrl`. */
  | { readonly kind: 'external'; readonly url: string }
  /** Relative or root-relative destination as written (query and fragment already dropped, not decoded). */
  | { readonly kind: 'path'; readonly dest: string }
  /** `[[target|label]]` target text (fragment already dropped). */
  | { readonly kind: 'wiki'; readonly target: string };

export type DraftInline =
  | { readonly type: 'text'; readonly value: string }
  | { readonly type: 'inlineCode'; readonly value: string }
  | { readonly type: 'emphasis'; readonly strong: boolean; readonly children: readonly DraftInline[] }
  | { readonly type: 'link'; readonly link: RawLink; readonly children: readonly DraftInline[] };

export type DraftBlock =
  | { readonly type: 'heading'; readonly depth: 1 | 2 | 3 | 4 | 5 | 6; readonly children: readonly DraftInline[] }
  | { readonly type: 'paragraph'; readonly children: readonly DraftInline[] }
  | { readonly type: 'list'; readonly ordered: boolean; readonly start: number | null; readonly items: readonly (readonly DraftBlock[])[] }
  | { readonly type: 'fence'; readonly lang: string | null; readonly text: string }
  | { readonly type: 'quote'; readonly children: readonly DraftBlock[] }
  | {
      readonly type: 'table';
      readonly align: readonly TableAlign[];
      readonly header: readonly (readonly DraftInline[])[];
      readonly rows: readonly (readonly (readonly DraftInline[])[])[];
    };

export interface DraftDocument {
  readonly type: 'document';
  readonly children: readonly DraftBlock[];
}

/** A discovered link: the label as written (plain text) plus its raw description. */
export interface LinkRef {
  readonly text: string;
  readonly link: RawLink;
}

export function inlineText(children: readonly DraftInline[]): string {
  let out = '';
  for (const node of children) {
    if (node.type === 'text' || node.type === 'inlineCode') out += node.value;
    else out += inlineText(node.children);
  }
  return out;
}

function collectInline(children: readonly DraftInline[], out: LinkRef[]): void {
  for (const node of children) {
    if (node.type === 'link') {
      out.push({ text: inlineText(node.children), link: node.link });
    } else if (node.type === 'emphasis') {
      collectInline(node.children, out);
    }
  }
}

function collectBlocks(blocks: readonly DraftBlock[], out: LinkRef[]): void {
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        collectInline(block.children, out);
        break;
      case 'quote':
        collectBlocks(block.children, out);
        break;
      case 'list':
        for (const item of block.items) collectBlocks(item, out);
        break;
      case 'table':
        for (const cell of block.header) collectInline(cell, out);
        for (const row of block.rows) for (const cell of row) collectInline(cell, out);
        break;
      case 'fence':
        break;
    }
  }
}

/** Links in document order (code never contributes: code is not parsed for links). */
export function collectLinks(doc: DraftDocument): LinkRef[] {
  const out: LinkRef[] = [];
  collectBlocks(doc.children, out);
  return out;
}

function textOfBlocks(blocks: readonly DraftBlock[], out: string[]): void {
  for (const block of blocks) {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        out.push(inlineText(block.children));
        break;
      case 'fence':
        out.push(block.text);
        break;
      case 'quote':
        textOfBlocks(block.children, out);
        break;
      case 'list':
        for (const item of block.items) textOfBlocks(item, out);
        break;
      case 'table':
        for (const cell of block.header) out.push(inlineText(cell));
        for (const row of block.rows) for (const cell of row) out.push(inlineText(cell));
        break;
    }
  }
}

/** Plain text of the document for indexing and snippets (link destinations are not included). */
export function documentText(doc: DraftDocument): string {
  const out: string[] = [];
  textOfBlocks(doc.children, out);
  return out.join('\n');
}

/** Text of the first top-level level-1 heading, or null. */
export function firstH1(doc: DraftDocument): string | null {
  for (const block of doc.children) {
    if (block.type === 'heading' && block.depth === 1) return inlineText(block.children);
  }
  return null;
}

export type LinkResolver = (link: RawLink, label: string) => LinkTarget;

function toInline(children: readonly DraftInline[], resolve: LinkResolver): InlineNode[] {
  return children.map((node): InlineNode => {
    switch (node.type) {
      case 'text':
      case 'inlineCode':
        return { type: node.type, value: node.value };
      case 'emphasis':
        return { type: 'emphasis', strong: node.strong, children: toInline(node.children, resolve) };
      case 'link':
        return { type: 'link', target: resolve(node.link, inlineText(node.children)), children: toInline(node.children, resolve) };
    }
  });
}

function toRow(cells: readonly (readonly DraftInline[])[], resolve: LinkResolver): TableRowNode {
  return { type: 'tableRow', cells: cells.map((cell) => ({ type: 'tableCell' as const, children: toInline(cell, resolve) })) };
}

function toBlocks(blocks: readonly DraftBlock[], resolve: LinkResolver): BlockNode[] {
  return blocks.map((block): BlockNode => {
    switch (block.type) {
      case 'heading':
        return { type: 'heading', depth: block.depth, children: toInline(block.children, resolve) };
      case 'paragraph':
        return { type: 'paragraph', children: toInline(block.children, resolve) };
      case 'fence':
        return { type: 'fence', lang: block.lang, text: block.text };
      case 'quote':
        return { type: 'quote', children: toBlocks(block.children, resolve) };
      case 'list': {
        const items = block.items.map((item) => ({ type: 'listItem' as const, children: toBlocks(item, resolve) }));
        return block.ordered && block.start !== null
          ? { type: 'list', ordered: true, start: block.start, items }
          : { type: 'list', ordered: block.ordered, items };
      }
      case 'table':
        return { type: 'table', align: block.align, header: toRow(block.header, resolve), rows: block.rows.map((row) => toRow(row, resolve)) };
    }
  });
}

/** Resolve every link of a draft into a contract `MarkdownDocument` (not yet validated). */
export function resolveDocument(doc: DraftDocument, resolve: LinkResolver): MarkdownDocument {
  return { type: 'document', children: toBlocks(doc.children, resolve) };
}
