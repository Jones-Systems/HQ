// Topic tree for one repository: a segmented repository control, a live filter that keeps the ancestors of matches,
// chevron disclosures that open with a short height animation, and page rows named by their file.

import { createElement as h, useMemo, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { NAMESPACES, pageKeyId, type PageKey, type Topic, type TopicList, type WikiNamespace } from '../../contract/src/index.ts';
import type { ViewCtx } from './context.ts';
import { ErrorNotice, Notice, Skeleton } from './feedback.ts';
import { folderParts, namespaceLabel } from './format.ts';
import { Icon } from './icons.ts';
import { useResource } from './load.ts';
import { useOutageToasts } from './outage.ts';
import { recoveryActions } from './recovery.ts';
import { topicsResource } from './resources.ts';
import { buildTopicTree, countShown, filterWords, markPieces, showTopics, topicPageLabel, type ShownTopic, type TopicNode } from './topic-tree.ts';

/** Levels of the tree that start open. */
const DEFAULT_OPEN_DEPTH = 2;

function depthsOf(nodes: readonly TopicNode[], depth: number, into: Map<string, number>): Map<string, number> {
  for (const node of nodes) {
    into.set(node.topic.id, depth);
    depthsOf(node.children, depth + 1, into);
  }
  return into;
}

function idsOf(nodes: readonly ShownTopic[], into: string[] = []): string[] {
  for (const node of nodes) {
    into.push(node.topic.id);
    idsOf(node.children, into);
  }
  return into;
}

/** `text` with the filter's words marked. Built from text children only. */
function Marked(props: { readonly text: string; readonly words: readonly string[] }): ReactElement {
  return h(
    'span',
    null,
    markPieces(props.text, props.words).map((piece, index) => (piece.match ? h('mark', { key: index, className: 'wiki-topic-mark' }, piece.text) : piece.text)),
  );
}

function PageRow(props: { readonly ctx: ViewCtx; readonly topic: Topic; readonly pageKey: PageKey; readonly words: readonly string[]; readonly matched: boolean }): ReactElement {
  const { ctx, pageKey } = props;
  const folder = folderParts(pageKey.path).join(' / ');
  return h(
    'li',
    { className: 'wiki-topic-page', 'data-match': props.matched ? 'true' : undefined },
    h(
      'button',
      { type: 'button', className: 'wiki-topic-page-button', 'data-target': 'page', onClick: () => ctx.openPage(pageKey) },
      h('span', { className: 'wiki-page-name' }, h(Marked, { text: topicPageLabel(props.topic, pageKey), words: props.words })),
      folder === '' ? null : h('span', { className: 'wiki-page-folder' }, h(Marked, { text: folder, words: props.words })),
    ),
  );
}

interface TreeState {
  /** Explicit open/closed choices; reset whenever the filter changes. */
  readonly choices: ReadonlyMap<string, boolean>;
  readonly query: string;
  /** Topics the last action opened: only these animate. */
  readonly entering: ReadonlySet<string>;
}

function Node(props: {
  readonly ctx: ViewCtx;
  readonly node: ShownTopic;
  readonly words: readonly string[];
  readonly isOpen: (id: string) => boolean;
  readonly entering: ReadonlySet<string>;
  readonly toggle: (id: string) => void;
}): ReactElement {
  const { ctx, node, words, isOpen, entering, toggle } = props;
  const { topic } = node;
  const expandable = node.children.length > 0 || node.pages.length > 0;
  const expanded = expandable && isOpen(topic.id);
  const hidden = topic.pageCount - topic.pages.length;
  return h(
    'li',
    { className: 'wiki-topic', 'data-topic-id': topic.id, 'data-expanded': String(expanded), 'data-match': node.labelMatch ? 'true' : undefined },
    h(
      'div',
      { className: 'wiki-topic-head' },
      expandable
        ? h(
            'button',
            { type: 'button', className: 'wiki-toggle', 'aria-expanded': expanded, 'aria-label': `${expanded ? 'Collapse' : 'Expand'} ${topic.label}`, onClick: () => toggle(topic.id) },
            h(Icon, { name: 'chevron-right', className: 'wiki-toggle-icon' }),
          )
        : h('span', { className: 'wiki-toggle-spacer', 'aria-hidden': 'true' }),
      h('span', { className: 'wiki-topic-label' }, h(Marked, { text: topic.label, words })),
      h('span', { className: 'wiki-badge', 'data-count': topic.pageCount }, `${topic.pageCount} ${topic.pageCount === 1 ? 'page' : 'pages'}`),
    ),
    expanded
      ? h(
          'div',
          { className: 'wiki-topic-body', 'data-enter': entering.has(topic.id) ? 'expand' : undefined },
          h(
            'div',
            { className: 'wiki-topic-inner' },
            node.pages.length === 0 && hidden <= 0
              ? null
              : h(
                  'ul',
                  { className: 'wiki-linklist wiki-topic-pages' },
                  node.pages.map((key) => h(PageRow, { key: pageKeyId(key), ctx, topic, pageKey: key, words, matched: node.pageMatches.has(pageKeyId(key)) })),
                  hidden > 0 ? h('li', { key: '…more', className: 'wiki-muted wiki-topic-more' }, `and ${hidden} more`) : null,
                ),
            node.children.length === 0
              ? null
              : h(
                  'ul',
                  { className: 'wiki-topic-tree' },
                  node.children.map((child) => h(Node, { key: child.topic.id, ctx, node: child, words, isOpen, entering, toggle })),
                ),
          ),
        )
      : null,
  );
}

/** Arrow keys move between the disclosures and page rows; → opens and ← closes the topic under focus. */
function onTreeKeys(event: KeyboardEvent<HTMLElement>): void {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'ArrowRight', 'ArrowLeft'];
  if (!keys.includes(event.key)) return;
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button.wiki-toggle, button.wiki-topic-page-button'));
  const current = items.findIndex((item) => item === document.activeElement);
  if (current < 0) return;
  const here = items[current]!;
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
    if (!here.classList.contains('wiki-toggle')) return;
    const open = here.getAttribute('aria-expanded') === 'true';
    if ((event.key === 'ArrowRight') === open) return;
    event.preventDefault();
    here.click();
    return;
  }
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : Math.min(items.length - 1, Math.max(0, current + (event.key === 'ArrowDown' ? 1 : -1)));
  items[next]?.focus();
}

function Tree(props: { readonly ctx: ViewCtx; readonly list: TopicList }): ReactElement {
  const { ctx } = props;
  const roots = useMemo(() => buildTopicTree(props.list.topics), [props.list]);
  const depths = useMemo(() => depthsOf(roots, 0, new Map()), [roots]);
  const [query, setQuery] = useState('');
  const [state, setState] = useState<TreeState>({ choices: new Map(), query: '', entering: new Set() });
  const words = useMemo(() => filterWords(query), [query]);
  const shown = useMemo(() => showTopics(roots, query), [roots, query]);
  const filtering = words.length > 0;
  // A choice made under another filter no longer applies.
  const choices = state.query === query ? state.choices : new Map<string, boolean>();
  const entering = state.query === query ? state.entering : new Set<string>();
  const isOpen = (id: string): boolean => choices.get(id) ?? (filtering || (depths.get(id) ?? 0) < DEFAULT_OPEN_DEPTH);

  const apply = (ids: readonly string[], open: boolean): void => {
    const next = new Map(choices);
    const opened = new Set<string>();
    for (const id of ids) {
      if (open && !isOpen(id)) opened.add(id);
      next.set(id, open);
    }
    setState({ choices: next, query, entering: opened });
  };
  const toggle = (id: string): void => apply([id], !isOpen(id));

  if (roots.length === 0) {
    return h(Notice, { tone: 'neutral', variant: 'empty', title: `No topics in ${namespaceLabel(props.list.namespace)}.`, live: 'off', data: { 'data-state': 'empty' } }, 'Topics appear once the repository has been indexed.');
  }
  const matches = countShown(shown);
  const ids = idsOf(shown);
  let body: ReactNode;
  if (shown.length === 0) {
    body = h(
      Notice,
      { tone: 'neutral', variant: 'empty', title: `No topics match “${query.trim()}”`, live: 'off', data: { 'data-state': 'no-match' }, actions: [{ label: 'Clear filter', onAction: () => setQuery('') }] },
      'Try fewer words, or check the spelling.',
    );
  } else {
    body = h(
      'ul',
      { className: 'wiki-topic-tree wiki-topic-root', onKeyDown: onTreeKeys },
      shown.map((node) => h(Node, { key: node.topic.id, ctx, node, words, isOpen, entering, toggle })),
    );
  }
  return h(
    'div',
    { className: 'wiki-topics-body' },
    h(
      'div',
      { className: 'wiki-topics-tools' },
      h('input', {
        type: 'search',
        name: 'filter',
        className: 'wiki-input wiki-topics-filter',
        'aria-label': 'Filter topics',
        placeholder: 'Filter topics',
        autoComplete: 'off',
        value: query,
        onChange: (event) => setQuery(event.target.value.slice(0, 200)),
        onKeyDown: (event) => {
          if (event.key === 'Escape' && query !== '') {
            event.preventDefault();
            event.stopPropagation();
            setQuery('');
          } else if (event.key === 'ArrowDown') {
            const first = event.currentTarget.closest('.wiki-topics-body')?.querySelector<HTMLElement>('button.wiki-toggle, button.wiki-topic-page-button');
            if (first !== null && first !== undefined) {
              event.preventDefault();
              first.focus();
            }
          }
        },
      }),
      h(
        'div',
        { className: 'wiki-actions' },
        h('button', { type: 'button', className: 'wiki-button', onClick: () => apply(ids, true) }, 'Expand all'),
        h('button', { type: 'button', className: 'wiki-button', onClick: () => apply(ids, false) }, 'Collapse all'),
      ),
    ),
    filtering ? h('p', { className: 'wiki-topics-count', role: 'status', 'data-matches': matches }, shown.length === 0 ? '' : `${matches} ${matches === 1 ? 'topic matches' : 'topics match'} “${query.trim()}”`) : null,
    body,
  );
}

function TopicsLoading(): ReactElement {
  return h(
    'div',
    { className: 'wiki-topics-loading', 'aria-busy': 'true' },
    Array.from({ length: 5 }, (_, index) => h('div', { key: index, className: 'wiki-topic-skeleton' }, h(Skeleton, { shape: 'chip' }), h(Skeleton, { shape: 'line', className: 'wiki-skeleton-label' }))),
    h('p', { className: 'wiki-loading wiki-sr-only', role: 'status', 'data-state': 'loading' }, 'Loading topics…'),
  );
}

function TopicsBody(props: { readonly ctx: ViewCtx; readonly namespace: WikiNamespace }): ReactElement {
  const { ctx, namespace } = props;
  const list = useResource(topicsResource(ctx.service, namespace), ctx.cache);
  const retry = useOutageToasts(ctx, list);
  if (list.value !== undefined) {
    return h(
      'div',
      { className: 'wiki-ready', 'data-state': 'ready' },
      list.error === null ? null : h(ErrorNotice, { error: list.error, what: 'topics', variant: 'bar', tone: 'warning', actions: recoveryActions(ctx, list.error, { retry }) }),
      h(Tree, { ctx, list: list.value }),
    );
  }
  if (list.status === 'error' && list.error !== null) return h(ErrorNotice, { error: list.error, what: 'topics', actions: recoveryActions(ctx, list.error, { retry }) });
  return h(TopicsLoading);
}

export function TopicsView(props: { readonly ctx: ViewCtx; readonly namespace: WikiNamespace }): ReactElement {
  const { ctx, namespace } = props;
  return h(
    'section',
    { className: 'wiki-topics', 'aria-label': 'Topics' },
    h(
      'header',
      { className: 'wiki-topics-header' },
      h('h1', { className: 'wiki-section-title', tabIndex: -1 }, 'Topics'),
      h(
        'div',
        { className: 'wiki-segmented', role: 'group', 'aria-label': 'Repository' },
        NAMESPACES.map((candidate) =>
          h('button', { key: candidate, type: 'button', className: 'wiki-segment', 'aria-pressed': candidate === namespace, onClick: () => ctx.openTopics(candidate) }, namespaceLabel(candidate)),
        ),
      ),
    ),
    // Keyed by namespace so the filter and expansion state never leak between repositories.
    h(TopicsBody, { key: namespace, ctx, namespace }),
  );
}
