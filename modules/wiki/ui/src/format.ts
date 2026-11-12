// Display helpers: namespace names, short commits and plain-language error text. Pure; no DOM.

import type { WikiError, WikiNamespace } from '../../contract/src/index.ts';

/** Accepted display map for the contract namespaces. */
export const NAMESPACE_LABELS: Readonly<Record<WikiNamespace, string>> = {
  bl: 'BusinessLessons',
  appdev: 'App Development',
};

export function namespaceLabel(namespace: string): string {
  return Object.hasOwn(NAMESPACE_LABELS, namespace) ? NAMESPACE_LABELS[namespace as WikiNamespace] : namespace;
}

export function shortCommit(commit: string): string {
  return commit.slice(0, 12);
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/gu;

/** Bounded, control-free excerpt of untrusted text for a notice. Always rendered as a React text child. */
export function excerpt(text: string, max = 80): string {
  const points = Array.from(text.replace(CONTROL, '�'));
  return points.length > max ? `${points.slice(0, max).join('')}…` : points.join('');
}

export interface ErrorText {
  readonly title: string;
  readonly detail: string;
}

/** One plain-language heading per error code (and per `unavailable` reason). The service's own message is shown separately. */
export function describeError(error: WikiError): ErrorText {
  switch (error.code) {
    case 'invalid-input':
      return { title: 'Request rejected', detail: 'The Wiki rejected this request as invalid.' };
    case 'not-found':
      return { title: 'Not found', detail: 'This item is not in the pinned source.' };
    case 'unavailable':
      if (error.reason === 'source-unavailable') {
        return { title: 'Source unavailable', detail: 'The repository for this item could not be read.' };
      }
      if (error.reason === 'index-unavailable') {
        return { title: 'Index unavailable', detail: 'The search and link index is not ready yet.' };
      }
      return { title: 'Wiki unavailable', detail: 'The Wiki cannot answer right now.' };
    default:
      return { title: 'Something went wrong', detail: 'The Wiki failed unexpectedly.' };
  }
}

/** Synthesised when a response is malformed or fails the contract validators. */
export function invalidResponse(message: string): WikiError {
  return { code: 'internal', reason: 'internal', message };
}

/** How a view can help after an error: try again, set the Wiki up in Settings, search instead, or go back. */
export type Recovery = 'retry' | 'settings' | 'search' | 'back';

/**
 * Recovery actions for an error, most useful first. Every Wiki read is side-effect free, so Retry is always safe;
 * an unavailable source or index also offers Settings, and a missing page offers a search for its name.
 */
export function errorRecovery(error: WikiError): readonly Recovery[] {
  switch (error.code) {
    case 'not-found':
      return ['search', 'back'];
    case 'unavailable':
      return ['retry', 'settings'];
    case 'invalid-input':
      return ['back'];
    default:
      return ['retry'];
  }
}

/** True when the error means the Wiki cannot answer at all (not a problem with this one item). */
export function isOutage(error: WikiError): boolean {
  return error.code === 'unavailable';
}

/** Display name for a page known only by its path: the file name without extension, dashes read as spaces. */
export function pageName(path: string): string {
  const file = path.split('/').filter((part) => part.length > 0).at(-1) ?? path;
  const stem = file.replace(/\.(?:md|markdown|mdx|txt)$/iu, '');
  const words = stem.replace(/[-_]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (words.length === 0) return excerpt(path, 60);
  return excerpt(words.charAt(0).toUpperCase() + words.slice(1), 80);
}

/** The folders above a page, for breadcrumbs: `lessons/pricing/tiers.md` → ['lessons', 'pricing']. */
export function folderParts(path: string): readonly string[] {
  return path.split('/').filter((part) => part.length > 0).slice(0, -1).map((part) => excerpt(part, 40));
}

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600_000],
  ['month', 30 * 24 * 3600_000],
  ['week', 7 * 24 * 3600_000],
  ['day', 24 * 3600_000],
  ['hour', 3600_000],
  ['minute', 60_000],
];

/** "3 days ago", "in 2 hours", "just now"; `fallback` for a missing or unreadable time. Locale-stable (en). */
export function relativeTime(iso: string | null, now: number, fallback = 'unknown'): string {
  if (iso === null) return fallback;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return fallback;
  const delta = at - now;
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(delta) >= size) return format.format(Math.round(delta / size), unit);
  }
  return 'just now';
}
