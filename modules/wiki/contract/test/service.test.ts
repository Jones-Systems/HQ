import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FORBIDDEN_REQUEST_KEYS,
  MAX_RESULTS,
  NAMESPACES,
  WIKI_SERVICE_METHODS,
  validateGetBacklinksRequest,
  validateGetPageRequest,
  validateListTopicsRequest,
  validateResolveAliasRequest,
  validateSearchRequest,
  type GetBacklinksRequest,
  type GetPageRequest,
  type ListTopicsRequest,
  type ResolveAliasRequest,
  type SearchRequest,
  type WikiService,
  type WikiServiceMethodName,
} from '../src/index.ts';

function reason(result: { ok: boolean; error?: { reason: string } }): string | undefined {
  return result.ok ? undefined : result.error?.reason;
}

// ---- type-level checks (verified by `tsc`; the runtime asserts below keep them referenced) ----
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

const methodSetIsExact: Equal<keyof WikiService, WikiServiceMethodName> = true;
const methodNamesAreTheSeven: Equal<
  WikiServiceMethodName,
  'listSources' | 'search' | 'getPage' | 'resolveAlias' | 'getBacklinks' | 'listTopics' | 'indexStatus'
> = true;
const searchRequestKeys: Equal<keyof SearchRequest, 'query' | 'namespaces' | 'limit'> = true;
const getPageRequestKeys: Equal<keyof GetPageRequest, 'key'> = true;
const aliasRequestKeys: Equal<keyof ResolveAliasRequest, 'namespace' | 'alias'> = true;
const backlinksRequestKeys: Equal<keyof GetBacklinksRequest, 'key' | 'limit'> = true;
const topicsRequestKeys: Equal<keyof ListTopicsRequest, 'namespace'> = true;
const noArgListSources: Equal<Parameters<WikiService['listSources']>, []> = true;
const noArgIndexStatus: Equal<Parameters<WikiService['indexStatus']>, []> = true;

const conforming: WikiService = {
  listSources: async () => ({ ok: true, value: [] }),
  search: async () => ({ ok: false, error: { code: 'unavailable', reason: 'index-unavailable', message: 'x' } }),
  getPage: async () => ({ ok: false, error: { code: 'not-found', reason: 'not-found', message: 'x' } }),
  resolveAlias: async () => ({ ok: true, value: { status: 'missing' } }),
  getBacklinks: async () => ({ ok: false, error: { code: 'internal', reason: 'internal', message: 'x' } }),
  listTopics: async () => ({ ok: true, value: { namespace: 'bl', topics: [] } }),
  indexStatus: async () => ({ ok: true, value: { namespaces: [] } }),
};

// @ts-expect-error an extra method is not part of the closed interface
const withExtra: WikiService = { ...conforming, readFile: async () => ({ ok: true, value: '' }) };
// @ts-expect-error a missing method is not a WikiService
const withMissing: WikiService = { listSources: conforming.listSources };
// @ts-expect-error a request cannot carry a filesystem path
const pathRequest: SearchRequest = { query: 'q', path: '/etc' };
// @ts-expect-error a request cannot carry a ref
const refRequest: GetPageRequest = { key: { namespace: 'bl', path: 'a.md' }, ref: 'main' };
// @ts-expect-error namespaces are a closed union
const badNamespace: ListTopicsRequest = { namespace: 'other' };

test('WikiService has exactly seven methods (type-level and runtime)', () => {
  assert.equal(methodSetIsExact && methodNamesAreTheSeven, true);
  assert.deepEqual([...WIKI_SERVICE_METHODS], ['listSources', 'search', 'getPage', 'resolveAlias', 'getBacklinks', 'listTopics', 'indexStatus']);
  assert.equal(new Set(WIKI_SERVICE_METHODS).size, 7);
  // A conforming implementation exposes the same runtime key set, in any order.
  assert.deepEqual(Object.keys(conforming).sort(), [...WIKI_SERVICE_METHODS].sort());
});

test('request types carry only logical keys and queries (type-level)', () => {
  assert.equal(
    searchRequestKeys && getPageRequestKeys && aliasRequestKeys && backlinksRequestKeys && topicsRequestKeys && noArgListSources && noArgIndexStatus,
    true,
  );
  // The negative cases above are checked by tsc via @ts-expect-error; touch the bindings so they are not unused.
  assert.ok([withExtra, withMissing, pathRequest, refRequest, badNamespace].every((value) => typeof value === 'object'));
});

test('a conforming service answers through WikiResult', async () => {
  const search = await conforming.search({ query: 'q' });
  assert.equal(search.ok, false);
  const topics = await conforming.listTopics({ namespace: 'bl' });
  assert.deepEqual(topics, { ok: true, value: { namespace: 'bl', topics: [] } });
});

test('search request: defaults, de-duplication and boundaries', () => {
  const minimal = validateSearchRequest({ query: 'pricing' });
  assert.ok(minimal.ok);
  assert.deepEqual(minimal.value, { query: 'pricing', namespaces: [...NAMESPACES], limit: MAX_RESULTS });
  const filtered = validateSearchRequest({ query: 'q', namespaces: ['appdev', 'appdev'], limit: 7 });
  assert.ok(filtered.ok);
  assert.deepEqual(filtered.value, { query: 'q', namespaces: ['appdev'], limit: 7 });

  assert.equal(validateSearchRequest({ query: 'x'.repeat(256), limit: 50 }).ok, true);
  assert.equal(reason(validateSearchRequest({ query: 'x'.repeat(257) })), 'too-long');
  assert.equal(reason(validateSearchRequest({ query: 'q', limit: 51 })), 'out-of-range');
  assert.equal(reason(validateSearchRequest({ query: 'q', limit: 0 })), 'out-of-range');
  assert.equal(validateSearchRequest({ query: 'q', limit: 1 }).ok, true);
  assert.equal(reason(validateSearchRequest({ query: '' })), 'empty');
  assert.equal(reason(validateSearchRequest({})), 'missing-property');
  assert.equal(reason(validateSearchRequest({ query: 'q', namespaces: [] })), 'empty');
  assert.equal(reason(validateSearchRequest({ query: 'q', namespaces: ['zz'] })), 'unknown-namespace');
  assert.equal(reason(validateSearchRequest({ query: 'q', namespaces: 'bl' })), 'wrong-type');
  assert.equal(reason(validateSearchRequest('q')), 'wrong-type');
  assert.equal(reason(validateSearchRequest(null)), 'wrong-type');
  assert.equal(reason(validateSearchRequest(['q'])), 'wrong-type');
  assert.equal(reason(validateSearchRequest({ query: 'q', limit: '5' })), 'wrong-type');
});

test('requests reject every root/ref/URL/path/argv capability by name', () => {
  for (const key of ['root', 'ref', 'url', 'path', 'argv', 'cwd', 'gitDir', 'remote', 'repo', 'file', 'command', 'Path', 'URL', 'ARGV']) {
    assert.equal(reason(validateSearchRequest({ query: 'q', [key]: 'x' })), 'forbidden-capability', key);
    assert.equal(reason(validateGetPageRequest({ key: { namespace: 'bl', path: 'a.md' }, [key]: 'x' })), 'forbidden-capability', key);
    assert.equal(reason(validateListTopicsRequest({ namespace: 'bl', [key]: 'x' })), 'forbidden-capability', key);
  }
  assert.equal(reason(validateSearchRequest({ query: 'q', argv: ['git', 'log'] })), 'forbidden-capability');
  assert.equal(reason(validateSearchRequest({ query: 'q', surprise: 1 })), 'unknown-property');
  assert.ok(FORBIDDEN_REQUEST_KEYS.length > 0 && FORBIDDEN_REQUEST_KEYS.every((key) => key === key.toLowerCase()));
});

test('getPage request: logical keys only', () => {
  assert.equal(validateGetPageRequest({ key: { namespace: 'bl', path: 'a/b.md' } }).ok, true);
  assert.equal(reason(validateGetPageRequest({ key: { namespace: 'bl', path: '../a' } })), 'traversal');
  assert.equal(reason(validateGetPageRequest({ key: { namespace: 'bl', path: '/etc/passwd' } })), 'absolute-path');
  assert.equal(reason(validateGetPageRequest({ key: { namespace: 'bl', path: 'a\u0000' } })), 'nul');
  assert.equal(reason(validateGetPageRequest({ key: { namespace: 'bl', path: 'file:///etc/passwd' } })), 'scheme');
  assert.equal(reason(validateGetPageRequest({ key: 'bl/a.md' })), 'wrong-type');
  assert.equal(reason(validateGetPageRequest({})), 'missing-property');
  assert.equal(reason(validateGetPageRequest({ path: 'a.md' })), 'forbidden-capability');
});

test('resolveAlias request: namespace-scoped, bounded alias text', () => {
  assert.equal(validateResolveAliasRequest({ namespace: 'bl', alias: 'Pricing' }).ok, true);
  assert.equal(validateResolveAliasRequest({ namespace: 'appdev', alias: 'a'.repeat(256) }).ok, true);
  assert.equal(reason(validateResolveAliasRequest({ namespace: 'appdev', alias: 'a'.repeat(257) })), 'too-long');
  assert.equal(reason(validateResolveAliasRequest({ namespace: 'bl', alias: '' })), 'empty');
  assert.equal(reason(validateResolveAliasRequest({ namespace: 'bl', alias: 'a\u0000' })), 'nul');
  assert.equal(reason(validateResolveAliasRequest({ alias: 'x' })), 'missing-property');
  assert.equal(reason(validateResolveAliasRequest({ namespace: 'zz', alias: 'x' })), 'unknown-namespace');
});

test('getBacklinks request: limit defaults to 50 and is bounded', () => {
  const key = { namespace: 'bl', path: 'a.md' };
  const defaulted = validateGetBacklinksRequest({ key });
  assert.ok(defaulted.ok);
  assert.equal(defaulted.value.limit, 50);
  assert.equal(validateGetBacklinksRequest({ key, limit: 50 }).ok, true);
  assert.equal(reason(validateGetBacklinksRequest({ key, limit: 51 })), 'out-of-range');
  assert.equal(reason(validateGetBacklinksRequest({ key: { namespace: 'bl', path: '..' } })), 'traversal');
  assert.equal(reason(validateGetBacklinksRequest({ key, root: '/' })), 'forbidden-capability');
});

test('listTopics request', () => {
  assert.equal(validateListTopicsRequest({ namespace: 'bl' }).ok, true);
  assert.equal(reason(validateListTopicsRequest({ namespace: 'x' })), 'unknown-namespace');
  assert.equal(reason(validateListTopicsRequest({})), 'missing-property');
  assert.equal(reason(validateListTopicsRequest(undefined)), 'wrong-type');
});
