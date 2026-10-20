// Inline Markdown parser producing draft inline nodes.
//
// Supported: emphasis/strong, inline code, inline/reference/shortcut links, autolinks, [[wiki|label]].
// Anything else stays verbatim text: HTML, images, footnote references, strikethrough, task markers,
// entities, and every link whose destination is rejected (unsafe scheme, anchor-only, empty, `//host`).
// A rejected link is kept as its exact source text and never rewritten into a different URL.

import { validateExternalUrl } from '../../contract/src/index.ts';
import { Overflow, type DraftInline, type RawLink } from './draft.ts';

export interface InlineContext {
  /** Link reference definitions: normalised label -> destination. */
  readonly defs: ReadonlyMap<string, string>;
  /** Shared node budget across the whole document. */
  readonly budget: { nodes: number };
}

const MAX_NODES = 200_000;
const MAX_DELIMITER_RUNS = 2000;
const MAX_SCAN_STEPS = 4_000_000;
const MAX_EMPHASIS_DEPTH = 24;
const MAX_WIKI_LENGTH = 1024;
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);
const SCHEME_LIKE = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/y;
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const PUNCTUATION = /[\p{P}\p{S}]/u;
const WHITESPACE = /[\s ]/;

/** Normalise a reference label: collapse whitespace, NFC, lowercase. */
export function normalizeRefLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim().normalize('NFC').toLowerCase();
}

function unescape(text: string): string {
  return text.replace(/\\([!-/:-@[-`{-~])/g, '$1');
}

interface Delimiter {
  readonly type: 'delim';
  readonly char: '*' | '_';
  count: number;
  readonly orig: number;
  readonly canOpen: boolean;
  readonly canClose: boolean;
}

type Item = DraftInline | Delimiter;

interface Emphasis {
  type: 'emphasis';
  strong: boolean;
  children: DraftInline[];
}

function isDelimiter(item: Item): item is Delimiter {
  return item.type === 'delim';
}

/** Classify a destination into a raw link, or null when the link must stay verbatim text. */
export function classifyDestination(raw: string): RawLink | null {
  const dest = raw.trim();
  if (dest === '' || dest.startsWith('#') || dest.startsWith('//')) return null;
  const scheme = SCHEME_LIKE.test(dest) ? dest.slice(0, dest.indexOf(':')).toLowerCase() : null;
  if (scheme !== null) {
    if (!SAFE_SCHEMES.has(scheme) || !validateExternalUrl(dest).ok) return null;
    return { kind: 'external', url: dest };
  }
  const cut = dest.search(/[?#]/);
  const path = cut < 0 ? dest : dest.slice(0, cut);
  return path === '' ? null : { kind: 'path', dest: path };
}

function charBefore(text: string, index: number): string {
  if (index <= 0) return ' ';
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) return text.slice(index - 2, index);
  return text[index - 1] as string;
}

function charAfter(text: string, index: number): string {
  if (index >= text.length) return ' ';
  const cp = text.codePointAt(index) as number;
  return String.fromCodePoint(cp);
}

interface BacktickIndex {
  /** run length -> sorted start offsets */
  readonly runs: Map<number, number[]>;
}

function indexBackticks(text: string): BacktickIndex {
  const runs = new Map<number, number[]>();
  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) !== 96) {
      i++;
      continue;
    }
    let j = i;
    while (j < text.length && text.charCodeAt(j) === 96) j++;
    const list = runs.get(j - i);
    if (list === undefined) runs.set(j - i, [i]);
    else list.push(i);
    i = j;
  }
  return { runs };
}

/** Start offset of the first run of exactly `length` backticks at or after `from`, or -1. */
function findBacktickRun(index: BacktickIndex, length: number, from: number): number {
  const list = index.runs.get(length);
  if (list === undefined) return -1;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((list[mid] as number) < from) lo = mid + 1;
    else hi = mid;
  }
  return lo < list.length ? (list[lo] as number) : -1;
}

interface Scan {
  steps: number;
}

function spend(scan: Scan, amount: number): void {
  scan.steps += amount;
  if (scan.steps > MAX_SCAN_STEPS) throw new Overflow();
}

/**
 * Pair every `[` with its closing `]` in one linear pass (escapes and code spans are skipped).
 * `pairs[open]` is the index of the matching `]`, or -1 when the bracket is unmatched.
 */
function matchBrackets(text: string, ticks: BacktickIndex): Int32Array {
  const pairs = new Int32Array(text.length).fill(-1);
  const stack: number[] = [];
  let j = 0;
  while (j < text.length) {
    const code = text.charCodeAt(j);
    if (code === 92) {
      j += 2;
    } else if (code === 96) {
      let k = j;
      while (k < text.length && text.charCodeAt(k) === 96) k++;
      const close = findBacktickRun(ticks, k - j, k);
      j = close >= 0 ? close + (k - j) : k;
    } else if (code === 91) {
      stack.push(j);
      j++;
    } else if (code === 93) {
      const open = stack.pop();
      if (open !== undefined) pairs[open] = j;
      j++;
    } else {
      j++;
    }
  }
  return pairs;
}

/** Longest destination or title the parser will look for after `(`; bounds work per bracket. */
const MAX_DEST_SCAN = 3072;

interface Dest {
  readonly dest: string;
  /** Index just after the closing `)`. */
  readonly end: number;
}

/** Parse `(dest "title")` whose `(` is at `open`. */
function parseInlineDest(text: string, open: number, scan: Scan): Dest | null {
  let j = open + 1;
  const limit = Math.min(text.length, open + 1 + MAX_DEST_SCAN);
  const skipSpace = () => {
    while (j < limit && /\s/.test(text[j] as string)) j++;
  };
  skipSpace();
  let dest = '';
  if (text[j] === '<') {
    const start = ++j;
    for (;;) {
      if (j >= limit || text[j] === '\n' || text[j] === '<') {
        spend(scan, j - open);
        return null;
      }
      if (text[j] === '\\') {
        j += 2;
        continue;
      }
      if (text[j] === '>') break;
      j++;
    }
    dest = unescape(text.slice(start, j));
    j++;
  } else {
    const start = j;
    let parens = 0;
    while (j < limit) {
      const ch = text[j] as string;
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (/\s/.test(ch) || ch.charCodeAt(0) < 32) break;
      if (ch === '(') parens++;
      else if (ch === ')') {
        if (parens === 0) break;
        parens--;
      }
      j++;
    }
    if (parens !== 0) {
      spend(scan, j - open);
      return null;
    }
    dest = unescape(text.slice(start, j));
  }
  spend(scan, j - open);
  const beforeTitle = j;
  skipSpace();
  const quote = text[j];
  if (j > beforeTitle && (quote === '"' || quote === "'" || quote === '(')) {
    const closer = quote === '(' ? ')' : quote;
    j++;
    for (;;) {
      if (j >= limit) {
        spend(scan, j - open);
        return null;
      }
      if (text[j] === '\\') {
        j += 2;
        continue;
      }
      if (text[j] === closer) break;
      j++;
    }
    j++;
    skipSpace();
  }
  if (text[j] !== ')') return null;
  spend(scan, j - open);
  return { dest, end: j + 1 };
}

function processEmphasis(items: Item[]): DraftInline[] {
  let ci = 0;
  while (ci < items.length) {
    const closer = items[ci] as Item;
    if (!isDelimiter(closer) || !closer.canClose || closer.count === 0) {
      ci++;
      continue;
    }
    let oi = -1;
    for (let k = ci - 1; k >= 0; k--) {
      const candidate = items[k] as Item;
      if (!isDelimiter(candidate) || candidate.char !== closer.char || !candidate.canOpen || candidate.count === 0) continue;
      const oddMatch =
        (candidate.canClose || closer.canOpen) && (candidate.orig + closer.orig) % 3 === 0 && !(candidate.orig % 3 === 0 && closer.orig % 3 === 0);
      if (oddMatch) continue;
      oi = k;
      break;
    }
    if (oi < 0) {
      ci++;
      continue;
    }
    const opener = items[oi] as Delimiter;
    const use = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
    const node: Emphasis = { type: 'emphasis', strong: use === 2, children: finalize(items.slice(oi + 1, ci)) };
    opener.count -= use;
    closer.count -= use;
    items.splice(oi + 1, ci - oi - 1, node);
    ci = oi + 2;
    if (opener.count === 0) {
      items.splice(oi, 1);
      ci--;
    }
    // A closer with characters left is tested again against earlier openers; an exhausted one is removed.
    if (closer.count === 0) items.splice(ci, 1);
  }
  return finalize(items);
}

/** Turn leftover delimiters into text, merge adjacent text and bound emphasis nesting. */
function finalize(items: readonly Item[]): DraftInline[] {
  const out: DraftInline[] = [];
  const push = (node: DraftInline) => {
    const last = out[out.length - 1];
    if (node.type === 'text') {
      if (node.value === '') return;
      if (last !== undefined && last.type === 'text') {
        out[out.length - 1] = { type: 'text', value: last.value + node.value };
        return;
      }
    }
    out.push(node);
  };
  for (const item of items) {
    if (isDelimiter(item)) push({ type: 'text', value: item.char.repeat(item.count) });
    else push(item);
  }
  return out;
}

function emphasisDepth(nodes: readonly DraftInline[]): number {
  let max = 0;
  for (const node of nodes) {
    if (node.type === 'emphasis') max = Math.max(max, 1 + emphasisDepth(node.children));
  }
  return max;
}

/**
 * Parse inline Markdown. `inLink` is true inside a link label, where links cannot nest: bracket
 * constructs stay literal text there.
 */
export function parseInline(text: string, ctx: InlineContext, inLink: boolean): DraftInline[] {
  const items: Item[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer !== '') {
      items.push({ type: 'text', value: buffer });
      buffer = '';
    }
  };
  const emit = (node: DraftInline) => {
    flush();
    items.push(node);
    if (++ctx.budget.nodes > MAX_NODES) throw new Overflow();
  };
  const scan: Scan = { steps: 0 };
  const ticks = indexBackticks(text);
  const pairs = text.includes('[') ? matchBrackets(text, ticks) : new Int32Array(0);
  let delimiterRuns = 0;
  let i = 0;

  const makeLink = (dest: string, label: string, start: number, end: number): boolean => {
    const link = classifyDestination(dest);
    if (link === null) {
      buffer += text.slice(start, end);
      return true;
    }
    emit({ type: 'link', link, children: parseInline(label, ctx, true) });
    return true;
  };

  while (i < text.length) {
    const ch = text[i] as string;
    switch (ch) {
      case '\\': {
        const next = text[i + 1];
        if (next !== undefined && ASCII_PUNCTUATION.test(next)) {
          buffer += next;
          i += 2;
        } else if (next === '\n') {
          buffer += '\n';
          i += 2;
        } else {
          buffer += ch;
          i++;
        }
        break;
      }
      case '`': {
        let end = i;
        while (end < text.length && text.charCodeAt(end) === 96) end++;
        const length = end - i;
        const close = findBacktickRun(ticks, length, end);
        if (close < 0) {
          buffer += text.slice(i, end);
          i = end;
          break;
        }
        let code = text.slice(end, close).replace(/\n/g, ' ');
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim() !== '') code = code.slice(1, -1);
        emit({ type: 'inlineCode', value: code });
        i = close + length;
        break;
      }
      case '<': {
        AUTOLINK.lastIndex = i;
        const match = AUTOLINK.exec(text);
        if (match === null) {
          buffer += ch;
          i++;
          break;
        }
        const url = match[1] as string;
        const scheme = url.slice(0, url.indexOf(':')).toLowerCase();
        if (inLink || !SAFE_SCHEMES.has(scheme) || !validateExternalUrl(url).ok) {
          buffer += match[0];
        } else {
          emit({ type: 'link', link: { kind: 'external', url }, children: [{ type: 'text', value: url }] });
        }
        i += match[0].length;
        break;
      }
      case '!': {
        // Images are not part of the safe AST: a well-formed image stays verbatim text and yields no link.
        if (text[i + 1] === '[' && !inLink) {
          const close = pairs[i + 1] as number;
          if (close > 0) {
            let end = -1;
            if (text[close + 1] === '(') {
              const dest = parseInlineDest(text, close + 1, scan);
              if (dest !== null) end = dest.end;
            } else if (text[close + 1] === '[') {
              const refClose = pairs[close + 1] as number;
              if (refClose > 0) end = refClose + 1;
            }
            if (end > 0) {
              buffer += text.slice(i, end);
              i = end;
              break;
            }
          }
        }
        buffer += ch;
        i++;
        break;
      }
      case '[': {
        if (inLink) {
          buffer += ch;
          i++;
          break;
        }
        if (text[i + 1] === '[') {
          const relative = text.slice(i + 2, i + 2 + MAX_WIKI_LENGTH).indexOf(']]');
          const close = relative < 0 ? -1 : i + 2 + relative;
          if (close > 0) {
            const inner = text.slice(i + 2, close);
            if (!/[[\]\n]/.test(inner) && inner.trim() !== '') {
              const bar = inner.indexOf('|');
              const targetRaw = bar < 0 ? inner : inner.slice(0, bar);
              const labelRaw = bar < 0 ? inner : inner.slice(bar + 1);
              const hash = targetRaw.indexOf('#');
              const target = (hash < 0 ? targetRaw : targetRaw.slice(0, hash)).trim();
              if (target === '' || target.startsWith('^')) {
                buffer += text.slice(i, close + 2);
              } else {
                const label = labelRaw.trim() === '' ? targetRaw.trim() : labelRaw.trim();
                emit({ type: 'link', link: { kind: 'wiki', target }, children: [{ type: 'text', value: label }] });
              }
              i = close + 2;
              break;
            }
          }
        }
        const close = pairs[i] as number;
        if (close < 0) {
          buffer += ch;
          i++;
          break;
        }
        const label = text.slice(i + 1, close);
        if (label.startsWith('^')) {
          buffer += ch;
          i++;
          break;
        }
        const next = text[close + 1];
        if (next === '(') {
          const dest = parseInlineDest(text, close + 1, scan);
          if (dest !== null) {
            makeLink(dest.dest, label, i, dest.end);
            i = dest.end;
            break;
          }
        } else if (next === '[') {
          const refClose = pairs[close + 1] as number;
          if (refClose > 0) {
            const refLabel = text.slice(close + 2, refClose);
            const def = ctx.defs.get(normalizeRefLabel(refLabel === '' ? label : refLabel));
            if (def !== undefined) {
              makeLink(def, label, i, refClose + 1);
              i = refClose + 1;
              break;
            }
          }
        } else {
          const def = ctx.defs.get(normalizeRefLabel(label));
          if (def !== undefined) {
            makeLink(def, label, i, close + 1);
            i = close + 1;
            break;
          }
        }
        buffer += ch;
        i++;
        break;
      }
      case '*':
      case '_': {
        let end = i;
        while (end < text.length && text[end] === ch) end++;
        const count = end - i;
        const before = charBefore(text, i);
        const after = charAfter(text, end);
        const beforeSpace = WHITESPACE.test(before);
        const afterSpace = WHITESPACE.test(after);
        const beforePunct = PUNCTUATION.test(before);
        const afterPunct = PUNCTUATION.test(after);
        const left = !afterSpace && (!afterPunct || beforeSpace || beforePunct);
        const right = !beforeSpace && (!beforePunct || afterSpace || afterPunct);
        const canOpen = ch === '*' ? left : left && (!right || beforePunct);
        const canClose = ch === '*' ? right : right && (!left || afterPunct);
        if (++delimiterRuns > MAX_DELIMITER_RUNS || (!canOpen && !canClose)) {
          buffer += text.slice(i, end);
        } else {
          flush();
          items.push({ type: 'delim', char: ch, count, orig: count, canOpen, canClose });
          if (++ctx.budget.nodes > MAX_NODES) throw new Overflow();
        }
        i = end;
        break;
      }
      case '\n': {
        buffer = buffer.replace(/[ \t]+$/, '') + '\n';
        i++;
        while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
        break;
      }
      default:
        buffer += ch;
        i++;
    }
  }
  flush();
  const result = processEmphasis(items);
  if (emphasisDepth(result) > MAX_EMPHASIS_DEPTH) throw new Overflow();
  return result;
}
