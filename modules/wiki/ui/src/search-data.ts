// Search plumbing shared by the top-bar combobox and the results page: what text may be requested, debouncing, the
// cached search and exact-name lookups (with the last good answer kept while another query loads), and match marking.

import { createElement as h, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  NAMESPACES,
  clampQuery,
  validateQuery,
  type AliasResolution,
  type SearchResult,
  type WikiError,
  type WikiNamespace,
} from '../../contract/src/index.ts';
import type { ViewCtx } from './context.ts';
import { useResource, type Resource } from './load.ts';
import { aliasResource, searchResource } from './resources.ts';

/** Idle time before the top-bar suggestions ask the Wiki. */
export const SUGGEST_DEBOUNCE_MS = 150;
/** Idle time before the results page asks the Wiki for what was typed. */
export const LIVE_DEBOUNCE_MS = 200;
/** Idle time before the results page records what was typed as its destination (replacing, never adding, an entry). */
export const COMMIT_IDLE_MS = 600;
/** How many hits the top-bar suggestions list. */
export const SUGGEST_HITS = 8;

/** The query a draft would search for, or null for empty or invalid text, which is never requested. */
export function usableQuery(draft: string): string | null {
  const query = clampQuery(draft).trim();
  return validateQuery(query).ok ? query : null;
}

/** Plain words for text that cannot be searched, shown under the field on submit. Null when the text is fine. */
export function draftProblem(draft: string): string | null {
  const query = clampQuery(draft).trim();
  const checked = validateQuery(query);
  if (checked.ok) return null;
  return checked.error.reason === 'empty' ? 'Enter something to search for.' : `That search text is not valid (${checked.error.reason}).`;
}

/** The value after it has stayed unchanged for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(settled, value)) return undefined;
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms, settled]);
  return settled;
}

export interface AliasMatch {
  readonly namespace: WikiNamespace;
  readonly resolution: Exclude<AliasResolution, { status: 'missing' }>;
}

export interface SearchData {
  /** The cached search for the current key. */
  readonly search: Resource<SearchResult>;
  /** The newest good result: the current key's, or an older query's while this one loads. */
  readonly result: SearchResult | undefined;
  /** `result` answers an older query or filter and a newer answer is on its way. */
  readonly outdated: boolean;
  /** Exact name matches (resolved or ambiguous) in the searched repositories. */
  readonly matches: readonly AliasMatch[];
  /** A name lookup is still running. */
  readonly matchesLoading: boolean;
  /** A real lookup failure, only when no match was found (a missing name is simply no match). */
  readonly matchError: WikiError | null;
  /** Ask again for the search and the name lookups. */
  readonly retry: () => void;
}

/**
 * The search and the exact-name lookups for `query` over `repos`. A null query (or no repository) is idle: nothing is
 * requested. The requests are the same cached resources the results page uses, so a result the suggestions fetched
 * paints at once when the page opens.
 */
export function useSearchData(ctx: ViewCtx, query: string | null, repos: readonly WikiNamespace[]): SearchData {
  const searching = query !== null && repos.length > 0;
  const search = useResource(searching ? searchResource(ctx.service, query, repos, NAMESPACES) : null, ctx.cache);
  // One lookup per repository: the repository list is a fixed pair, so the hook count never changes.
  const lookups = NAMESPACES.map((namespace) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useResource(searching && repos.includes(namespace) ? aliasResource(ctx.service, namespace, query) : null, ctx.cache),
  );

  const kept = useRef<SearchResult | undefined>(undefined);
  if (!searching) kept.current = undefined;
  else if (search.value !== undefined) kept.current = search.value;
  const result = searching ? (search.value ?? kept.current) : undefined;

  const matches: AliasMatch[] = [];
  let matchesLoading = false;
  let matchError: WikiError | null = null;
  NAMESPACES.forEach((namespace, index) => {
    const lookup = lookups[index];
    if (lookup === undefined || !searching || !repos.includes(namespace)) return;
    if (lookup.status === 'loading') matchesLoading = true;
    else if (lookup.status === 'ready' && lookup.value !== undefined) {
      if (lookup.value.status !== 'missing') matches.push({ namespace, resolution: lookup.value });
    } else if (lookup.status === 'error' && lookup.error !== null && lookup.error.code !== 'invalid-input' && lookup.error.code !== 'not-found' && matchError === null) {
      matchError = lookup.error;
    }
  });

  return {
    search,
    result,
    outdated: searching && search.value === undefined && result !== undefined,
    matches,
    matchesLoading,
    matchError: matches.length === 0 ? matchError : null,
    retry: () => {
      search.retry();
      for (const lookup of lookups) lookup.retry();
    },
  };
}

const SPECIAL = /[.*+?^${}()|[\]\\]/gu;

/** Splits `text` around the words of `query` so matches can be marked. Text children only; nothing is parsed as markup. */
export function highlight(text: string, query: string): ReactNode[] {
  const words = [...new Set(query.split(/\s+/u).filter((word) => word.length > 0))].slice(0, 8).sort((a, b) => b.length - a.length);
  if (words.length === 0 || text === '') return [text];
  let pattern: RegExp;
  try {
    pattern = new RegExp(words.map((word) => word.replace(SPECIAL, '\\$&')).join('|'), 'giu');
  } catch {
    return [text];
  }
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (match[0].length === 0) continue;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(h('mark', { key: start, className: 'wiki-mark' }, match[0]));
    last = start + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
