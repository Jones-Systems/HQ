// Safe AST → React elements. Every string is a React text child; link targets become buttons or inert text, and each
// link can show a preview card (view-preview.ts). Headings carry the stable ids the outline scrolls to.

import { createElement as h, Fragment, type ReactElement, type ReactNode } from 'react';
import type {
  BlockNode,
  InlineNode,
  LinkNode,
  MarkdownDocument,
  TableRowNode,
} from '../../contract/src/index.ts';
import type { ViewCtx } from './context.ts';
import { pageDestination } from './destinations.ts';
import { Icon } from './icons.ts';
import { documentHeadings, inlineText, type DocumentHeadings } from './reader-model.ts';
import { LinkPreview, Previewable, warmPage } from './view-preview.ts';

/** Per-render state: heading ids and levels for the document, and a counter that gives every link its own id. */
export interface RenderState {
  readonly headings: DocumentHeadings;
  links: number;
}

const NO_HEADINGS: DocumentHeadings = { info: new Map(), skipped: null, outline: [] };

export function createRenderState(headings: DocumentHeadings = NO_HEADINGS): RenderState {
  return { headings, links: 0 };
}

const linkLabel = (node: LinkNode): string => inlineText(node.children).slice(0, 256);

function renderLink(node: LinkNode, ctx: ViewCtx, key: number, state: RenderState): ReactElement {
  const children = renderInlines(node.children, ctx, state);
  const target = node.target;
  const id = `link-${state.links++}`;
  const label = linkLabel(node);
  const card = (): ReactNode => h(LinkPreview, { ctx, target, label });
  switch (target.kind) {
    case 'page':
      return h(Previewable, {
        key,
        id,
        kind: 'page',
        placement: 'inline',
        warm: warmPage(ctx, target.key),
        card,
        children: (anchor: string) =>
          h(
            'button',
            {
              type: 'button',
              className: `wiki-link${anchor}`,
              'data-target': 'page',
              disabled: pageDestination(target.key) === null,
              onClick: () => ctx.openPage(target.key),
            },
            children,
          ),
      });
    case 'ambiguous':
      return h(Previewable, {
        key,
        id,
        kind: 'ambiguous',
        placement: 'inline',
        card,
        children: (anchor: string) =>
          h(
            'button',
            {
              type: 'button',
              className: `wiki-link wiki-link-ambiguous${anchor}`,
              'data-target': 'ambiguous',
              'data-count': target.candidates.length,
              'aria-label': `${label}, ${target.candidates.length} pages match this name`,
              onClick: () => ctx.openAmbiguity(label, target.candidates),
            },
            children,
          ),
      });
    case 'missing':
      return h(Previewable, {
        key,
        id,
        kind: 'missing',
        placement: 'inline',
        card,
        children: (anchor: string) =>
          h('span', { className: `wiki-link-missing${anchor}`, 'data-target': 'missing', tabIndex: 0, 'aria-description': `Missing page: ${target.label}` }, children),
      });
    default:
      // External URLs are shown in the preview and the link list, never opened.
      return h(Previewable, {
        key,
        id,
        kind: 'external',
        placement: 'inline',
        card,
        children: (anchor: string) =>
          h(
            'span',
            { className: `wiki-link-external${anchor}`, 'data-target': 'external', tabIndex: 0, 'aria-description': `External link, not opened from the Wiki: ${target.url}` },
            h('span', { className: 'wiki-external-text' }, children),
            h(Icon, { name: 'external', className: 'wiki-external-icon' }),
          ),
      });
  }
}

export function renderInlines(nodes: readonly InlineNode[], ctx: ViewCtx, state: RenderState = createRenderState()): ReactNode[] {
  return nodes.map((node, i): ReactNode => {
    switch (node.type) {
      case 'text':
        return h(Fragment, { key: i }, node.value);
      case 'inlineCode':
        return h('code', { key: i, className: 'wiki-inline-code' }, node.value);
      case 'emphasis':
        return h(node.strong ? 'strong' : 'em', { key: i }, renderInlines(node.children, ctx, state));
      default:
        return renderLink(node, ctx, i, state);
    }
  });
}

function renderRow(row: TableRowNode, ctx: ViewCtx, state: RenderState, align: readonly (string | null)[], header: boolean, key: number): ReactElement {
  return h(
    'tr',
    { key },
    row.cells.map((cell, i) =>
      h(header ? 'th' : 'td', { key: i, 'data-align': align[i] ?? undefined, scope: header ? 'col' : undefined }, renderInlines(cell.children, ctx, state)),
    ),
  );
}

export function renderBlocks(blocks: readonly BlockNode[], ctx: ViewCtx, state: RenderState = createRenderState()): ReactNode[] {
  return blocks.map((block, i): ReactNode => {
    switch (block.type) {
      case 'heading': {
        if (block === state.headings.skipped) return null;
        const info = state.headings.info.get(block);
        const level = info?.level ?? Math.min(6, block.depth + 1);
        return h(
          `h${level}`,
          { key: i, id: info?.id, tabIndex: info === undefined ? undefined : -1, className: 'wiki-heading', 'data-depth': block.depth },
          renderInlines(block.children, ctx, state),
        );
      }
      case 'paragraph':
        return h('p', { key: i }, renderInlines(block.children, ctx, state));
      case 'list':
        return h(
          block.ordered ? 'ol' : 'ul',
          { key: i, start: block.ordered ? block.start : undefined },
          block.items.map((item, j) => h('li', { key: j }, renderBlocks(item.children, ctx, state))),
        );
      case 'fence':
        return h('pre', { key: i, className: 'wiki-fence', 'data-lang': block.lang ?? undefined }, h('code', null, block.text));
      case 'quote':
        return h('blockquote', { key: i }, renderBlocks(block.children, ctx, state));
      default:
        return h(
          'div',
          { key: i, className: 'wiki-table-wrap' },
          h(
            'table',
            { className: 'wiki-table' },
            h('thead', null, renderRow(block.header, ctx, state, block.align, true, 0)),
            h('tbody', null, block.rows.map((row, j) => renderRow(row, ctx, state, block.align, false, j))),
          ),
        );
    }
  });
}

/** `headings` (from `documentHeadings`) carries the heading ids and the dropped duplicate title heading. */
export function renderDocument(document: MarkdownDocument, ctx: ViewCtx, headings: DocumentHeadings = documentHeadings(document, '')): ReactElement {
  return h('div', { className: 'wiki-content wiki-parsed', 'data-content': 'parsed' }, renderBlocks(document.children, ctx, createRenderState(headings)));
}
