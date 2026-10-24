// Safe AST → React elements. Every string is a React text child; link targets become buttons or inert text.

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

function linkTitle(count: number): string {
  return `${count} pages match this name`;
}

function renderLink(node: LinkNode, ctx: ViewCtx, key: number): ReactElement {
  const children = renderInlines(node.children, ctx);
  const target = node.target;
  switch (target.kind) {
    case 'page':
      return h(
        'button',
        {
          key,
          type: 'button',
          className: 'wiki-link',
          'data-target': 'page',
          disabled: pageDestination(target.key) === null,
          onClick: () => ctx.openPage(target.key),
        },
        children,
      );
    case 'ambiguous':
      return h(
        'button',
        {
          key,
          type: 'button',
          className: 'wiki-link wiki-link-ambiguous',
          'data-target': 'ambiguous',
          title: linkTitle(target.candidates.length),
          onClick: () => ctx.openAmbiguity(textOf(node.children), target.candidates),
        },
        children,
      );
    case 'missing':
      return h(
        'span',
        { key, className: 'wiki-link-missing', 'data-target': 'missing', title: `Missing target: ${target.label}` },
        children,
      );
    default:
      // External URLs are shown, never opened.
      return h(
        'span',
        { key, className: 'wiki-link-external', 'data-target': 'external' },
        h('span', { className: 'wiki-external-text' }, children),
        h('span', { className: 'wiki-external-url' }, ` (${target.url})`),
      );
  }
}

function textOf(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node) => (node.type === 'text' || node.type === 'inlineCode' ? node.value : node.type === 'emphasis' || node.type === 'link' ? textOf(node.children) : ''))
    .join('')
    .slice(0, 256);
}

export function renderInlines(nodes: readonly InlineNode[], ctx: ViewCtx): ReactNode[] {
  return nodes.map((node, i): ReactNode => {
    switch (node.type) {
      case 'text':
        return h(Fragment, { key: i }, node.value);
      case 'inlineCode':
        return h('code', { key: i, className: 'wiki-inline-code' }, node.value);
      case 'emphasis':
        return h(node.strong ? 'strong' : 'em', { key: i }, renderInlines(node.children, ctx));
      default:
        return renderLink(node, ctx, i);
    }
  });
}

function renderRow(row: TableRowNode, ctx: ViewCtx, align: readonly (string | null)[], header: boolean, key: number): ReactElement {
  return h(
    'tr',
    { key },
    row.cells.map((cell, i) =>
      h(header ? 'th' : 'td', { key: i, 'data-align': align[i] ?? undefined, scope: header ? 'col' : undefined }, renderInlines(cell.children, ctx)),
    ),
  );
}

export function renderBlocks(blocks: readonly BlockNode[], ctx: ViewCtx): ReactNode[] {
  return blocks.map((block, i): ReactNode => {
    switch (block.type) {
      case 'heading': {
        const level = Math.min(6, block.depth + 1);
        return h(`h${level}`, { key: i, className: 'wiki-heading', 'data-depth': block.depth }, renderInlines(block.children, ctx));
      }
      case 'paragraph':
        return h('p', { key: i }, renderInlines(block.children, ctx));
      case 'list':
        return h(
          block.ordered ? 'ol' : 'ul',
          { key: i, start: block.ordered ? block.start : undefined },
          block.items.map((item, j) => h('li', { key: j }, renderBlocks(item.children, ctx))),
        );
      case 'fence':
        return h('pre', { key: i, className: 'wiki-fence', 'data-lang': block.lang ?? undefined }, h('code', null, block.text));
      case 'quote':
        return h('blockquote', { key: i }, renderBlocks(block.children, ctx));
      default:
        return h(
          'div',
          { key: i, className: 'wiki-table-wrap' },
          h(
            'table',
            { className: 'wiki-table' },
            h('thead', null, renderRow(block.header, ctx, block.align, true, 0)),
            h('tbody', null, block.rows.map((row, j) => renderRow(row, ctx, block.align, false, j))),
          ),
        );
    }
  });
}

export function renderDocument(document: MarkdownDocument, ctx: ViewCtx): ReactElement {
  return h('div', { className: 'wiki-content wiki-parsed', 'data-content': 'parsed' }, renderBlocks(document.children, ctx));
}
