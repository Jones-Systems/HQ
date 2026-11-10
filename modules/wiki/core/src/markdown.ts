// Markdown entry points: total functions over arbitrary text (they never throw for hostile input).

import { Overflow, collectLinks, type DraftDocument, type LinkRef } from './draft.ts';
import { parseBlockDocument } from './markdown-block.ts';
import { normalizeRefLabel, parseInline } from './markdown-inline.ts';

export type MarkdownParse =
  | { readonly ok: true; readonly doc: DraftDocument }
  /** A structural bound was exceeded: the page becomes raw text; `links` come from a flat scan. */
  | { readonly ok: false; readonly links: readonly LinkRef[] };

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/** Parse Markdown into the draft tree; structural overflow reports `ok: false` with scanned links. */
export function parseMarkdown(body: string): MarkdownParse {
  try {
    return { ok: true, doc: { type: 'document', children: parseBlockDocument(splitLines(body)) } };
  } catch (error) {
    if (error instanceof Overflow) return { ok: false, links: scanLinks(body) };
    throw error;
  }
}

const DEFINITION = /^ {0,3}\[((?:[^\]\\\n]|\\.){1,999})\]:[ \t]*(?:<([^<>\n]*)>|(\S+))(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_MARKER = /^[ \t]*(?:[-+*]|\d{1,9}[.)])[ \t]/;
const PREFIX = /^(?:[ \t]*>)*[ \t]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)*/;

/**
 * Best-effort link discovery for text the structured parser refused: skips fenced and indented
 * code, strips quote/list prefixes and reads inline links paragraph by paragraph. Used so a raw
 * page still contributes links and backlinks.
 */
export function scanLinks(body: string): LinkRef[] {
  const lines = splitLines(body);
  const defs = new Map<string, string>();
  for (const line of lines) {
    const match = DEFINITION.exec(line);
    if (match !== null && !(match[1] as string).startsWith('^')) {
      const label = normalizeRefLabel(match[1] as string);
      if (label !== '' && !defs.has(label)) defs.set(label, (match[2] ?? match[3]) as string);
    }
  }
  const out: LinkRef[] = [];
  const ctx = { defs, budget: { nodes: 0 } };
  let fence: string | null = null;
  let paragraph: string[] = [];
  let previousBlank = true;
  let inIndentedCode = false;
  const flush = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join('\n');
    paragraph = [];
    try {
      const nodes = parseInline(text, ctx, false);
      collectLinks({ type: 'document', children: [{ type: 'paragraph', children: nodes }] }).forEach((ref) => out.push(ref));
    } catch (error) {
      if (!(error instanceof Overflow)) throw error;
    }
  };
  for (const line of lines) {
    const open = FENCE.exec(line);
    if (fence !== null) {
      if (open !== null && (open[1] as string)[0] === fence[0] && (open[1] as string).length >= fence.length && line.trim() === open[1]) fence = null;
      continue;
    }
    if (open !== null) {
      flush();
      fence = open[1] as string;
      continue;
    }
    const blank = /^[ \t]*$/.test(line);
    const wasBlank = previousBlank;
    previousBlank = blank;
    if (blank) {
      inIndentedCode = false;
      flush();
      continue;
    }
    if (/^( {4}|\t)/.test(line) && (wasBlank || inIndentedCode) && !LIST_MARKER.test(line)) {
      inIndentedCode = true;
      flush();
      continue;
    }
    inIndentedCode = false;
    if (DEFINITION.test(line)) continue;
    paragraph.push(line.replace(PREFIX, ''));
  }
  flush();
  return out;
}
