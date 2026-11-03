// Reader: title and text lead; properties, provenance and the page's links stay one glance away. Pages come from the
// session cache (instant Back), a failure keeps what loaded, and every problem shows in place with a way forward.

import { createElement as h, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { Page, PageField, PageKey, RawReason, WikiError } from '../../contract/src/index.ts';
import type { ViewCtx } from './context.ts';
import { ErrorNotice, Notice, Skeleton } from './feedback.ts';
import { describeError, folderParts, namespaceLabel, pageName, shortCommit } from './format.ts';
import { useResource } from './load.ts';
import { useOutageToasts } from './outage.ts';
import { documentHeadings, sameText, type DocumentHeadings } from './reader-model.ts';
import { recoveryActions } from './recovery.ts';
import { renderDocument } from './render-ast.ts';
import { backlinksResource, pageId, pageResource } from './resources.ts';
import { BacklinksSection, OutLinksSection } from './view-links.ts';
import { Outline } from './view-outline.ts';
import { PreviewProvider } from './view-preview.ts';

const RAW_EXPLANATIONS: Readonly<Record<RawReason, string>> = {
  'frontmatter-unsupported': 'The frontmatter uses syntax this reader cannot represent safely, so the file is shown verbatim.',
  'markdown-unsupported': 'The Markdown could not be turned into a safe document, so the file is shown verbatim.',
  'not-text': 'The file is not valid text. Undecodable bytes appear as replacement characters.',
};

/** Properties shown before "Show all N properties". */
export const PROPERTIES_SHOWN = 6;

function FieldValue(props: { readonly field: PageField }): ReactElement {
  const { value } = props.field;
  return Array.isArray(value)
    ? h('ul', { className: 'wiki-field-list wiki-chips' }, value.map((item, i) => h('li', { key: i, className: 'wiki-chip' }, String(item))))
    : h('span', null, String(value));
}

/** Frontmatter as a compact two-column grid. A `title` field that repeats the page title is not a property. */
function Properties(props: { readonly fields: readonly PageField[]; readonly title: string }): ReactElement | null {
  const fields = props.fields.filter((field) => !(field.name.toLowerCase() === 'title' && typeof field.value === 'string' && sameText(field.value, props.title)));
  const [all, setAll] = useState(false);
  if (fields.length === 0) return null;
  const shown = all ? fields : fields.slice(0, PROPERTIES_SHOWN);
  return h(
    'section',
    { className: 'wiki-fields', 'aria-label': 'Properties' },
    h(
      'dl',
      { className: 'wiki-properties' },
      shown.map((field) =>
        h('div', { key: field.name, className: 'wiki-prop', 'data-field-name': field.name }, h('dt', null, field.name), h('dd', null, h(FieldValue, { field }))),
      ),
    ),
    fields.length > PROPERTIES_SHOWN
      ? h('button', { type: 'button', className: 'wiki-text-button', 'aria-expanded': all, onClick: () => setAll(!all) }, all ? 'Show fewer properties' : `Show all ${fields.length} properties`)
      : null,
  );
}

/** Size and the full provenance, one click away. */
function PageDetails(props: { readonly page: Page }): ReactElement {
  const { page } = props;
  return h(
    'details',
    { className: 'wiki-details' },
    h('summary', null, 'Page details'),
    h(
      'dl',
      { className: 'wiki-provenance', 'aria-label': 'Provenance' },
      h('div', { className: 'wiki-row', 'data-field': 'repository' }, h('dt', null, 'Repository'), h('dd', null, namespaceLabel(page.key.namespace))),
      h('div', { className: 'wiki-row', 'data-field': 'path' }, h('dt', null, 'Path'), h('dd', null, h('code', null, page.key.path))),
      h('div', { className: 'wiki-row', 'data-field': 'commit' }, h('dt', null, 'Commit'), h('dd', null, h('code', { title: page.commit }, shortCommit(page.commit)))),
      h('div', { className: 'wiki-row', 'data-field': 'size' }, h('dt', null, 'Size'), h('dd', null, `${page.byteLength} bytes`)),
    ),
  );
}

function PageHeader(props: { readonly ctx: ViewCtx; readonly page: Page }): ReactElement {
  const { ctx, page } = props;
  const folder = folderParts(page.key.path).join(' / ');
  return h(
    'header',
    { className: 'wiki-page-header' },
    h('h1', { className: 'wiki-page-title', tabIndex: -1 }, page.title),
    h(
      'p',
      { className: 'wiki-meta' },
      h(
        'button',
        { type: 'button', className: 'wiki-ns wiki-meta-repo', 'data-namespace': page.key.namespace, title: `Browse ${namespaceLabel(page.key.namespace)} topics`, onClick: () => ctx.openTopics(page.key.namespace) },
        namespaceLabel(page.key.namespace),
      ),
      folder === '' ? null : h('code', { className: 'wiki-meta-folder' }, folder),
      h('span', { className: 'wiki-meta-commit' }, 'Commit ', h('code', { title: page.commit }, page.commit.slice(0, 7))),
    ),
    h(Properties, { fields: page.fields, title: page.title }),
    h(PageDetails, { page }),
  );
}

function Content(props: { readonly ctx: ViewCtx; readonly page: Page; readonly headings: DocumentHeadings | null }): ReactElement {
  const { content } = props.page;
  if (content.state === 'parsed') return renderDocument(content.ast, props.ctx, props.headings ?? documentHeadings(content.ast, props.page.title));
  return h(
    'div',
    { className: 'wiki-content wiki-raw', 'data-content': 'raw', 'data-raw-reason': content.reason },
    h(
      Notice,
      { tone: 'info', title: 'Shown as plain text', live: 'off', className: 'wiki-raw-note' },
      RAW_EXPLANATIONS[content.reason],
      h('span', { className: 'wiki-raw-reason' }, content.reason),
    ),
    h('pre', { className: 'wiki-raw-text' }, content.text),
  );
}

function LoadingPage(props: { readonly title: string | undefined }): ReactElement {
  return h(
    'div',
    { className: 'wiki-page-loading', 'aria-busy': 'true' },
    props.title === undefined ? h(Skeleton, { shape: 'title' }) : h('h1', { className: 'wiki-page-title', tabIndex: -1, 'data-provisional': 'true' }, props.title),
    h(Skeleton, { shape: 'line', className: 'wiki-skeleton-meta' }),
    h(Skeleton, { shape: 'line', lines: 4 }),
    h(Skeleton, { shape: 'line', lines: 3 }),
    h('p', { className: 'wiki-loading wiki-sr-only', role: 'status', 'data-state': 'loading' }, 'Loading page…'),
  );
}

/** A page that cannot be shown: not in this repository, or the Wiki could not answer. */
function PageProblem(props: { readonly ctx: ViewCtx; readonly pageKey: PageKey; readonly error: WikiError; readonly retry: () => void }): ReactElement {
  const { ctx, pageKey, error } = props;
  const actions = recoveryActions(ctx, error, { retry: props.retry, searchFor: pageName(pageKey.path) });
  if (error.code !== 'not-found') return h(ErrorNotice, { error, what: 'this page', actions });
  const text = describeError(error);
  return h(
    Notice,
    {
      tone: 'warning',
      title: `This page isn’t in ${namespaceLabel(pageKey.namespace)}`,
      live: 'assertive',
      actions,
      data: { 'data-state': 'error', 'data-code': error.code, 'data-reason': error.reason },
    },
    h('p', { className: 'wiki-notice-detail' }, `${text.detail} It may have been renamed or removed.`),
    error.message === '' ? null : h('p', { className: 'wiki-notice-message' }, error.message),
    h('p', { className: 'wiki-notice-code' }, `${pageKey.path} · ${error.code}`),
  );
}

function ReaderPage(props: { readonly ctx: ViewCtx; readonly pageKey: PageKey }): ReactElement {
  const { ctx, pageKey } = props;
  const page = useResource(pageResource(ctx.service, pageKey), ctx.cache);
  const backlinks = useResource(backlinksResource(ctx.service, pageKey), ctx.cache);
  const retryPage = useOutageToasts(ctx, page);
  const scope = useRef<HTMLDivElement | null>(null);
  const value = page.value;

  const headings = useMemo(() => (value !== undefined && value.content.state === 'parsed' ? documentHeadings(value.content.ast, value.title) : null), [value]);

  // Opening a page records it, so the sidebar's recent list and the history popover can name it.
  useEffect(() => {
    if (value !== undefined) ctx.session.visit(value.key, value.title);
  }, [ctx.session, value]);
  useEffect(() => {
    for (const entry of backlinks.value?.entries ?? []) ctx.session.rememberTitle(entry.source, entry.title);
  }, [ctx.session, backlinks.value]);

  // Content that replaces a skeleton rises in; a page that was already cached appears at once.
  const rise = useRef(false);
  if (page.status === 'loading') rise.current = true;

  let article: ReactElement;
  if (value !== undefined) {
    article = h(
      'div',
      { className: 'wiki-article-body', 'data-enter': rise.current ? 'rise' : undefined },
      h(PageHeader, { ctx, page: value }),
      h(Content, { ctx, page: value, headings }),
    );
  } else if (page.status === 'error' && page.error !== null) {
    article = h('div', { className: 'wiki-article-body' }, h(PageProblem, { ctx, pageKey, error: page.error, retry: retryPage }));
  } else {
    article = h(LoadingPage, { title: ctx.session.titleOf(pageKey) });
  }

  return h(
    'article',
    { className: 'wiki-reader', 'aria-label': 'Reader', 'data-page': pageId(pageKey) },
    page.error !== null && value !== undefined
      ? h(ErrorNotice, { error: page.error, what: 'this page', variant: 'bar', tone: 'warning', actions: recoveryActions(ctx, page.error, { retry: retryPage }) })
      : null,
    h(
      PreviewProvider,
      null,
      h(
        'div',
        { className: 'wiki-reader-layout' },
        h('div', { className: 'wiki-article', ref: scope }, article),
        h(
          'aside',
          { className: 'wiki-rail', 'aria-label': 'Page context' },
          headings === null ? null : h(Outline, { items: headings.outline, scope }),
          h(BacklinksSection, { ctx, current: pageKey, backlinks }),
          value === undefined ? null : h(OutLinksSection, { ctx, links: value.outLinks }),
        ),
      ),
    ),
  );
}

/** One reader per page: keyed, so previews, the outline and expanded properties never carry over between pages. */
export function ReaderView(props: { readonly ctx: ViewCtx; readonly pageKey: PageKey }): ReactElement {
  return h(ReaderPage, { key: pageId(props.pageKey), ctx: props.ctx, pageKey: props.pageKey });
}
