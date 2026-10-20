// Small pure text helpers shared by the parser, indexer and service. No node:* imports.

import { MAX_LABEL_LENGTH } from '../../contract/src/index.ts';

const CONTROL_RUN = /[\u0000-\u001f\u007f-\u009f]+/g;
const WHITESPACE_RUN = /\s+/g;
const LONE_SURROGATE_G = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/** UTF-16 code-unit order (what `<` does on strings): deterministic and locale independent. */
export function compareUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function dropLoneSurrogates(text: string): string {
  return text.replace(LONE_SURROGATE_G, '');
}

/** Cut to at most `max` UTF-16 units without splitting a surrogate pair. */
export function truncateUnits(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

/**
 * Single-line display text: controls become separators, whitespace collapses, lone surrogates drop,
 * and the result is truncated without breaking a surrogate pair. May return an empty string.
 */
export function cleanLabel(text: string, max: number = MAX_LABEL_LENGTH): string {
  const cleaned = dropLoneSurrogates(text).replace(CONTROL_RUN, ' ').replace(WHITESPACE_RUN, ' ').trim();
  return truncateUnits(cleaned, max).trim();
}

/** Alias identity: NFC, lowercase, collapsed whitespace. Page path identity is never normalised. */
export function normalizeAlias(text: string): string {
  return cleanLabel(text, 4096).normalize('NFC').toLowerCase();
}

const TOKEN = /[\p{L}\p{N}]+/gu;
const MAX_TOKEN_UNITS = 128;

/** Lowercase+NFC Unicode letter/number tokens. Over-long runs are dropped rather than indexed. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const match of text.normalize('NFC').toLowerCase().matchAll(TOKEN)) {
    if (match[0].length <= MAX_TOKEN_UNITS) out.push(match[0]);
  }
  return out;
}

/** FNV-1a, 64 bit, over UTF-16 code units. Not cryptographic: only for stable keys and ids. */
export function fnv64Hex(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

/** `a/b/c.md` -> `c.md`. */
export function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

/** `a/b/c.md` -> `a/b`; `c.md` -> ``. */
export function dirName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

/** File name without the profile's page extension (case-insensitive); falls back to the whole name. */
export function fileStem(path: string, extensions: readonly string[]): string {
  const name = baseName(path);
  const lower = name.toLowerCase();
  for (const ext of extensions) {
    if (lower.length > ext.length && lower.endsWith(ext)) return name.slice(0, name.length - ext.length);
  }
  return name;
}

/** Plain-text hash-safe slug: NFC lowercase, runs of non letter/number become one `-`. */
export function slugify(text: string, max: number): string {
  const slug = text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return truncateUnits(slug, max).replace(/-+$/g, '');
}
