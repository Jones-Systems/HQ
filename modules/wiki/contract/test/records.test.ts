import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_PAGE_BLOB_BYTES,
  validateAliasResolution,
  validateBacklinkResult,
  validateIndexStatus,
  validatePage,
  validateSearchResult,
  validateTopicList,
} from '../src/index.ts';
import { clone, descriptor, page } from './fixtures.ts';

function reason(result: { ok: boolean; error?: { reason: string } }): string | undefined {
  return result.ok ? undefined : result.error?.reason;
}
const bl = (path: string) => ({ namespace: 'bl', path });
const dev = (path: string) => ({ namespace: 'appdev', path });

test('page: parsed and raw states validate', () => {
  assert.equal(validatePage(page()).ok, true);
  const raw = page({ fields: [], outLinks: [], content: { state: 'raw', reason: 'frontmatter-unsupported', text: '---\nbroken: [\n---\nBody' } });
  assert.equal(validatePage(raw).ok, true);
});

test('page: rejects a parsed page whose AST contains an image or HTML node', () => {
  const p = clone(page());
  p.content.ast.children.push({ type: 'paragraph', children: [{ type: 'image' }] });
  assert.equal(reason(validatePage(p)), 'image-not-allowed');
  const h = clone(page());
  h.content.ast.children.push({ type: 'html', value: '<b>' });
  assert.equal(reason(validatePage(h)), 'html-not-allowed');
});

test('page: blob size boundary at 2 MiB, for byteLength and raw text', () => {
  assert.equal(validatePage(page({ byteLength: MAX_PAGE_BLOB_BYTES })).ok, true);
  assert.equal(reason(validatePage(page({ byteLength: MAX_PAGE_BLOB_BYTES + 1 }))), 'too-large');
  const rawAt = page({ byteLength: MAX_PAGE_BLOB_BYTES, fields: [], outLinks: [], content: { state: 'raw', reason: 'not-text', text: 'a'.repeat(MAX_PAGE_BLOB_BYTES) } });
  assert.equal(validatePage(rawAt).ok, true);
  const rawOver = page({ byteLength: MAX_PAGE_BLOB_BYTES, fields: [], outLinks: [], content: { state: 'raw', reason: 'not-text', text: 'é'.repeat(MAX_PAGE_BLOB_BYTES / 2 + 1) } });
  assert.equal(reason(validatePage(rawOver)), 'too-large');
});

test('page: rejects bad head fields', () => {
  assert.equal(reason(validatePage(page({ key: { namespace: 'bl', path: '../x' } }))), 'traversal');
  assert.equal(reason(validatePage(page({ title: '' }))), 'empty');
  assert.equal(reason(validatePage(page({ commit: 'nothex' }))), 'invalid-format');
  assert.equal(reason(validatePage({ ...page(), extra: 1 })), 'unknown-property');
  assert.equal(reason(validatePage(null)), 'wrong-type');
});

test('page: fields are unique, plain-named and bounded', () => {
  assert.equal(reason(validatePage(page({ fields: [{ name: 'a', value: 'x' }, { name: 'a', value: 'y' }] }))), 'duplicate');
  assert.equal(reason(validatePage(page({ fields: [{ name: '__proto__', value: 'x' }] }))), 'invalid-format');
  assert.equal(reason(validatePage(page({ fields: [{ name: 'has space', value: 'x' }] }))), 'invalid-format');
  assert.equal(reason(validatePage(page({ fields: [{ name: 'a', value: { nested: true } as never }] }))), 'wrong-type');
  assert.equal(reason(validatePage(page({ fields: [{ name: 'a', value: [['x']] as never }] }))), 'wrong-type');
  assert.equal(reason(validatePage(page({ fields: [{ name: 'a', value: 'x'.repeat(2049) }] }))), 'too-long');
  assert.equal(validatePage(page({ fields: [{ name: 'a', value: 'x'.repeat(2048) }] })).ok, true);
  assert.equal(reason(validatePage(page({ fields: [{ name: 'a', value: Array.from({ length: 65 }, () => 'x') }] }))), 'out-of-range');
  assert.equal(validatePage(page({ fields: [{ name: 'a', value: Array.from({ length: 64 }, () => 'x') }] })).ok, true);
  assert.equal(reason(validatePage(page({ fields: Array.from({ length: 65 }, (_, i) => ({ name: `f${i}`, value: 'x' })) }))), 'out-of-range');
  assert.equal(reason(validatePage(page({ fields: [{ name: 'n', value: Number.NaN }] }))), 'out-of-range');
});

test('page: out-links keep dangling, ambiguous and external targets and reject unsafe ones', () => {
  const ambiguous = { text: 'dup', target: { kind: 'ambiguous', candidates: [bl('a.md'), bl('b/a.md')] } } as const;
  assert.equal(validatePage(page({ outLinks: [ambiguous as never] })).ok, true);
  assert.equal(
    reason(validatePage(page({ outLinks: [{ text: 'x', target: { kind: 'external', url: 'javascript:alert(1)' } }] }))),
    'unsafe-url',
  );
  assert.equal(reason(validatePage(page({ outLinks: Array.from({ length: 1001 }, () => ({ text: 'x', target: { kind: 'missing', label: 'x' } })) as never }))), 'out-of-range');
});

test('alias resolution: resolved, ambiguous (single namespace) and missing', () => {
  assert.equal(validateAliasResolution({ status: 'resolved', target: bl('a.md') }).ok, true);
  assert.equal(validateAliasResolution({ status: 'missing' }).ok, true);
  assert.equal(validateAliasResolution({ status: 'ambiguous', candidates: [bl('a.md'), bl('b.md')] }).ok, true);
  assert.equal(reason(validateAliasResolution({ status: 'ambiguous', candidates: [bl('a.md'), dev('a.md')] })), 'inconsistent');
  assert.equal(reason(validateAliasResolution({ status: 'ambiguous', candidates: [bl('a.md')] })), 'out-of-range');
  assert.equal(reason(validateAliasResolution({ status: 'missing', target: bl('a.md') })), 'unknown-property');
  assert.equal(reason(validateAliasResolution({ status: 'guess' })), 'invalid-format');
});

test('search result: same-title hits in two namespaces stay distinct', () => {
  const hit = (key: unknown) => ({ key, title: 'Pricing', score: 1.5, snippet: 'about pricing' });
  const result = { query: 'pricing', hits: [hit(bl('Pricing.md')), hit(dev('Pricing.md'))], totalHits: 2, truncated: false };
  assert.equal(validateSearchResult(result).ok, true);
  assert.equal(reason(validateSearchResult({ ...result, hits: [hit(bl('Pricing.md')), hit(bl('Pricing.md'))] })), 'duplicate');
});

test('search result: 50 hits accepted, 51 rejected; truncation flag must agree', () => {
  const hits = (n: number) => Array.from({ length: n }, (_, i) => ({ key: bl(`n${i}.md`), title: `N${i}`, score: 1, snippet: '' }));
  assert.equal(validateSearchResult({ query: 'q', hits: hits(50), totalHits: 50, truncated: false }).ok, true);
  assert.equal(validateSearchResult({ query: 'q', hits: hits(50), totalHits: 80, truncated: true }).ok, true);
  assert.equal(reason(validateSearchResult({ query: 'q', hits: hits(51), totalHits: 51, truncated: false })), 'too-large');
  assert.equal(reason(validateSearchResult({ query: 'q', hits: hits(50), totalHits: 80, truncated: false })), 'inconsistent');
  assert.equal(reason(validateSearchResult({ query: 'q', hits: hits(50), totalHits: 50, truncated: true })), 'inconsistent');
  assert.equal(reason(validateSearchResult({ query: 'q', hits: hits(2), totalHits: 1, truncated: false })), 'out-of-range');
  assert.equal(reason(validateSearchResult({ query: 'x'.repeat(257), hits: [], totalHits: 0, truncated: false })), 'too-long');
  assert.equal(reason(validateSearchResult({ query: 'q', hits: [{ key: bl('a.md'), title: 'A', score: -1, snippet: '' }], totalHits: 1, truncated: false })), 'out-of-range');
  assert.equal(reason(validateSearchResult({ query: 'q', hits: [{ key: bl('a.md'), title: 'A', score: Number.NaN, snippet: '' }], totalHits: 1, truncated: false })), 'out-of-range');
  assert.equal(reason(validateSearchResult({ query: 'q', hits: [{ key: bl('a.md'), title: 'A', score: 1, snippet: 'x'.repeat(513) }], totalHits: 1, truncated: false })), 'too-long');
});

test('backlinks: bounded, de-duplicated and consistent', () => {
  const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ source: bl(`s${i}.md`), title: `S${i}` }));
  assert.equal(validateBacklinkResult({ target: bl('t.md'), entries: entries(50), total: 50, truncated: false }).ok, true);
  assert.equal(validateBacklinkResult({ target: bl('t.md'), entries: entries(50), total: 120, truncated: true }).ok, true);
  assert.equal(reason(validateBacklinkResult({ target: bl('t.md'), entries: entries(51), total: 51, truncated: false })), 'too-large');
  assert.equal(reason(validateBacklinkResult({ target: bl('t.md'), entries: entries(2), total: 1, truncated: false })), 'out-of-range');
  assert.equal(reason(validateBacklinkResult({ target: bl('t.md'), entries: entries(2), total: 9, truncated: false })), 'inconsistent');
  assert.equal(
    reason(validateBacklinkResult({ target: bl('t.md'), entries: [entries(1)[0], entries(1)[0]], total: 2, truncated: false })),
    'duplicate',
  );
  assert.equal(reason(validateBacklinkResult({ target: { namespace: 'bl', path: '/abs' }, entries: [], total: 0, truncated: false })), 'absolute-path');
});

test('topics: namespaced, hierarchical and bounded', () => {
  const topic = (id: string, parentId: string | null, pages: unknown[] = [], pageCount = pages.length) => ({ id, label: id.toUpperCase(), parentId, pageCount, pages });
  const list = { namespace: 'bl', topics: [topic('root', null, [bl('a.md')], 3), topic('child', 'root')] };
  assert.equal(validateTopicList(list).ok, true);
  assert.equal(reason(validateTopicList({ namespace: 'bl', topics: [topic('t', null, [dev('a.md')])] })), 'inconsistent');
  assert.equal(reason(validateTopicList({ namespace: 'bl', topics: [topic('t', 'missing')] })), 'inconsistent');
  assert.equal(reason(validateTopicList({ namespace: 'bl', topics: [topic('t', 't')] })), 'inconsistent');
  assert.equal(reason(validateTopicList({ namespace: 'bl', topics: [topic('t', null), topic('t', null)] })), 'duplicate');
  assert.equal(reason(validateTopicList({ namespace: 'bl', topics: [topic('a/b', null)] })), 'invalid-format');
  assert.equal(reason(validateTopicList({ namespace: 'bl', topics: [topic('t', null, [bl('a.md')], 0)] })), 'inconsistent');
  assert.equal(reason(validateTopicList({ namespace: 'zz', topics: [] })), 'unknown-namespace');
  const fifty = Array.from({ length: 50 }, (_, i) => bl(`p${i}.md`));
  assert.equal(validateTopicList({ namespace: 'bl', topics: [topic('t', null, fifty)] }).ok, true);
  assert.equal(reason(validateTopicList({ namespace: 'bl', topics: [topic('t', null, [...fifty, bl('p50.md')])] })), 'out-of-range');
  const many = Array.from({ length: 501 }, (_, i) => topic(`t${i}`, null));
  assert.equal(reason(validateTopicList({ namespace: 'bl', topics: many })), 'too-large');
});

test('index status: one entry per namespace, descriptor present unless unavailable', () => {
  const ready = { namespace: 'bl', state: 'ready', pageCount: 10, source: descriptor() };
  const down = { namespace: 'appdev', state: 'unavailable', pageCount: 0, source: null };
  assert.equal(validateIndexStatus({ namespaces: [ready, down] }).ok, true);
  assert.equal(validateIndexStatus({ namespaces: [] }).ok, true);
  assert.equal(reason(validateIndexStatus({ namespaces: [ready, ready] })), 'duplicate');
  assert.equal(reason(validateIndexStatus({ namespaces: [{ ...ready, namespace: 'appdev' }] })), 'inconsistent');
  assert.equal(reason(validateIndexStatus({ namespaces: [{ ...down, source: descriptor() }] })), 'inconsistent');
  assert.equal(reason(validateIndexStatus({ namespaces: [{ ...ready, source: null }] })), 'wrong-type');
  assert.equal(reason(validateIndexStatus({ namespaces: [{ ...ready, state: 'fresh' }] })), 'invalid-format');
});
