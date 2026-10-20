// Search ranking, backlinks, topics and snapshots.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_AST_NODES, MAX_RESULTS, MAX_SNIPPET_LENGTH, MAX_TOPIC_ID_LENGTH, MAX_TOPICS, validateTopicList } from '../../contract/src/index.ts';
import { BM25_B, BM25_K1, TITLE_WEIGHT, createMemoryIndexStore, createWikiHost, parseSnapshot, profileIndexKey, validateSourceProfile, type IndexSnapshot } from '../src/index.ts';
import { clock, commitOf, memoryHost, memorySource, must, profileFor } from './support.ts';

function words(text: string): string[] {
  return text.normalize('NFC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Independent BM25 reference over (title, body) pairs, using the parameters the plan fixes. */
function reference(docs: Record<string, { title: string; body: string }>, term: string): Map<string, number> {
  const parsed = Object.entries(docs).map(([id, d]) => {
    const title = words(d.title);
    const body = words(d.body);
    return { id, tf: body.filter((w) => w === term).length + 2 * title.filter((w) => w === term).length, length: body.length + 2 * title.length };
  });
  const average = parsed.reduce((sum, d) => sum + d.length, 0) / parsed.length;
  const df = parsed.filter((d) => d.tf > 0).length;
  const idf = Math.log(1 + (parsed.length - df + 0.5) / (df + 0.5));
  const scores = new Map<string, number>();
  for (const d of parsed) if (d.tf > 0) scores.set(d.id, (idf * d.tf * (1.2 + 1)) / (d.tf + 1.2 * (1 - 0.75 + (0.75 * d.length) / average)));
  return scores;
}

describe('BM25 ranking', () => {
  test('parameters are the plan values', () => {
    assert.deepEqual([BM25_K1, BM25_B, TITLE_WEIGHT], [1.2, 0.75, 2]);
  });

  test('scores match an independent reference implementation (title weight 2, k1 1.2, b 0.75)', async () => {
    const docs = {
      'alpha.md': { title: 'alpha', body: 'beta beta gamma' },
      'beta.md': { title: 'beta', body: 'alpha alpha alpha delta delta delta epsilon zeta eta theta' },
      'gamma.md': { title: 'gamma', body: 'beta gamma gamma' },
      'delta.md': { title: 'delta', body: 'filler filler' },
    };
    const t = memoryHost({ bl: Object.fromEntries(Object.entries(docs).map(([path, d]) => [path, d.body])) });
    must(await t.host.refresh());
    for (const term of ['beta', 'gamma', 'alpha']) {
      const expected = reference(docs, term);
      const result = must(await t.host.service.search({ query: term }));
      assert.equal(result.totalHits, expected.size, term);
      for (const hit of result.hits) {
        assert.ok(Math.abs(hit.score - (expected.get(hit.key.path) as number)) < 1e-12, `${term} ${hit.key.path}: ${hit.score} vs ${expected.get(hit.key.path)}`);
      }
      const order = [...expected.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([path]) => path);
      assert.deepEqual(result.hits.map((h) => h.key.path), order);
    }
  });

  test('multi-term queries sum per-term scores; a title hit outranks an equal body hit', async () => {
    const t = memoryHost({ bl: { 'rare.md': 'plain words here', 'common.md': 'pineapple words here', 'pineapple.md': 'plain words here' } });
    must(await t.host.refresh());
    const result = must(await t.host.service.search({ query: 'pineapple' }));
    assert.deepEqual(result.hits.map((h) => h.key.path), ['pineapple.md', 'common.md'], 'the title match (weight 2) beats a single body match of the same length');
    const both = must(await t.host.service.search({ query: 'pineapple words' }));
    assert.deepEqual(both.hits.map((h) => h.key.path), ['pineapple.md', 'common.md', 'rare.md'], 'the rarer term dominates; a document matching only the common term ranks last');
  });

  test('ties break by page key in UTF-16 code-unit order, not by locale', async () => {
    const t = memoryHost({ bl: { 'b.md': 'same', 'B.md': 'same', 'a.md': 'same', 'Z.md': 'same', 'é.md': 'same' } });
    must(await t.host.refresh());
    const result = must(await t.host.service.search({ query: 'same' }));
    const scores = new Set(result.hits.map((h) => h.score));
    assert.equal(scores.size, 1, 'identical documents tie exactly');
    assert.deepEqual(result.hits.map((h) => h.key.path), ['B.md', 'Z.md', 'a.md', 'b.md', 'é.md']);
  });

  test('results are deterministic across rebuilds and independent of file enumeration order', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i++) files[`n${i}.md`] = `common term ${'extra '.repeat(i % 5)} unique${i}`;
    const reversed = Object.fromEntries(Object.entries(files).reverse());
    const a = memoryHost({ bl: files });
    const b = memoryHost({ bl: reversed });
    must(await a.host.refresh());
    must(await b.host.refresh());
    const ra = must(await a.host.service.search({ query: 'common extra' }));
    const rb = must(await b.host.service.search({ query: 'common extra' }));
    assert.deepEqual(ra, rb);
    assert.deepEqual(must(await a.host.service.search({ query: 'common extra' })), ra, 'repeatable');
    assert.equal(a.store.entries.get(`bl/${commitOf('bl')}`), b.store.entries.get(`bl/${commitOf('bl')}`), 'snapshots serialise identically');
  });

  test('tokenisation: Unicode letters and numbers, lowercase, NFC', async () => {
    const t = memoryHost({ bl: { 'u.md': 'École élève Straße 東京 42 snake_case étude', 'v.md': 'other' } });
    must(await t.host.refresh());
    const hit = async (query: string) => must(await t.host.service.search({ query })).hits.map((h) => h.key.path);
    assert.deepEqual(await hit('ÉCOLE'), ['u.md']);
    assert.deepEqual(await hit('école'), ['u.md'], 'decomposed query matches composed text');
    assert.deepEqual(await hit('étude'), ['u.md'], 'composed query matches decomposed text');
    assert.deepEqual(await hit('東京'), ['u.md']);
    assert.deepEqual(await hit('42'), ['u.md']);
    assert.deepEqual(await hit('snake'), ['u.md'], 'underscore separates tokens');
    assert.deepEqual(await hit('!!! ???'), []);
  });

  test('limit, totalHits and truncated; default cap is 50', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 60; i++) files[`p${String(i).padStart(2, '0')}.md`] = 'shared';
    const t = memoryHost({ bl: files });
    must(await t.host.refresh());
    const small = must(await t.host.service.search({ query: 'shared', limit: 10 }));
    assert.deepEqual([small.hits.length, small.totalHits, small.truncated], [10, 60, true]);
    const full = must(await t.host.service.search({ query: 'shared' }));
    assert.deepEqual([full.hits.length, full.totalHits, full.truncated], [MAX_RESULTS, 60, true]);
    const exact = must(await t.host.service.search({ query: 'shared', limit: 50 }));
    assert.equal(exact.truncated, true);
  });

  test('snippets are bounded, centred on the match and never split a surrogate pair', async () => {
    const body = `${'😀 filler '.repeat(150)}needle ${'trailing 😀 '.repeat(150)}`;
    const t = memoryHost({ bl: { 's.md': body, 'plain.md': 'short text about needle' } });
    must(await t.host.refresh());
    const result = must(await t.host.service.search({ query: 'needle' }));
    for (const hit of result.hits) {
      assert.ok(hit.snippet.length <= MAX_SNIPPET_LENGTH);
      assert.ok(hit.snippet.includes('needle'));
      assert.doesNotMatch(hit.snippet, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
      assert.doesNotMatch(hit.snippet, /[\u0000-\u001f]/);
    }
  });

  test('a repository filter changes the candidate set only', async () => {
    const t = memoryHost({ bl: { 'a.md': 'orchid' }, appdev: { 'b.md': 'orchid orchid' } });
    must(await t.host.refresh());
    const both = must(await t.host.service.search({ query: 'orchid' }));
    assert.deepEqual(both.hits.map((h) => h.key.namespace), ['appdev', 'bl']);
    assert.deepEqual(must(await t.host.service.search({ query: 'orchid', namespaces: ['bl'] })).hits.map((h) => h.key.namespace), ['bl']);
    assert.deepEqual(must(await t.host.service.search({ query: 'orchid', namespaces: ['bl', 'bl', 'appdev'] })).totalHits, 2);
  });
});

describe('backlinks', () => {
  test('sorted by title then key, with limit, total and truncated; only resolved page links count', async () => {
    const files: Record<string, string> = { 'target.md': '# Target', 'dupe-a.md': '---\ntitle: Dupe\n---\n', 'dupe-b.md': '---\ntitle: Dupe\n---\n' };
    for (const [path, title] of [['z1.md', 'Zulu'], ['a1.md', 'Alpha'], ['m1.md', 'Mike'], ['m2.md', 'Mike']] as const) files[path] = `# ${title}\n\n[t](target.md)`;
    files['self.md'] = '# Self\n\n[me](self.md) [t](target.md)';
    files['ambiguous.md'] = '# Ambiguous\n\n[[Dupe]]';
    files['missing.md'] = '# Missing\n\n[x](nothing.md) [[Target Nope]]';
    files['external.md'] = '# External\n\n[e](https://example.invalid/target.md)';
    const t = memoryHost({ bl: files });
    must(await t.host.refresh());
    const all = must(await t.host.service.getBacklinks({ key: { namespace: 'bl', path: 'target.md' } }));
    assert.deepEqual(all.entries.map((e) => `${e.title}:${e.source.path}`), ['Alpha:a1.md', 'Mike:m1.md', 'Mike:m2.md', 'Self:self.md', 'Zulu:z1.md']);
    assert.deepEqual([all.total, all.truncated], [5, false]);
    const limited = must(await t.host.service.getBacklinks({ key: { namespace: 'bl', path: 'target.md' }, limit: 2 }));
    assert.deepEqual([limited.entries.length, limited.total, limited.truncated], [2, 5, true]);
    const none = must(await t.host.service.getBacklinks({ key: { namespace: 'bl', path: 'dupe-a.md' } }));
    assert.deepEqual(none.entries, [], 'an ambiguous link is not a backlink to either candidate');
    const selfOnly = must(await t.host.service.getBacklinks({ key: { namespace: 'bl', path: 'self.md' } }));
    assert.deepEqual(selfOnly.entries, [], 'a page does not back-link itself');
  });
});

describe('aliases', () => {
  test('alias resolution is normalised, namespace-scoped and preserves ambiguity (sorted, capped at 50)', async () => {
    const files: Record<string, string> = { 'one.md': '---\ntitle: One\naliases: ["  Uno  ", "ÉCOLE"]\n---\n', 'two.md': '---\ntitle: Two\naliases: [uno]\n---\n' };
    for (let i = 0; i < 60; i++) files[`many/m${String(i).padStart(2, '0')}.md`] = '---\naliases: [crowd]\n---\n';
    const t = memoryHost({ bl: files });
    must(await t.host.refresh());
    const s = t.host.service;
    assert.deepEqual(must(await s.resolveAlias({ namespace: 'bl', alias: 'ONE' })), { status: 'resolved', target: { namespace: 'bl', path: 'one.md' } });
    assert.deepEqual(must(await s.resolveAlias({ namespace: 'bl', alias: 'école' })), { status: 'resolved', target: { namespace: 'bl', path: 'one.md' } });
    assert.deepEqual(must(await s.resolveAlias({ namespace: 'bl', alias: ' uno ' })), {
      status: 'ambiguous',
      candidates: [
        { namespace: 'bl', path: 'one.md' },
        { namespace: 'bl', path: 'two.md' },
      ],
    });
    const crowd = must(await s.resolveAlias({ namespace: 'bl', alias: 'crowd' }));
    assert.equal(crowd.status, 'ambiguous');
    if (crowd.status === 'ambiguous') {
      assert.equal(crowd.candidates.length, 50);
      assert.equal(crowd.candidates[0]?.path, 'many/m00.md');
    }
    assert.deepEqual(must(await s.resolveAlias({ namespace: 'bl', alias: 'nobody' })), { status: 'missing' });
    assert.deepEqual(must(await s.resolveAlias({ namespace: 'bl', alias: 'notes/none.md' })), { status: 'missing' });
    assert.deepEqual(must(await s.resolveAlias({ namespace: 'bl', alias: 'one.md' })), { status: 'resolved', target: { namespace: 'bl', path: 'one.md' } }, 'an exact path also resolves');
  });
});

describe('topics', () => {
  test('field topics: deterministic ids without slashes, sorted previews, counts', async () => {
    const t = memoryHost({
      bl: {
        'a.md': '---\ntitle: Banana\ntags: [Fruit, "Tropical/Warm"]\n---\n',
        'b.md': '---\ntitle: Apple\ntags: [fruit]\n---\n',
        'c.md': '---\ntitle: Carrot\ntags: [Veg]\n---\n',
        'd.md': 'no frontmatter',
      },
    });
    must(await t.host.refresh());
    const list = must(await t.host.service.listTopics({ namespace: 'bl' }));
    assert.equal(validateTopicList(list).ok, true);
    assert.deepEqual(
      list.topics.map((topic) => [topic.id, topic.label, topic.parentId, topic.pageCount, topic.pages.map((k) => k.path)]),
      [
        ['f-fruit', 'Fruit', null, 2, ['b.md', 'a.md']],
        ['f-tropical-warm', 'Tropical/Warm', null, 1, ['a.md']],
        ['f-veg', 'Veg', null, 1, ['c.md']],
      ],
    );
    assert.deepEqual(must(await t.host.service.listTopics({ namespace: 'bl' })), list, 'stable across calls');
  });

  test('colliding slugs and unusable labels get a hash suffix; ids fit the limit', async () => {
    const long = 'x'.repeat(250);
    const t = memoryHost({ bl: { 'a.md': `---\ntags: ["C++", "C#", "!!!", "${long}", "東京"]\n---\n` } });
    must(await t.host.refresh());
    const list = must(await t.host.service.listTopics({ namespace: 'bl' }));
    const ids = list.topics.map((topic) => topic.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const id of ids) {
      assert.ok(!id.includes('/') && id.length <= MAX_TOPIC_ID_LENGTH && id.length > 0, id);
    }
    assert.ok(ids.filter((id) => id.includes('~')).length >= 3, 'C++, C# and !!! collide or are empty');
    assert.ok(ids.includes('f-東京'));
    const other = memoryHost({ bl: { 'a.md': `---\ntags: ["C++", "C#", "!!!", "${long}", "東京"]\n---\n` } });
    must(await other.host.refresh());
    assert.deepEqual(must(await other.host.service.listTopics({ namespace: 'bl' })), list, 'ids are deterministic');
  });

  test('at most 500 topics and 50-page previews', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < MAX_TOPICS + 100; i++) files[`t${i}.md`] = `---\ntags: [topic ${String(i).padStart(4, '0')}, shared]\n---\n`;
    const t = memoryHost({ bl: files });
    must(await t.host.refresh());
    const list = must(await t.host.service.listTopics({ namespace: 'bl' }));
    assert.equal(list.topics.length, MAX_TOPICS);
    const shared = list.topics.find((topic) => topic.label === 'shared');
    assert.equal(shared?.pageCount, MAX_TOPICS + 100);
    assert.equal(shared?.pages.length, MAX_RESULTS);
    assert.equal(validateTopicList(list).ok, true);
  });

  test('directory mode builds a hierarchy; none mode lists nothing', async () => {
    const files = { 'top.md': '# T', 'guides/intro.md': '# I', 'guides/deep/more.md': '# M', 'guides/deep/er/leaf.md': '# L', 'ref/x.md': '# X' };
    const dir = memoryHost({ bl: files }, { bl: { topicMode: 'directory' } });
    must(await dir.host.refresh());
    const list = must(await dir.host.service.listTopics({ namespace: 'bl' }));
    assert.equal(validateTopicList(list).ok, true);
    const byLabel = Object.fromEntries(list.topics.map((topic) => [topic.label, topic]));
    assert.deepEqual(Object.keys(byLabel).sort(), ['deep', 'er', 'guides', 'ref']);
    assert.equal(byLabel['guides']?.parentId, null);
    assert.equal(byLabel['deep']?.parentId, byLabel['guides']?.id);
    assert.equal(byLabel['er']?.parentId, byLabel['deep']?.id);
    assert.deepEqual(byLabel['guides']?.pages.map((k) => k.path), ['guides/intro.md']);
    assert.equal(byLabel['guides']?.pageCount, 1);

    const none = memoryHost({ bl: files }, { bl: { topicMode: 'none' } });
    must(await none.host.refresh());
    assert.deepEqual(must(await none.host.service.listTopics({ namespace: 'bl' })).topics, []);
  });
});

describe('snapshots', () => {
  const files = {
    'a.md': '---\ntitle: Alpha\ntags: [x]\nrelated: [Beta]\nnothing:\n---\n# Alpha\n\nhello [b](b.md)',
    'b.md': '# Beta\n\nworld [[Alpha]]',
    'raw.md': '---\ndup: 1\ndup: 2\n---\nraw [a](a.md)',
    'bin.md': new Uint8Array([0x61, 0xff, 0x00]),
  };

  async function built() {
    const t = memoryHost({ bl: files });
    must(await t.host.refresh());
    const key = `bl/${commitOf('bl')}`;
    return { t, key, text: t.store.entries.get(key) as string };
  }

  test('stats are aggregate counters only', async () => {
    const { text } = await built();
    const snapshot = JSON.parse(text) as IndexSnapshot;
    assert.deepEqual(Object.keys(snapshot.stats).sort(), [
      'nullOmissions',
      'outLinkCaps',
      'pages',
      'rawFrontmatter',
      'rawMarkdown',
      'rawNotText',
      'skippedInvalidPaths',
      'skippedOther',
      'skippedOversize',
      'skippedSubmodules',
      'skippedSymlinks',
    ]);
    assert.deepEqual(snapshot.stats, {
      pages: 4,
      rawFrontmatter: 1,
      rawMarkdown: 0,
      rawNotText: 1,
      nullOmissions: 1,
      skippedSymlinks: 0,
      skippedSubmodules: 0,
      skippedOther: 0,
      skippedInvalidPaths: 0,
      skippedOversize: 0,
      outLinkCaps: 0,
    });
    assert.ok(Object.values(snapshot.stats).every((v) => Number.isInteger(v)));
  });

  test('a stored snapshot is reloaded without listing or reading the source, with identical answers', async () => {
    const first = await built();
    const reload = memorySource({ files, commit: commitOf('bl') });
    const host = createWikiHost({ profiles: [profileFor('bl')], sources: { bl: reload }, store: first.t.store, clock });
    must(await host.refresh());
    assert.equal(reload.listings.length, 0, 'no tree listing');
    assert.equal(reload.blobReads.length, 0, 'no blob reads');
    for (const query of ['alpha', 'world', 'hello', 'beta']) {
      assert.deepEqual(must(await host.service.search({ query })), must(await first.t.host.service.search({ query })));
    }
    assert.deepEqual(must(await host.service.listTopics({ namespace: 'bl' })), must(await first.t.host.service.listTopics({ namespace: 'bl' })));
    assert.deepEqual(
      must(await host.service.getBacklinks({ key: { namespace: 'bl', path: 'a.md' } })),
      must(await first.t.host.service.getBacklinks({ key: { namespace: 'bl', path: 'a.md' } })),
    );
    assert.deepEqual(must(await host.service.listSources()), must(await first.t.host.service.listSources()));
  });

  test('corrupt, mismatched or stale snapshots are rebuilt, not trusted', async () => {
    const first = await built();
    const good = JSON.parse(first.text) as Record<string, unknown>;
    const mutations: Record<string, (s: Record<string, any>) => string> = {
      'not json': () => '{not json',
      'wrong namespace': (s) => JSON.stringify({ ...s, namespace: 'appdev' }),
      'other commit inside': (s) => JSON.stringify({ ...s, commit: commitOf('other') }),
      'other profile': (s) => JSON.stringify({ ...s, profileKey: '0000000000000000' }),
      'unknown schema': (s) => JSON.stringify({ ...s, schema: 'hq.wiki.index/v0' }),
      'extra key': (s) => JSON.stringify({ ...s, extra: 1 }),
      'page count mismatch': (s) => JSON.stringify({ ...s, stats: { ...s['stats'], pages: 99 } }),
      'control char in title': (s) => JSON.stringify({ ...s, pages: s['pages'].map((p: any, i: number) => (i === 0 ? { ...p, title: 'bad\u0001' } : p)) }),
      'traversal path': (s) => JSON.stringify({ ...s, pages: s['pages'].map((p: any, i: number) => (i === 0 ? { ...p, path: '../escape.md' } : p)) }),
      'unsorted pages': (s) => JSON.stringify({ ...s, pages: [...s['pages']].reverse() }),
      'foreign link target': (s) =>
        JSON.stringify({ ...s, pages: s['pages'].map((p: any, i: number) => (i === 0 ? { ...p, links: [{ kind: 'page', key: { namespace: 'appdev', path: 'x.md' } }] } : p)) }),
      'unsafe link target': (s) =>
        JSON.stringify({ ...s, pages: s['pages'].map((p: any, i: number) => (i === 0 ? { ...p, links: [{ kind: 'external', url: 'javascript:alert(1)' }] } : p)) }),
      'bad term': (s) => JSON.stringify({ ...s, pages: s['pages'].map((p: any, i: number) => (i === 0 ? { ...p, terms: [['x', -1, 0]] } : p)) }),
    };
    for (const [name, mutate] of Object.entries(mutations)) {
      const store = createMemoryIndexStore();
      store.entries.set(first.key, mutate(good as Record<string, any>));
      const source = memorySource({ files, commit: commitOf('bl') });
      const host = createWikiHost({ profiles: [profileFor('bl')], sources: { bl: source }, store, clock });
      const status = must(await host.refresh());
      assert.equal(status.namespaces[0]?.state, 'ready', name);
      assert.equal(source.listings.length, 1, `${name}: rebuilt from the source`);
      assert.equal(store.entries.get(first.key), first.text, `${name}: the store holds the rebuilt, valid snapshot`);
    }
  });

  test('a profile change rebuilds; a store that throws neither blocks nor fails the index', async () => {
    const first = await built();
    const source = memorySource({ files, commit: commitOf('bl') });
    const changed = createWikiHost({ profiles: [profileFor('bl', { fieldMappings: { title: 'name' } })], sources: { bl: source }, store: first.t.store, clock });
    must(await changed.refresh());
    assert.equal(source.listings.length, 1);

    const broken = {
      read: () => Promise.reject(new Error('disk gone')),
      write: () => Promise.reject(new Error('disk full')),
    };
    const source2 = memorySource({ files, commit: commitOf('bl') });
    const host = createWikiHost({ profiles: [profileFor('bl')], sources: { bl: source2 }, store: broken, clock });
    assert.equal(must(await host.refresh()).namespaces[0]?.state, 'ready');
    assert.equal(must(await host.service.search({ query: 'alpha' })).totalHits > 0, true);
  });

  test('parseSnapshot accepts exactly what the builder wrote', async () => {
    const { text } = await built();
    const profile = validateSourceProfile(profileFor('bl'));
    assert.ok(profile.ok);
    if (!profile.ok) return;
    const expected = { namespace: 'bl' as const, commit: commitOf('bl'), profileKey: profileIndexKey(profile.value) };
    assert.notEqual(parseSnapshot(JSON.parse(text), expected), null);
    assert.equal(parseSnapshot(JSON.parse(text), { ...expected, commit: commitOf('x') }), null);
    assert.equal(parseSnapshot(null, expected), null);
    assert.equal(parseSnapshot([], expected), null);
    assert.equal(parseSnapshot('text', expected), null);
  });
});

describe('structural bounds', () => {
  test('the node cap constant is the contract one (no second cap defined here)', () => {
    assert.equal(MAX_AST_NODES, 200_000);
  });
});
