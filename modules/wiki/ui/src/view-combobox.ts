// The top-bar search field: an ARIA 1.2 combobox. Typing shows, after a short pause, exact name matches ("Go to …"),
// the best hits and a final "Search all pages" option. Nothing invalid or empty is ever requested. On the results page
// the page itself answers live, so the field stays a plain field there.

import { createElement as h, useId, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { NAMESPACES, clampQuery, pageKeyEquals, type PageKey, type WikiNamespace } from '../../contract/src/index.ts';
import { pageTitle, RepoBadge, stepIndex } from './chrome.ts';
import type { ViewCtx } from './context.ts';
import { Kbd } from './feedback.ts';
import { folderParts } from './format.ts';
import { Icon } from './icons.ts';
import { draftProblem, highlight, SUGGEST_DEBOUNCE_MS, SUGGEST_HITS, useDebounced, usableQuery, useSearchData } from './search-data.ts';

interface Row {
  readonly id: string;
  readonly kind: 'goto' | 'hit' | 'all';
  readonly run: () => void;
  readonly content: readonly ReactNode[];
}

export function SearchBox(props: {
  readonly ctx: ViewCtx;
  readonly draft: string;
  readonly setDraft: (draft: string) => void;
  readonly repos: readonly WikiNamespace[];
  /** On the results page the page answers live; the field then shows no suggestions. */
  readonly suggest: boolean;
  /** Opens the full results page for a valid query (Enter with nothing active, Ctrl/⌘+Enter, the last option). */
  readonly onSubmit: (query: string) => void;
  readonly inputRef: { current: HTMLInputElement | null };
}): ReactElement {
  const { ctx, draft } = props;
  const uid = useId();
  const listId = `${uid}-suggestions`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [problem, setProblem] = useState<string | null>(null);

  const typed = usableQuery(draft);
  const listOpen = props.suggest && open && typed !== null;
  const settled = useDebounced(typed, SUGGEST_DEBOUNCE_MS);
  const data = useSearchData(ctx, listOpen ? settled : null, props.repos.length === 0 ? NAMESPACES : props.repos);

  const close = (): void => {
    setOpen(false);
    setActive(-1);
  };
  const submit = (): void => {
    const found = draftProblem(draft);
    setProblem(found);
    if (found !== null) return;
    close();
    props.onSubmit(clampQuery(draft).trim());
  };

  const rows: Row[] = [];
  if (listOpen) {
    const add = (kind: Row['kind'], run: () => void, ...content: ReactNode[]): void => {
      rows.push({ id: `${listId}-${rows.length}`, kind, run, content });
    };
    const resolved: PageKey[] = [];
    for (const match of data.matches) {
      if (match.resolution.status === 'resolved') {
        const key = match.resolution.target;
        resolved.push(key);
        add('goto', () => ctx.openPage(key), h('span', { className: 'wiki-suggest-verb' }, 'Go to'), h('span', { className: 'wiki-suggest-title' }, pageTitle(ctx.session, key)), h(RepoBadge, { namespace: key.namespace }), h('span', { className: 'wiki-suggest-folder' }, folderParts(key.path).join(' / ')));
      } else {
        const { candidates } = match.resolution;
        add('goto', () => ctx.openAmbiguity(settled ?? '', candidates), h('span', { className: 'wiki-suggest-verb' }, 'Go to'), h('span', { className: 'wiki-suggest-title' }, `“${settled ?? ''}” · ${candidates.length} pages`), h(RepoBadge, { namespace: match.namespace }));
      }
    }
    const hits = (data.result?.hits ?? []).filter((hit) => !resolved.some((key) => pageKeyEquals(key, hit.key))).slice(0, SUGGEST_HITS);
    for (const hit of hits) {
      add('hit', () => ctx.openPage(hit.key), h(Icon, { name: 'page', className: 'wiki-suggest-icon' }), h('span', { className: 'wiki-suggest-title' }, ...highlight(hit.title, settled ?? '')), h(RepoBadge, { namespace: hit.key.namespace }), h('span', { className: 'wiki-suggest-folder' }, folderParts(hit.key.path).join(' / ')));
    }
    add('all', submit, h(Icon, { name: 'search', className: 'wiki-suggest-icon' }), h('span', { className: 'wiki-suggest-title' }, `Search all pages for “${typed}”`), h('span', { className: 'wiki-suggest-key', 'aria-hidden': 'true' }, h(Kbd, { children: '↵' })));
  }
  const activeRow = active >= 0 ? rows[active] : undefined;
  const realRows = rows.filter((row) => row.kind !== 'all').length;

  let note: string | null = null;
  if (listOpen && data.result === undefined) {
    if (data.search.status === 'error') note = "Couldn't search right now. Press Enter to try the full search.";
    else note = 'Searching…';
  } else if (listOpen && realRows === 0 && !data.matchesLoading) note = `No pages match “${typed}”.`;

  const run = (row: Row): void => {
    close();
    row.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!props.suggest || typed === null) return;
      event.preventDefault();
      if (!listOpen) {
        setOpen(true);
        setActive(-1);
        return;
      }
      setActive(stepIndex(active, event.key === 'ArrowDown' ? 1 : -1, rows.length));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey || activeRow === undefined) submit();
      else run(activeRow);
    } else if (event.key === 'Escape') {
      if (listOpen) {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (draft !== '' || problem !== null) {
        event.preventDefault();
        event.stopPropagation();
        setProblem(null);
        props.setDraft('');
      }
    }
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
    h(Icon, { name: 'search', className: 'wiki-searchbar-icon' }),
    h('input', {
      ref: props.inputRef,
      type: 'search',
      name: 'q',
      className: 'wiki-input wiki-searchbar-input',
      role: 'combobox',
      'aria-label': 'Search the Wiki',
      'aria-autocomplete': 'list',
      'aria-expanded': listOpen,
      'aria-controls': listId,
      'aria-activedescendant': activeRow?.id,
      placeholder: 'Search the Wiki',
      autoComplete: 'off',
      spellCheck: false,
      value: draft,
      onChange: (event) => {
        props.setDraft(clampQuery(event.target.value));
        setProblem(null);
        setOpen(true);
        setActive(-1);
      },
      onKeyDown,
      onBlur: close,
    }),
    h('span', { className: 'wiki-searchbar-hint', 'aria-hidden': 'true' }, h(Kbd, { children: '/' })),
    problem === null ? null : h('p', { className: 'wiki-field-problem', role: 'alert' }, problem),
    listOpen
      ? h(
          'div',
          { className: 'wiki-popover wiki-suggest' },
          h(
            'ul',
            { id: listId, role: 'listbox', className: 'wiki-suggest-list', 'aria-label': 'Search suggestions', 'aria-busy': data.outdated || undefined },
            rows.map((row, index) =>
              h(
                'li',
                {
                  key: row.id,
                  id: row.id,
                  role: 'option',
                  className: 'wiki-suggest-item',
                  'data-kind': row.kind,
                  'aria-selected': index === active,
                  onMouseDown: (event) => event.preventDefault(),
                  onMouseMove: () => setActive(index),
                  onClick: () => run(row),
                },
                ...row.content,
              ),
            ),
          ),
          note === null ? null : h('p', { className: 'wiki-suggest-status', role: 'status', 'data-suggest-state': data.result === undefined && data.search.status !== 'error' ? 'loading' : 'empty' }, note),
          h(
            'div',
            { className: 'wiki-suggest-hints', 'aria-hidden': 'true' },
            h('span', null, h(Kbd, { children: '↑' }), h(Kbd, { children: '↓' }), ' move'),
            h('span', null, h(Kbd, { children: '↵' }), ' open'),
            h('span', null, h(Kbd, { children: 'Esc' }), ' close'),
          ),
        )
      : null,
  );
}
