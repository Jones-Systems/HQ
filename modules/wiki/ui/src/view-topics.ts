// Topic tree for one repository: parentId nesting, page counts and previewed members.

import { createElement as h, useState, type ReactElement } from 'react';
import { NAMESPACES, validateTopicList, type TopicList, type WikiNamespace } from '../../contract/src/index.ts';
import { Async, PageButton } from './common.ts';
import type { ViewCtx } from './context.ts';
import { namespaceLabel } from './format.ts';
import { contract, useLoaded } from './load.ts';
import { buildTopicTree, type TopicNode } from './topic-tree.ts';

const DEFAULT_OPEN_DEPTH = 2;

function openByDefault(nodes: readonly TopicNode[], depth: number, into: Set<string>): Set<string> {
  for (const node of nodes) {
    if (depth < DEFAULT_OPEN_DEPTH) into.add(node.topic.id);
    openByDefault(node.children, depth + 1, into);
  }
  return into;
}

function allIds(nodes: readonly TopicNode[], into: Set<string>): Set<string> {
  for (const node of nodes) {
    into.add(node.topic.id);
    allIds(node.children, into);
  }
  return into;
}

function Node(props: {
  readonly ctx: ViewCtx;
  readonly node: TopicNode;
  readonly open: ReadonlySet<string>;
  readonly toggle: (id: string) => void;
}): ReactElement {
  const { ctx, node, open, toggle } = props;
  const { topic } = node;
  const expandable = node.children.length > 0 || topic.pages.length > 0;
  const expanded = expandable && open.has(topic.id);
  const hidden = topic.pageCount - topic.pages.length;
  return h(
    'li',
    { className: 'wiki-topic', 'data-topic-id': topic.id, 'data-expanded': String(expanded) },
    h(
      'div',
      { className: 'wiki-topic-head' },
      expandable
        ? h('button', { type: 'button', className: 'wiki-toggle', 'aria-expanded': expanded, 'aria-label': `${expanded ? 'Collapse' : 'Expand'} ${topic.label}`, onClick: () => toggle(topic.id) }, expanded ? '−' : '+')
        : h('span', { className: 'wiki-toggle-spacer', 'aria-hidden': true }),
      h('span', { className: 'wiki-topic-label' }, topic.label),
      h('span', { className: 'wiki-badge', 'data-count': topic.pageCount }, `${topic.pageCount} ${topic.pageCount === 1 ? 'page' : 'pages'}`),
    ),
    expanded
      ? h(
          'div',
          { className: 'wiki-topic-body' },
          topic.pages.length === 0
            ? null
            : h(
                'ul',
                { className: 'wiki-linklist wiki-topic-pages' },
                topic.pages.map((key) => h('li', { key: key.path }, h(PageButton, { ctx, pageKey: key }))),
                hidden > 0 ? h('li', { key: '…more', className: 'wiki-muted' }, `and ${hidden} more`) : null,
              ),
          node.children.length === 0
            ? null
            : h('ul', { className: 'wiki-topic-tree' }, node.children.map((child) => h(Node, { key: child.topic.id, ctx, node: child, open, toggle }))),
        )
      : null,
  );
}

function Tree(props: { readonly ctx: ViewCtx; readonly list: TopicList }): ReactElement {
  const roots = buildTopicTree(props.list.topics);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => openByDefault(roots, 0, new Set()));
  const toggle = (id: string): void =>
    setOpen((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  if (roots.length === 0) return h('p', { className: 'wiki-empty', 'data-state': 'empty' }, `No topics in ${namespaceLabel(props.list.namespace)}.`);
  return h(
    'div',
    { className: 'wiki-topics-body' },
    h(
      'div',
      { className: 'wiki-actions' },
      h('button', { type: 'button', className: 'wiki-button', onClick: () => setOpen(allIds(roots, new Set())) }, 'Expand all'),
      h('button', { type: 'button', className: 'wiki-button', onClick: () => setOpen(new Set()) }, 'Collapse all'),
    ),
    h('ul', { className: 'wiki-topic-tree wiki-topic-root' }, roots.map((node) => h(Node, { key: node.topic.id, ctx: props.ctx, node, open, toggle }))),
  );
}

export function TopicsView(props: { readonly ctx: ViewCtx; readonly namespace: WikiNamespace }): ReactElement {
  const { ctx, namespace } = props;
  const list = useLoaded<TopicList>(
    `topics:${namespace}`,
    () => ctx.service.listTopics({ namespace }),
    contract(validateTopicList, (value) => (value.namespace === namespace ? null : 'The Wiki returned topics for a different repository.')),
  );
  return h(
    'section',
    { className: 'wiki-topics', 'aria-label': 'Topics' },
    h('h2', { className: 'wiki-section-title' }, `Topics · ${namespaceLabel(namespace)}`),
    h(
      'div',
      { className: 'wiki-actions', role: 'group', 'aria-label': 'Repository' },
      NAMESPACES.map((candidate) =>
        h('button', { key: candidate, type: 'button', className: 'wiki-button', 'aria-pressed': candidate === namespace, onClick: () => ctx.openTopics(candidate) }, namespaceLabel(candidate)),
      ),
    ),
    // Keyed by namespace so expansion state never leaks between repositories.
    h(Async<TopicList>, { key: namespace, loaded: list, what: 'topics', children: (value) => h(Tree, { ctx, list: value }) }),
  );
}
