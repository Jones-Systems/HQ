// The Wiki reference provider: find mapping and limits, resolve statuses, the content revision token, the id/title/
// destination caps (pinned to the real `parseReference` and `isDestination`), freshness, and the read-only surface
// (only `search` and `getPage` are ever called). A real-corpus section runs the provider over the committed synthetic
// repositories through the renderer client; a scripted section covers the cases a corpus cannot produce.
// Synthetic content only; no private corpus is read.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { isDestination, parseReference } from '../../../../packages/contracts/src/index.ts';
import {
  failWith,
  ok,
  parseDestination,
  pageKeyId,
  serviceError,
  type GetPageRequest,
  type Page,
  type PageKey,
  type SearchRequest,
  type SearchResult,
  type WikiResult,
  type WikiService,
} from '../../contract/src/index.ts';
import { createWikiClient } from '../src/client.ts';
import { createWikiReferenceProvider, WIKI_REVISION_PREFIX, type WikiReferenceEnvelope } from '../src/references.ts';
import { advanceMain } from './corpus.ts';
import { assemble, type Assembly } from './harness.ts';

const PROJECT = 'hq-local';
const NOW = new Date('2026-11-03T12:00:00.000Z');
const clock = (): Date => NOW;
const REVISION = new RegExp(`^${WIKI_REVISION_PREFIX}[0-9a-f]{64}$`);
const COMMIT = 'a'.repeat(40);

function must<T>(result: WikiResult<T>): T {
  if (!result.ok) assert.fail(`expected ok, got ${result.error.code}/${result.error.reason}: ${result.error.message}`);
  return result.value;
}

const key = (path: string, namespace: 'bl' | 'appdev' = 'bl'): PageKey => ({ namespace, path });
const page = (k: PageKey, over: Partial<Page> = {}): Page => ({
  key: k,
  title: 'Stub page',
  commit: COMMIT,
  byteLength: 10,
  fields: [],
  outLinks: [],
  content: { state: 'raw', reason: 'markdown-unsupported', text: 'body' },
  ...over,
});
const searchResult = (query: string, keys: readonly PageKey[]): WikiResult<SearchResult> =>
  ok({ query, hits: keys.map((k) => ({ key: k, title: 'Hit', score: 1, snippet: 'snippet' })), totalHits: keys.length, truncated: false });

interface Script {
  search?: (request: SearchRequest) => WikiResult<SearchResult> | Promise<WikiResult<SearchResult>>;
  getPage?: (request: GetPageRequest) => WikiResult<Page> | Promise<WikiResult<Page>>;
}

/** A service whose only readable members are `search` and `getPage`; reading anything else fails the test. */
function scripted(script: Script): { service: WikiService; touched: Set<string>; searches: SearchRequest[]; reads: GetPageRequest[] } {
  const touched = new Set<string>();
  const searches: SearchRequest[] = [];
  const reads: GetPageRequest[] = [];
  const service = new Proxy({} as WikiService, {
    get(_target, property) {
      touched.add(String(property));
      if (property === 'search') {
        return async (request: SearchRequest) => {
          searches.push(request);
          return script.search ? script.search(request) : searchResult(request.query, []);
        };
      }
      if (property === 'getPage') {
        return async (request: GetPageRequest) => {
          reads.push(request);
          return script.getPage ? script.getPage(request) : failWith(serviceError('not-found', 'not-found', 'no such page'));
        };
      }
      return assert.fail(`the provider read "${String(property)}"; only search and getPage are allowed`);
    },
  });
  return { service, touched, searches, reads };
}

const scope = (over: Partial<{ projectId: string; kinds: readonly string[]; limit: number }> = {}) => ({ projectId: PROJECT, limit: 30, ...over });
const envelopeOf = (entityId: string, over: Record<string, unknown> = {}) => ({ domain: 'wiki', kind: 'page', entityId, ...over });
const hasLoneSurrogate = (value: string): boolean => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);

function assertParses(found: readonly WikiReferenceEnvelope[]): void {
  for (const envelope of found) assert.deepEqual(parseReference(envelope), envelope, `parseReference accepts ${envelope.entityId}`);
}

describe('against the synthetic corpus (real core, committed Git, renderer client)', () => {
  let a: Assembly;
  before(async () => {
    a = await assemble('references');
  });
  after(() => a?.cleanup());

  test('find returns valid page envelopes from both namespaces that resolve as available', async () => {
    const provider = createWikiReferenceProvider(a.client, clock);
    const found = await provider.find('quokkaharbor', scope());
    assert.deepEqual(found.map((e) => e.entityId).sort(), ['appdev/architecture/overview.md', 'bl/policies/retry-policy.md']);
    assertParses(found);
    for (const envelope of found) {
      assert.equal(envelope.version, 1);
      assert.equal(envelope.domain, 'wiki');
      assert.equal(envelope.kind, 'page');
      assert.equal(envelope.projectId, PROJECT);
      assert.equal(envelope.returnDestination.domain, 'wiki');
      assert.match(envelope.sourceRevision, REVISION);
      const destination = must(parseDestination(envelope.returnDestination.destination));
      assert.ok(destination.kind === 'page' && pageKeyId(destination.key) === envelope.entityId);
      const resolved = await provider.resolve(envelope);
      assert.equal(resolved.status, 'available');
      assert.equal(resolved.latestRevision, envelope.sourceRevision);
      assert.equal(resolved.latestTitle, envelope.title);
      assert.equal(resolved.destination, envelope.returnDestination.destination);
      assert.equal(resolved.observedAt, NOW.toISOString());
      assert.ok(!('targetProjectId' in resolved));
    }
    assert.deepEqual(found.map((e) => e.title).sort(), ['Architecture Overview', 'Retry Policy']);
  });

  test('a page whose path has spaces, non-ASCII letters and an ampersand round-trips through its destination', async () => {
    const provider = createWikiReferenceProvider(a.client, clock);
    const found = await provider.find('Spaced Unicode Page', scope());
    const envelope = found.find((e) => e.entityId === 'bl/notes/Ünï café & spaces.md');
    assert.ok(envelope, 'the unicode page is found');
    const destination = must(parseDestination(envelope.returnDestination.destination));
    assert.deepEqual(destination, { kind: 'page', key: { namespace: 'bl', path: 'notes/Ünï café & spaces.md' } });
    assert.ok(isDestination(envelope.returnDestination.destination));
    const resolved = await provider.resolve(envelope);
    assert.equal(resolved.status, 'available');
    assert.equal(resolved.destination, envelope.returnDestination.destination);
  });

  test('a limit smaller than the matches bounds the list', async () => {
    const provider = createWikiReferenceProvider(a.client, clock);
    assert.equal((await provider.find('quokkaharbor', scope({ limit: 1 }))).length, 1);
  });

  test('a page that does not exist resolves as missing, with no latest data', async () => {
    const provider = createWikiReferenceProvider(a.client, clock);
    const resolved = await provider.resolve(envelopeOf('bl/policies/no-such-page.md', { sourceRevision: `${WIKI_REVISION_PREFIX}${'0'.repeat(64)}` }));
    assert.deepEqual(resolved, { status: 'missing', observedAt: NOW.toISOString() });
  });

  test('a stale snapshot revision resolves as changed and reports the current revision', async () => {
    const provider = createWikiReferenceProvider(a.client, clock);
    const [found] = await provider.find('Retry Policy', scope({ limit: 1 }));
    assert.ok(found);
    const stale = { ...found, sourceRevision: `${WIKI_REVISION_PREFIX}${'0'.repeat(64)}` };
    const resolved = await provider.resolve(stale);
    assert.equal(resolved.status, 'changed');
    assert.equal(resolved.latestRevision, found.sourceRevision);
    assert.equal(resolved.destination, found.returnDestination.destination);
  });

  test('a later commit that leaves a page untouched does not make it changed', async () => {
    const provider = createWikiReferenceProvider(a.client, clock);
    const found = (await provider.find('Retry Policy', scope())).find((e) => e.entityId === 'bl/policies/retry-policy.md');
    assert.ok(found);
    const before = must(await a.client.getPage({ key: key('policies/retry-policy.md') }));
    const next = advanceMain(a.corpus.repos.bl.gitDir, 'later synthetic commit');
    must(await a.host.refresh('bl'));
    const after = must(await a.client.getPage({ key: key('policies/retry-policy.md') }));
    assert.notEqual(after.commit, before.commit, 'the host moved to the later commit');
    assert.equal(after.commit, next);
    const resolved = await provider.resolve(found);
    assert.equal(resolved.status, 'available');
    assert.equal(resolved.latestRevision, found.sourceRevision);
  });

  test('without a bridge the provider finds nothing and resolves unavailable', async () => {
    const provider = createWikiReferenceProvider(createWikiClient(() => null), clock);
    assert.deepEqual(await provider.find('quokkaharbor', scope()), []);
    assert.deepEqual(await provider.resolve(envelopeOf('bl/index.md')), { status: 'unavailable', observedAt: NOW.toISOString() });
  });

  test('only search and getPage reached the host through the bridge', () => {
    assert.ok(a.bridge.calls.length > 0);
    assert.deepEqual([...new Set(a.bridge.calls.map((c) => c.method))].sort(), ['getPage', 'search']);
  });
});

describe('find', () => {
  test('searches both namespaces with the trimmed, clamped query and the contract result cap', async () => {
    const s = scripted({});
    const provider = createWikiReferenceProvider(s.service, clock);
    await provider.find('  needle  ', scope({ limit: 7 }));
    await provider.find('needle', scope({ limit: 100 }));
    await provider.find('x'.repeat(300), scope());
    assert.deepEqual(s.searches.map((r) => r.limit), [7, 50, 30]);
    assert.equal(s.searches[0]?.query, 'needle');
    assert.equal(Array.from(s.searches[2]?.query ?? '').length, 256);
    for (const request of s.searches) assert.ok(!('namespaces' in request), 'no namespace filter: both are searched');
  });

  test('an empty or blank query lists nothing and calls nothing', async () => {
    const s = scripted({});
    const provider = createWikiReferenceProvider(s.service, clock);
    assert.deepEqual(await provider.find('', scope()), []);
    assert.deepEqual(await provider.find(' \t\n ', scope()), []);
    assert.equal(s.searches.length + s.reads.length, 0);
  });

  test('a kinds filter without page returns nothing and calls nothing; one with page proceeds', async () => {
    const hit = key('guides/a.md');
    const s = scripted({ search: (r) => searchResult(r.query, [hit]), getPage: () => ok(page(hit)) });
    const provider = createWikiReferenceProvider(s.service, clock);
    assert.deepEqual(await provider.find('a', scope({ kinds: ['item', 'draft'] })), []);
    assert.deepEqual(await provider.find('a', scope({ kinds: [] })), []);
    assert.equal(s.searches.length, 0);
    assert.equal((await provider.find('a', scope({ kinds: ['item', 'page'] }))).length, 1);
    assert.equal((await provider.find('a', { projectId: PROJECT, limit: 5 })).length, 1);
  });

  test('an invalid limit lists nothing', async () => {
    const s = scripted({});
    const provider = createWikiReferenceProvider(s.service, clock);
    for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.deepEqual(await provider.find('a', scope({ limit })), [], String(limit));
    assert.equal(s.searches.length, 0);
  });

  test('every envelope carries the scope project and passes parseReference unchanged', async () => {
    const hits = [key('guides/a.md'), key('guides/b c.md', 'appdev'), key('guides/#?%.md')];
    const s = scripted({ search: (r) => searchResult(r.query, hits), getPage: (r) => ok(page(r.key, { title: `Title of ${r.key.path}` })) });
    const found = await createWikiReferenceProvider(s.service, clock).find('a', scope({ projectId: 'project-9' }));
    assert.equal(found.length, 3);
    assertParses(found);
    for (const envelope of found) assert.equal(envelope.projectId, 'project-9');
    assert.deepEqual(found.map((e) => e.entityId), ['bl/guides/a.md', 'appdev/guides/b c.md', 'bl/guides/#?%.md']);
  });

  test('an id over 160 characters is omitted without reading it; exactly 160 is kept', async () => {
    const path = (length: number) => `${'x'.repeat(length - 3)}.md`;
    const keep = key(path(157)); // "bl/" + 157 = 160
    const drop = key(path(158)); // 161
    const s = scripted({ search: (r) => searchResult(r.query, [drop, keep]), getPage: (r) => ok(page(r.key)) });
    const found = await createWikiReferenceProvider(s.service, clock).find('x', scope());
    assert.deepEqual(found.map((e) => e.entityId), [pageKeyId(keep)]);
    assert.equal(pageKeyId(keep).length, 160);
    assertParses(found);
    assert.deepEqual(s.reads.map((r) => r.key.path), [keep.path], 'the omitted page is not even read');
    // The cap is the real one: parseReference refuses the omitted id.
    assert.equal(parseReference({ ...found[0], entityId: pageKeyId(drop) }), null);
  });

  test('a page whose destination would exceed 512 characters is omitted', async () => {
    const wide = key(`${'日'.repeat(100)}.md`); // id 3 + 103 = 106 characters, destination ~ 900 once encoded
    const plain = key('guides/a.md');
    const s = scripted({ search: (r) => searchResult(r.query, [wide, plain]), getPage: (r) => ok(page(r.key)) });
    const found = await createWikiReferenceProvider(s.service, clock).find('x', scope());
    assert.deepEqual(found.map((e) => e.entityId), ['bl/guides/a.md']);
    assert.equal(parseReference({ ...found[0], entityId: pageKeyId(wide), returnDestination: { domain: 'wiki', destination: 'page/bl/' + encodeURIComponent(wide.path) } }), null);
    assert.deepEqual(s.reads.map((r) => r.key.path), ['guides/a.md']);
  });

  test('titles are trimmed and cut at 300 without splitting a surrogate pair', async () => {
    const titles = new Map<string, string>([
      ['a.md', 'a'.repeat(298) + '😀' + 'tail'], // the pair straddles the cut
      ['b.md', 'b'.repeat(400)],
      ['c.md', 'c'.repeat(300)], // exactly at the cap: untouched
      ['d.md', '  padded title  '],
      ['e.md', '   '], // nothing readable: the id stands in
      ['f.md', 'f'.repeat(299) + '😀'], // the pair starts at the last unit before the ellipsis slot
    ]);
    const keys = [...titles.keys()].map((path) => key(path));
    const s = scripted({ search: (r) => searchResult(r.query, keys), getPage: (r) => ok(page(r.key, { title: titles.get(r.key.path) ?? '' })) });
    const found = await createWikiReferenceProvider(s.service, clock).find('x', scope());
    assert.equal(found.length, 6);
    assertParses(found);
    const byId = new Map(found.map((e) => [e.entityId, e.title]));
    assert.equal(byId.get('bl/a.md'), 'a'.repeat(298) + '\u2026');
    assert.equal(byId.get('bl/b.md'), 'b'.repeat(299) + '\u2026');
    assert.equal(byId.get('bl/c.md'), 'c'.repeat(300));
    assert.equal(byId.get('bl/d.md'), 'padded title');
    assert.equal(byId.get('bl/e.md'), 'bl/e.md');
    assert.equal(byId.get('bl/f.md'), 'f'.repeat(299) + '\u2026');
    for (const title of byId.values()) {
      assert.ok(title.length <= 300);
      assert.ok(!hasLoneSurrogate(title), 'no broken surrogate pair');
    }
  });

  test('a search failure, a thrown search or an unreadable hit never throws; unreadable hits are left out', async () => {
    const good = key('guides/good.md');
    const gone = key('guides/gone.md');
    const boom = key('guides/boom.md');
    const bad = createWikiReferenceProvider(scripted({ search: () => failWith(serviceError('unavailable', 'source-unavailable', 'down')) }).service, clock);
    assert.deepEqual(await bad.find('x', scope()), []);
    const thrown = createWikiReferenceProvider(scripted({ search: () => { throw new Error('boom'); } }).service, clock);
    assert.deepEqual(await thrown.find('x', scope()), []);
    const partial = createWikiReferenceProvider(scripted({
      search: (r) => searchResult(r.query, [gone, good, boom]),
      getPage: (r) => {
        if (r.key.path === gone.path) return failWith(serviceError('not-found', 'not-found', 'gone'));
        if (r.key.path === boom.path) throw new Error('boom');
        return ok(page(r.key));
      },
    }).service, clock);
    assert.deepEqual((await partial.find('x', scope())).map((e) => e.entityId), ['bl/guides/good.md']);
  });

  test('a scope project that parseReference would refuse yields no envelopes', async () => {
    const hit = key('guides/a.md');
    const s = scripted({ search: (r) => searchResult(r.query, [hit]), getPage: (r) => ok(page(r.key)) });
    const provider = createWikiReferenceProvider(s.service, clock);
    assert.deepEqual(await provider.find('a', scope({ projectId: '' })), []);
    assert.deepEqual(await provider.find('a', scope({ projectId: 'p'.repeat(161) })), []);
    assert.deepEqual(await provider.find('a', scope({ projectId: ' padded' })), []);
    assert.equal((await provider.find('a', scope({ projectId: 'p'.repeat(160) }))).length, 1);
  });
});

describe('resolve', () => {
  test('available without a snapshot revision; available when it equals the current one; changed when it differs', async () => {
    const s = scripted({ getPage: (r) => ok(page(r.key, { title: 'Current' })) });
    const provider = createWikiReferenceProvider(s.service, clock);
    const first = await provider.resolve(envelopeOf('bl/guides/a.md'));
    assert.equal(first.status, 'available');
    assert.match(first.latestRevision ?? '', REVISION);
    assert.ok((first.latestRevision ?? '').length <= 300);
    assert.equal(first.latestTitle, 'Current');
    assert.equal(first.destination, 'page/bl/guides/a.md');
    const same = await provider.resolve(envelopeOf('bl/guides/a.md', { sourceRevision: first.latestRevision }));
    assert.equal(same.status, 'available');
    const stale = await provider.resolve(envelopeOf('bl/guides/a.md', { sourceRevision: 'wiki-c1:old' }));
    assert.equal(stale.status, 'changed');
    assert.equal(stale.latestRevision, first.latestRevision);
    assert.equal(stale.latestTitle, 'Current');
    assert.deepEqual(s.reads.map((r) => r.key), Array(3).fill(key('guides/a.md')));
  });

  test('the revision follows the page content only', async () => {
    const k = key('guides/a.md');
    const revisionOf = async (p: Page) => (await createWikiReferenceProvider(scripted({ getPage: () => ok(p) }).service, clock).resolve(envelopeOf('bl/guides/a.md'))).latestRevision;
    const base = await revisionOf(page(k));
    assert.match(base ?? '', REVISION);
    // Not part of the token: the commit the page was read from, the out-links and the property order of the record.
    assert.equal(await revisionOf(page(k, { commit: 'b'.repeat(40) })), base);
    assert.equal(await revisionOf(page(k, { outLinks: [{ text: 'x' }] as unknown as Page['outLinks'] })), base);
    const reordered = { content: { text: 'body', reason: 'markdown-unsupported', state: 'raw' }, fields: [], title: 'Stub page', byteLength: 10, key: k, outLinks: [], commit: COMMIT } as Page;
    assert.equal(await revisionOf(reordered), base);
    // Part of the token: size, title, fields and content.
    const changed = [
      await revisionOf(page(k, { byteLength: 11 })),
      await revisionOf(page(k, { title: 'Other title' })),
      await revisionOf(page(k, { fields: [{ name: 'status', value: 'draft' }] })),
      await revisionOf(page(k, { fields: [{ name: 'status', value: 'final' }] })),
      await revisionOf(page(k, { content: { state: 'raw', reason: 'markdown-unsupported', text: 'body!' } })),
      await revisionOf(page(k, { content: { state: 'raw', reason: 'not-text', text: 'body' } })),
      await revisionOf(page(k, { content: { state: 'parsed', ast: { type: 'document', children: [] } } as unknown as Page['content'] })),
    ];
    assert.equal(new Set([base, ...changed]).size, changed.length + 1, 'each change gives a distinct token');
  });

  test('error codes map to missing, unavailable and unknown; a thrown read is unavailable', async () => {
    const answer = async (script: () => WikiResult<Page>) =>
      createWikiReferenceProvider(scripted({ getPage: script }).service, clock).resolve(envelopeOf('bl/guides/a.md', { sourceRevision: 'wiki-c1:x' }));
    const bare = (status: string) => ({ status, observedAt: NOW.toISOString() });
    assert.deepEqual(await answer(() => failWith(serviceError('not-found', 'not-found', 'm'))), bare('missing'));
    assert.deepEqual(await answer(() => failWith(serviceError('unavailable', 'source-unavailable', 'm'))), bare('unavailable'));
    assert.deepEqual(await answer(() => failWith(serviceError('unavailable', 'index-unavailable', 'm'))), bare('unavailable'));
    assert.deepEqual(await answer(() => failWith(serviceError('internal', 'internal', 'm'))), bare('unknown'));
    assert.deepEqual(await answer(() => failWith({ code: 'invalid-input', reason: 'traversal', message: 'm', path: '$' })), bare('unknown'));
    assert.deepEqual(await answer(() => { throw new Error('boom'); }), bare('unavailable'));
    // A service that answers with another page is not trusted.
    assert.deepEqual(await answer(() => ok(page(key('guides/other.md')))), bare('unknown'));
  });

  test('ids that are not a valid <namespace>/<path> resolve unknown without reading anything', async () => {
    const s = scripted({ getPage: (r) => ok(page(r.key)) });
    const provider = createWikiReferenceProvider(s.service, clock);
    const ids: unknown[] = [
      '', 'bl', 'bl/', '/bl/index.md', '/etc/passwd', '../x', '../bl/index.md', 'bl/../x', 'bl/./x', 'bl//x', 'bl/a//b', 'bl/a/',
      'other/index.md', 'BL/index.md', 'appdev2/index.md', 'bl\\index.md', 'bl/a\\b', 'C:/x', 'bl/C:/x', 'bl/file:x', 'bl/\u0000', 'bl/a\u0007b',
      `bl/${'x'.repeat(158)}`, `bl/${'日'.repeat(150)}.md`, 42, null, undefined, { path: 'x' },
    ];
    for (const id of ids) {
      const resolved = await provider.resolve(envelopeOf(id as string));
      assert.deepEqual(resolved, { status: 'unknown', observedAt: NOW.toISOString() }, `entityId ${JSON.stringify(id)}`);
    }
    assert.equal(s.reads.length, 0);
  });

  test('another kind or domain resolves unknown without reading anything', async () => {
    const s = scripted({ getPage: (r) => ok(page(r.key)) });
    const provider = createWikiReferenceProvider(s.service, clock);
    for (const bad of [envelopeOf('bl/index.md', { kind: 'item' }), envelopeOf('bl/index.md', { domain: 'work' }), envelopeOf('bl/index.md', { kind: 'Page' })]) {
      assert.deepEqual(await provider.resolve(bad), { status: 'unknown', observedAt: NOW.toISOString() });
    }
    for (const bad of [null, undefined, 'bl/index.md', 7]) {
      assert.deepEqual(await provider.resolve(bad as never), { status: 'unknown', observedAt: NOW.toISOString() });
    }
    assert.equal(s.reads.length, 0);
  });

  test('a namespace name inside the path is kept: only the first slash splits', async () => {
    const s = scripted({ getPage: (r) => ok(page(r.key)) });
    const resolved = await createWikiReferenceProvider(s.service, clock).resolve(envelopeOf('appdev/bl/index.md'));
    assert.equal(resolved.status, 'available');
    assert.deepEqual(s.reads.map((r) => r.key), [{ namespace: 'appdev', path: 'bl/index.md' }]);
  });

  test('destinations round-trip through the contract parser and satisfy isDestination', async () => {
    const paths = ['index.md', 'guides/onboarding.md', 'notes/Ünï café & spaces.md', 'a b/c#d?e%f.md', 'x/日本語.md', 'x/a:b.md', `${'seg/'.repeat(30)}end.md`];
    const provider = createWikiReferenceProvider(scripted({ getPage: (r) => ok(page(r.key)) }).service, clock);
    for (const namespace of ['bl', 'appdev'] as const) {
      for (const path of paths) {
        const resolved = await provider.resolve(envelopeOf(`${namespace}/${path}`));
        assert.equal(resolved.status, 'available', `${namespace}/${path}`);
        const destination = resolved.destination ?? '';
        assert.ok(isDestination(destination) && destination.length <= 512, destination);
        assert.deepEqual(must(parseDestination(destination)), { kind: 'page', key: { namespace, path } });
      }
    }
  });

  test('an id that fits 160 characters but whose destination exceeds 512 resolves unknown without a read', async () => {
    const s = scripted({ getPage: (r) => ok(page(r.key)) });
    const id = `bl/${'日'.repeat(100)}.md`;
    assert.ok(id.length <= 160);
    assert.deepEqual(await createWikiReferenceProvider(s.service, clock).resolve(envelopeOf(id)), { status: 'unknown', observedAt: NOW.toISOString() });
    assert.equal(s.reads.length, 0);
  });

  test('observedAt is the clock reading taken after the read, in ISO form, for every status', async () => {
    let current = new Date('2026-11-03T12:00:00.000Z');
    const answers: (() => WikiResult<Page>)[] = [
      () => ok(page(key('guides/a.md'))),
      () => failWith(serviceError('not-found', 'not-found', 'm')),
      () => failWith(serviceError('unavailable', 'source-unavailable', 'm')),
      () => failWith(serviceError('internal', 'internal', 'm')),
    ];
    const statuses = ['available', 'missing', 'unavailable', 'unknown'];
    for (const [index, answer] of answers.entries()) {
      const provider = createWikiReferenceProvider(scripted({ getPage: () => { current = new Date(current.getTime() + 90_000); return answer(); } }).service, () => current);
      const readAt = new Date(current.getTime() + 90_000).toISOString();
      const resolved = await provider.resolve(envelopeOf('bl/guides/a.md'));
      assert.equal(resolved.status, statuses[index]);
      assert.equal(resolved.observedAt, readAt, 'stamped after the read, not before it');
      assert.ok(Number.isFinite(Date.parse(resolved.observedAt)));
    }
  });
});

describe('read-only surface', () => {
  test('the provider exposes only domain, kinds, find and resolve', () => {
    const provider = createWikiReferenceProvider(scripted({}).service, clock);
    assert.deepEqual(Object.keys(provider).sort(), ['domain', 'find', 'kinds', 'resolve']);
    assert.equal(provider.domain, 'wiki');
    assert.deepEqual([...provider.kinds], ['page']);
  });

  test('find and resolve in every outcome read only search and getPage from the service', async () => {
    const hit = key('guides/a.md');
    const s = scripted({ search: (r) => searchResult(r.query, [hit]), getPage: (r) => ok(page(r.key)) });
    const provider = createWikiReferenceProvider(s.service, clock);
    await provider.find('a', scope());
    await provider.find('', scope());
    await provider.find('a', scope({ kinds: ['draft'] }));
    await provider.resolve(envelopeOf('bl/guides/a.md'));
    await provider.resolve(envelopeOf('bl/guides/a.md', { sourceRevision: 'wiki-c1:x' }));
    await provider.resolve(envelopeOf('../x'));
    await provider.resolve(envelopeOf('bl/missing.md'));
    assert.ok(s.touched.size > 0);
    assert.deepEqual([...s.touched].sort(), ['getPage', 'search']);
  });
});
