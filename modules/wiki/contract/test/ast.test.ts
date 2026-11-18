import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  BLOCK_NODE_TYPES,
  INLINE_NODE_TYPES,
  MAX_AST_DEPTH,
  validateExternalUrl,
  validateLinkTarget,
  validateMarkdownDocument,
} from '../src/index.ts';
import { clone, document } from './fixtures.ts';

function reason(result: { ok: boolean; error?: { reason: string } }): string | undefined {
  return result.ok ? undefined : result.error?.reason;
}

function withBlock(block: unknown): unknown {
  return { type: 'document', children: [block] };
}
function paragraph(...children: unknown[]) {
  return { type: 'paragraph', children };
}
const text = (value: string) => ({ type: 'text', value });

test('node vocabulary is the specified closed set', () => {
  assert.deepEqual([...BLOCK_NODE_TYPES], ['heading', 'paragraph', 'list', 'fence', 'quote', 'table']);
  assert.deepEqual([...INLINE_NODE_TYPES], ['text', 'emphasis', 'inlineCode', 'link']);
  assert.ok(![...BLOCK_NODE_TYPES, ...INLINE_NODE_TYPES].some((t) => /image|html/i.test(t)));
});

test('accepts a document using every node type', () => {
  const result = validateMarkdownDocument(document());
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(validateMarkdownDocument({ type: 'document', children: [] }).ok, true);
});

test('rejects image nodes anywhere, including inside inline content', () => {
  const image = { type: 'image', url: 'https://example.com/x.png', alt: 'x' };
  assert.equal(reason(validateMarkdownDocument(withBlock(image))), 'image-not-allowed');
  assert.equal(reason(validateMarkdownDocument(withBlock(paragraph(text('a'), image)))), 'image-not-allowed');
  assert.equal(reason(validateMarkdownDocument(withBlock(paragraph({ type: 'Image' })))), 'image-not-allowed');
  assert.equal(reason(validateMarkdownDocument(withBlock(paragraph({ type: 'imageReference' })))), 'image-not-allowed');
  const result = validateMarkdownDocument(withBlock(paragraph(text('a'), image)));
  assert.ok(!result.ok && result.error.path === '$.children[0].children[1].type');
});

test('rejects raw HTML as markup nodes, blocks and inlines', () => {
  assert.equal(reason(validateMarkdownDocument(withBlock({ type: 'html', value: '<div onclick="x()">' }))), 'html-not-allowed');
  assert.equal(reason(validateMarkdownDocument(withBlock(paragraph({ type: 'html', value: '<b>' })))), 'html-not-allowed');
  assert.equal(reason(validateMarkdownDocument(withBlock(paragraph({ type: 'rawHtml', value: '<b>' })))), 'html-not-allowed');
  assert.equal(reason(validateMarkdownDocument(withBlock({ type: 'script', value: 'alert(1)' }))), 'html-not-allowed');
  assert.equal(reason(validateMarkdownDocument(withBlock({ type: 'iframe' }))), 'html-not-allowed');
});

test('HTML-looking text is valid only as an inert text, inline-code or fence value', () => {
  const html = '<img src=x onerror=alert(1)><script>alert(1)</script>';
  assert.equal(validateMarkdownDocument(withBlock(paragraph(text(html)))).ok, true);
  assert.equal(validateMarkdownDocument(withBlock(paragraph({ type: 'inlineCode', value: html }))).ok, true);
  assert.equal(validateMarkdownDocument(withBlock({ type: 'fence', lang: 'html', text: html })).ok, true);
});

test('rejects smuggled properties and unknown node types', () => {
  assert.equal(reason(validateMarkdownDocument(withBlock(paragraph({ type: 'text', value: 'a', html: '<b>' })))), 'unknown-property');
  assert.equal(reason(validateMarkdownDocument(withBlock({ type: 'paragraph', children: [], onClick: 'x' }))), 'unknown-property');
  assert.equal(reason(validateMarkdownDocument(withBlock({ type: 'thematicBreak' }))), 'unknown-node-type');
  assert.equal(reason(validateMarkdownDocument(withBlock({ type: 7 }))), 'wrong-type');
  assert.equal(reason(validateMarkdownDocument({ type: 'paragraph', children: [] })), 'unknown-node-type');
  assert.equal(reason(validateMarkdownDocument(null)), 'wrong-type');
  assert.equal(reason(validateMarkdownDocument({ type: 'document', children: 'x' })), 'wrong-type');
  assert.equal(reason(validateMarkdownDocument({ type: 'document', children: [], extra: 1 })), 'unknown-property');
});

test('rejects nodes in the wrong position', () => {
  assert.equal(reason(validateMarkdownDocument(withBlock(text('loose')))), 'wrong-context');
  assert.equal(reason(validateMarkdownDocument(withBlock(paragraph(paragraph(text('x')))))), 'wrong-context');
  assert.equal(reason(validateMarkdownDocument(withBlock({ type: 'listItem', children: [] }))), 'wrong-context');
  assert.equal(reason(validateMarkdownDocument(withBlock(paragraph({ type: 'tableCell', children: [] })))), 'wrong-context');
});

test('links: page, ambiguous, missing and external targets validate', () => {
  const link = (target: unknown) => withBlock(paragraph({ type: 'link', target, children: [text('x')] }));
  assert.equal(validateMarkdownDocument(link({ kind: 'page', key: { namespace: 'appdev', path: 'a/b.md' } })).ok, true);
  assert.equal(
    validateMarkdownDocument(link({ kind: 'ambiguous', candidates: [{ namespace: 'bl', path: 'a.md' }, { namespace: 'appdev', path: 'a.md' }] })).ok,
    true,
  );
  assert.equal(validateMarkdownDocument(link({ kind: 'missing', label: 'Dangling' })).ok, true);
  assert.equal(validateMarkdownDocument(link({ kind: 'external', url: 'mailto:someone@example.com' })).ok, true);
});

test('links: unsafe schemes are rejected as link targets', () => {
  const link = (url: string) => validateMarkdownDocument(withBlock(paragraph({ type: 'link', target: { kind: 'external', url }, children: [text('x')] })));
  for (const url of [
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
    'blob:https://example.com/abc',
    'ftp://example.com/x',
    '//example.com/x',
    '/relative/path',
    'relative.md',
    '#fragment',
    'http://',
    'https:///nohost',
    'java\tscript:alert(1)',
    ' javascript:alert(1)',
    'https://exa mple.com',
    'https://example.com/"onmouseover="x',
    'https://example.com/<b>',
    'https://example.com\\evil',
  ]) {
    assert.equal(reason(link(url)), 'unsafe-url', url);
  }
  assert.equal(reason(link('x'.repeat(2049))), 'too-long');
  assert.equal(reason(validateMarkdownDocument(withBlock(paragraph({ type: 'link', target: { kind: 'external', url: 5 }, children: [] })))), 'wrong-type');
});

test('external URL validator accepts only absolute http, https and mailto', () => {
  for (const url of ['http://example.com', 'https://example.com/a/b?c=d#e', 'HTTPS://EXAMPLE.COM', 'mailto:a@example.com', 'https://user@example.com:8080/x']) {
    assert.equal(validateExternalUrl(url).ok, true, url);
  }
  for (const url of ['javascript:x', 'data:x', 'file:///x', '', 'https://']) {
    assert.equal(validateExternalUrl(url).ok, false, url);
  }
});

test('link targets reject raw paths, URLs outside the external kind, and malformed candidates', () => {
  assert.equal(reason(validateLinkTarget({ kind: 'page', key: { namespace: 'bl', path: '../x' } })), 'traversal');
  assert.equal(reason(validateLinkTarget({ kind: 'page', path: 'a.md' })), 'unknown-property');
  assert.equal(reason(validateLinkTarget({ kind: 'file', path: '/etc/passwd' })), 'invalid-format');
  assert.equal(reason(validateLinkTarget({ kind: 'ambiguous', candidates: [{ namespace: 'bl', path: 'a.md' }] })), 'out-of-range');
  assert.equal(
    reason(validateLinkTarget({ kind: 'ambiguous', candidates: [{ namespace: 'bl', path: 'a.md' }, { namespace: 'bl', path: 'a.md' }] })),
    'duplicate',
  );
  assert.equal(reason(validateLinkTarget({ kind: 'missing', label: '' })), 'empty');
  assert.equal(reason(validateLinkTarget({ kind: 'missing', label: 'a\u0000b' })), 'nul');
  assert.equal(reason(validateLinkTarget(null)), 'wrong-type');
});

test('links cannot nest', () => {
  const inner = { type: 'link', target: { kind: 'missing', label: 'b' }, children: [text('b')] };
  const outer = { type: 'link', target: { kind: 'missing', label: 'a' }, children: [inner] };
  assert.equal(reason(validateMarkdownDocument(withBlock(paragraph(outer)))), 'wrong-context');
  const viaEmphasis = { type: 'link', target: { kind: 'missing', label: 'a' }, children: [{ type: 'emphasis', strong: false, children: [inner] }] };
  assert.equal(reason(validateMarkdownDocument(withBlock(paragraph(viaEmphasis)))), 'wrong-context');
});

test('headings, lists, fences and text are range-checked', () => {
  const heading = (depth: unknown) => withBlock({ type: 'heading', depth, children: [text('h')] });
  assert.equal(validateMarkdownDocument(heading(1)).ok, true);
  assert.equal(validateMarkdownDocument(heading(6)).ok, true);
  assert.equal(reason(validateMarkdownDocument(heading(0))), 'out-of-range');
  assert.equal(reason(validateMarkdownDocument(heading(7))), 'out-of-range');
  assert.equal(reason(validateMarkdownDocument(heading('2'))), 'wrong-type');

  const item = { type: 'listItem', children: [paragraph(text('x'))] };
  assert.equal(validateMarkdownDocument(withBlock({ type: 'list', ordered: false, items: [item] })).ok, true);
  assert.equal(reason(validateMarkdownDocument(withBlock({ type: 'list', ordered: false, start: 1, items: [item] }))), 'inconsistent');
  assert.equal(reason(validateMarkdownDocument(withBlock({ type: 'list', ordered: true, start: -1, items: [item] }))), 'out-of-range');
  assert.equal(reason(validateMarkdownDocument(withBlock({ type: 'list', ordered: true, items: [] }))), 'empty');
  assert.equal(reason(validateMarkdownDocument(withBlock({ type: 'list', ordered: true, items: [paragraph(text('bare'))] }))), 'wrong-context');

  assert.equal(validateMarkdownDocument(withBlock({ type: 'fence', lang: null, text: '' })).ok, true);
  assert.equal(reason(validateMarkdownDocument(withBlock({ type: 'fence', lang: 'a b', text: '' }))), 'invalid-format');
  assert.equal(reason(validateMarkdownDocument(withBlock({ type: 'fence', lang: null, text: 'a\u0000' }))), 'nul');
  assert.equal(reason(validateMarkdownDocument(withBlock(paragraph(text('a\u0000'))))), 'nul');
  assert.equal(reason(validateMarkdownDocument(withBlock({ type: 'fence', lang: null }))), 'missing-property');
});

test('tables must be rectangular with valid alignment', () => {
  const row = (...cells: string[]) => ({ type: 'tableRow', cells: cells.map((c) => ({ type: 'tableCell', children: [text(c)] })) });
  const table = (align: unknown[], header: unknown, rows: unknown[]) => withBlock({ type: 'table', align, header, rows });
  assert.equal(validateMarkdownDocument(table(['left', 'center', 'right', null], row('a', 'b', 'c', 'd'), [row('1', '2', '3', '4')])).ok, true);
  assert.equal(reason(validateMarkdownDocument(table(['left', null], row('a', 'b'), [row('1')]))), 'inconsistent');
  assert.equal(reason(validateMarkdownDocument(table(['left'], row('a', 'b'), []))), 'inconsistent');
  assert.equal(reason(validateMarkdownDocument(table(['justify'], row('a'), []))), 'invalid-format');
  assert.equal(reason(validateMarkdownDocument(table([], row(), []))), 'out-of-range');
  assert.equal(reason(validateMarkdownDocument(table(['left'], { type: 'tableCell', children: [] }, []))), 'wrong-context');
  const cellWithImage = { type: 'tableRow', cells: [{ type: 'tableCell', children: [{ type: 'image' }] }] };
  assert.equal(reason(validateMarkdownDocument(table([null], cellWithImage, []))), 'image-not-allowed');
});

test('nesting depth is bounded', () => {
  let node: unknown = paragraph(text('leaf'));
  for (let i = 0; i < MAX_AST_DEPTH; i++) node = { type: 'quote', children: [node] };
  assert.equal(reason(validateMarkdownDocument({ type: 'document', children: [node] })), 'too-deep');
  let shallow: unknown = paragraph(text('leaf'));
  for (let i = 0; i < 10; i++) shallow = { type: 'quote', children: [shallow] };
  assert.equal(validateMarkdownDocument({ type: 'document', children: [shallow] }).ok, true);
});

test('node count is bounded', () => {
  const many = Array.from({ length: 100_001 }, () => paragraph(text('x')));
  assert.equal(reason(validateMarkdownDocument({ type: 'document', children: many })), 'too-many-nodes');
  const fine = Array.from({ length: 1000 }, () => paragraph(text('x')));
  assert.equal(validateMarkdownDocument({ type: 'document', children: fine }).ok, true);
});

test('validation does not mutate its input', () => {
  const doc = document();
  const before = JSON.stringify(doc);
  validateMarkdownDocument(doc);
  assert.equal(JSON.stringify(doc), before);
  assert.deepEqual(clone(doc), doc);
});
