// Reader: provenance, fields, parsed or raw content, out-links and backlinks for one page.

import { createElement as h, type ReactElement } from 'react';
import {
  pageKeyEquals,
  validateBacklinkResult,
  validatePage,
  type BacklinkResult,
  type OutLink,
  type Page,
  type PageField,
  type PageKey,
  type RawReason,
} from '../../contract/src/index.ts';
import { Async, NamespaceBadge, PageButton } from './common.ts';
import type { ViewCtx } from './context.ts';
import { namespaceLabel, shortCommit } from './format.ts';
import { contract, useLoaded } from './load.ts';
import { renderDocument } from './render-ast.ts';

const RAW_EXPLANATIONS: Readonly<Record<RawReason, string>> = {
  'frontmatter-unsupported': 'The frontmatter uses syntax this reader cannot represent safely, so the file is shown verbatim.',
  'markdown-unsupported': 'The Markdown could not be turned into a safe document, so the file is shown verbatim.',
  'not-text': 'The file is not valid text. Undecodable bytes appear as replacement characters.',
};

function FieldValue(props: { readonly field: PageField }): ReactElement {
  const { value } = props.field;
  return Array.isArray(value)
    ? h('ul', { className: 'wiki-field-list' }, value.map((item, i) => h('li', { key: i }, String(item))))
    : h('span', null, String(value));
}

function Fields(props: { readonly fields: readonly PageField[] }): ReactElement | null {
  if (props.fields.length === 0) return null;
  return h(
    'section',
    { className: 'wiki-fields', 'aria-label': 'Fields' },
    h('h3', { className: 'wiki-subtitle' }, 'Fields'),
    h(
      'dl',
      { className: 'wiki-provenance' },
      props.fields.map((field) =>
        h('div', { key: field.name, className: 'wiki-row', 'data-field-name': field.name }, h('dt', null, field.name), h('dd', null, h(FieldValue, { field }))),
      ),
    ),
  );
}

function Content(props: { readonly ctx: ViewCtx; readonly page: Page }): ReactElement {
  const { content } = props.page;
  if (content.state === 'parsed') return renderDocument(content.ast, props.ctx);
  return h(
    'div',
    { className: 'wiki-content wiki-raw', 'data-content': 'raw', 'data-raw-reason': content.reason },
    h('p', { className: 'wiki-raw-note', role: 'note' }, h('strong', null, 'Shown as raw text'), ` (${content.reason}). ${RAW_EXPLANATIONS[content.reason]}`),
    h('pre', { className: 'wiki-raw-text' }, content.text),
  );
}

function OutLinkItem(props: { readonly ctx: ViewCtx; readonly link: OutLink }): ReactElement {
  const { ctx, link } = props;
  const { target } = link;
  switch (target.kind) {
    case 'page':
      return h(PageButton, { ctx, pageKey: target.key, label: link.text });
    case 'ambiguous':
      return h(
        'button',
        { type: 'button', className: 'wiki-link wiki-link-ambiguous', 'data-target': 'ambiguous', onClick: () => ctx.openAmbiguity(link.text, target.candidates) },
        link.text,
        h('span', { className: 'wiki-muted' }, ` ${target.candidates.length} candidates`),
      );
    case 'missing':
      return h('span', { className: 'wiki-link-missing', 'data-target': 'missing', title: `Missing target: ${target.label}` }, link.text, h('span', { className: 'wiki-muted' }, ` (missing: ${target.label})`));
    default:
      return h('span', { className: 'wiki-link-external', 'data-target': 'external' }, link.text, h('span', { className: 'wiki-external-url' }, ` (${target.url})`));
  }
}

function OutLinks(props: { readonly ctx: ViewCtx; readonly links: readonly OutLink[] }): ReactElement {
  return h(
    'section',
    { className: 'wiki-outlinks', 'aria-label': 'Links from this page' },
    h('h3', { className: 'wiki-subtitle' }, `Links from this page (${props.links.length})`),
    props.links.length === 0
      ? h('p', { className: 'wiki-muted' }, 'This page has no outgoing links.')
      : h('ul', { className: 'wiki-linklist' }, props.links.map((link, i) => h('li', { key: i }, h(OutLinkItem, { ctx: props.ctx, link })))),
  );
}

function Backlinks(props: { readonly ctx: ViewCtx; readonly result: BacklinkResult }): ReactElement {
  const { ctx, result } = props;
  return h(
    'div',
    { className: 'wiki-backlinks-body', 'data-total': result.total },
    result.entries.length === 0
      ? h('p', { className: 'wiki-muted' }, 'No page links here.')
      : h(
          'p',
          { className: 'wiki-summary', 'data-truncated': String(result.truncated) },
          result.truncated ? `Showing ${result.entries.length} of ${result.total} pages that link here.` : `${result.total} ${result.total === 1 ? 'page links' : 'pages link'} here.`,
        ),
    h(
      'ul',
      { className: 'wiki-linklist' },
      result.entries.map((entry) =>
        h('li', { key: `${entry.source.namespace}/${entry.source.path}` }, h(PageButton, { ctx, pageKey: entry.source, label: entry.title }), h('code', { className: 'wiki-path' }, entry.source.path)),
      ),
    ),
  );
}

export function ReaderView(props: { readonly ctx: ViewCtx; readonly pageKey: PageKey }): ReactElement {
  const { ctx, pageKey } = props;
  const id = `${pageKey.namespace}\u0000${pageKey.path}`;
  const page = useLoaded<Page>(
    `page:${id}`,
    () => ctx.service.getPage({ key: pageKey }),
    contract(validatePage, (value) => (pageKeyEquals(value.key, pageKey) ? null : 'The Wiki returned a different page than requested.')),
  );
  const backlinks = useLoaded<BacklinkResult>(
    `backlinks:${id}`,
    () => ctx.service.getBacklinks({ key: pageKey }),
    contract(validateBacklinkResult, (value) => (pageKeyEquals(value.target, pageKey) ? null : 'The Wiki returned backlinks for a different page.')),
  );

  return h(
    'article',
    { className: 'wiki-reader', 'aria-label': 'Reader' },
    h('p', { className: 'wiki-crumbs' }, h(NamespaceBadge, { namespace: pageKey.namespace }), h('code', null, pageKey.path)),
    h(Async<Page>, {
      loaded: page,
      what: 'page',
      children: (value) =>
        h(
          'div',
          null,
          h('h2', { className: 'wiki-page-title' }, value.title),
          h(
            'dl',
            { className: 'wiki-provenance', 'aria-label': 'Provenance' },
            h('div', { className: 'wiki-row', 'data-field': 'repository' }, h('dt', null, 'Repository'), h('dd', null, namespaceLabel(value.key.namespace))),
            h('div', { className: 'wiki-row', 'data-field': 'path' }, h('dt', null, 'Path'), h('dd', null, h('code', null, value.key.path))),
            h('div', { className: 'wiki-row', 'data-field': 'commit' }, h('dt', null, 'Commit'), h('dd', null, h('code', { title: value.commit }, shortCommit(value.commit)))),
            h('div', { className: 'wiki-row', 'data-field': 'size' }, h('dt', null, 'Size'), h('dd', null, `${value.byteLength} bytes`)),
          ),
          h(Fields, { fields: value.fields }),
          h(Content, { ctx, page: value }),
          h(OutLinks, { ctx, links: value.outLinks }),
        ),
    }),
    h(
      'section',
      { className: 'wiki-backlinks', 'aria-label': 'Backlinks' },
      h('h3', { className: 'wiki-subtitle' }, 'Backlinks'),
      h(Async<BacklinkResult>, { loaded: backlinks, what: 'backlinks', children: (value) => h(Backlinks, { ctx, result: value }) }),
    ),
  );
}
