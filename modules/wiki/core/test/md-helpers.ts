// Markdown test helpers: parse, resolve links to inspectable targets, validate against the contract
// and render the AST as a compact string so expectations stay readable.

import {
  validateMarkdownDocument,
  type BlockNode,
  type InlineNode,
  type LinkTarget,
  type MarkdownDocument,
} from '../../contract/src/index.ts';
import { parseMarkdown, resolveDocument, collectLinks, type DraftDocument, type LinkRef } from '../src/index.ts';

export interface Parsed {
  readonly doc: DraftDocument;
  readonly ast: MarkdownDocument;
  readonly links: readonly LinkRef[];
}

/** Parse, require success, resolve links to simple targets and require a contract-valid AST. */
export function parse(markdown: string): Parsed {
  const result = parseMarkdown(markdown);
  if (!result.ok) throw new Error('markdown overflowed unexpectedly');
  const ast = resolveDocument(result.doc, (link) =>
    link.kind === 'external' ? { kind: 'external', url: link.url } : { kind: 'missing', label: link.kind === 'path' ? link.dest : link.target },
  );
  const valid = validateMarkdownDocument(ast);
  if (!valid.ok) throw new Error(`AST invalid: ${valid.error.reason} at ${valid.error.path ?? ''}: ${valid.error.message}`);
  return { doc: result.doc, ast, links: collectLinks(result.doc) };
}

function target(t: LinkTarget): string {
  switch (t.kind) {
    case 'external':
      return `ext:${t.url}`;
    case 'missing':
      return `ref:${t.label}`;
    case 'page':
      return `page:${t.key.path}`;
    case 'ambiguous':
      return 'ambiguous';
  }
}

export function inline(nodes: readonly InlineNode[]): string {
  return nodes
    .map((node): string => {
      switch (node.type) {
        case 'text':
          return JSON.stringify(node.value);
        case 'inlineCode':
          return `\`${node.value}\``;
        case 'emphasis':
          return `${node.strong ? 'strong' : 'em'}(${inline(node.children)})`;
        case 'link':
          return `link<${target(node.target)}>(${inline(node.children)})`;
      }
    })
    .join(' ');
}

export function blocks(nodes: readonly BlockNode[]): string {
  return nodes
    .map((node): string => {
      switch (node.type) {
        case 'heading':
          return `h${node.depth}[${inline(node.children)}]`;
        case 'paragraph':
          return `p[${inline(node.children)}]`;
        case 'list':
          return `${node.ordered ? `ol${node.start ?? ''}` : 'ul'}[${node.items.map((item) => `li[${blocks(item.children)}]`).join(' ')}]`;
        case 'fence':
          return `code(${node.lang ?? ''}):${JSON.stringify(node.text)}`;
        case 'quote':
          return `q[${blocks(node.children)}]`;
        case 'table':
          return `table(${node.align.map((a) => a ?? '-').join(',')})[${[node.header, ...node.rows]
            .map((row) => row.cells.map((cell) => inline(cell.children)).join(' | '))
            .join(' / ')}]`;
      }
    })
    .join(' ');
}

/** One-line rendering of a whole document. */
export function show(markdown: string): string {
  return blocks(parse(markdown).ast.children);
}

/** Rendering of just the inline content of a single paragraph. */
export function showInline(markdown: string): string {
  const first = parse(markdown).ast.children[0];
  if (first === undefined || (first.type !== 'paragraph' && first.type !== 'heading')) throw new Error('expected a paragraph');
  return inline(first.children);
}
