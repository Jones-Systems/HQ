// Synthetic fixtures only: invented names and content, no corpus bytes.

import type { MarkdownDocument, Page, SourceDescriptor } from '../src/index.ts';

export const COMMIT_A = 'a'.repeat(40);
export const COMMIT_B = 'b'.repeat(40);

export function descriptor(overrides: Partial<SourceDescriptor> = {}): SourceDescriptor {
  return {
    schema: 'hq.wiki.source/v1',
    namespace: 'bl',
    ref: 'main',
    commit: COMMIT_A,
    commitTime: '2026-01-02T03:04:05Z',
    indexedAt: '2026-01-02T04:00:00.250Z',
    freshness: {
      graph: { state: 'current', indexedCommit: COMMIT_A },
      content: { state: 'unknown', checkedAt: null },
    },
    ...overrides,
  };
}

export function document(): MarkdownDocument {
  return {
    type: 'document',
    children: [
      { type: 'heading', depth: 1, children: [{ type: 'text', value: 'Synthetic note' }] },
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'See ' },
          { type: 'link', target: { kind: 'page', key: { namespace: 'bl', path: 'notes/other.md' } }, children: [{ type: 'text', value: 'other' }] },
          { type: 'text', value: ' and ' },
          { type: 'emphasis', strong: true, children: [{ type: 'text', value: 'bold' }] },
          { type: 'text', value: ' <script>alert(1)</script> ' },
          { type: 'inlineCode', value: '[not](a-link)' },
        ],
      },
      { type: 'list', ordered: true, start: 3, items: [{ type: 'listItem', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'one' }] }] }] },
      { type: 'quote', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'quoted' }] }] },
      { type: 'fence', lang: 'ts', text: 'const x = 1;\n' },
      {
        type: 'table',
        align: ['left', null],
        header: { type: 'tableRow', cells: [cell('a'), cell('b')] },
        rows: [{ type: 'tableRow', cells: [cell('1'), cell('2')] }],
      },
    ],
  };
}

function cell(text: string) {
  return { type: 'tableCell', children: [{ type: 'text', value: text }] } as const;
}

export function page(overrides: Partial<Page> = {}): Page {
  return {
    key: { namespace: 'bl', path: 'notes/synthetic.md' },
    title: 'Synthetic note',
    commit: COMMIT_A,
    byteLength: 120,
    fields: [
      { name: 'title', value: 'Synthetic note' },
      { name: 'tags', value: ['alpha', 'beta'] },
    ],
    outLinks: [
      { text: 'other', target: { kind: 'page', key: { namespace: 'bl', path: 'notes/other.md' } } },
      { text: 'nowhere', target: { kind: 'missing', label: 'Nowhere' } },
      { text: 'site', target: { kind: 'external', url: 'https://example.com/a?b=c#d' } },
    ],
    content: { state: 'parsed', ast: document() },
    ...overrides,
  };
}

/** Mutable deep clone for building invalid variants. */
export function clone<T>(value: T): any {
  return structuredClone(value);
}
