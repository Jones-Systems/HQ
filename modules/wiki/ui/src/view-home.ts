// Home: repositories with provenance and freshness, plus entry points to topics.

import { createElement as h, type ReactElement, type ReactNode } from 'react';
import {
  NAMESPACES,
  validateIndexStatus,
  validateSourceDescriptor,
  type IndexStatus,
  type NamespaceIndexStatus,
  type SourceDescriptor,
  type WikiError,
  type WikiNamespace,
} from '../../contract/src/index.ts';
import { ErrorPanel, Loading } from './common.ts';
import type { ViewCtx } from './context.ts';
import type { Notice } from './destinations.ts';
import { invalidResponse, namespaceLabel, shortCommit } from './format.ts';
import { contract, useLoaded } from './load.ts';

const checkDescriptor = contract(validateSourceDescriptor);

function checkSources(value: readonly SourceDescriptor[]): WikiError | null {
  if (!Array.isArray(value)) return invalidResponse('The source list was not an array.');
  for (const descriptor of value) {
    const problem = checkDescriptor(descriptor);
    if (problem !== null) return problem;
  }
  return null;
}

function Time(props: { readonly iso: string | null; readonly none: string }): ReactElement {
  return props.iso === null ? h('span', { className: 'wiki-muted' }, props.none) : h('time', { dateTime: props.iso }, props.iso);
}

function Row(props: { readonly label: string; readonly children: ReactNode; readonly name: string }): ReactElement {
  return h('div', { className: 'wiki-row', 'data-field': props.name }, h('dt', null, props.label), h('dd', null, props.children));
}

function Provenance(props: { readonly source: SourceDescriptor }): ReactElement {
  const { source } = props;
  const { graph, content } = source.freshness;
  return h(
    'dl',
    { className: 'wiki-provenance' },
    h(Row, { label: 'Ref', name: 'ref', children: h('code', null, source.ref) }),
    h(Row, { label: 'Commit', name: 'commit', children: h('code', { title: source.commit }, shortCommit(source.commit)) }),
    h(Row, { label: 'Commit time', name: 'commitTime', children: h(Time, { iso: source.commitTime, none: 'unknown' }) }),
    h(Row, { label: 'Indexed', name: 'indexedAt', children: h(Time, { iso: source.indexedAt, none: 'never indexed' }) }),
    h(Row, {
      label: 'Index freshness',
      name: 'graphFreshness',
      children: h(
        'span',
        { 'data-freshness': graph.state },
        graph.indexedCommit === null ? graph.state : `${graph.state} (built from ${shortCommit(graph.indexedCommit)})`,
      ),
    }),
    h(Row, {
      label: 'Remote freshness',
      name: 'contentFreshness',
      children:
        content.state === 'unknown'
          ? h('span', { 'data-freshness': 'unknown' }, 'Unknown (not checked against the remote)')
          : h('span', { 'data-freshness': content.state }, `${content.state}, checked `, h(Time, { iso: content.checkedAt, none: 'never' })),
    }),
  );
}

function Card(props: {
  readonly ctx: ViewCtx;
  readonly namespace: WikiNamespace;
  readonly source: SourceDescriptor | null;
  readonly entry: NamespaceIndexStatus | null;
}): ReactElement {
  const { ctx, namespace, source, entry } = props;
  return h(
    'article',
    { className: 'wiki-card', 'data-namespace': namespace },
    h(
      'header',
      { className: 'wiki-card-head' },
      h('h3', { className: 'wiki-card-title' }, namespaceLabel(namespace)),
      entry === null ? null : h('span', { className: 'wiki-badge', 'data-index-state': entry.state }, entry.state === 'unavailable' ? 'source unavailable' : `index ${entry.state}`),
    ),
    entry === null || entry.state === 'unavailable'
      ? null
      : h('p', { className: 'wiki-muted' }, `${entry.pageCount} ${entry.pageCount === 1 ? 'page' : 'pages'} indexed`),
    source === null ? h('p', { className: 'wiki-muted' }, 'No source information is available for this repository.') : h(Provenance, { source }),
    h(
      'div',
      { className: 'wiki-actions' },
      h('button', { type: 'button', className: 'wiki-button', onClick: () => ctx.openTopics(namespace) }, `Browse ${namespaceLabel(namespace)} topics`),
    ),
  );
}

export function HomeView(props: { readonly ctx: ViewCtx; readonly notice: Notice | null }): ReactElement {
  const { ctx, notice } = props;
  const sources = useLoaded('sources', () => ctx.service.listSources(), checkSources);
  const status = useLoaded<IndexStatus>('status', () => ctx.service.indexStatus(), contract(validateIndexStatus));

  const descriptors = sources?.status === 'ready' ? sources.value : [];
  const entries = status?.status === 'ready' ? status.value.namespaces : [];
  const anyReady = sources?.status === 'ready' || status?.status === 'ready';
  const anyLoading = sources?.status === 'loading' || status?.status === 'loading';

  return h(
    'section',
    { className: 'wiki-home', 'aria-label': 'Home' },
    notice === null
      ? null
      : h(
          'div',
          { className: 'wiki-notice', role: 'status', 'data-notice': 'destination' },
          h('strong', null, 'That destination is not recognised, so Home is shown.'),
          notice.excerpt === '' ? null : h('p', { className: 'wiki-notice-destination' }, `Destination: “${notice.excerpt}”`),
          h('p', { className: 'wiki-muted' }, `Reason: ${notice.reason}`),
        ),
    h('h2', { className: 'wiki-section-title' }, 'Repositories'),
    anyLoading ? h(Loading, { what: 'repositories' }) : null,
    sources?.status === 'error' ? h(ErrorPanel, { error: sources.error, what: 'repository list' }) : null,
    status?.status === 'error' ? h(ErrorPanel, { error: status.error, what: 'index status' }) : null,
    anyReady
      ? h(
          'div',
          { className: 'wiki-cards' },
          NAMESPACES.map((namespace) => {
            const entry = entries.find((candidate) => candidate.namespace === namespace) ?? null;
            const source = descriptors.find((candidate) => candidate.namespace === namespace) ?? entry?.source ?? null;
            return h(Card, { key: namespace, ctx, namespace, source, entry });
          }),
        )
      : null,
  );
}
