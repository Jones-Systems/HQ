// Top bar: Back and Forward, the breadcrumb, the search field and the history button. At narrow widths a Browse button
// opens the sidebar as an overlay. The bar never scrolls; only the content below it does.

import { createElement as h, type ReactElement } from 'react';
import type { WikiNamespace } from '../../contract/src/index.ts';
import type { Crumb } from './chrome.ts';
import type { ViewCtx } from './context.ts';
import type { HistoryEntry } from './history.ts';
import { Icon } from './icons.ts';
import { HistoryMenu } from './view-history.ts';
import { SearchBox } from './view-combobox.ts';

function Breadcrumb(props: { readonly crumbs: readonly Crumb[] }): ReactElement {
  return h(
    'nav',
    { className: 'wiki-breadcrumb', 'aria-label': 'Breadcrumb' },
    h(
      'ol',
      { className: 'wiki-crumb-list' },
      props.crumbs.map((crumb, index) =>
        h(
          'li',
          { key: index, className: 'wiki-crumb', 'data-current': crumb.current || undefined },
          index === 0 ? null : h(Icon, { name: 'chevron-right', className: 'wiki-crumb-sep' }),
          crumb.action === null
            ? h('span', { className: 'wiki-crumb-text', 'aria-current': crumb.current ? 'page' : undefined, title: crumb.label }, crumb.label)
            : h('button', { type: 'button', className: 'wiki-crumb-button', onClick: crumb.action }, crumb.label),
        ),
      ),
    ),
  );
}

export function TopBar(props: {
  readonly ctx: ViewCtx;
  readonly crumbs: readonly Crumb[];
  readonly entries: readonly HistoryEntry[];
  readonly index: number;
  readonly onBack: () => void;
  readonly onForward: () => void;
  readonly onJump: (index: number) => void;
  readonly draft: string;
  readonly setDraft: (draft: string) => void;
  readonly repos: readonly WikiNamespace[];
  /** False on the results page, which answers live. */
  readonly suggest: boolean;
  readonly onSearch: (query: string) => void;
  readonly historyOpen: boolean;
  readonly setHistoryOpen: (open: boolean) => void;
  readonly sidebarOpen: boolean;
  readonly sidebarId: string;
  readonly onBrowse: () => void;
  readonly refs: {
    readonly input: { current: HTMLInputElement | null };
    readonly browse: { current: HTMLButtonElement | null };
    readonly history: { current: HTMLButtonElement | null };
  };
}): ReactElement {
  return h(
    'header',
    { className: 'wiki-topbar' },
    h(
      'button',
      {
        type: 'button',
        ref: props.refs.browse,
        className: 'wiki-icon-button wiki-browse',
        'aria-label': 'Browse',
        'aria-expanded': props.sidebarOpen,
        'aria-controls': props.sidebarId,
        title: 'Browse repositories and recent pages',
        onClick: props.onBrowse,
      },
      h(Icon, { name: 'menu' }),
    ),
    h(
      'div',
      { className: 'wiki-nav', role: 'group', 'aria-label': 'Wiki navigation' },
      h('button', { type: 'button', className: 'wiki-icon-button', 'aria-label': 'Back', title: 'Back (Alt+←)', disabled: props.index === 0, onClick: props.onBack }, h(Icon, { name: 'back' })),
      h('button', { type: 'button', className: 'wiki-icon-button', 'aria-label': 'Forward', title: 'Forward (Alt+→)', disabled: props.index >= props.entries.length - 1, onClick: props.onForward }, h(Icon, { name: 'forward' })),
    ),
    h(Breadcrumb, { crumbs: props.crumbs }),
    h(
      'div',
      { className: 'wiki-topbar-end' },
      h(SearchBox, { ctx: props.ctx, draft: props.draft, setDraft: props.setDraft, repos: props.repos, suggest: props.suggest, onSubmit: props.onSearch, inputRef: props.refs.input }),
      h(HistoryMenu, { session: props.ctx.session, entries: props.entries, index: props.index, open: props.historyOpen, setOpen: props.setHistoryOpen, onJump: props.onJump, buttonRef: props.refs.history }),
    ),
  );
}
