// The Wiki reference provider against a scripted port: what `find` returns and skips, what `resolve` reports, and that
// nothing outside the seven reads is ever reached. The real validator for envelopes lives in @hq/contracts, which this
// module does not import; `envelopeRules` below mirrors it and the desktop integration test runs the real one.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { WIKI_SERVICE_METHODS, type WikiError } from '../../contract/src/index.ts';
import { createWikiReferenceProvider, type WikiReferenceEnvelope, type WikiReferenceInput } from '../src/references.ts';
import type { WikiHostPort } from '../src/port.ts';

const COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);
const PROJECT = 'project-one';
const NOW = '2026-11-03T12:00:00.000Z';

type Key = { namespace: string; path: string };
const hit = (key: Key, title: string) => ({ key, title, score: 1, snippet: 'Synthetic excerpt.' });
const searchResult = (hits: ReturnType<typeof hit>[], query = 'x') => ({ query, hits, totalHits: hits.length, truncated: false });
const page = (key: Key, title = 'Synthetic page', commit = COMMIT) => ({
  key,
  title,
  commit,
  byteLength: 10,
  fields: [],
  outLinks: [],
  content: { state: 'raw', reason: 'markdown-unsupported', text: 'x' },
});
const failure = (code: WikiError['code'], reason: WikiError['reason']) => ({ ok: false, error: { code, reason, message: 'Synthetic failure.' } });
const success = (value: unknown) => ({ ok: true, value });

type Responder = (method: string, args: unknown[]) => unknown;

/** A port whose seven methods answer through `respond` and record what they received. */
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

const clock = () => {
  let n = 0;
  return () => `2026-11-03T12:00:${String(n++).padStart(2, '0')}.000Z`;
};

const GUIDE: Key = { namespace: 'bl', path: 'guides/onboarding.md' };
const POLICY: Key = { namespace: 'appdev', path: 'notes/Retry Policy.md' };

/** Provider over a port that answers search with `hits` and getPage with the page for the requested key. */
function provider(hits: ReturnType<typeof hit>[] = [], options: { commit?: string; title?: string } = {}) {
  const { port, calls } = scripted((method, args) => {
    if (method === 'search') return success(searchResult(hits));
    if (method === 'getPage') return success(page((args[0] as { key: Key }).key, options.title, options.commit));
    return success(null);
  });
  return { provider: createWikiReferenceProvider(() => port, () => NOW), calls };
}

const scope = (overrides: Partial<{ projectId: string; kinds: readonly string[]; limit: number }> = {}) => ({ projectId: PROJECT, limit: 10, ...overrides });

/** Mirrors `parseReference` in @hq/contracts for the fields this provider fills. */
function envelopeRules(envelope: WikiReferenceEnvelope): void {
  const text = (value: unknown, max: number) =>
    typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
  assert.deepEqual(Object.keys(envelope).sort(), ['domain', 'entityId', 'kind', 'projectId', 'returnDestination', 'title', 'version']);
  assert.equal(envelope.version, 1);
  assert.equal(envelope.domain, 'wiki');
  assert.equal(envelope.kind, 'page');
  assert.ok(text(envelope.projectId, 160), 'projectId');
  assert.ok(text(envelope.entityId, 160), 'entityId');
  assert.ok(text(envelope.title, 300), 'title');
  assert.deepEqual(Object.keys(envelope.returnDestination).sort(), ['destination', 'domain']);
  assert.equal(envelope.returnDestination.domain, 'wiki');
  assert.ok(text(envelope.returnDestination.destination, 512), 'destination');
  assert.ok(!/^[a-z][a-z\d+.-]*:|^[/\\]{2}/iu.test(envelope.returnDestination.destination), 'destination is not scheme-like');
}

describe('shape', () => {
  test('a frozen Wiki provider for the page kind with exactly find and resolve', () => {
    const { provider: p } = provider();
    assert.equal(p.domain, 'wiki');
    assert.deepEqual(p.kinds, ['page']);
    assert.deepEqual(Object.keys(p).sort(), ['domain', 'find', 'kinds', 'resolve']);
    assert.ok(Object.isFrozen(p) && Object.isFrozen(p.kinds));
  });
});

describe('find', () => {
  test('maps hits to page envelopes with logical identities and destinations, in the host order', async () => {
    const { provider: p, calls } = provider([hit(GUIDE, 'Onboarding Guide'), hit(POLICY, 'Retry Policy')]);
    const found = await p.find('policy', scope());
    assert.deepEqual(found, [
      {
        version: 1,
        domain: 'wiki',
        projectId: PROJECT,
        kind: 'page',
        entityId: 'bl/guides/onboarding.md',
        title: 'Onboarding Guide',
        returnDestination: { domain: 'wiki', destination: 'page/bl/guides/onboarding.md' },
      },
      {
        version: 1,
        domain: 'wiki',
        projectId: PROJECT,
        kind: 'page',
        entityId: 'appdev/notes/Retry Policy.md',
        title: 'Retry Policy',
        returnDestination: { domain: 'wiki', destination: 'page/appdev/notes/Retry%20Policy.md' },
      },
    ]);
    for (const envelope of found) envelopeRules(envelope);
    assert.deepEqual(calls, [{ method: 'search', args: [{ query: 'policy', namespaces: ['bl', 'appdev'], limit: 10 }] }]);
  });

  test('the projectId is the scope\'s, whatever it is called', async () => {
    const { provider: p } = provider([hit(GUIDE, 'Onboarding Guide')]);
    const [envelope] = await p.find('guide', scope({ projectId: 'another project' }));
    assert.equal(envelope?.projectId, 'another project');
  });

  test('a scope that excludes the page kind finds nothing and asks the host nothing', async () => {
    const { provider: p, calls } = provider([hit(GUIDE, 'Onboarding Guide')]);
    assert.deepEqual(await p.find('guide', scope({ kinds: ['item'] })), []);
    assert.deepEqual(await p.find('guide', scope({ kinds: [] })), []);
    assert.equal(calls.length, 0);
    assert.equal((await p.find('guide', scope({ kinds: ['draft', 'page'] }))).length, 1);
    assert.equal((await p.find('guide', scope({ kinds: ['page'] }))).length, 1);
    assert.equal((await p.find('guide', scope())).length, 1);
  });

  test('a query the Wiki contract refuses finds nothing and asks the host nothing', async () => {
    const { provider: p, calls } = provider([hit(GUIDE, 'Onboarding Guide')]);
    const refused: unknown[] = ['', '   ', '\t\n', 'x'.repeat(257), 'a\u0000b', 'a\u0007b', 'a\u007fb', 'lone \ud800 surrogate', 42, null, undefined, { query: 'x' }];
    for (const query of refused) assert.deepEqual(await p.find(query as string, scope()), [], String(query));
    assert.equal(calls.length, 0);
    assert.equal((await p.find('x'.repeat(256), scope())).length, 1, 'the longest query is accepted');
    assert.equal(calls.length, 1);
  });

  test('a scope without a usable limit or project finds nothing and asks the host nothing', async () => {
    const { provider: p, calls } = provider([hit(GUIDE, 'Onboarding Guide')]);
    for (const limit of [0, -1, 1.5, Number.NaN, Infinity, '3' as unknown as number, undefined as unknown as number]) {
      assert.deepEqual(await p.find('guide', scope({ limit })), [], String(limit));
    }
    for (const projectId of ['', ' padded', 'padded ', 'a\nb', 'p'.repeat(161), undefined as unknown as string]) {
      assert.deepEqual(await p.find('guide', scope({ projectId })), [], String(projectId));
    }
    assert.deepEqual(await p.find('guide', undefined as unknown as ReturnType<typeof scope>), []);
    assert.equal(calls.length, 0);
    assert.equal((await p.find('guide', scope({ projectId: 'p'.repeat(160) }))).length, 1);
  });

  test('the request limit is the scope limit, bounded by the contract maximum', async () => {
    const { provider: p, calls } = provider([hit(GUIDE, 'Onboarding Guide')]);
    await p.find('guide', scope({ limit: 1 }));
    await p.find('guide', scope({ limit: 30 }));
    await p.find('guide', scope({ limit: 50 }));
    await p.find('guide', scope({ limit: 100 }));
    assert.deepEqual(
      calls.map((c) => (c.args[0] as { limit: number }).limit),
      [1, 30, 50, 50],
    );
  });

  test('a host that returns more hits than the scope limit is cut to the limit', async () => {
    const many = Array.from({ length: 6 }, (_, i) => hit({ namespace: 'bl', path: `pages/p${i}.md` }, `Page ${i}`));
    const { provider: p } = provider(many);
    const found = await p.find('page', scope({ limit: 4 }));
    assert.deepEqual(found.map((e) => e.entityId), ['bl/pages/p0.md', 'bl/pages/p1.md', 'bl/pages/p2.md', 'bl/pages/p3.md']);
  });

  test('a hit that cannot be named within the envelope rules is skipped, never shortened', async () => {
    const longPath = 'a'.repeat(158); // 'bl/' + 158 = 161 characters: legal for the Wiki, too long for an envelope id
    const encodedLong = 'é'.repeat(100); // a 103-character id whose destination is 600 characters once percent-encoded
    const { provider: p } = provider([
      hit({ namespace: 'bl', path: longPath }, 'Too long to name'),
      hit({ namespace: 'bl', path: 'trailing space ' }, 'Untrimmed identity'),
      hit({ namespace: 'bl', path: ' leading-space.md' }, 'Space inside the identity is fine'),
      hit({ namespace: 'bl', path: encodedLong }, 'Destination too long'),
      hit({ namespace: 'bl', path: 'notes/untrimmed-title.md' }, ' padded title'),
      hit({ namespace: 'bl', path: 'notes/untrimmed-title-2.md' }, 'padded title '),
      hit({ namespace: 'bl', path: 'a'.repeat(157) }, 'Exactly at the limit'),
      hit(GUIDE, 'Onboarding Guide'),
    ]);
    const found = await p.find('page', scope({ limit: 10 }));
    assert.deepEqual(found.map((e) => e.entityId), ['bl/ leading-space.md', `bl/${'a'.repeat(157)}`, 'bl/guides/onboarding.md']);
    assert.equal(found[1]?.entityId.length, 160);
    assert.equal(found[0]?.returnDestination.destination, 'page/bl/%20leading-space.md');
    for (const envelope of found) envelopeRules(envelope);
  });

  test('skipped hits do not count against the limit and the rest keep their order', async () => {
    const { provider: p } = provider([
      hit({ namespace: 'bl', path: 'x'.repeat(200) }, 'Skipped'),
      hit({ namespace: 'bl', path: 'one.md' }, 'One'),
      hit({ namespace: 'bl', path: 'two.md' }, 'Two'),
      hit({ namespace: 'bl', path: 'three.md' }, 'Three'),
    ]);
    const found = await p.find('page', scope({ limit: 2 }));
    assert.deepEqual(found.map((e) => e.entityId), ['bl/one.md', 'bl/two.md']);
  });

  test('titles and paths are copied exactly: Unicode, quotes and markup are inert text', async () => {
    const title = 'Résumé <b>"quoted"</b> & more';
    const { provider: p } = provider([hit({ namespace: 'bl', path: 'notes/résumé & more.md' }, title)]);
    const [envelope] = await p.find('resume', scope());
    assert.ok(envelope);
    envelopeRules(envelope);
    assert.equal(envelope.title, title);
    assert.equal(envelope.entityId, 'bl/notes/résumé & more.md');
    assert.equal(envelope.returnDestination.destination, 'page/bl/notes/r%C3%A9sum%C3%A9%20%26%20more.md');
  });

  test('an empty result is an empty list', async () => {
    const { provider: p } = provider([]);
    assert.deepEqual(await p.find('nothing', scope()), []);
  });

  test('host errors, malformed answers, thrown ports and a missing bridge all find nothing and never throw', async () => {
    const answers: unknown[] = [
      failure('unavailable', 'source-unavailable'),
      failure('unavailable', 'index-unavailable'),
      failure('internal', 'internal'),
      failure('not-found', 'not-found'),
      'not an envelope',
      { ok: true, value: { query: 'x', hits: [{ key: { namespace: 'bl', path: '../escape.md' }, title: 'T', score: 1, snippet: '' }], totalHits: 1, truncated: false } },
      { ok: true, value: { query: 'x', hits: [hit({ namespace: 'bl', path: 'a\u0007b.md' }, 'Control')], totalHits: 1, truncated: false } },
      { ok: true, value: { query: 'x', hits: [], totalHits: 3, truncated: false } },
    ];
    for (const answer of answers) {
      const { port } = scripted(() => answer);
      assert.deepEqual(await createWikiReferenceProvider(() => port, () => NOW).find('x', scope()), [], JSON.stringify(answer));
    }
    const throwing = scripted(() => {
      throw new Error('synthetic host failure');
    }).port;
    const rejecting = scripted(() => Promise.reject(new Error('synthetic host failure'))).port;
    for (const getPort of [() => throwing, () => rejecting, () => null, () => { throw new Error('no bridge'); }]) {
      assert.deepEqual(await createWikiReferenceProvider(getPort, () => NOW).find('x', scope()), []);
    }
  });

  test('the bridge is read on every call, so one that appears later is used', async () => {
    let current: WikiHostPort | null = null;
    const p = createWikiReferenceProvider(() => current, () => NOW);
    assert.deepEqual(await p.find('guide', scope()), []);
    current = scripted(() => success(searchResult([hit(GUIDE, 'Onboarding Guide')]))).port;
    assert.equal((await p.find('guide', scope())).length, 1);
  });
});

describe('resolve', () => {
  const envelope = (overrides: Record<string, unknown> = {}): WikiReferenceInput =>
    ({ version: 1, domain: 'wiki', projectId: PROJECT, kind: 'page', entityId: 'bl/guides/onboarding.md', title: 'Onboarding Guide', returnDestination: { domain: 'wiki', destination: 'page/bl/guides/onboarding.md' }, ...overrides }) as WikiReferenceInput;

  test('a page that is there is available, with its latest title, commit and destination', async () => {
    const { provider: p, calls } = provider([], { title: 'Onboarding Guide (revised)' });
    assert.deepEqual(await p.resolve(envelope()), {
      status: 'available',
      observedAt: NOW,
      latestTitle: 'Onboarding Guide (revised)',
      latestRevision: COMMIT,
      destination: 'page/bl/guides/onboarding.md',
    });
    assert.deepEqual(calls, [{ method: 'getPage', args: [{ key: GUIDE }] }]);
  });

  test('the same snapshot revision is available; a different one is changed', async () => {
    const { provider: p } = provider([], { commit: OTHER_COMMIT });
    assert.equal((await p.resolve(envelope({ sourceRevision: OTHER_COMMIT }))).status, 'available');
    assert.equal((await p.resolve(envelope())).status, 'available', 'no snapshot revision, nothing to differ from');
    assert.deepEqual(await p.resolve(envelope({ sourceRevision: COMMIT })), {
      status: 'changed',
      observedAt: NOW,
      latestTitle: 'Synthetic page',
      latestRevision: OTHER_COMMIT,
      destination: 'page/bl/guides/onboarding.md',
    });
  });

  test('an identity from find resolves to the destination find gave it', async () => {
    const hits = [hit(POLICY, 'Retry Policy'), hit({ namespace: 'bl', path: 'notes/résumé & more.md' }, 'Résumé'), hit({ namespace: 'appdev', path: 'a/b/c.md' }, 'Nested')];
    const { provider: p } = provider(hits);
    const found = await p.find('anything', scope());
    assert.equal(found.length, 3);
    for (const reference of found) {
      const resolution = await p.resolve(reference);
      assert.equal(resolution.status, 'available');
      assert.equal(resolution.destination, reference.returnDestination.destination);
    }
  });

  test('the request carries the logical key parsed from the identity, with a "/" inside the path preserved', async () => {
    const { provider: p, calls } = provider();
    await p.resolve(envelope({ entityId: 'appdev/notes/Retry Policy.md' }));
    assert.deepEqual(calls, [{ method: 'getPage', args: [{ key: POLICY }] }]);
  });

  test('a page the host cannot find is missing', async () => {
    const { port } = scripted(() => failure('not-found', 'not-found'));
    const p = createWikiReferenceProvider(() => port, () => NOW);
    assert.deepEqual(await p.resolve(envelope()), { status: 'missing', observedAt: NOW });
  });

  test('an unavailable or failing host is unavailable, whatever it sends', async () => {
    const answers: unknown[] = [
      failure('unavailable', 'source-unavailable'),
      failure('unavailable', 'index-unavailable'),
      failure('internal', 'internal'),
      'not an envelope',
      { ok: true, value: page({ namespace: 'bl', path: 'another/page.md' }) },
      { ok: true, value: { ...page(GUIDE), commit: 'not a commit' } },
    ];
    for (const answer of answers) {
      const { port } = scripted(() => answer);
      const p = createWikiReferenceProvider(() => port, () => NOW);
      assert.deepEqual(await p.resolve(envelope()), { status: 'unavailable', observedAt: NOW }, JSON.stringify(answer));
    }
    const throwing = scripted(() => {
      throw new Error('synthetic host failure');
    }).port;
    const rejecting = scripted(() => Promise.reject(new Error('synthetic host failure'))).port;
    for (const getPort of [() => throwing, () => rejecting, () => null, () => { throw new Error('no bridge'); }]) {
      assert.deepEqual(await createWikiReferenceProvider(getPort, () => NOW).resolve(envelope()), { status: 'unavailable', observedAt: NOW });
    }
  });

  test('anything that is not a Wiki page identity is unknown and never reaches the host', async () => {
    const { provider: p, calls } = provider();
    const identities: unknown[] = [
      '', 'bl', 'bl/', '/guide.md', 'nope/guide.md', 'BL/guide.md', 'bl//guide.md', 'bl/a//b.md', 'bl/a/', 'bl/../guide.md', 'bl/a/./b.md', 'bl//etc/passwd',
      'bl/a\\b.md', 'bl/a\u0000b.md', 'bl/a\nb.md', 'bl/C:/guide.md', 'bl/file:///etc/passwd', `bl/${'a'.repeat(1025)}`, `bl/${'a'.repeat(256)}`, 'bl/lone \ud800 surrogate', 7, null, undefined,
    ];
    for (const entityId of identities) {
      assert.deepEqual(await p.resolve(envelope({ entityId })), { status: 'unknown', observedAt: NOW }, String(entityId));
    }
    assert.deepEqual(await p.resolve(envelope({ domain: 'work' })), { status: 'unknown', observedAt: NOW });
    assert.deepEqual(await p.resolve(envelope({ kind: 'topic' })), { status: 'unknown', observedAt: NOW });
    for (const value of [undefined, null, 'bl/guides/onboarding.md', 7]) assert.deepEqual(await p.resolve(value as never), { status: 'unknown', observedAt: NOW });
    assert.equal(calls.length, 0);
  });

  test('a page the shell could not be given a destination for is not offered as openable', async () => {
    const { provider: p, calls } = provider();
    assert.deepEqual(await p.resolve(envelope({ entityId: `bl/${'é'.repeat(100)}` })), { status: 'unknown', observedAt: NOW });
    assert.equal(calls.length, 1);
  });

  test('every observation is stamped by the supplied clock, after the read', async () => {
    const { port } = scripted((_method, args) => success(page((args[0] as { key: Key }).key)));
    const p = createWikiReferenceProvider(() => port, clock());
    assert.equal((await p.resolve(envelope())).observedAt, '2026-11-03T12:00:00.000Z');
    assert.equal((await p.resolve(envelope())).observedAt, '2026-11-03T12:00:01.000Z');
    assert.equal((await p.resolve(envelope({ entityId: 'nope' }))).observedAt, '2026-11-03T12:00:02.000Z');
  });
});

describe('reads', () => {
  test('only search and getPage are ever called, and only the seven method names are ever read', async () => {
    const touched = new Set<string>();
    const { port, calls } = scripted((method, args) => (method === 'search' ? success(searchResult([hit(GUIDE, 'Onboarding Guide')])) : success(page((args[0] as { key: Key }).key))));
    const spy = new Proxy({ ...port, refresh: () => assert.fail('refresh must never be called'), migrateHome: () => assert.fail('nor home migration') }, {
      get(target, property, receiver) {
        touched.add(String(property));
        return Reflect.get(target, property, receiver);
      },
    }) as unknown as WikiHostPort;
    const p = createWikiReferenceProvider(() => spy, () => NOW);
    const [reference] = await p.find('guide', scope());
    assert.ok(reference);
    await p.resolve(reference);
    await p.find('', scope());
    await p.resolve({ ...reference, entityId: 'bad' });
    assert.deepEqual([...touched].sort(), ['getPage', 'search']);
    assert.deepEqual(calls.map((c) => c.method), ['search', 'getPage']);
  });

  test('requests that would carry a path, root or url are impossible: only a validated key and query are sent', async () => {
    const { provider: p, calls } = provider([hit(GUIDE, 'Onboarding Guide')]);
    await p.find('guide', { ...scope(), root: '/somewhere', path: '/etc', url: 'https://example.invalid' } as ReturnType<typeof scope>);
    await p.resolve({ domain: 'wiki', kind: 'page', entityId: 'bl/guides/onboarding.md', path: '/etc', root: '/somewhere' } as WikiReferenceInput);
    assert.deepEqual(calls.map((c) => c.args), [[{ query: 'guide', namespaces: ['bl', 'appdev'], limit: 10 }], [{ key: GUIDE }]]);
  });
});
