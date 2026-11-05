// Safe Markdown AST. The grammar is closed: any node type or property not listed here is invalid.
// There is no image node and no HTML node. Raw HTML and unsafe-scheme links are representable
// only as `text` nodes, which renderers must display as inert text (never as markup, never navigated).
// Producing this tree from Markdown belongs to core; this module only types and validates it.

import { checkInertText, checkInteger, checkKeys, checkLabel, isRecord } from './guard.ts';
import {
  MAX_AST_DEPTH,
  MAX_AST_NODES,
  MAX_PAGE_BLOB_BYTES,
  MAX_PATH_LENGTH,
  MAX_RESULTS,
  MAX_TABLE_COLUMNS,
  MAX_URL_LENGTH,
} from './limits.ts';
import { checkPageKey, pageKeyId, type PageKey } from './page-key.ts';
import { invalid, resultOf, type WikiError, type WikiResult } from './result.ts';

// ---- link targets (shared by AST links and Page.outLinks) ----

export type LinkTarget =
  | { readonly kind: 'page'; readonly key: PageKey }
  /** More than one page matches; the reader shows disambiguation. */
  | { readonly kind: 'ambiguous'; readonly candidates: readonly PageKey[] }
  /** Dangling target; `label` is the unresolved reference text, shown inertly. */
  | { readonly kind: 'missing'; readonly label: string }
  /** Absolute http(s)/mailto URL. Display-only data; the contract never fetches or opens it. */
  | { readonly kind: 'external'; readonly url: string };

export const SAFE_URL_SCHEMES: readonly string[] = ['http', 'https', 'mailto'];

const URL_FORBIDDEN = '\\s<>"\'`\\\\\\u0000-\\u001f\\u007f-\\u009f';
const HTTP_URL = new RegExp(`^https?://[^/?#${URL_FORBIDDEN}]+(?:[/?#][^${URL_FORBIDDEN}]*)?$`, 'i');
const MAILTO_URL = new RegExp(`^mailto:[^${URL_FORBIDDEN}]+$`, 'i');

export function checkExternalUrl(value: unknown, path: string): WikiError | null {
  if (typeof value !== 'string') return invalid('wrong-type', 'url must be a string', path);
  if (value.length > MAX_URL_LENGTH) return invalid('too-long', `url exceeds ${MAX_URL_LENGTH} characters`, path);
  if (!HTTP_URL.test(value) && !MAILTO_URL.test(value)) {
    return invalid('unsafe-url', 'only absolute http, https and mailto URLs are allowed as links', path);
  }
  return null;
}

/** Accepts absolute `http:`, `https:` and `mailto:` URLs without whitespace, controls, quotes or backslashes. */
export function validateExternalUrl(value: unknown): WikiResult<string> {
  return resultOf(checkExternalUrl(value, '$'), value as string);
}

export function checkLinkTarget(value: unknown, path: string): WikiError | null {
  if (!isRecord(value)) return invalid('wrong-type', 'link target must be an object', path);
  switch (value['kind']) {
    case 'page':
      return checkKeys(value, ['kind', 'key'], ['kind', 'key'], path) ?? checkPageKey(value['key'], `${path}.key`);
    case 'ambiguous': {
      const keys = checkKeys(value, ['kind', 'candidates'], ['kind', 'candidates'], path);
      if (keys !== null) return keys;
      const candidates = value['candidates'];
      if (!Array.isArray(candidates)) return invalid('wrong-type', 'candidates must be an array', `${path}.candidates`);
      if (candidates.length < 2 || candidates.length > MAX_RESULTS) {
        return invalid('out-of-range', `ambiguous targets need 2..${MAX_RESULTS} candidates`, `${path}.candidates`);
      }
      const seen = new Set<string>();
      for (const [i, candidate] of candidates.entries()) {
        const error = checkPageKey(candidate, `${path}.candidates[${i}]`);
        if (error !== null) return error;
        const id = pageKeyId(candidate as PageKey);
        if (seen.has(id)) return invalid('duplicate', 'duplicate candidate', `${path}.candidates[${i}]`);
        seen.add(id);
      }
      return null;
    }
    case 'missing':
      return checkKeys(value, ['kind', 'label'], ['kind', 'label'], path) ?? checkLabel(value['label'], `${path}.label`, MAX_PATH_LENGTH);
    case 'external':
      return checkKeys(value, ['kind', 'url'], ['kind', 'url'], path) ?? checkExternalUrl(value['url'], `${path}.url`);
    default:
      return invalid('invalid-format', 'link target kind must be page, ambiguous, missing or external', `${path}.kind`);
  }
}

export function validateLinkTarget(value: unknown): WikiResult<LinkTarget> {
  return resultOf(checkLinkTarget(value, '$'), value as LinkTarget);
}

// ---- node types ----

export interface TextNode {
  readonly type: 'text';
  /** Verbatim text. May contain markup-looking characters (e.g. raw HTML); it is never interpreted. */
  readonly value: string;
}
export interface EmphasisNode {
  readonly type: 'emphasis';
  readonly strong: boolean;
  readonly children: readonly InlineNode[];
}
export interface InlineCodeNode {
  readonly type: 'inlineCode';
  readonly value: string;
}
export interface LinkNode {
  readonly type: 'link';
  readonly target: LinkTarget;
  readonly children: readonly InlineNode[];
}
export type InlineNode = TextNode | EmphasisNode | InlineCodeNode | LinkNode;

export interface HeadingNode {
  readonly type: 'heading';
  readonly depth: 1 | 2 | 3 | 4 | 5 | 6;
  readonly children: readonly InlineNode[];
}
export interface ParagraphNode {
  readonly type: 'paragraph';
  readonly children: readonly InlineNode[];
}
export interface ListItemNode {
  readonly type: 'listItem';
  readonly children: readonly BlockNode[];
}
export interface ListNode {
  readonly type: 'list';
  readonly ordered: boolean;
  /** First number of an ordered list; absent for unordered lists. */
  readonly start?: number;
  readonly items: readonly ListItemNode[];
}
export interface FenceNode {
  readonly type: 'fence';
  /** Info-string language token, or null. Never executed or highlighted from the network. */
  readonly lang: string | null;
  readonly text: string;
}
export interface QuoteNode {
  readonly type: 'quote';
  readonly children: readonly BlockNode[];
}
export type TableAlign = 'left' | 'center' | 'right' | null;
export interface TableCellNode {
  readonly type: 'tableCell';
  readonly children: readonly InlineNode[];
}
export interface TableRowNode {
  readonly type: 'tableRow';
  readonly cells: readonly TableCellNode[];
}
export interface TableNode {
  readonly type: 'table';
  readonly align: readonly TableAlign[];
  readonly header: TableRowNode;
  readonly rows: readonly TableRowNode[];
}
export type BlockNode = HeadingNode | ParagraphNode | ListNode | FenceNode | QuoteNode | TableNode;

export interface MarkdownDocument {
  readonly type: 'document';
  readonly children: readonly BlockNode[];
}

export const BLOCK_NODE_TYPES = ['heading', 'paragraph', 'list', 'fence', 'quote', 'table'] as const;
export const INLINE_NODE_TYPES = ['text', 'emphasis', 'inlineCode', 'link'] as const;
export const STRUCTURAL_NODE_TYPES = ['document', 'listItem', 'tableRow', 'tableCell'] as const;

const IMAGE_TYPES = new Set(['image', 'imagereference', 'img', 'picture', 'svg', 'figure']);
const HTML_TYPES = new Set(['html', 'rawhtml', 'raw', 'jsx', 'mdxjsxflowelement', 'mdxjsxtextelement', 'script', 'style', 'iframe', 'object', 'embed']);
const ALIGNS: readonly unknown[] = ['left', 'center', 'right', null];
const LANG = /^[^\s\u0000-\u001f\u007f-\u009f]{1,64}$/;

// ---- validation ----

interface Ctx {
  nodes: number;
}

type Mode = 'block' | 'inline';

function isBlockType(type: string): boolean {
  return (BLOCK_NODE_TYPES as readonly string[]).includes(type);
}
function isInlineType(type: string): boolean {
  return (INLINE_NODE_TYPES as readonly string[]).includes(type);
}

function checkChildren(value: unknown, path: string, depth: number, ctx: Ctx, mode: Mode, inLink: boolean): WikiError | null {
  if (!Array.isArray(value)) return invalid('wrong-type', 'children must be an array', path);
  for (const [i, child] of value.entries()) {
    const error = checkNode(child, `${path}[${i}]`, depth, ctx, mode, inLink);
    if (error !== null) return error;
  }
  return null;
}

function checkRow(value: unknown, path: string, depth: number, ctx: Ctx, columns: number): WikiError | null {
  if (++ctx.nodes > MAX_AST_NODES) return invalid('too-many-nodes', `document exceeds ${MAX_AST_NODES} nodes`, path);
  if (!isRecord(value)) return invalid('wrong-type', 'table row must be an object', path);
  if (value['type'] !== 'tableRow') return invalid('wrong-context', 'expected a tableRow node', `${path}.type`);
  const keys = checkKeys(value, ['type', 'cells'], ['type', 'cells'], path);
  if (keys !== null) return keys;
  const cells = value['cells'];
  if (!Array.isArray(cells)) return invalid('wrong-type', 'cells must be an array', `${path}.cells`);
  if (cells.length !== columns) return invalid('inconsistent', `row has ${cells.length} cells but the table has ${columns} columns`, `${path}.cells`);
  for (const [i, cell] of cells.entries()) {
    const cellPath = `${path}.cells[${i}]`;
    if (++ctx.nodes > MAX_AST_NODES) return invalid('too-many-nodes', `document exceeds ${MAX_AST_NODES} nodes`, cellPath);
    if (!isRecord(cell)) return invalid('wrong-type', 'table cell must be an object', cellPath);
    if (cell['type'] !== 'tableCell') return invalid('wrong-context', 'expected a tableCell node', `${cellPath}.type`);
    const cellKeys = checkKeys(cell, ['type', 'children'], ['type', 'children'], cellPath);
    if (cellKeys !== null) return cellKeys;
    const error = checkChildren(cell['children'], `${cellPath}.children`, depth + 2, ctx, 'inline', false);
    if (error !== null) return error;
  }
  return null;
}

function checkNode(value: unknown, path: string, depth: number, ctx: Ctx, mode: Mode, inLink: boolean): WikiError | null {
  if (++ctx.nodes > MAX_AST_NODES) return invalid('too-many-nodes', `document exceeds ${MAX_AST_NODES} nodes`, path);
  if (depth > MAX_AST_DEPTH) return invalid('too-deep', `nesting exceeds ${MAX_AST_DEPTH} levels`, path);
  if (!isRecord(value)) return invalid('wrong-type', 'node must be an object', path);
  const type = value['type'];
  if (typeof type !== 'string') return invalid('wrong-type', 'node type must be a string', `${path}.type`);
  const lowered = type.toLowerCase();
  if (IMAGE_TYPES.has(lowered)) return invalid('image-not-allowed', 'images are not part of the safe AST', `${path}.type`);
  if (HTML_TYPES.has(lowered)) return invalid('html-not-allowed', 'HTML is only representable as inert text', `${path}.type`);

  const known = isBlockType(type) || isInlineType(type) || (STRUCTURAL_NODE_TYPES as readonly string[]).includes(type);
  if (!known) return invalid('unknown-node-type', `unknown node type "${type}"`, `${path}.type`);
  const fits = mode === 'block' ? isBlockType(type) : isInlineType(type);
  if (!fits) return invalid('wrong-context', `${type} node is not allowed in a ${mode} position`, `${path}.type`);

  switch (type) {
    case 'heading': {
      return (
        checkKeys(value, ['type', 'depth', 'children'], ['type', 'depth', 'children'], path) ??
        checkInteger(value['depth'], `${path}.depth`, 1, 6) ??
        checkChildren(value['children'], `${path}.children`, depth + 1, ctx, 'inline', false)
      );
    }
    case 'paragraph':
      return (
        checkKeys(value, ['type', 'children'], ['type', 'children'], path) ??
        checkChildren(value['children'], `${path}.children`, depth + 1, ctx, 'inline', false)
      );
    case 'list': {
      const keys = checkKeys(value, ['type', 'ordered', 'start', 'items'], ['type', 'ordered', 'items'], path);
      if (keys !== null) return keys;
      if (typeof value['ordered'] !== 'boolean') return invalid('wrong-type', 'ordered must be a boolean', `${path}.ordered`);
      if ('start' in value) {
        if (value['ordered'] !== true) return invalid('inconsistent', 'only ordered lists have a start', `${path}.start`);
        const start = checkInteger(value['start'], `${path}.start`, 0, 1_000_000_000);
        if (start !== null) return start;
      }
      const items = value['items'];
      if (!Array.isArray(items)) return invalid('wrong-type', 'items must be an array', `${path}.items`);
      if (items.length === 0) return invalid('empty', 'a list needs at least one item', `${path}.items`);
      for (const [i, item] of items.entries()) {
        const itemPath = `${path}.items[${i}]`;
        if (++ctx.nodes > MAX_AST_NODES) return invalid('too-many-nodes', `document exceeds ${MAX_AST_NODES} nodes`, itemPath);
        if (!isRecord(item)) return invalid('wrong-type', 'list item must be an object', itemPath);
        if (item['type'] !== 'listItem') return invalid('wrong-context', 'expected a listItem node', `${itemPath}.type`);
        const itemKeys = checkKeys(item, ['type', 'children'], ['type', 'children'], itemPath);
        if (itemKeys !== null) return itemKeys;
        const error = checkChildren(item['children'], `${itemPath}.children`, depth + 2, ctx, 'block', false);
        if (error !== null) return error;
      }
      return null;
    }
    case 'fence': {
      const keys = checkKeys(value, ['type', 'lang', 'text'], ['type', 'lang', 'text'], path);
      if (keys !== null) return keys;
      const lang = value['lang'];
      if (lang !== null && (typeof lang !== 'string' || !LANG.test(lang))) {
        return invalid('invalid-format', 'fence lang must be null or a short token without whitespace', `${path}.lang`);
      }
      return checkInertText(value['text'], `${path}.text`, MAX_PAGE_BLOB_BYTES);
    }
    case 'quote':
      return (
        checkKeys(value, ['type', 'children'], ['type', 'children'], path) ??
        checkChildren(value['children'], `${path}.children`, depth + 1, ctx, 'block', false)
      );
    case 'table': {
      const keys = checkKeys(value, ['type', 'align', 'header', 'rows'], ['type', 'align', 'header', 'rows'], path);
      if (keys !== null) return keys;
      const align = value['align'];
      if (!Array.isArray(align)) return invalid('wrong-type', 'align must be an array', `${path}.align`);
      if (align.length < 1 || align.length > MAX_TABLE_COLUMNS) {
        return invalid('out-of-range', `tables need 1..${MAX_TABLE_COLUMNS} columns`, `${path}.align`);
      }
      for (const [i, a] of align.entries()) {
        if (!ALIGNS.includes(a)) return invalid('invalid-format', 'align must be left, center, right or null', `${path}.align[${i}]`);
      }
      const header = checkRow(value['header'], `${path}.header`, depth + 1, ctx, align.length);
      if (header !== null) return header;
      const rows = value['rows'];
      if (!Array.isArray(rows)) return invalid('wrong-type', 'rows must be an array', `${path}.rows`);
      for (const [i, row] of rows.entries()) {
        const error = checkRow(row, `${path}.rows[${i}]`, depth + 1, ctx, align.length);
        if (error !== null) return error;
      }
      return null;
    }
    case 'text':
    case 'inlineCode':
      return checkKeys(value, ['type', 'value'], ['type', 'value'], path) ?? checkInertText(value['value'], `${path}.value`, MAX_PAGE_BLOB_BYTES);
    case 'emphasis': {
      const keys = checkKeys(value, ['type', 'strong', 'children'], ['type', 'strong', 'children'], path);
      if (keys !== null) return keys;
      if (typeof value['strong'] !== 'boolean') return invalid('wrong-type', 'strong must be a boolean', `${path}.strong`);
      return checkChildren(value['children'], `${path}.children`, depth + 1, ctx, 'inline', inLink);
    }
    case 'link': {
      if (inLink) return invalid('wrong-context', 'links cannot nest', `${path}.type`);
      return (
        checkKeys(value, ['type', 'target', 'children'], ['type', 'target', 'children'], path) ??
        checkLinkTarget(value['target'], `${path}.target`) ??
        checkChildren(value['children'], `${path}.children`, depth + 1, ctx, 'inline', true)
      );
    }
    default:
      return invalid('unknown-node-type', `unknown node type "${type}"`, `${path}.type`);
  }
}

export function checkMarkdownDocument(value: unknown, path: string = '$'): WikiError | null {
  if (!isRecord(value)) return invalid('wrong-type', 'document must be an object', path);
  if (value['type'] !== 'document') return invalid('unknown-node-type', 'root node must be a document', `${path}.type`);
  const keys = checkKeys(value, ['type', 'children'], ['type', 'children'], path);
  if (keys !== null) return keys;
  return checkChildren(value['children'], `${path}.children`, 1, { nodes: 1 }, 'block', false);
}

/**
 * Structural validator for the safe AST: closed node set, closed property sets, inert text,
 * no images, no HTML nodes, only allow-listed link targets, bounded depth and node count.
 */
export function validateMarkdownDocument(value: unknown): WikiResult<MarkdownDocument> {
  return resultOf(checkMarkdownDocument(value), value as MarkdownDocument);
}
