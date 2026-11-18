// Sidebar: Home, the repositories with their state, recent pages and the Wiki's overall status. At narrow widths the
// root shows it as an overlay; the content is the same.

import { createElement as h, type ReactElement, type ReactNode } from 'react';
import { pageKeyEquals, type PageKey, type WikiNamespace } from '../../contract/src/index.ts';
import type { Shown } from './chrome.ts';
import type { ViewCtx } from './context.ts';
import { StatusChip } from './feedback.ts';
import { excerpt } from './format.ts';
import { Icon } from './icons.ts';
import type { RepoRow, WikiStatus } from './status.ts';

export const SIDEBAR_RECENT = 8;

function countText(count: number): string {
  return `${count} ${count === 1 ? 'page' : 'pages'}`;
}

/** "BusinessLessons, Ready, 38 pages": the name a screen reader and the tooltip give a repository row. */
export function repoSummary(item: RepoRow): string {
  return [item.label, item.word, item.pageCount === null ? null : countText(item.pageCount)].filter((part): part is string => part !== null).join(', ');
}

function StatusShape(props: { readonly tone: RepoRow['tone'] }): ReactElement {
  return h('span', { className: `wiki-status wiki-status--${props.tone}`, 'data-status': props.tone, 'aria-hidden': 'true' }, h('span', { className: 'wiki-status-shape' }));
}

function Group(props: { readonly id: string; readonly title: string; readonly children?: ReactNode }): ReactElement {
  return h('div', { className: 'wiki-side-group', role: 'group', 'aria-labelledby': props.id }, h('div', { className: 'wiki-eyebrow', id: props.id }, props.title), props.children);
}

export function Sidebar(props: {
  readonly ctx: ViewCtx;
  readonly id: string;
  readonly status: WikiStatus;
  readonly shown: Shown;
  readonly open: boolean;
  /** Called after any item opens something, so a narrow overlay can close. */
  readonly onChoose: () => void;
}): ReactElement {
  const { ctx, shown, status } = props;
  const recent = ctx.session.recent().slice(0, SIDEBAR_RECENT);
  const choose = (action: () => void) => (): void => {
    action();
    props.onChoose();
  };
  const currentPage = shown.view === 'page' ? shown.key : null;
  const topicsOf: WikiNamespace | null = shown.view === 'topics' ? shown.namespace : null;
  const within: WikiNamespace | null = currentPage === null ? null : currentPage.namespace;

  return h(
    'nav',
    { className: 'wiki-sidebar', id: props.id, 'aria-label': 'Wiki', 'data-open': String(props.open) },
    h('div', { className: 'wiki-sidebar-head' }, h('span', { className: 'wiki-sidebar-title' }, 'Wiki')),
    h(
      'button',
      { type: 'button', className: 'wiki-side-item', 'data-side': 'home', 'aria-current': shown.view === 'home' ? 'page' : undefined, onClick: choose(ctx.openHome) },
      h(Icon, { name: 'home' }),
      h('span', { className: 'wiki-side-name' }, 'Home'),
    ),
    h(
      Group,
      { id: `${props.id}-repositories`, title: 'Repositories' },
      h(
        'ul',
        { className: 'wiki-side-list' },
        status.rows.map((item) => {
          const summary = repoSummary(item);
          return h(
            'li',
            { key: item.namespace },
            h(
              'button',
              {
                type: 'button',
                className: 'wiki-side-item wiki-side-repo',
                'data-side': 'repository',
                'data-namespace': item.namespace,
                'data-state': item.state,
                'data-within': within === item.namespace || undefined,
                'aria-current': topicsOf === item.namespace ? 'page' : undefined,
                'aria-label': summary,
                title: summary,
                onClick: choose(() => ctx.openTopics(item.namespace)),
              },
              h(StatusShape, { tone: item.tone }),
              h('span', { className: 'wiki-side-name' }, item.label),
              item.pageCount === null ? null : h('span', { className: 'wiki-side-count' }, String(item.pageCount)),
            ),
          );
        }),
      ),
    ),
    recent.length === 0
      ? null
      : h(
          Group,
          { id: `${props.id}-recent`, title: 'Recent' },
          h(
            'ul',
            { className: 'wiki-side-list' },
            recent.map((item) => {
              const title = excerpt(item.title, 60);
              const key: PageKey = item.key;
              return h(
                'li',
                { key: `${key.namespace}/${key.path}` },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'wiki-side-item wiki-side-recent',
                    'data-side': 'recent',
                    'aria-current': currentPage !== null && pageKeyEquals(currentPage, key) ? 'page' : undefined,
                    title: `${title} · ${key.path}`,
                    onClick: choose(() => ctx.openPage(key)),
                  },
                  h('span', { className: 'wiki-side-name' }, title),
                ),
              );
            }),
          ),
        ),
    h(
      'div',
      { className: 'wiki-sidebar-foot' },
      h(StatusChip, { tone: status.overall.tone, label: status.overall.word, busy: status.overall.busy }),
      ctx.openSettings === null
        ? null
        : h(
            'button',
            { type: 'button', className: 'wiki-side-item wiki-side-settings', 'data-side': 'settings', onClick: choose(ctx.openSettings) },
            h(Icon, { name: 'settings' }),
            h('span', { className: 'wiki-side-name' }, 'Wiki settings'),
          ),
    ),
  );
}
