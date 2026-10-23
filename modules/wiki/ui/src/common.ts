// Shared presentational pieces. Everything user-visible is a React text child.

import { createElement as h, type ReactElement, type ReactNode } from 'react';
import type { PageKey, WikiError } from '../../contract/src/index.ts';
import type { ViewCtx } from './context.ts';
import { describeError, namespaceLabel } from './format.ts';
import type { Loaded } from './load.ts';

export function Loading(props: { readonly what: string }): ReactElement {
  return h('p', { className: 'wiki-loading', role: 'status', 'data-state': 'loading' }, `Loading ${props.what}…`);
}

export function ErrorPanel(props: { readonly error: WikiError; readonly what: string }): ReactElement {
  const text = describeError(props.error);
  return h(
    'div',
    { className: 'wiki-error', role: 'alert', 'data-state': 'error', 'data-code': props.error.code, 'data-reason': props.error.reason },
    h('strong', { className: 'wiki-error-title' }, text.title),
    h('p', { className: 'wiki-error-detail' }, `${text.detail} (${props.what})`),
    h('p', { className: 'wiki-error-message' }, props.error.message),
    h('p', { className: 'wiki-error-code' }, `${props.error.code} · ${props.error.reason}`),
  );
}

/** Loading / error / content for one request. `idle` (null) renders nothing. */
export function Async<T>(props: {
  readonly loaded: Loaded<T> | null;
  readonly what: string;
  readonly children: (value: T) => ReactNode;
}): ReactElement | null {
  const { loaded } = props;
  if (loaded === null) return null;
  if (loaded.status === 'loading') return h(Loading, { what: props.what });
  if (loaded.status === 'error') return h(ErrorPanel, { error: loaded.error, what: props.what });
  return h('div', { className: 'wiki-ready', 'data-state': 'ready' }, props.children(loaded.value));
}

export function NamespaceBadge(props: { readonly namespace: string }): ReactElement {
  return h('span', { className: 'wiki-ns', 'data-namespace': props.namespace }, namespaceLabel(props.namespace));
}

/** A navigation button for a page key. Never a link element: navigation is a request to the root. */
export function PageButton(props: { readonly ctx: ViewCtx; readonly pageKey: PageKey; readonly label?: string }): ReactElement {
  const { ctx, pageKey } = props;
  return h(
    'button',
    { type: 'button', className: 'wiki-link', 'data-target': 'page', onClick: () => ctx.openPage(pageKey) },
    props.label ?? pageKey.path,
    h('span', { className: 'wiki-ns' }, namespaceLabel(pageKey.namespace)),
  );
}

/** Candidates for an ambiguous name. Titles are not part of the contract here, so paths identify them. */
export function Disambiguation(props: {
  readonly ctx: ViewCtx;
  readonly label: string;
  readonly candidates: readonly PageKey[];
  readonly heading?: boolean;
}): ReactElement {
  const { ctx, candidates } = props;
  return h(
    'section',
    { className: 'wiki-disambiguation', 'aria-label': 'Disambiguation' },
    props.heading === false ? null : h('h2', { className: 'wiki-section-title' }, 'Which page did you mean?'),
    h('p', { className: 'wiki-muted' }, `“${props.label}” matches ${candidates.length} pages. Choose one.`),
    h(
      'ul',
      { className: 'wiki-candidates' },
      candidates.map((candidate) => h('li', { key: `${candidate.namespace}/${candidate.path}` }, h(PageButton, { ctx, pageKey: candidate }))),
    ),
  );
}
