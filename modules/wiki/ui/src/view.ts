// The Wiki view: header (history, topics, search, repository filter) over home / search / reader / topics /
// disambiguation. The root owns navigation; views only read through the injected WikiService.

import { createElement as h, useEffect, useReducer, useRef, useState, type ComponentType, type ReactElement } from 'react';
import {
  NAMESPACES,
  clampQuery,
  validateQuery,
  type PageKey,
  type WikiNamespace,
  type WikiService,
} from '../../contract/src/index.ts';
import { Disambiguation } from './common.ts';
import type { ViewCtx } from './context.ts';
import {
  HOME,
  describeDestination,
  pageDestination,
  resolveDestination,
  searchDestination,
  topicsDestination,
} from './destinations.ts';
import { namespaceLabel } from './format.ts';
import { currentEntry, initialNav, navReducer, shellRequestFor, type HistoryEntry } from './history.ts';
import { HomeView } from './view-home.ts';
import { ReaderView } from './view-reader.ts';
import { SearchView } from './view-search.ts';
import { TopicsView } from './view-topics.ts';

export interface WikiViewProps {
  /** `home`, `page/<ns>/<path>`, `search?q=…` or `topics/<ns>`. Anything else shows home with a notice. */
  readonly destination: string;
  readonly appearance: 'light' | 'dark';
  /** A request that the shell persist this destination. The view keeps its own in-session history regardless. */
  readonly navigate: (destination: string) => void;
}

function SearchBar(props: {
  readonly initialQuery: string;
  readonly repos: readonly WikiNamespace[];
  readonly toggleRepo: (namespace: WikiNamespace) => void;
  readonly onSubmit: (query: string) => void;
}): ReactElement {
  const [draft, setDraft] = useState(props.initialQuery);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = (): void => {
    const query = clampQuery(draft).trim();
    const checked = validateQuery(query);
    if (!checked.ok) {
      setProblem(checked.error.reason === 'empty' ? 'Enter something to search for.' : `That search text is not valid (${checked.error.reason}).`);
      return;
    }
    setProblem(null);
    props.onSubmit(query);
  };
  return h(
    'form',
    {
      className: 'wiki-searchbar',
      role: 'search',
      onSubmit: (event) => {
        event.preventDefault();
        submit();
      },
    },
    h('input', {
      type: 'search',
      name: 'q',
      className: 'wiki-input',
      'aria-label': 'Search the Wiki',
      placeholder: 'Search titles, aliases and text',
      autoComplete: 'off',
      value: draft,
      onChange: (event) => {
        setDraft(clampQuery(event.target.value));
        setProblem(null);
      },
    }),
    h('button', { type: 'submit', className: 'wiki-button wiki-button-primary' }, 'Search'),
    h(
      'fieldset',
      { className: 'wiki-filter' },
      h('legend', null, 'Repositories'),
      NAMESPACES.map((namespace) =>
        h(
          'label',
          { key: namespace, className: 'wiki-check' },
          h('input', { type: 'checkbox', name: 'repository', value: namespace, checked: props.repos.includes(namespace), onChange: () => props.toggleRepo(namespace) }),
          namespaceLabel(namespace),
        ),
      ),
    ),
    problem === null ? null : h('p', { className: 'wiki-field-problem', role: 'alert' }, problem),
  );
}

function entryLabel(entry: HistoryEntry): string {
  return entry.ambiguity === undefined ? describeDestination(entry.destination) : `Disambiguation · ${entry.ambiguity.label}`;
}

function WikiRoot(props: WikiViewProps & { readonly service: WikiService }): ReactElement {
  const { service } = props;
  const destination = typeof props.destination === 'string' ? props.destination : '';
  const [nav, dispatch] = useReducer(navReducer, destination, initialNav);
  const [repos, setRepos] = useState<readonly WikiNamespace[]>(NAMESPACES);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(() => {
    try { return window.localStorage.getItem('hq.wiki.searchbar.v1') !== 'closed'; } catch { return true; }
  });
  const toggleSearch = (): void => setSearchOpen(current => {
    try { window.localStorage.setItem('hq.wiki.searchbar.v1', current ? 'closed' : 'open'); }
    catch { /* Search remains usable when preference storage is unavailable. */ }
    return !current;
  });
  const [notice, setNotice] = useState<{ readonly message: string; readonly index: number } | null>(null);
  const main = useRef<HTMLElement | null>(null);

  // Re-sync with the shell: a changed `destination` prop is either the echo of our own request or an external navigation.
  if (nav.seenProp !== destination) dispatch({ type: 'prop', destination });

  const entry = currentEntry(nav);

  const request = (target: HistoryEntry): void => {
    const shell = shellRequestFor(nav, target);
    if (shell === null) return;
    try {
      props.navigate(shell);
    } catch {
      // The shell refusing a request must not break in-session navigation.
    }
  };
  const go = (target: HistoryEntry): void => {
    request(target);
    dispatch({ type: 'go', entry: target });
  };
  const goTo = (target: string | null): void => {
    if (target === null) setNotice({ message: 'That link cannot be opened.', index: nav.index });
    else go({ destination: target });
  };
  const move = (index: number): void => {
    const target = nav.entries[index];
    if (target === undefined) return;
    request(target);
    dispatch({ type: 'jump', index });
  };

  const ctx: ViewCtx = {
    service,
    openPage: (key: PageKey) => goTo(pageDestination(key)),
    openSearch: (query: string) => goTo(searchDestination(query)),
    openTopics: (namespace: WikiNamespace) => goTo(topicsDestination(namespace)),
    openAmbiguity: (label, candidates) => go({ destination: entry.destination, ambiguity: { label, candidates } }),
  };

  const resolved = resolveDestination(entry.destination);
  const viewKey = entry.ambiguity === undefined ? resolved.view : 'ambiguity';

  const navigated = useRef(false);
  useEffect(() => {
    // Move focus to the new content after navigation, but never on first mount.
    if (navigated.current) main.current?.focus();
    navigated.current = true;
  }, [nav.index, entry.destination]);

  const toggleRepo = (namespace: WikiNamespace): void =>
    setRepos((previous) => (previous.includes(namespace) ? previous.filter((item) => item !== namespace) : NAMESPACES.filter((item) => item === namespace || previous.includes(item))));

  let body: ReactElement;
  if (entry.ambiguity !== undefined) {
    body = h(Disambiguation, { ctx, label: entry.ambiguity.label, candidates: entry.ambiguity.candidates });
  } else if (resolved.view === 'page') {
    body = h(ReaderView, { ctx, pageKey: resolved.key });
  } else if (resolved.view === 'search') {
    body = h(SearchView, { ctx, query: resolved.query, repos, allRepos: NAMESPACES });
  } else if (resolved.view === 'topics') {
    body = h(TopicsView, { ctx, namespace: resolved.namespace });
  } else {
    body = h(HomeView, { ctx, notice: resolved.notice });
  }

  return h(
    'div',
    { className: 'wiki-view', role: 'region', 'aria-label': 'Wiki', 'data-appearance': props.appearance === 'dark' ? 'dark' : 'light' },
    h(
      'header',
      { className: 'wiki-header' },
      h(
        'div',
        { className: 'wiki-toolbar' },
        h('h1', { className: 'wiki-title' }, 'Wiki'),
        h(
          'nav',
          { className: 'wiki-nav', 'aria-label': 'Wiki navigation' },
          h('button', { type: 'button', className: 'wiki-button', 'aria-label': 'Back', disabled: nav.index === 0, onClick: () => move(nav.index - 1) }, '← Back'),
          h('button', { type: 'button', className: 'wiki-button', 'aria-label': 'Forward', disabled: nav.index >= nav.entries.length - 1, onClick: () => move(nav.index + 1) }, 'Forward →'),
          h('button', { type: 'button', className: 'wiki-button', onClick: () => go({ destination: HOME }) }, 'Home'),
          NAMESPACES.map((namespace) =>
            h('button', { key: namespace, type: 'button', className: 'wiki-button', onClick: () => ctx.openTopics(namespace) }, `Topics · ${namespaceLabel(namespace)}`),
          ),
          h('button', { type: 'button', className: 'wiki-button', 'aria-expanded': historyOpen, onClick: () => setHistoryOpen(!historyOpen) }, `History (${nav.entries.length})`),
        ),
      ),
      h('button', { type: 'button', className: 'wiki-button wiki-search-toggle', 'aria-label': searchOpen ? 'Hide Wiki search and filters' : 'Show Wiki search and filters', title: searchOpen ? 'Hide search and filters' : 'Show search and filters', 'aria-expanded': searchOpen, 'aria-controls': 'wiki-secondary-search', onClick: toggleSearch }, searchOpen ? '⌃' : '⌄'),
      h('div', { id: 'wiki-secondary-search', hidden: !searchOpen }, h(SearchBar, {
        key: `${nav.index}:${entry.destination}`,
        initialQuery: resolved.view === 'search' && entry.ambiguity === undefined ? resolved.query : '',
        repos,
        toggleRepo,
        onSubmit: ctx.openSearch,
      })),
    ),
    historyOpen
      ? h(
          'nav',
          { className: 'wiki-history', 'aria-label': 'Session history' },
          h(
            'ol',
            null,
            nav.entries.map((item, index) =>
              h(
                'li',
                { key: index },
                h(
                  'button',
                  { type: 'button', className: 'wiki-link', 'aria-current': index === nav.index ? 'step' : undefined, onClick: () => move(index) },
                  entryLabel(item),
                ),
              ),
            ),
          ),
        )
      : null,
    notice !== null && notice.index === nav.index
      ? h('div', { className: 'wiki-notice', role: 'status', 'data-notice': 'action' }, notice.message)
      : null,
    h('main', { key: viewKey, className: 'wiki-main', ref: main, tabIndex: -1 }, body),
  );
}

/** Builds the Wiki view over an injected, read-only WikiService. */
export function createWikiView(service: WikiService): ComponentType<WikiViewProps> {
  function WikiView(props: WikiViewProps): ReactElement {
    return h(WikiRoot, { ...props, service });
  }
  WikiView.displayName = 'WikiView';
  return WikiView;
}
