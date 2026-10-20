// Hard limits, validators and clamps. The service rejects over-limit input (validate*)
// and bounds its own output lists (clamp*).

import { codePointLength, hasControlChar, hasLoneSurrogate, utf8ByteLength } from './guard.ts';
import { invalid, resultOf, type WikiError, type WikiResult } from './result.ts';

/** Maximum search query length, counted in Unicode code points. */
export const MAX_QUERY_LENGTH = 256;

/** Maximum number of results (search hits, backlinks, topic page previews) in one response. */
export const MAX_RESULTS = 50;

/**
 * Maximum page blob size: 2 MiB = 2 * 1024 * 1024 = 2_097_152 bytes.
 * The plan says "2 MB"; the binary reading is chosen because blob sizes are byte counts
 * and 2 MiB is the larger reading, so a conforming adapter that enforces the decimal
 * reading (2_000_000) is merely stricter and stays compatible. The owner may tighten it.
 */
export const MAX_PAGE_BLOB_BYTES = 2 * 1024 * 1024;

// Structural bounds chosen by this contract (not named in the plan).
export const MAX_PATH_LENGTH = 1024;
export const MAX_SEGMENT_LENGTH = 255;
export const MAX_ALIAS_LENGTH = 256;
export const MAX_LABEL_LENGTH = 256;
export const MAX_TOPIC_ID_LENGTH = 128;
export const MAX_SNIPPET_LENGTH = 512;
export const MAX_URL_LENGTH = 2048;
export const MAX_DESTINATION_LENGTH = 16384;
export const MAX_OUT_LINKS = 1000;
export const MAX_FIELDS = 64;
export const MAX_FIELD_NAME_LENGTH = 64;
export const MAX_FIELD_LIST_ITEMS = 64;
export const MAX_FIELD_VALUE_LENGTH = 2048;
export const MAX_TOPICS = 500;
export const MAX_AST_DEPTH = 64;
export const MAX_AST_NODES = 200_000;
export const MAX_TABLE_COLUMNS = 64;

export function checkQuery(value: unknown, path: string = '$'): WikiError | null {
  if (typeof value !== 'string') return invalid('wrong-type', 'query must be a string', path);
  // Every code point is at most two UTF-16 units, so this is a cheap pre-check before scanning.
  if (value.length > MAX_QUERY_LENGTH * 2) return invalid('too-long', `query exceeds ${MAX_QUERY_LENGTH} characters`, path);
  if (value.includes('\u0000')) return invalid('nul', 'query contains NUL', path);
  if (hasControlChar(value)) return invalid('control-character', 'query contains a control character', path);
  if (hasLoneSurrogate(value)) return invalid('lone-surrogate', 'query contains a lone surrogate', path);
  if (value.trim().length === 0) return invalid('empty', 'query is empty', path);
  if (codePointLength(value) > MAX_QUERY_LENGTH) return invalid('too-long', `query exceeds ${MAX_QUERY_LENGTH} characters`, path);
  return null;
}

/** Accepts 1..256 code points of non-blank text without control characters. */
export function validateQuery(value: unknown): WikiResult<string> {
  return resultOf(checkQuery(value), value as string);
}

/** Truncate to 256 code points (for input fields). The result may still fail `validateQuery`. */
export function clampQuery(text: string): string {
  return Array.from(text.slice(0, MAX_QUERY_LENGTH * 2))
    .slice(0, MAX_QUERY_LENGTH)
    .join('');
}

export function checkResultLimit(value: unknown, path: string = '$'): WikiError | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return invalid('wrong-type', 'limit must be an integer', path);
  if (value < 1 || value > MAX_RESULTS) return invalid('out-of-range', `limit must be within 1..${MAX_RESULTS}`, path);
  return null;
}

/** Accepts integers 1..50. */
export function validateResultLimit(value: unknown): WikiResult<number> {
  return resultOf(checkResultLimit(value), value as number);
}

/** Coerce any value into an integer within 1..50; non-numbers and NaN yield `fallback` (itself clamped). */
export function clampResultLimit(value: unknown, fallback: number = MAX_RESULTS): number {
  const n = typeof value === 'number' && !Number.isNaN(value) ? value : fallback;
  return Math.min(MAX_RESULTS, Math.max(1, Math.floor(n)));
}

/** Accepts integer byte counts 0..MAX_PAGE_BLOB_BYTES inclusive. */
export function validatePageBlobSize(bytes: unknown): WikiResult<number> {
  return resultOf(checkPageBlobSize(bytes), bytes as number);
}

export function checkPageBlobSize(bytes: unknown, path: string = '$'): WikiError | null {
  if (typeof bytes !== 'number' || !Number.isInteger(bytes)) return invalid('wrong-type', 'blob size must be an integer', path);
  if (bytes < 0) return invalid('out-of-range', 'blob size cannot be negative', path);
  if (bytes > MAX_PAGE_BLOB_BYTES) return invalid('too-large', `blob exceeds ${MAX_PAGE_BLOB_BYTES} bytes`, path);
  return null;
}

/** Accepts text whose UTF-8 encoding is at most MAX_PAGE_BLOB_BYTES. */
export function validatePageText(text: unknown): WikiResult<string> {
  if (typeof text !== 'string') return resultOf(invalid('wrong-type', 'page text must be a string'), '');
  const error = utf8ByteLength(text) > MAX_PAGE_BLOB_BYTES ? invalid('too-large', `page text exceeds ${MAX_PAGE_BLOB_BYTES} bytes`) : null;
  return resultOf(error, text);
}
