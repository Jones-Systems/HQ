// Shape classifiers and small statistics. Every function here maps data to a member of a fixed
// enumeration or to a number, so the report can be built from categories and counts only: no label,
// path or name ever flows into the output.

import { MAX_RESULTS, type LinkTarget } from '../../contract/src/index.ts';

export const LINK_KINDS = ['page', 'missing', 'ambiguous', 'external'] as const satisfies readonly LinkTarget['kind'][];
export type LinkKind = (typeof LINK_KINDS)[number];

/** Shape of an unresolved link label, judged from the label alone (a heuristic, never an identity). */
export const MISSING_SHAPES = ['non-page-extension', 'md-path-not-found', 'path-like', 'slug-like', 'title-like', 'other'] as const;
export type MissingShape = (typeof MISSING_SHAPES)[number];

const EXTENSION_TAIL = /.\.[a-z][a-z0-9]{0,15}$/;
const SLUG = /^[\p{L}\p{N}][\p{L}\p{N}._~-]*$/u;
const RELATIVE_PREFIX = /^(?:\.{1,2}\/|\/)/;

/**
 * Categorise a missing-link label by shape. `md-path-not-found` means the label ends with one of the
 * profile's page extensions (whatever they are); `non-page-extension` means it ends with any other
 * dot-extension; `path-like` has a slash and no whitespace; `title-like` has whitespace or an upper-case
 * letter; `slug-like` is one run of lower-case or caseless letters and digits joined by `-_.~`; everything else is `other`.
 */
export function missingShape(label: string, pageExtensions: readonly string[]): MissingShape {
  const lower = label.toLowerCase();
  const spaced = /\s/.test(label);
  if (!spaced && pageExtensions.some((ext) => lower.length > ext.length && lower.endsWith(ext))) return 'md-path-not-found';
  if (!spaced && EXTENSION_TAIL.test(lower)) return 'non-page-extension';
  if (!spaced && (label.includes('/') || RELATIVE_PREFIX.test(label))) return 'path-like';
  if (spaced || /\p{Lu}/u.test(label)) return /\p{L}/u.test(label) ? 'title-like' : 'other';
  return SLUG.test(label) ? 'slug-like' : 'other';
}

/** Candidate-count buckets of an ambiguous link target (2..MAX_RESULTS candidates; the last bucket is the cap). */
export const AMBIGUOUS_BUCKETS = ['2', '3', '4', '5-9', '10-24', '25-49', 'cap'] as const;
export type AmbiguousBucket = (typeof AMBIGUOUS_BUCKETS)[number];

export function ambiguousBucket(candidates: number): AmbiguousBucket {
  if (candidates >= MAX_RESULTS) return 'cap';
  if (candidates >= 25) return '25-49';
  if (candidates >= 10) return '10-24';
  if (candidates >= 5) return '5-9';
  if (candidates >= 4) return '4';
  if (candidates >= 3) return '3';
  return '2';
}

/** Nearest-rank percentile of an ascending list; 0 for an empty list. */
export function percentile(sortedAscending: readonly number[], percent: number): number {
  if (sortedAscending.length === 0) return 0;
  const rank = Math.max(1, Math.ceil((percent / 100) * sortedAscending.length));
  return sortedAscending[Math.min(rank, sortedAscending.length) - 1] as number;
}

/** Every `step`-th item starting at the first, with `step` chosen so that at most `max` items result. */
export function everyNth<T>(items: readonly T[], max: number): T[] {
  const step = Math.max(1, Math.ceil(items.length / max));
  const out: T[] = [];
  for (let i = 0; i < items.length; i += step) out.push(items[i] as T);
  return out;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
