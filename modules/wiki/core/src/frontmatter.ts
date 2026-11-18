// Generic frontmatter parser for a bounded scalar/list grammar. It accepts a small, strict subset of
// YAML and refuses everything else (`unsupported`) so the page can fall back to readable raw text
// instead of silently losing values.
//
// Accepted: `key: scalar`, block lists (`- item`), flow lists (`[a, "b"]`), comments, quoted values
// with bounded escapes, decimal numbers, true/false. `yes`/`no` stay strings.
// Null (`null`, `~`, empty) fields and null list items are omitted, never coerced.
// Refused: duplicate or invalid keys, nested maps, anchors/aliases/tags, block scalars, multi-line
// values, unclosed delimiters and any structural overflow.

import {
  MAX_FIELD_LIST_ITEMS,
  MAX_FIELD_NAME_LENGTH,
  MAX_FIELD_VALUE_LENGTH,
  MAX_FIELDS,
  type FieldScalar,
  type FieldValue,
  type PageField,
} from '../../contract/src/index.ts';

export type FrontmatterResult =
  | { readonly status: 'none'; readonly body: string }
  | { readonly status: 'ok'; readonly fields: readonly PageField[]; readonly nullOmissions: number; readonly body: string }
  | { readonly status: 'unsupported'; readonly body: string };

/** Hard bounds of the frontmatter block itself (the contract bounds the parsed values). */
const MAX_FRONTMATTER_LINES = 4096;
const MAX_FRONTMATTER_CHARS = 256 * 1024;

const OPENING = /^---[ \t]*(?:\r\n|\n|\r|$)/;
const CLOSING = /^(?:---|\.\.\.)[ \t]*$/;
const KEY_LINE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)[ \t]*:(?:[ \t]+(.*))?$/;
const LIST_ITEM = /^([ \t]*)-(?:[ \t]+(.*))?$/;
const DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const FIELD_NAME_RESERVED: readonly string[] = ['__proto__', 'constructor', 'prototype'];
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const UNSUPPORTED_LEAD = new Set(['{', '&', '*', '!', '|', '>', '%', '@', '`']);

class Unsupported extends Error {}

function fail(): never {
  throw new Unsupported();
}

interface Counter {
  nulls: number;
}

/** A scalar parse yields `undefined` for null (omitted) so callers can count and skip it. */
type Parsed = FieldScalar | undefined;

function checkValue(value: FieldScalar): FieldScalar {
  if (typeof value === 'string') {
    if (value.length > MAX_FIELD_VALUE_LENGTH || value.includes('\u0000') || LONE_SURROGATE.test(value)) fail();
  } else if (typeof value === 'number' && !Number.isFinite(value)) fail();
  return value;
}

function afterQuote(rest: string): void {
  const trimmed = rest.trim();
  if (trimmed === '') return;
  if (/^[ \t]/.test(rest) && trimmed.startsWith('#')) return;
  fail();
}

/** Parse a double-quoted scalar starting at `text[0]`; returns the value and the index after the closing quote. */
function readDoubleQuoted(text: string): [string, number] {
  let out = '';
  for (let i = 1; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === '"') return [out, i + 1];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = text[++i];
    switch (next) {
      case '\\':
      case '"':
      case '/':
        out += next;
        break;
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case 'x':
      case 'u': {
        const width = next === 'x' ? 2 : 4;
        const hex = text.slice(i + 1, i + 1 + width);
        if (hex.length !== width || !/^[0-9A-Fa-f]+$/.test(hex)) fail();
        out += String.fromCharCode(parseInt(hex, 16));
        i += width;
        break;
      }
      default:
        fail();
    }
  }
  return fail();
}

function readSingleQuoted(text: string): [string, number] {
  let out = '';
  for (let i = 1; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch !== "'") {
      out += ch;
      continue;
    }
    if (text[i + 1] === "'") {
      out += "'";
      i++;
      continue;
    }
    return [out, i + 1];
  }
  return fail();
}

function plainScalar(raw: string, counter: Counter): Parsed {
  let text = raw;
  const comment = text.search(/[ \t]#/);
  if (comment >= 0) text = text.slice(0, comment);
  text = text.trim();
  if (text === '' || text === 'null' || text === '~') {
    counter.nulls++;
    return undefined;
  }
  if (text.endsWith(':') || text.includes(': ') || text.includes(':\t')) fail();
  if (text === '-' || text.startsWith('- ') || text.startsWith('? ')) fail();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (DECIMAL.test(text)) {
    const digits = text.replace(/[-.]/g, '').length;
    const number = Number(text);
    if (digits <= 15 && Number.isFinite(number) && !(number === 0 && text.startsWith('-'))) return number;
  }
  return checkValue(text);
}

/** Parse one scalar from the whole of `raw` (comments and surrounding whitespace allowed). */
function parseScalar(raw: string, counter: Counter): Parsed {
  const text = raw.replace(/^[ \t]+/, '');
  const lead = text[0];
  if (lead === '"') {
    const [value, end] = readDoubleQuoted(text);
    afterQuote(text.slice(end));
    return checkValue(value);
  }
  if (lead === "'") {
    const [value, end] = readSingleQuoted(text);
    afterQuote(text.slice(end));
    return checkValue(value);
  }
  if (lead !== undefined && (UNSUPPORTED_LEAD.has(lead) || lead === '[')) fail();
  return plainScalar(text, counter);
}

function parseFlowList(raw: string, counter: Counter): FieldScalar[] {
  const text = raw.trim();
  const items: FieldScalar[] = [];
  let i = 1;
  const skipSpace = () => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  };
  skipSpace();
  if (text[i] === ']') {
    i++;
  } else {
    for (;;) {
      skipSpace();
      const lead = text[i];
      let parsed: Parsed;
      if (lead === '"' || lead === "'") {
        const [value, end] = lead === '"' ? readDoubleQuoted(text.slice(i)) : readSingleQuoted(text.slice(i));
        i += end;
        parsed = checkValue(value);
      } else {
        const start = i;
        while (i < text.length && !',[]{}'.includes(text[i] as string)) i++;
        const plain = text.slice(start, i).trim();
        if (plain === '') fail();
        if (plain.includes(': ') || plain.endsWith(':') || plain.includes(' #')) fail();
        if (UNSUPPORTED_LEAD.has(plain[0] as string) || plain === '-' || plain.startsWith('- ')) fail();
        parsed = plainScalar(plain, counter);
      }
      if (parsed !== undefined) items.push(parsed);
      if (items.length > MAX_FIELD_LIST_ITEMS) fail();
      skipSpace();
      if (text[i] === ',') {
        i++;
        skipSpace();
        if (text[i] === ']') {
          i++;
          break;
        }
        continue;
      }
      if (text[i] === ']') {
        i++;
        break;
      }
      fail();
    }
  }
  afterQuote(text.slice(i));
  return items;
}

interface Line {
  readonly text: string;
}

function parseBlock(lines: readonly Line[]): { fields: PageField[]; nulls: number } {
  const counter: Counter = { nulls: 0 };
  const fields: PageField[] = [];
  const names = new Set<string>();
  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] as Line).text;
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      i++;
      continue;
    }
    if (/^[ \t]/.test(line)) fail();
    const match = KEY_LINE.exec(line);
    if (match === null) fail();
    const name = match[1] as string;
    if (name.length > MAX_FIELD_NAME_LENGTH || FIELD_NAME_RESERVED.includes(name) || names.has(name)) fail();
    names.add(name);
    const rest = (match[2] ?? '').trim();
    i++;

    let value: FieldValue | undefined;
    if (rest === '' || rest.startsWith('#')) {
      // Empty value: a block list if the next meaningful line is a list item, otherwise null.
      let j = i;
      while (j < lines.length && ((lines[j] as Line).text.trim() === '' || (lines[j] as Line).text.trimStart().startsWith('#'))) j++;
      const first = j < lines.length ? LIST_ITEM.exec((lines[j] as Line).text) : null;
      if (first === null) {
        counter.nulls++;
      } else {
        const indent = first[1] as string;
        const items: FieldScalar[] = [];
        let end = j;
        for (let k = j; k < lines.length; k++) {
          const text = (lines[k] as Line).text;
          if (text.trim() === '' || text.trimStart().startsWith('#')) continue;
          const item = LIST_ITEM.exec(text);
          if (item === null) break;
          if (item[1] !== indent) fail();
          const parsed = parseScalar(item[2] ?? '', counter);
          if (parsed !== undefined) items.push(parsed);
          if (items.length > MAX_FIELD_LIST_ITEMS) fail();
          end = k + 1;
        }
        value = items;
        i = end;
      }
    } else if (rest.startsWith('[')) {
      value = parseFlowList(rest, counter);
    } else {
      value = parseScalar(rest, counter);
    }
    if (value !== undefined) fields.push({ name, value });
    if (fields.length > MAX_FIELDS) fail();
  }
  return { fields, nulls: counter.nulls };
}

function splitLines(text: string): { lines: string[]; starts: number[] } {
  const lines: string[] = [];
  const starts: number[] = [];
  let pos = 0;
  while (pos <= text.length) {
    starts.push(pos);
    let end = pos;
    while (end < text.length && text.charCodeAt(end) !== 10 && text.charCodeAt(end) !== 13) end++;
    lines.push(text.slice(pos, end));
    if (end >= text.length) break;
    pos = end + (text.charCodeAt(end) === 13 && text.charCodeAt(end + 1) === 10 ? 2 : 1);
  }
  return { lines, starts };
}

/**
 * Split a decoded page into frontmatter fields and body. The text must already have its BOM
 * removed; a leading U+FEFF is tolerated anyway.
 */
export function parseFrontmatter(input: string): FrontmatterResult {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const opening = OPENING.exec(text);
  if (opening === null) return { status: 'none', body: text };

  const afterOpening = text.slice(opening[0].length);
  const { lines, starts } = splitLines(afterOpening);
  let close = -1;
  for (let i = 0; i < lines.length; i++) {
    if (CLOSING.test(lines[i] as string)) {
      close = i;
      break;
    }
  }
  if (close < 0) return { status: 'unsupported', body: afterOpening };

  const bodyStart = close + 1 < starts.length ? (starts[close + 1] as number) : afterOpening.length;
  const body = afterOpening.slice(bodyStart);
  if (close > MAX_FRONTMATTER_LINES || (starts[close] as number) > MAX_FRONTMATTER_CHARS) return { status: 'unsupported', body };

  try {
    const block = parseBlock(lines.slice(0, close).map((line) => ({ text: line })));
    return { status: 'ok', fields: block.fields, nullOmissions: block.nulls, body };
  } catch (error) {
    if (error instanceof Unsupported) return { status: 'unsupported', body };
    throw error;
  }
}
