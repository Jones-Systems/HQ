// The reader's link sections: "Linked from" (backlinks, with a preview of the sentence that links here) and
// "Links on this page" (out-links grouped by kind). Both live in the right rail and share the preview store.

import { createElement as h, useState, type ReactElement } from 'react';
import type { BacklinkEntry, BacklinkResult, OutLink, PageKey } from '../../contract/src/index.ts';
import { PageButton } from './common.ts';
import type { ViewCtx } from './context.ts';
import { ErrorNotice, Skeleton, type NoticeAction } from './feedback.ts';
import type { Resource } from './load.ts';
import { groupOutLinks } from './reader-model.ts';
import { recoveryActions } from './recovery.ts';
import { pageId } from './resources.ts';
import { BacklinkPreview, LinkPreview, Previewable, warmPage } from './view-preview.ts';

/** Out-link lists stay short until asked: more than this many collapse behind "Show all". */
export const OUT_LINK_COLLAPSE = 8;

function BacklinkRow(props: { readonly ctx: ViewCtx; readonly current: PageKey; readonly entry: BacklinkEntry }): ReactElement {
  const { ctx, entry } = props;
  const { source } = entry;
  return h(
    'li',
    { className: 'wiki-backlink' },
    h(Previewable, {
      id: `backlink-${pageId(source)}`,
      kind: 'backlink',
      placement: 'rail',
      ...(entry.excerpt === undefined ? { warm: warmPage(ctx, source) } : {}),
      card: () => h(BacklinkPreview, { ctx, entry, current: props.current }),
      children: (anchor: string) =>
        h('span', { className: `wiki-backlink-row${anchor}` }, h(PageButton, { ctx, pageKey: source, label: entry.title }), h('code', { className: 'wiki-path' }, source.path), entry.via === undefined ? null : h('span', { className: 'wiki-muted wiki-backlink-via' }, `Via ${entry.via.join(', ')}`)),
    }),
  );
}

function BacklinksBody(props: { readonly ctx: ViewCtx; readonly current: PageKey; readonly result: BacklinkResult }): ReactElement {
  const { ctx, result } = props;
  return h(
    'div',
    { className: 'wiki-backlinks-body', 'data-total': result.total },
    result.entries.length === 0
      ? h('p', { className: 'wiki-muted' }, 'No page links here.')
      : result.truncated
        ? h('p', { className: 'wiki-summary', 'data-truncated': 'true' }, `Showing ${result.entries.length} of ${result.total} pages that link here.`)
        : null,
    h(
      'ul',
      { className: 'wiki-linklist' },
      result.entries.map((entry) => h(BacklinkRow, { key: pageId(entry.source), ctx, current: props.current, entry })),
    ),
  );
}

/** `quiet`: the page already reports that the Wiki is unreachable, so a failure here shows no notice of its own. */
export function BacklinksSection(props: { readonly ctx: ViewCtx; readonly current: PageKey; readonly backlinks: Resource<BacklinkResult>; readonly quiet?: boolean }): ReactElement | null {
  const { ctx, backlinks } = props;
  const result = backlinks.value;
  if (props.quiet === true && result === undefined) return null;
  const actions: readonly NoticeAction[] = backlinks.error === null ? [] : recoveryActions(ctx, backlinks.error, { retry: backlinks.retry });
  return h(
    'section',
    { className: 'wiki-backlinks', 'aria-label': 'Backlinks', 'aria-busy': backlinks.status === 'loading' || undefined },
    h('h3', { className: 'wiki-rail-title' }, result === undefined ? 'Linked from' : `Linked from (${result.total})`),
    backlinks.error === null || props.quiet === true
      ? null
      : h(ErrorNotice, { error: backlinks.error, what: 'backlinks', variant: 'bar', tone: result === undefined ? 'danger' : 'warning', actions }),
    result !== undefined
      ? h(BacklinksBody, { ctx, current: props.current, result })
      : backlinks.status === 'loading'
        ? h(
            'div',
            { className: 'wiki-rail-loading' },
            h(Skeleton, { shape: 'line', lines: 3 }),
            h('p', { className: 'wiki-loading wiki-sr-only', role: 'status', 'data-state': 'loading' }, 'Loading backlinks…'),
          )
        : null,
  );
}

function OutLinkItem(props: { readonly ctx: ViewCtx; readonly link: OutLink; readonly index: number }): ReactElement {
  const { ctx, link, index } = props;
  const { target } = link;
  const id = `out-${index}`;
  const card = (): ReactElement => h(LinkPreview, { ctx, target, label: link.text });
  switch (target.kind) {
    case 'page':
      return h(Previewable, {
        id,
        kind: 'page',
        placement: 'rail',
        warm: warmPage(ctx, target.key),
        card,
        children: (anchor: string) => h('span', { className: `wiki-outlink-row${anchor}` }, h(PageButton, { ctx, pageKey: target.key, label: link.text })),
      });
    case 'ambiguous':
      return h(Previewable, {
        id,
        kind: 'ambiguous',
        placement: 'rail',
        card,
        children: (anchor: string) =>
          h(
            'span',
            { className: `wiki-outlink-row${anchor}` },
            h(
              'button',
              { type: 'button', className: 'wiki-link wiki-link-ambiguous', 'data-target': 'ambiguous', onClick: () => ctx.openAmbiguity(link.text, target.candidates) },
              link.text,
              h('span', { className: 'wiki-muted' }, ` ${target.candidates.length} candidates`),
            ),
          ),
      });
    case 'missing':
      return h(Previewable, {
        id,
        kind: 'missing',
        placement: 'rail',
        card,
        children: (anchor: string) =>
          h(
            'span',
            { className: `wiki-outlink-row${anchor}` },
            h('span', { className: 'wiki-link-missing', 'data-target': 'missing', tabIndex: 0, 'aria-description': `Missing page: ${target.label}` }, link.text),
          ),
      });
    default:
      return h(Previewable, {
        id,
        kind: 'external',
        placement: 'rail',
        card,
        children: (anchor: string) =>
          h(
            'span',
            { className: `wiki-outlink-row${anchor}` },
            h('span', { className: 'wiki-link-external', 'data-target': 'external', tabIndex: 0, 'aria-description': `External link, not opened from the Wiki: ${target.url}` }, link.text),
            h('span', { className: 'wiki-external-url' }, target.url),
          ),
      });
  }
}

export function OutLinksSection(props: { readonly ctx: ViewCtx; readonly links: readonly OutLink[] }): ReactElement {
  const groups = groupOutLinks(props.links);
  const total = groups.reduce((sum, group) => sum + group.links.length, 0);
  const [all, setAll] = useState(false);
  const collapsible = total > OUT_LINK_COLLAPSE;
  let budget = collapsible && !all ? OUT_LINK_COLLAPSE : Infinity;
  let offset = 0;
  const visible = groups.flatMap((group) => {
    const links = group.links.slice(0, budget);
    budget -= links.length;
    const start = offset;
    offset += group.links.length;
    return links.length === 0 ? [] : [{ group, links, start }];
  });
  return h(
    'section',
    { className: 'wiki-outlinks', 'aria-label': 'Links from this page' },
    h('h3', { className: 'wiki-rail-title' }, `Links on this page (${total})`),
    total === 0
      ? h('p', { className: 'wiki-muted' }, 'This page has no outgoing links.')
      : h(
          'div',
          { className: 'wiki-outlink-groups' },
          visible.map(({ group, links, start }) =>
            h(
              'div',
              { key: group.kind, className: 'wiki-outlink-group', 'data-group': group.kind },
              h('h4', { className: 'wiki-rail-subtitle' }, group.label, h('span', { className: 'wiki-count' }, String(group.links.length))),
              h(
                'ul',
                { className: 'wiki-linklist' },
                links.map((link, position) => h('li', { key: start + position, className: 'wiki-outlink' }, h(OutLinkItem, { ctx: props.ctx, link, index: start + position }))),
              ),
            ),
          ),
        ),
    collapsible
      ? h('button', { type: 'button', className: 'wiki-text-button', 'aria-expanded': all, onClick: () => setAll(!all) }, all ? 'Show fewer links' : `Show all ${total} links`)
      : null,
  );
}
