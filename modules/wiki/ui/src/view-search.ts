// Search results for one query, with the repository filter applied by the root, plus exact alias matches.

import { createElement as h, type ReactElement } from 'react';
import {
  MAX_RESULTS,
  validateAliasResolution,
  validateSearchResult,
  type AliasResolution,
  type SearchResult,
  type WikiNamespace,
  type WikiResult,
} from '../../contract/src/index.ts';
import { Async, Disambiguation, ErrorPanel, NamespaceBadge, PageButton } from './common.ts';
import type { ViewCtx } from './context.ts';
import { namespaceLabel } from './format.ts';
import { contract, useLoaded } from './load.ts';

interface AliasMatch {
  readonly namespace: WikiNamespace;
  readonly resolution: Exclude<AliasResolution, { status: 'missing' }>;
}

const checkResult = contract(validateSearchResult);
const checkAlias = contract(validateAliasResolution);

export function SearchView(props: {
  readonly ctx: ViewCtx;
  readonly query: string;
  readonly repos: readonly WikiNamespace[];
  readonly allRepos: readonly WikiNamespace[];
}): ReactElement {
  const { ctx, query, repos } = props;
  const searching = repos.length > 0;
  const requestKey = searching ? `${repos.join(',')}\u0000${query}` : null;
  const filtered = repos.length < props.allRepos.length;

  const result = useLoaded<SearchResult>(
    requestKey === null ? null : `search:${requestKey}`,
    () => ctx.service.search(filtered ? { query, namespaces: repos } : { query }),
    checkResult,
  );

  // Exact title/alias matches keep same-name pages in different repositories distinct, and preserve ambiguity.
  const aliases = useLoaded<readonly AliasMatch[]>(
    requestKey === null ? null : `alias:${requestKey}`,
    async (): Promise<WikiResult<readonly AliasMatch[]>> => {
      const settled = await Promise.all(
        repos.map(async (namespace) => {
          try {
            return { namespace, result: await ctx.service.resolveAlias({ namespace, alias: query }) };
          } catch {
            return { namespace, result: null };
          }
        }),
      );
      const matches: AliasMatch[] = [];
      let failure: WikiResult<never> | null = null;
      for (const { namespace, result: outcome } of settled) {
        if (outcome === null) continue;
        if (!outcome.ok) {
          if (outcome.error.code !== 'invalid-input' && outcome.error.code !== 'not-found' && failure === null) failure = outcome;
          continue;
        }
        if (checkAlias(outcome.value) !== null) continue;
        if (outcome.value.status !== 'missing') matches.push({ namespace, resolution: outcome.value });
      }
      return matches.length === 0 && failure !== null ? failure : { ok: true, value: matches };
    },
    () => null,
  );

  return h(
    'section',
    { className: 'wiki-search', 'aria-label': 'Search results' },
    h('h2', { className: 'wiki-section-title' }, `Search: “${query}”`),
    searching
      ? null
      : h('p', { className: 'wiki-empty', role: 'status', 'data-state': 'no-repositories' }, 'Choose at least one repository to search.'),
    aliases === null || aliases.status === 'loading'
      ? null
      : aliases.status === 'error'
        ? h(ErrorPanel, { error: aliases.error, what: 'name lookup' })
        : aliases.value.length === 0
          ? null
          : h(
              'div',
              { className: 'wiki-alias-matches', 'data-section': 'alias-matches' },
              h('h3', { className: 'wiki-subtitle' }, 'Exact name matches'),
              aliases.value.map((match) =>
                match.resolution.status === 'resolved'
                  ? h(
                      'p',
                      { key: match.namespace, className: 'wiki-alias-match' },
                      h(PageButton, { ctx, pageKey: match.resolution.target, label: `${query} → ${match.resolution.target.path}` }),
                    )
                  : h(Disambiguation, {
                      key: match.namespace,
                      ctx,
                      label: `${query} (${namespaceLabel(match.namespace)})`,
                      candidates: match.resolution.candidates,
                      heading: false,
                    }),
              ),
            ),
    h(Async<SearchResult>, { loaded: result, what: 'search results', children: (value) => h(Results, { ctx, result: value }) }),
  );
}

function Results(props: { readonly ctx: ViewCtx; readonly result: SearchResult }): ReactElement {
  const { ctx, result } = props;
  return h(
    'div',
    { className: 'wiki-results' },
    result.hits.length === 0
      ? h('p', { className: 'wiki-empty', 'data-state': 'empty' }, `No matches for “${result.query}”.`)
      : h(
          'p',
          { className: 'wiki-summary', 'data-total': result.totalHits, 'data-truncated': String(result.truncated) },
          `Showing ${result.hits.length} of ${result.totalHits} ${result.totalHits === 1 ? 'match' : 'matches'}.`,
          result.truncated ? ` Results are capped at ${MAX_RESULTS}; narrow the query or the repositories to see the rest.` : '',
        ),
    h(
      'ol',
      { className: 'wiki-hits' },
      result.hits.map((hit) =>
        h(
          'li',
          { key: `${hit.key.namespace}/${hit.key.path}`, className: 'wiki-hit' },
          h(
            'button',
            { type: 'button', className: 'wiki-link wiki-hit-title', 'data-target': 'page', onClick: () => ctx.openPage(hit.key) },
            hit.title,
          ),
          h('div', { className: 'wiki-hit-meta' }, h(NamespaceBadge, { namespace: hit.key.namespace }), h('code', null, hit.key.path), h('span', { className: 'wiki-muted' }, `score ${hit.score.toFixed(2)}`)),
          hit.snippet === '' ? null : h('p', { className: 'wiki-snippet' }, hit.snippet),
        ),
      ),
    ),
  );
}
