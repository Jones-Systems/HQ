// Block-level Markdown parser (a CommonMark/GFM subset) producing the draft tree.
//
// Supported blocks: ATX/setext headings, paragraphs, nested ordered/bullet lists, fenced and indented
// code, block quotes, GFM tables. Excluded constructs stay verbatim text in a paragraph: thematic
// breaks, HTML blocks, footnote definitions and tables wider than the contract allows.

import { MAX_TABLE_COLUMNS, type TableAlign } from '../../contract/src/index.ts';
import { Overflow, type DraftBlock, type DraftInline } from './draft.ts';
import { normalizeRefLabel, parseInline, type InlineContext } from './markdown-inline.ts';

/** Deepest allowed container (quote / list item) nesting; keeps the final AST inside the contract depth. */
export const MAX_CONTAINER_DEPTH = 24;

const LANG = /^[^\s\u0000-\u001f\u007f-\u009f]{1,64}$/;
const BLANK = /^[ \t]*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;
const THEMATIC = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const QUOTE = /^ {0,3}>[ ]?/;
const FOOTNOTE_DEF = /^ {0,3}\[\^[^\]\s]+\]:/;
const DEFINITION =
  /^ {0,3}\[((?:[^\]\\\n]|\\.){1,999})\]:[ \t]*(?:<([^<>\n]*)>|(\S+))(?:[ \t]+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^)\\]|\\.)*\)))?[ \t]*$/;
const BLOCK_TAGS =
  'address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|section|source|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul';
const HTML_STARTS: readonly { readonly start: RegExp; readonly end: RegExp | null }[] = [
  { start: /^ {0,3}<(?:script|pre|style|textarea)(?:\s|>|$)/i, end: /<\/(?:script|pre|style|textarea)>/i },
  { start: /^ {0,3}<!--/, end: /-->/ },
  { start: /^ {0,3}<\?/, end: /\?>/ },
  { start: /^ {0,3}<![A-Za-z]/, end: />/ },
  { start: /^ {0,3}<!\[CDATA\[/, end: /\]\]>/ },
  { start: new RegExp(`^ {0,3}</?(?:${BLOCK_TAGS})(?:\\s|/?>|$)`, 'i'), end: null },
];

type Pre =
  | { readonly type: 'heading'; readonly depth: 1 | 2 | 3 | 4 | 5 | 6; readonly raw: string }
  | { readonly type: 'paragraph'; readonly raw: string }
  | { readonly type: 'verbatim'; readonly raw: string }
  | { readonly type: 'list'; readonly ordered: boolean; readonly start: number | null; readonly items: readonly (readonly Pre[])[] }
  | { readonly type: 'fence'; readonly lang: string | null; readonly text: string }
  | { readonly type: 'quote'; readonly children: readonly Pre[] }
  | { readonly type: 'table'; readonly align: readonly TableAlign[]; readonly header: readonly string[]; readonly rows: readonly (readonly string[])[] };

interface State {
  readonly defs: Map<string, string>;
}

// ---- column helpers (tabs advance to the next multiple of 4) ----

function isBlank(line: string): boolean {
  return BLANK.test(line);
}

function indentOf(line: string): number {
  let col = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charCodeAt(i);
    if (ch === 32) col++;
    else if (ch === 9) col += 4 - (col % 4);
    else break;
  }
  return col;
}

/** Remove up to `cols` columns of leading whitespace; a tab straddling the cut leaves spaces behind. */
function stripCols(line: string, cols: number): string {
  let col = 0;
  let i = 0;
  while (i < line.length && col < cols) {
    const ch = line.charCodeAt(i);
    if (ch === 32) {
      col++;
      i++;
    } else if (ch === 9) {
      const width = 4 - (col % 4);
      if (col + width > cols) return ' '.repeat(col + width - cols) + line.slice(i + 1);
      col += width;
      i++;
    } else break;
  }
  return line.slice(i);
}

// ---- block start detectors ----

interface FenceOpen {
  readonly indent: number;
  readonly char: string;
  readonly length: number;
  readonly info: string;
}

function fenceOpen(line: string): FenceOpen | null {
  const match = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/.exec(line);
  if (match === null) return null;
  const marker = match[2] as string;
  const info = (match[3] as string).trim();
  if (marker[0] === '`' && info.includes('`')) return null;
  return { indent: (match[1] as string).length, char: marker[0] as string, length: marker.length, info };
}

interface ListMarker {
  readonly ordered: boolean;
  readonly bullet: string;
  readonly delimiter: string;
  readonly number: number;
  readonly contentOffset: number;
  readonly empty: boolean;
  /** The item's first line with the marker (and its separating spaces) removed. */
  readonly first: string;
}

function listMarker(line: string): ListMarker | null {
  const indent = indentOf(line);
  if (indent >= 4) return null;
  const lead = (/^[ \t]*/.exec(line) as RegExpExecArray)[0].length;
  const s = line.slice(lead);
  let markerLen: number;
  let ordered = false;
  let bullet = '';
  let delimiter = '';
  let number = 0;
  const b = /^([-+*])(?=[ \t]|$)/.exec(s);
  if (b !== null) {
    markerLen = 1;
    bullet = b[1] as string;
  } else {
    const o = /^(\d{1,9})([.)])(?=[ \t]|$)/.exec(s);
    if (o === null) return null;
    ordered = true;
    markerLen = (o[1] as string).length + 1;
    number = Number(o[1]);
    delimiter = o[2] as string;
  }
  const after = s.slice(markerLen);
  const spaces = (/^[ \t]*/.exec(after) as RegExpExecArray)[0];
  const rest = after.slice(spaces.length);
  const markerEnd = indent + markerLen;
  if (rest === '') return { ordered, bullet, delimiter, number, contentOffset: markerEnd + 1, empty: true, first: '' };
  let width = 0;
  for (const ch of spaces) width += ch === '\t' ? 4 - ((markerEnd + width) % 4) : 1;
  // Five or more spaces after the marker: the content starts one column in and is indented code.
  const first = width >= 5 ? ' '.repeat(width - 1) + rest : rest;
  return { ordered, bullet, delimiter, number, contentOffset: width >= 5 ? markerEnd + 1 : markerEnd + width, empty: false, first };
}

function sameList(a: ListMarker, b: ListMarker): boolean {
  return a.ordered === b.ordered && (a.ordered ? a.delimiter === b.delimiter : a.bullet === b.bullet);
}

function htmlStart(line: string): (typeof HTML_STARTS)[number] | null {
  for (const kind of HTML_STARTS) if (kind.start.test(line)) return kind;
  return null;
}

/** Whether `line` ends a paragraph that is in progress. */
function interruptsParagraph(line: string): boolean {
  if (indentOf(line) >= 4) return false;
  if (ATX.test(line) || fenceOpen(line) !== null || QUOTE.test(line) || THEMATIC.test(line) || htmlStart(line) !== null) return true;
  const marker = listMarker(line);
  return marker !== null && !marker.empty && (!marker.ordered || marker.number === 1);
}

/** Whether `line` can still be continued lazily by a following unindented line. */
function paragraphLike(line: string): boolean {
  return !isBlank(line) && indentOf(line) < 4 && !ATX.test(line) && fenceOpen(line) === null && !THEMATIC.test(line) && htmlStart(line) === null;
}

// ---- tables ----

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string;
    if (ch === '\\' && i + 1 < s.length) {
      cell += ch + s[i + 1];
      i++;
    } else if (ch === '|') {
      cells.push(cell.trim());
      cell = '';
    } else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

function delimiterAlign(line: string, columns: number): TableAlign[] | null {
  if (indentOf(line) >= 4 || !line.includes('-')) return null;
  const cells = splitRow(line);
  if (cells.length !== columns) return null;
  const align: TableAlign[] = [];
  for (const cell of cells) {
    if (!/^:?-+:?$/.test(cell)) return null;
    const left = cell.startsWith(':');
    const right = cell.endsWith(':');
    align.push(left && right ? 'center' : left ? 'left' : right ? 'right' : null);
  }
  return align;
}

// ---- main loop ----

function parseBlocks(lines: readonly string[], depth: number, state: State): Pre[] {
  if (depth > MAX_CONTAINER_DEPTH) throw new Overflow();
  const out: Pre[] = [];
  const n = lines.length;
  let i = 0;
  while (i < n) {
    const line = lines[i] as string;
    if (isBlank(line)) {
      i++;
      continue;
    }

    if (indentOf(line) >= 4) {
      let last = i;
      for (let j = i; j < n; j++) {
        const l = lines[j] as string;
        if (isBlank(l)) continue;
        if (indentOf(l) < 4) break;
        last = j;
      }
      const text: string[] = [];
      for (let j = i; j <= last; j++) {
        const l = lines[j] as string;
        text.push(isBlank(l) ? '' : stripCols(l, 4));
      }
      out.push({ type: 'fence', lang: null, text: text.join('\n') + '\n' });
      i = last + 1;
      continue;
    }

    const fence = fenceOpen(line);
    if (fence !== null) {
      const text: string[] = [];
      const closer = new RegExp(`^ {0,3}${fence.char === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`);
      let j = i + 1;
      while (j < n && !closer.test(lines[j] as string)) {
        text.push(stripCols(lines[j] as string, fence.indent));
        j++;
      }
      const word = fence.info.split(/\s+/)[0] ?? '';
      out.push({ type: 'fence', lang: LANG.test(word) ? word : null, text: text.map((t) => t + '\n').join('') });
      i = j + 1;
      continue;
    }

    const atx = ATX.exec(line);
    if (atx !== null) {
      const content = (atx[2] ?? '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim();
      out.push({ type: 'heading', depth: (atx[1] as string).length as 1 | 2 | 3 | 4 | 5 | 6, raw: content });
      i++;
      continue;
    }

    if (THEMATIC.test(line)) {
      out.push({ type: 'verbatim', raw: line.trim() });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const content: string[] = [];
      let j = i;
      while (j < n) {
        const l = lines[j] as string;
        if (QUOTE.test(l)) {
          content.push(l.replace(QUOTE, ''));
        } else if (
          !isBlank(l) &&
          content.length > 0 &&
          paragraphLike(content[content.length - 1] as string) &&
          !interruptsParagraph(l) &&
          listMarker(l) === null
        ) {
          content.push(l);
        } else break;
        j++;
      }
      out.push({ type: 'quote', children: parseBlocks(content, depth + 1, state) });
      i = j;
      continue;
    }

    const first = listMarker(line);
    if (first !== null) {
      const items: Pre[][] = [];
      let current: ListMarker = first;
      let start = i;
      let next = i;
      for (;;) {
        const itemLines: string[] = [current.first];
        let k = start + 1;
        let blanks = 0;
        while (k < n) {
          const l = lines[k] as string;
          if (isBlank(l)) {
            if (itemLines.length === 1 && itemLines[0] === '' && current.empty) break;
            blanks++;
            k++;
            continue;
          }
          if (indentOf(l) >= current.contentOffset) {
            for (; blanks > 0; blanks--) itemLines.push('');
            itemLines.push(stripCols(l, current.contentOffset));
            k++;
            continue;
          }
          const prev = itemLines[itemLines.length - 1] as string;
          if (blanks === 0 && paragraphLike(prev) && !interruptsParagraph(l) && listMarker(l) === null) {
            itemLines.push(l.trimStart());
            k++;
            continue;
          }
          break;
        }
        items.push(parseBlocks(itemLines, depth + 1, state));
        next = k - blanks;
        let m = k;
        while (m < n && isBlank(lines[m] as string)) m++;
        const sibling = m < n && !THEMATIC.test(lines[m] as string) ? listMarker(lines[m] as string) : null;
        if (sibling !== null && sameList(first, sibling)) {
          current = sibling;
          start = m;
          continue;
        }
        break;
      }
      out.push({ type: 'list', ordered: first.ordered, start: first.ordered ? first.number : null, items });
      i = next;
      continue;
    }

    const html = htmlStart(line);
    if (html !== null) {
      const raw: string[] = [];
      let j = i;
      while (j < n) {
        const l = lines[j] as string;
        if (html.end === null && isBlank(l)) break;
        raw.push(l.trimEnd());
        j++;
        if (html.end !== null && html.end.test(l)) break;
      }
      out.push({ type: 'verbatim', raw: raw.join('\n') });
      i = j;
      continue;
    }

    if (line.includes('|') && i + 1 < n) {
      const header = splitRow(line);
      const align = delimiterAlign(lines[i + 1] as string, header.length);
      if (align !== null) {
        let j = i + 2;
        const rows: string[][] = [];
        while (j < n) {
          const l = lines[j] as string;
          if (isBlank(l) || interruptsParagraph(l)) break;
          const cells = splitRow(l);
          while (cells.length < header.length) cells.push('');
          rows.push(cells.slice(0, header.length));
          j++;
        }
        if (header.length > MAX_TABLE_COLUMNS) {
          out.push({ type: 'verbatim', raw: lines.slice(i, j).map((l) => l.trimEnd()).join('\n') });
        } else {
          out.push({ type: 'table', align, header, rows });
        }
        i = j;
        continue;
      }
    }

    // paragraph (possibly a setext heading, link reference definitions, or a verbatim footnote definition)
    const para: string[] = [line];
    let j = i + 1;
    let setext: 1 | 2 | null = null;
    while (j < n) {
      const l = lines[j] as string;
      if (isBlank(l)) break;
      if (indentOf(l) < 4) {
        const underline = SETEXT.exec(l);
        if (underline !== null) {
          setext = (underline[1] as string)[0] === '=' ? 1 : 2;
          j++;
          break;
        }
        if (interruptsParagraph(l)) break;
      }
      para.push(l);
      j++;
    }
    i = j;
    if (setext !== null) {
      out.push({ type: 'heading', depth: setext, raw: para.map((l) => l.trim()).join(' ') });
      continue;
    }
    if (FOOTNOTE_DEF.test(para[0] as string)) {
      out.push({ type: 'verbatim', raw: para.map((l) => l.trim()).join('\n') });
      continue;
    }
    while (para.length > 0) {
      const def = DEFINITION.exec(para[0] as string);
      if (def === null || (def[1] as string).startsWith('^')) break;
      const label = normalizeRefLabel(def[1] as string);
      if (label !== '' && !state.defs.has(label)) state.defs.set(label, ((def[2] ?? def[3]) as string).replace(/\\([!-/:-@[-`{-~])/g, '$1'));
      para.shift();
    }
    if (para.length > 0) out.push({ type: 'paragraph', raw: para.map((l) => l.trim()).join('\n') });
  }
  return out;
}

// ---- inline conversion ----

function convert(blocks: readonly Pre[], ctx: InlineContext): DraftBlock[] {
  const out: DraftBlock[] = [];
  const text = (value: string): DraftInline[] => (value === '' ? [] : [{ type: 'text', value }]);
  for (const block of blocks) {
    if (++ctx.budget.nodes > 200_000) throw new Overflow();
    switch (block.type) {
      case 'heading':
        out.push({ type: 'heading', depth: block.depth, children: parseInline(block.raw, ctx, false) });
        break;
      case 'paragraph':
        out.push({ type: 'paragraph', children: parseInline(block.raw, ctx, false) });
        break;
      case 'verbatim':
        out.push({ type: 'paragraph', children: text(block.raw) });
        break;
      case 'fence':
        out.push({ type: 'fence', lang: block.lang, text: block.text });
        break;
      case 'quote':
        out.push({ type: 'quote', children: convert(block.children, ctx) });
        break;
      case 'list':
        out.push({ type: 'list', ordered: block.ordered, start: block.start, items: block.items.map((item) => convert(item, ctx)) });
        break;
      case 'table':
        out.push({
          type: 'table',
          align: block.align,
          header: block.header.map((cell) => parseInline(cell, ctx, false)),
          rows: block.rows.map((row) => row.map((cell) => parseInline(cell, ctx, false))),
        });
        break;
    }
  }
  return out;
}

/** Parse block structure then inline content. Throws `Overflow` when a structural bound is exceeded. */
export function parseBlockDocument(lines: readonly string[]): readonly DraftBlock[] {
  const state: State = { defs: new Map() };
  const pre = parseBlocks(lines, 0, state);
  return convert(pre, { defs: state.defs, budget: { nodes: 0 } });
}
