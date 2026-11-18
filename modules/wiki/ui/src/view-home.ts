// Home: the repositories at a glance (state, size, freshness, a way into topics), recently opened pages and the biggest
// topics. When the Wiki is not set up or its host does not answer, one calm "Connect" state replaces all of it.

import { createElement as h, useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import { NAMESPACES, type SourceDescriptor, type Topic, type WikiError, type WikiNamespace } from '../../contract/src/index.ts';
import { RepoBadge, useOutageSignals } from './chrome.ts';
import type { ViewCtx } from './context.ts';
import type { Notice as DestinationNotice } from './destinations.ts';
import { ErrorNotice, Notice, Skeleton, StatusChip, type NoticeAction } from './feedback.ts';
import { describeError, errorRecovery, folderParts, namespaceLabel, relativeTime, shortCommit } from './format.ts';
import { Icon } from './icons.ts';
import { useResource } from './load.ts';
import { topicsResource } from './resources.ts';
import type { RepoRow, WikiStatus } from './status.ts';

export const HOME_TOPICS = 8;
const CONNECT_COPY = 'Choose the BusinessLessons and App Development repositories in Settings to read and search them here.';

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
      children: h('span', { 'data-freshness': graph.state }, graph.indexedCommit === null ? graph.state : `${graph.state} (built from ${shortCommit(graph.indexedCommit)})`),
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

function Card(props: { readonly ctx: ViewCtx; readonly item: RepoRow; readonly loadingSource: boolean }): ReactElement {
  const { ctx, item } = props;
  const [details, setDetails] = useState(false);
  const detailsId = `${useId()}-details`;
  const { source } = item;
  const available = item.state !== 'unavailable' && item.state !== 'unknown';
  const pages = item.pageCount === null ? null : `${item.pageCount} ${item.pageCount === 1 ? 'page' : 'pages'}`;
  return h(
    'article',
    { className: 'wiki-card', 'data-namespace': item.namespace },
    h(
      'header',
      { className: 'wiki-card-head' },
      h('h3', { className: 'wiki-card-title' }, item.label),
      h('span', { className: 'wiki-card-status', 'data-index-state': item.state }, h(StatusChip, { tone: item.tone, label: item.word, busy: item.state === 'building' })),
    ),
    pages === null ? null : h('p', { className: 'wiki-card-count' }, pages),
    source === null
      ? props.loadingSource
        ? h(Skeleton, { shape: 'line', className: 'wiki-card-skeleton' })
        : h('p', { className: 'wiki-muted' }, 'No source information is available for this repository.')
      : h(
          'p',
          { className: 'wiki-card-updated' },
          'Updated ',
          h('time', { dateTime: source.commitTime, title: source.commitTime }, relativeTime(source.commitTime, Date.now())),
          h('code', { className: 'wiki-card-commit', title: source.commit }, shortCommit(source.commit)),
        ),
    h(
      'div',
      { className: 'wiki-card-actions' },
      available
        ? h(
            'button',
            { type: 'button', className: 'wiki-button wiki-button-primary', onClick: () => ctx.openTopics(item.namespace) },
            h(Icon, { name: 'topics' }),
            'Browse ',
            h('span', { className: 'wiki-sr-only' }, `${item.label} `),
            'topics',
          )
        : ctx.openSettings === null
          ? null
          : h('button', { type: 'button', className: 'wiki-button', onClick: ctx.openSettings }, h(Icon, { name: 'settings' }), 'Set up in Wiki settings'),
      source === null
        ? null
        : h('button', { type: 'button', className: 'wiki-button wiki-card-toggle', 'aria-expanded': details, 'aria-controls': detailsId, onClick: () => setDetails(!details) }, 'Details', h(Icon, { name: 'chevron-down', className: 'wiki-card-chevron' })),
    ),
    source === null ? null : h('div', { id: detailsId, className: 'wiki-card-details', 'data-open': String(details), inert: !details }, h('div', { className: 'wiki-card-details-inner' }, h(Provenance, { source }))),
  );
}

function SkeletonCards(): ReactElement {
  return h(
    'div',
    { className: 'wiki-cards', 'aria-busy': 'true' },
    NAMESPACES.map((namespace) =>
      h(
        'article',
        { key: namespace, className: 'wiki-card wiki-card--skeleton', 'aria-hidden': 'true' },
        h(Skeleton, { shape: 'title' }),
        h(Skeleton, { shape: 'line', lines: 2 }),
        h(Skeleton, { shape: 'chip' }),
      ),
    ),
  );
}

function recoveryActions(ctx: ViewCtx, error: WikiError, retry: () => void, busy: boolean): NoticeAction[] {
  const actions: NoticeAction[] = [];
  for (const step of errorRecovery(error)) {
    if (step === 'retry') actions.push({ label: 'Retry', onAction: retry, busy, busyLabel: 'Retrying', icon: 'refresh' });
    else if (step === 'settings' && ctx.openSettings !== null) actions.push({ label: 'Wiki settings', onAction: ctx.openSettings, icon: 'settings' });
  }
  return actions;
}

function TopicsToExplore(props: { readonly ctx: ViewCtx; readonly rows: readonly RepoRow[] }): ReactElement | null {
  const { ctx, rows } = props;
  const lists = NAMESPACES.map((namespace) => {
    const row = rows.find((item) => item.namespace === namespace);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useResource(row !== undefined && (row.state === 'unavailable' || row.state === 'unknown') ? null : topicsResource(ctx.service, namespace), ctx.cache);
  });
  const groups = NAMESPACES.map((namespace, index): { readonly namespace: WikiNamespace; readonly topics: readonly Topic[] } => {
    const value = lists[index]?.value;
    const roots = value === undefined ? [] : value.topics.filter((topic) => topic.parentId === null && topic.pageCount > 0);
    return { namespace, topics: [...roots].sort((a, b) => b.pageCount - a.pageCount).slice(0, HOME_TOPICS) };
  }).filter((group) => group.topics.length > 0);
  if (groups.length === 0) return null;
  return h(
    'section',
    { className: 'wiki-home-section wiki-home-topics', 'aria-label': 'Topics to explore' },
    h('h2', { className: 'wiki-home-heading' }, 'Topics to explore'),
    groups.map((group) =>
      h(
        'div',
        { key: group.namespace, className: 'wiki-topic-group', 'data-namespace': group.namespace },
        h('span', { className: 'wiki-eyebrow' }, namespaceLabel(group.namespace)),
        h(
          'ul',
          { className: 'wiki-chips' },
          group.topics.map((topic) =>
            h(
              'li',
              { key: topic.id },
              h(
                'button',
                { type: 'button', className: 'wiki-chip', 'data-topic-id': topic.id, title: `Browse ${topic.label} in ${namespaceLabel(group.namespace)}`, onClick: () => ctx.openTopics(group.namespace) },
                h('span', { className: 'wiki-chip-label' }, topic.label),
                h('span', { className: 'wiki-chip-count' }, String(topic.pageCount)),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

function RecentlyOpened(props: { readonly ctx: ViewCtx }): ReactElement | null {
  const { ctx } = props;
  const recent = ctx.session.recent().slice(0, HOME_TOPICS);
  if (recent.length === 0) return null;
  return h(
    'section',
    { className: 'wiki-home-section wiki-home-recent', 'aria-label': 'Recently opened' },
    h('h2', { className: 'wiki-home-heading' }, 'Recently opened'),
    h(
      'ul',
      { className: 'wiki-recent-list' },
      recent.map((item) =>
        h(
          'li',
          { key: `${item.key.namespace}/${item.key.path}` },
          h(
            'button',
            { type: 'button', className: 'wiki-recent-item', 'data-target': 'page', onClick: () => ctx.openPage(item.key) },
            h(Icon, { name: 'page', className: 'wiki-recent-icon' }),
            h('span', { className: 'wiki-recent-title' }, item.title),
            h(RepoBadge, { namespace: item.key.namespace }),
            h('span', { className: 'wiki-recent-folder' }, folderParts(item.key.path).join(' / ')),
          ),
        ),
      ),
    ),
  );
}

export function HomeView(props: { readonly ctx: ViewCtx; readonly notice: DestinationNotice | null; readonly status: WikiStatus }): ReactElement {
  const { ctx, notice, status } = props;
  const refreshing = status.sources.refreshing || status.index.refreshing;
  const signals = useOutageSignals(ctx, { error: status.error, refreshing, hasContent: status.known });
  const [trying, setTrying] = useState(false);
  useEffect(() => {
    if (!status.loading) setTrying(false);
  }, [status.loading]);
  const retry = (): void => {
    signals.noteRetry();
    setTrying(true);
    status.retry();
  };

  const failures = [
    { what: 'repository list', resource: status.sources },
    { what: 'index status', resource: status.index },
  ].filter((item) => item.resource.error !== null);
  const connect = status.notConnected || (trying && status.loading);
  const pending = status.sources.status === 'loading' || status.index.status === 'loading';

  return h(
    'section',
    { className: 'wiki-home', 'aria-label': 'Home', 'aria-busy': status.loading || undefined },
    notice === null
      ? null
      : h(
          Notice,
          { tone: 'info', title: 'That destination is not recognised, so Home is shown.', live: 'polite', data: { 'data-notice': 'destination' } },
          notice.excerpt === '' ? null : h('p', { className: 'wiki-notice-destination' }, `Destination: “${notice.excerpt}”`),
          h('p', null, `Reason: ${notice.reason}`),
        ),
    h(
      'header',
      { className: 'wiki-home-head' },
      h('h1', { className: 'wiki-home-title' }, 'Wiki'),
      h('p', { className: 'wiki-home-lede' }, `Read and search ${NAMESPACES.map(namespaceLabel).join(' and ')}.`),
    ),
    connect
      ? h(
          Notice,
          {
            tone: 'info',
            variant: 'empty',
            title: 'Connect the Local Wiki',
            live: 'polite',
            data: {
              'data-state': 'not-connected',
              ...(status.error === null ? {} : { 'data-code': status.error.code, 'data-reason': status.error.reason }),
            },
            actions: [
              ...(ctx.openSettings === null ? [] : [{ label: 'Open Wiki settings', onAction: ctx.openSettings, icon: 'settings' as const }]),
              { label: 'Try again', onAction: retry, busy: trying && status.loading, busyLabel: 'Trying again', icon: 'refresh' as const },
            ],
          },
          h('p', { className: 'wiki-notice-detail' }, CONNECT_COPY),
          status.error === null ? null : h('p', { className: 'wiki-notice-message' }, `${describeError(status.error).title} · ${status.error.message}`),
        )
      : h(
          'div',
          { className: 'wiki-home-body' },
          pending ? h('p', { className: 'wiki-sr-only', role: 'status', 'data-state': 'loading' }, 'Loading repositories…') : null,
          failures.map(({ what, resource }) =>
            resource.error === null
              ? null
              : h(ErrorNotice, {
                  key: what,
                  error: resource.error,
                  what,
                  variant: 'bar',
                  tone: resource.value !== undefined ? 'warning' : 'danger',
                  actions: recoveryActions(ctx, resource.error, retry, refreshing),
                }),
          ),
          status.loading ? h(SkeletonCards) : h('div', { className: 'wiki-cards' }, status.rows.map((item) => h(Card, { key: item.namespace, ctx, item, loadingSource: status.sources.status === 'loading' }))),
          h(RecentlyOpened, { ctx }),
          h(TopicsToExplore, { ctx, rows: status.rows }),
        ),
  );
}
