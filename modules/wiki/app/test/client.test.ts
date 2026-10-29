// The renderer client against a scripted port: request guards, the exact-seven-methods rule, response validation and
// failure mapping. The port here is a plain test double; the end-to-end suites use the real host behind a bridge.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { WIKI_SERVICE_METHODS, type WikiError, type WikiResult } from '../../contract/src/index.ts';
import { createWikiClient } from '../src/client.ts';
import type { WikiHostPort } from '../src/port.ts';

const COMMIT = 'a'.repeat(40);
const KEY = { namespace: 'bl', path: 'guides/onboarding.md' } as const;
const descriptor = (namespace: 'bl' | 'appdev') => ({
  schema: 'hq.wiki.source/v1',
  namespace,
  ref: 'main',
  commit: COMMIT,
  commitTime: '2026-01-02T03:04:05Z',
  indexedAt: '2026-01-03T04:05:06Z',
  freshness: { graph: { state: 'current', indexedCommit: COMMIT }, content: { state: 'unknown', checkedAt: null } },
});
const page = (key: { namespace: string; path: string } = KEY) => ({
  key,
  title: 'Synthetic',
  commit: COMMIT,
  byteLength: 10,
  fields: [],
  outLinks: [],
  content: { state: 'raw', reason: 'markdown-unsupported', text: 'x' },
});
const GOOD: Record<string, unknown> = {
  listSources: [descriptor('bl'), descriptor('appdev')],
  search: { query: 'x', hits: [], totalHits: 0, truncated: false },
  getPage: page(),
  resolveAlias: { status: 'missing' },
  getBacklinks: { target: KEY, entries: [], total: 0, truncated: false },
  listTopics: { namespace: 'bl', topics: [] },
  indexStatus: { namespaces: [{ namespace: 'bl', state: 'unavailable', pageCount: 0, source: null }] },
};
const REQUESTS: Record<string, unknown[]> = {
  listSources: [],
  search: [{ query: 'x' }],
  getPage: [{ key: KEY }],
  resolveAlias: [{ namespace: 'bl', alias: 'Getting Started' }],
  getBacklinks: [{ key: KEY }],
  listTopics: [{ namespace: 'bl' }],
  indexStatus: [],
};

type Responder = (method: string, args: unknown[]) => unknown;

/** A port whose every method answers through `respond` and records what it received. */
function scripted(respond: Responder): { port: WikiHostPort; calls: { method: string; args: unknown[] }[] } {
  const calls: { method: string; args: unknown[] }[] = [];
  const port = Object.fromEntries(
    WIKI_SERVICE_METHODS.map((method) => [
      method,
      (...args: unknown[]) => {
        calls.push({ method, args });
        return Promise.resolve(respond(method, args));
      },
    ]),
  ) as unknown as WikiHostPort;
  return { port, calls };
}

const okResult = (method: string, value: unknown = GOOD[method]) => ({ ok: true, value });
const call = (service: Record<string, unknown>, method: string, args: unknown[] = REQUESTS[method] ?? []): Promise<WikiResult<unknown>> =>
  (service[method] as (...a: unknown[]) => Promise<WikiResult<unknown>>)(...args);
const failure = (result: WikiResult<unknown>): WikiError => {
  assert.equal(result.ok, false, 'expected a failure');
  return (result as { ok: false; error: WikiError }).error;
};

describe('shape', () => {
  test('the client has exactly the seven contract methods and is frozen', () => {
    const client = createWikiClient(() => null);
    assert.deepEqual(Object.keys(client), [...WIKI_SERVICE_METHODS]);
    assert.ok(Object.isFrozen(client));
  });

  test('valid answers pass through for every method', async () => {
    const { port } = scripted((method) => okResult(method));
    const client = createWikiClient(() => port) as unknown as Record<string, unknown>;
    for (const method of WIKI_SERVICE_METHODS) {
      const result = await call(client, method);
      assert.deepEqual(result, { ok: true, value: GOOD[method] }, method);
    }
  });

  test('requests are sent as canonical plain copies with defaults filled', async () => {
    const { port, calls } = scripted((method) => okResult(method));
    const client = createWikiClient(() => port);
    await client.search({ query: 'x', namespaces: ['bl', 'bl'] });
    await client.getBacklinks({ key: KEY });
    await client.getPage({ key: KEY });
    assert.deepEqual(calls.map((c) => c.args), [
      [{ query: 'x', namespaces: ['bl'], limit: 50 }],
      [{ key: KEY, limit: 50 }],
      [{ key: KEY }],
    ]);
  });

  test('only the seven method names are ever read from the port; a host-only refresh is unreachable', async () => {
    const touched = new Set<string>();
    const { port } = scripted((method) => okResult(method));
    const spy = new Proxy({ ...port, refresh: () => assert.fail('refresh must never be called'), migrateHome: () => assert.fail('nor home migration') }, {
      get(target, property, receiver) {
        touched.add(String(property));
        return Reflect.get(target, property, receiver);
      },
    }) as unknown as WikiHostPort;
    const client = createWikiClient(() => spy) as unknown as Record<string, unknown>;
    for (const method of WIKI_SERVICE_METHODS) await call(client, method);
    assert.deepEqual([...touched].sort(), [...WIKI_SERVICE_METHODS].sort());
    assert.equal('refresh' in client, false);
  });

  test('the port is read on every call, so a bridge that appears later is used', async () => {
    let current: WikiHostPort | null = null;
    const client = createWikiClient(() => current);
    assert.equal(failure(await client.indexStatus()).reason, 'source-unavailable');
    current = scripted((method) => okResult(method)).port;
    assert.equal((await client.indexStatus()).ok, true);
  });
});

describe('request guards: nothing forbidden reaches the host', () => {
  const bad: [string, string, unknown][] = [
    ['search', 'path key', { query: 'x', path: '/etc/passwd' }],
    ['search', 'ref key', { query: 'x', ref: 'refs/heads/other' }],
    ['search', 'empty query', { query: '' }],
    ['search', 'over-long query', { query: 'x'.repeat(257) }],
    ['search', 'over-limit', { query: 'x', limit: 51 }],
    ['search', 'unknown namespace', { query: 'x', namespaces: ['private'] }],
    ['search', 'not an object', 'x'],
    ['getPage', 'traversal', { key: { namespace: 'bl', path: '../secret.md' } }],
    ['getPage', 'absolute', { key: { namespace: 'bl', path: '/etc/passwd' } }],
    ['getPage', 'scheme', { key: { namespace: 'bl', path: 'file:///etc/passwd' } }],
    ['getPage', 'root key', { key: KEY, root: '/x' }],
    ['getPage', 'url key', { key: KEY, url: 'https://example.invalid' }],
    ['resolveAlias', 'argv key', { namespace: 'bl', alias: 'a', argv: ['git'] }],
    ['resolveAlias', 'unknown namespace', { namespace: 'x', alias: 'a' }],
    ['getBacklinks', 'cwd key', { key: KEY, cwd: '/' }],
    ['getBacklinks', 'limit zero', { key: KEY, limit: 0 }],
    ['listTopics', 'shell key', { namespace: 'bl', shell: 'sh' }],
  ];
  for (const [method, name, request] of bad) {
    test(`${method}: ${name}`, async () => {
      const { port, calls } = scripted((m) => okResult(m));
      const result = await call(createWikiClient(() => port) as unknown as Record<string, unknown>, method, [request]);
      assert.equal(failure(result).code, 'invalid-input');
      assert.deepEqual(calls, [], 'the port was never called');
    });
  }

  test('forbidden capability keys get their own reason', async () => {
    const { port } = scripted((m) => okResult(m));
    const error = failure(await createWikiClient(() => port).getPage({ key: KEY, path: 'x' } as never));
    assert.equal(error.reason, 'forbidden-capability');
  });
});

describe('failure mapping', () => {
  test('no bridge: every method is unavailable and nothing throws', async () => {
    const client = createWikiClient(() => null) as unknown as Record<string, unknown>;
    for (const method of WIKI_SERVICE_METHODS) {
      const error = failure(await call(client, method));
      assert.deepEqual([error.code, error.reason], ['unavailable', 'source-unavailable'], method);
    }
  });

  test('a bridge missing a method, or holding a non-function, is unavailable', async () => {
    const partial = { indexStatus: undefined, listSources: 'nope' } as unknown as WikiHostPort;
    const client = createWikiClient(() => partial);
    assert.equal(failure(await client.indexStatus()).reason, 'source-unavailable');
    assert.equal(failure(await client.listSources()).reason, 'source-unavailable');
  });

  test('a rejected or throwing call is unavailable and its message is never repeated', async () => {
    const secret = 'EACCES: synthetic secret token';
    const rejecting = createWikiClient(() => scripted(() => { throw new Error(secret); }).port);
    const asyncRejecting = createWikiClient(() => ({ ...scripted((m) => okResult(m)).port, indexStatus: () => Promise.reject(new Error(secret)) }));
    for (const result of [await rejecting.indexStatus(), await asyncRejecting.indexStatus()]) {
      const error = failure(result);
      assert.equal(error.code, 'unavailable');
      assert.ok(!JSON.stringify(error).includes('secret'));
    }
  });

  test('a throwing port getter is an internal error, not an exception', async () => {
    const client = createWikiClient(() => { throw new Error('boom'); });
    const error = failure(await client.indexStatus());
    assert.deepEqual([error.code, error.reason], ['internal', 'internal']);
  });

  test('a host error passes through rebuilt from its known fields', async () => {
    const { port } = scripted(() => ({ ok: false, error: { code: 'not-found', reason: 'not-found', message: 'page not found' } }));
    assert.deepEqual(await createWikiClient(() => port).getPage({ key: KEY }), { ok: false, error: { code: 'not-found', reason: 'not-found', message: 'page not found' } });
    const withPath = scripted(() => ({ ok: false, error: { code: 'invalid-input', reason: 'out-of-range', message: 'm', path: '$.limit' } })).port;
    assert.deepEqual(failure(await createWikiClient(() => withPath).indexStatus()), { code: 'invalid-input', reason: 'out-of-range', message: 'm', path: '$.limit' });
  });
});

describe('response validation: anything off-contract becomes internal', () => {
  const malformed: [string, unknown, (method: string) => boolean][] = [
    ['undefined', undefined, () => true],
    ['a string', 'ok', () => true],
    ['an array', [], () => true],
    ['no ok flag', { value: 1 }, () => true],
    ['ok without value', { ok: true }, () => true],
    ['ok with an error too', { ok: true, value: null, error: {} }, () => true],
    ['an extra top-level key', { ok: true, value: GOOD['indexStatus'], leaked: 'extra' }, (m) => m === 'indexStatus'],
    ['an error with an unknown code', { ok: false, error: { code: 'teapot', reason: 'internal', message: 'm' } }, () => true],
    ['an incoherent code/reason pair', { ok: false, error: { code: 'not-found', reason: 'out-of-range', message: 'm' } }, () => true],
    ['an error with an extra field', { ok: false, error: { code: 'internal', reason: 'internal', message: 'm', stack: 's' } }, () => true],
    ['an over-long error message', { ok: false, error: { code: 'internal', reason: 'internal', message: 'm'.repeat(501) } }, () => true],
  ];
  for (const [name, response, applies] of malformed) {
    test(name, async () => {
      for (const method of WIKI_SERVICE_METHODS) {
        if (!applies(method)) continue;
        const { port } = scripted(() => response);
        const error = failure(await call(createWikiClient(() => port) as unknown as Record<string, unknown>, method));
        assert.deepEqual([error.code, error.reason], ['internal', 'internal'], method);
      }
    });
  }

  const wrongValue: [string, unknown][] = [
    ['listSources', 'not an array'],
    ['listSources', [{ ...descriptor('bl'), commit: 'not-a-commit' }]],
    ['listSources', [descriptor('bl'), descriptor('bl')]],
    ['search', { query: 'x', hits: [], totalHits: 3, truncated: false }],
    ['getPage', { ...page(), content: { state: 'parsed', ast: { type: 'html', value: '<b>' } } }],
    ['getPage', page({ namespace: 'bl', path: 'other.md' })],
    ['getPage', page({ namespace: 'appdev', path: KEY.path })],
    ['resolveAlias', { status: 'resolved', target: { namespace: 'appdev', path: 'x.md' } }],
    ['resolveAlias', { status: 'ambiguous', candidates: [{ namespace: 'bl', path: 'a.md' }] }],
    ['getBacklinks', { target: { namespace: 'bl', path: 'other.md' }, entries: [], total: 0, truncated: false }],
    ['listTopics', { namespace: 'appdev', topics: [] }],
    ['indexStatus', { namespaces: 'none' }],
  ];
  for (const [method, value] of wrongValue) {
    test(`${method}: ${JSON.stringify(value).slice(0, 60)}`, async () => {
      const { port } = scripted(() => ({ ok: true, value }));
      const error = failure(await call(createWikiClient(() => port) as unknown as Record<string, unknown>, method));
      assert.deepEqual([error.code, error.reason], ['internal', 'internal']);
    });
  }
});
