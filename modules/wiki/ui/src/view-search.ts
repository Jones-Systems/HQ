// Search results: a live query field (synced with the top bar), the repository filter, exact name matches, and hits with
// the matched words marked. Typing updates the results after a short pause; the destination is recorded by replacing the
// current history entry once typing stops, so typing never fills history.

import { createElement as h, useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { clampQuery, pageKeyEquals, type PageKey, type SearchHit, type SearchResult, type WikiNamespace } from '../../contract/src/index.ts';
import { pageTitle, RepoBadge, useOutageSignals } from './chrome.ts';
import { Disambiguation } from './common.ts';
import type { ViewCtx } from './context.ts';
import { ErrorNotice, Notice, Skeleton, type NoticeAction } from './feedback.ts';
import { errorRecovery, folderParts, namespaceLabel } from './format.ts';
import { Icon } from './icons.ts';
import { COMMIT_IDLE_MS, highlight, LIVE_DEBOUNCE_MS, usableQuery, useDebounced, useSearchData, type AliasMatch } from './search-data.ts';

function Chips(props: {
  readonly repos: readonly WikiNamespace[];
  readonly allRepos: readonly WikiNamespace[];
  readonly toggle: (namespace: WikiNamespace) => void;
  readonly selectAll: () => void;
}): ReactElement {
  const everything = props.allRepos.every((namespace) => props.repos.includes(namespace));
  return h(
    'div',
    { className: 'wiki-repo-chips', role: 'group', 'aria-label': 'Repositories' },
    h('button', { type: 'button', className: 'wiki-chip', 'data-repo': 'all', 'aria-pressed': everything, onClick: props.selectAll }, 'All'),
    props.allRepos.map((namespace) =>
      h('button', { key: namespace, type: 'button', className: 'wiki-chip', 'data-repo': namespace, 'aria-pressed': props.repos.includes(namespace), onClick: () => props.toggle(namespace) }, namespaceLabel(namespace)),
    ),
  );
}

function GoTo(props: { readonly ctx: ViewCtx; readonly query: string; readonly matches: readonly AliasMatch[]; readonly hits: readonly SearchHit[] }): ReactElement {
  const { ctx, matches } = props;
  const titleOf = (key: PageKey): string => props.hits.find((hit) => pageKeyEquals(hit.key, key))?.title ?? pageTitle(ctx.session, key);
  return h(
    'div',
    { className: 'wiki-alias-matches', 'data-section': 'alias-matches' },
    h('span', { className: 'wiki-eyebrow' }, 'Go to'),
    matches.map((match) => {
      if (match.resolution.status === 'resolved') {
        const key = match.resolution.target;
        return h(
          'button',
          { key: match.namespace, type: 'button', className: 'wiki-goto', 'data-target': 'page', onClick: () => ctx.openPage(key) },
          h(Icon, { name: 'page', className: 'wiki-goto-icon' }),
          h('span', { className: 'wiki-goto-title' }, titleOf(key)),
          h(RepoBadge, { namespace: key.namespace }),
          h('span', { className: 'wiki-hit-folder' }, folderParts(key.path).join(' / ')),
          h(Icon, { name: 'forward', className: 'wiki-goto-arrow' }),
        );
      }
      return h(Disambiguation, { key: match.namespace, ctx, label: `${props.query} (${namespaceLabel(match.namespace)})`, candidates: match.resolution.candidates, heading: false });
    }),
  );
}

function Hits(props: {
  readonly ctx: ViewCtx;
  readonly result: SearchResult;
  readonly query: string;
  readonly busy: boolean;
  readonly focusField: () => void;
}): ReactElement {
  const { ctx, result } = props;
  const list = useRef<HTMLOListElement | null>(null);
  const [active, setActive] = useState(0);
  const titles = (): HTMLElement[] => Array.from(list.current?.querySelectorAll<HTMLElement>('.wiki-hit-title') ?? []);
  const move = (to: number): void => {
    setActive(to);
    titles()[to]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    const at = titles().indexOf(event.target as HTMLElement);
    if (at < 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(Math.min(titles().length - 1, at + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (at === 0) props.focusField();
      else move(at - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      move(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      move(titles().length - 1);
    }
  };
  const current = Math.min(active, Math.max(0, result.hits.length - 1));
  return h(
    'div',
    { className: 'wiki-results', 'aria-busy': props.busy || undefined },
    props.busy ? h('div', { className: 'wiki-progress', 'aria-hidden': 'true' }) : null,
    h(
      'ol',
      { className: 'wiki-hits', ref: list, onKeyDown },
      result.hits.map((hit, index) =>
        h(
          'li',
          { key: `${hit.key.namespace}/${hit.key.path}`, className: 'wiki-hit', 'data-score': hit.score.toFixed(2), 'data-namespace': hit.key.namespace },
          h('button', { type: 'button', className: 'wiki-link wiki-hit-title', 'data-target': 'page', tabIndex: index === current ? 0 : -1, onFocus: () => setActive(index), onClick: () => ctx.openPage(hit.key) }, ...highlight(hit.title, props.query)),
          h('div', { className: 'wiki-hit-meta' }, h(RepoBadge, { namespace: hit.key.namespace }), folderParts(hit.key.path).length === 0 ? null : h('span', { className: 'wiki-hit-folder' }, folderParts(hit.key.path).join(' / '))),
          hit.snippet === '' ? null : h('p', { className: 'wiki-snippet' }, ...highlight(hit.snippet, props.query)),
        ),
      ),
    ),
  );
}

export function SearchView(props: {
  readonly ctx: ViewCtx;
  /** The query of the current destination. */
  readonly query: string;
  /** What the field holds (shared with the top bar). */
  readonly draft: string;
  readonly setDraft: (draft: string) => void;
  readonly repos: readonly WikiNamespace[];
  readonly allRepos: readonly WikiNamespace[];
  readonly toggleRepo: (namespace: WikiNamespace) => void;
  readonly selectAllRepos: () => void;
  /** Goes back one entry, or null at the start. */
  readonly onBack: (() => void) | null;
}): ReactElement {
  const { ctx, query, draft, repos } = props;
  const field = useRef<HTMLInputElement | null>(null);
  const root = useRef<HTMLElement | null>(null);
  const openSearch = useRef(ctx.openSearch);
  openSearch.current = ctx.openSearch;

  // What the page searches: the destination's query, then whatever was typed once it has settled.
  const [live, setLive] = useState(query);
  const [seen, setSeen] = useState(query);
  if (seen !== query) {
    setSeen(query);
    setLive(query);
  }
  const typed = usableQuery(draft);
  const settled = useDebounced(typed, LIVE_DEBOUNCE_MS);
  useEffect(() => {
    if (settled !== null) setLive(settled);
  }, [settled]);

  // Typing stops: record the query as this entry's destination (replacing it), never adding history.
  useEffect(() => {
    if (typed === null || typed === query) return undefined;
    const timer = setTimeout(() => openSearch.current(typed, { replace: true }), COMMIT_IDLE_MS);
    return () => clearTimeout(timer);
  }, [typed, query]);

  const searching = repos.length > 0 && usableQuery(live) !== null;
  const data = useSearchData(ctx, searching ? live : null, repos);
  const { search, result } = data;
  const busy = data.outdated || search.refreshing;
  const signals = useOutageSignals(ctx, { error: search.error, refreshing: busy || search.status === 'loading', hasContent: result !== undefined });
  const retry = (): void => {
    signals.noteRetry();
    data.retry();
  };

  const failureActions = (): NoticeAction[] => {
    const error = search.error;
    if (error === null) return [];
    const actions: NoticeAction[] = [];
    for (const step of errorRecovery(error)) {
      if (step === 'retry') actions.push({ label: 'Retry', onAction: retry, busy, busyLabel: 'Retrying', icon: 'refresh' });
      else if (step === 'settings' && ctx.openSettings !== null) actions.push({ label: 'Wiki settings', onAction: ctx.openSettings, icon: 'settings' });
      else if (step === 'back' && props.onBack !== null) actions.push({ label: 'Back', onAction: props.onBack });
    }
    return actions;
  };

  const filtered = repos.length < props.allRepos.length;
  const summary =
    result === undefined
      ? null
      : result.hits.length === 0
        ? null
        : result.truncated || result.hits.length < result.totalHits
          ? `Showing ${result.hits.length} of ${result.totalHits} · narrow the search or the repositories`
          : `${result.totalHits} ${result.totalHits === 1 ? 'result' : 'results'}`;

  return h(
    'section',
    { ref: root, className: 'wiki-search', 'aria-label': 'Search results' },
    h(
      'header',
      { className: 'wiki-search-head' },
      h('h1', { className: 'wiki-section-title' }, `Results for “${live}”`),
      summary === null || result === undefined ? null : h('p', { className: 'wiki-summary', 'data-total': result.totalHits, 'data-truncated': String(result.truncated) }, summary),
    ),
    h(
      'div',
      { className: 'wiki-query' },
      h(Icon, { name: 'search', className: 'wiki-query-icon' }),
      h('input', {
        ref: field,
        type: 'search',
        name: 'results-query',
        className: 'wiki-input wiki-query-input',
        'aria-label': 'Search query',
        placeholder: 'Search titles, aliases and text',
        autoComplete: 'off',
        spellCheck: false,
        value: draft,
        onChange: (event) => props.setDraft(clampQuery(event.target.value)),
        onKeyDown: (event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            root.current?.querySelector<HTMLElement>('.wiki-hit-title')?.focus();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            if (typed !== null) openSearch.current(typed, { replace: true });
          }
        },
      }),
    ),
    h(Chips, { repos, allRepos: props.allRepos, toggle: props.toggleRepo, selectAll: props.selectAllRepos }),
    repos.length > 0 ? null : h('p', { className: 'wiki-empty', role: 'status', 'data-state': 'no-repositories' }, 'Choose at least one repository to search.'),
    searching && data.matches.length > 0 ? h(GoTo, { ctx, query: live, matches: data.matches, hits: result?.hits ?? [] }) : null,
    searching && data.matchError !== null ? h(ErrorNotice, { error: data.matchError, what: 'name lookup', variant: 'bar', actions: [{ label: 'Retry', onAction: retry, icon: 'refresh' }] }) : null,
    !searching
      ? null
      : result === undefined
        ? search.status === 'error' && search.error !== null
          ? h(ErrorNotice, { error: search.error, what: 'search results', actions: failureActions() })
          : h(
              'div',
              { className: 'wiki-loading', role: 'status', 'data-state': 'loading', 'aria-busy': 'true' },
              h('span', { className: 'wiki-sr-only' }, 'Searching…'),
              h(Skeleton, { shape: 'block', className: 'wiki-loading-row' }),
              h(Skeleton, { shape: 'block', className: 'wiki-loading-row' }),
              h(Skeleton, { shape: 'block', className: 'wiki-loading-row' }),
            )
        : h(
            'div',
            { className: 'wiki-ready', 'data-state': 'ready' },
            search.error === null
              ? null
              : h(
                  Notice,
                  {
                    tone: search.error.code === 'unavailable' ? 'warning' : 'danger',
                    variant: 'bar',
                    title: "Couldn't update the results",
                    data: { 'data-state': 'error', 'data-code': search.error.code, 'data-reason': search.error.reason },
                    actions: failureActions(),
                  },
                  'Showing the last results.',
                ),
            result.hits.length === 0
              ? h(
                  Notice,
                  {
                    tone: 'neutral',
                    variant: 'empty',
                    title: `No pages match “${result.query}”`,
                    live: 'polite',
                    data: { 'data-state': 'empty' },
                    actions: filtered ? [{ label: 'Search all repositories', onAction: props.selectAllRepos, icon: 'search' }] : [],
                  },
                  filtered ? 'Only some repositories are searched.' : 'Try fewer words.',
                )
              : h(Hits, { ctx, result, query: live, busy, focusField: () => field.current?.focus() }),
          ),
  );
}
