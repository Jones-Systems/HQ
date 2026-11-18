// The Wiki host and its WikiService: closed surface, validation, errors, freshness, namespaces.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  MAX_PAGE_BLOB_BYTES,
  MAX_QUERY_LENGTH,
  MAX_RESULTS,
  WIKI_SERVICE_METHODS,
  validateIndexStatus,
  validateSourceDescriptor,
  type WikiResult,
} from '../../contract/src/index.ts';
import { createMemoryIndexStore, createWikiHost, type GitObjectSource } from '../src/index.ts';
import { clock, commitOf, memoryHost, memorySource, must, profileFor } from './support.ts';

function errorOf(result: WikiResult<unknown>) {
  assert.equal(result.ok, false, 'expected an error result');
  if (result.ok) throw new Error('unreachable');
  return result.error;
}

describe('closed service surface', () => {
  test('exposes exactly the seven read methods; refresh lives only on the host', () => {
    const t = memoryHost({ bl: { 'a.md': '# A' } });
    assert.deepEqual(Object.keys(t.host.service).sort(), [...WIKI_SERVICE_METHODS].sort());
    assert.equal(Object.keys(t.host).sort().join(), 'refresh,service');
    assert.equal('refresh' in t.host.service, false);
  });

  test('before the first refresh nothing is indexed: no index, no sources, status unavailable', async () => {
    const t = memoryHost({ bl: { 'a.md': '# A' }, appdev: { 'b.md': '# B' } });
    const s = t.host.service;
    assert.deepEqual(must(await s.listSources()), []);
    for (const result of [
      await s.search({ query: 'a' }),
      await s.getPage({ key: { namespace: 'bl', path: 'a.md' } }),
      await s.resolveAlias({ namespace: 'bl', alias: 'a' }),
      await s.getBacklinks({ key: { namespace: 'bl', path: 'a.md' } }),
      await s.listTopics({ namespace: 'bl' }),
    ]) {
      const error = errorOf(result);
      assert.deepEqual([error.code, error.reason], ['unavailable', 'index-unavailable']);
    }
    const status = must(await s.indexStatus());
    assert.deepEqual(
      status.namespaces.map((n) => [n.namespace, n.state, n.pageCount, n.source]),
      [['bl', 'unavailable', 0, null], ['appdev', 'unavailable', 0, null]],
    );
    assert.equal(t.sources.bl?.listings.length, 0, 'the service never touches the source before refresh');
  });

  test('a read never triggers a refresh or a listing', async () => {
    const t = memoryHost({ bl: { 'a.md': '# A', 'b.md': '[a](a.md)' } });
    must(await t.host.refresh());
    const pins = t.sources.bl?.pinCalls;
    const listings = t.sources.bl?.listings.length;
    await t.host.service.search({ query: 'a' });
    await t.host.service.getBacklinks({ key: { namespace: 'bl', path: 'a.md' } });
    await t.host.service.listTopics({ namespace: 'bl' });
    await t.host.service.getPage({ key: { namespace: 'bl', path: 'a.md' } });
    assert.equal(t.sources.bl?.pinCalls, pins);
    assert.equal(t.sources.bl?.listings.length, listings);
  });
});

describe('request validation (the renderer supplies logical keys only)', () => {
  const ready = async () => {
    const t = memoryHost({ bl: { 'a.md': '# A' } });
    must(await t.host.refresh());
    return t.host.service;
  };

  test('traversal, absolute, NUL, scheme-like and over-long paths are rejected before any lookup', async () => {
    const s = await ready();
    for (const path of ['../a.md', 'a/../b.md', '/etc/passwd', 'a\u0000.md', 'a\\b.md', 'C:\\x', 'javascript:alert(1)', '', 'a//b.md', 'x'.repeat(1025)]) {
      const error = errorOf(await s.getPage({ key: { namespace: 'bl', path } }));
      assert.equal(error.code, 'invalid-input', JSON.stringify(path));
    }
  });

  test('requests that try to supply a root, ref, url or argv get forbidden-capability', async () => {
    const s = await ready();
    for (const extra of [{ root: '/x' }, { ref: 'main' }, { url: 'https://a.invalid' }, { argv: ['x'] }, { gitDir: '/x' }, { cwd: '/' }]) {
      const error = errorOf(await s.getPage({ key: { namespace: 'bl', path: 'a.md' }, ...extra } as never));
      assert.equal(error.reason, 'forbidden-capability');
    }
    assert.equal(errorOf(await s.search({ query: 'a', commit: 'abc' } as never)).reason, 'forbidden-capability');
  });

  test('queries count code points: 256 emoji pass, 257 fail; results are capped at 50', async () => {
    const s = await ready();
    assert.equal((await s.search({ query: '😀'.repeat(MAX_QUERY_LENGTH) })).ok, true);
    assert.equal(errorOf(await s.search({ query: '😀'.repeat(MAX_QUERY_LENGTH + 1) })).reason, 'too-long');
    assert.equal(errorOf(await s.search({ query: '' })).reason, 'empty');
    assert.equal(errorOf(await s.search({ query: 'a', limit: MAX_RESULTS + 1 })).reason, 'out-of-range');
    assert.equal(errorOf(await s.search({ query: 'a\u0000' })).reason, 'nul');
    assert.equal(errorOf(await s.search({ query: 'a', namespaces: ['nope'] } as never)).reason, 'unknown-namespace');
  });

  test('not-found is a service error, not an invalid input', async () => {
    const s = await ready();
    const error = errorOf(await s.getPage({ key: { namespace: 'bl', path: 'missing.md' } }));
    assert.deepEqual([error.code, error.reason], ['not-found', 'not-found']);
    const back = errorOf(await s.getBacklinks({ key: { namespace: 'bl', path: 'missing.md' } }));
    assert.deepEqual([back.code, back.reason], ['not-found', 'not-found']);
  });

  test('a namespace without a configured source is index-unavailable', async () => {
    const s = await ready();
    const error = errorOf(await s.getPage({ key: { namespace: 'appdev', path: 'a.md' } }));
    assert.deepEqual([error.code, error.reason], ['unavailable', 'index-unavailable']);
  });
});

describe('namespaces never merge', () => {
  const files = {
    bl: { 'shared/topic.md': '---\ntitle: Same Title\ntags: [common]\n---\n# Same Title\n\nbl-only content about pineapples [[Same Title]]', 'bl-only.md': '# BL only' },
    appdev: { 'shared/topic.md': '---\ntitle: Same Title\ntags: [common]\n---\n# Same Title\n\nappdev content about pineapples [[Same Title]]', 'dev-only.md': '# Dev only [x](shared/topic.md)' },
  } as const;

  test('same path and title in both namespaces stay distinct in search, links, aliases, backlinks and topics', async () => {
    const t = memoryHost(files);
    must(await t.host.refresh());
    const s = t.host.service;

    const hits = must(await s.search({ query: 'pineapples' }));
    assert.deepEqual(hits.hits.map((h) => `${h.key.namespace}/${h.key.path}`).sort(), ['appdev/shared/topic.md', 'bl/shared/topic.md']);
    const onlyBl = must(await s.search({ query: 'pineapples', namespaces: ['bl'] }));
    assert.deepEqual(onlyBl.hits.map((h) => h.key.namespace), ['bl']);

    assert.deepEqual(must(await s.resolveAlias({ namespace: 'bl', alias: 'same title' })), { status: 'resolved', target: { namespace: 'bl', path: 'shared/topic.md' } });
    assert.deepEqual(must(await s.resolveAlias({ namespace: 'appdev', alias: 'same title' })), { status: 'resolved', target: { namespace: 'appdev', path: 'shared/topic.md' } });
    assert.deepEqual(must(await s.resolveAlias({ namespace: 'bl', alias: 'dev only' })), { status: 'missing' });

    const bl = must(await s.getPage({ key: { namespace: 'bl', path: 'shared/topic.md' } }));
    assert.deepEqual(bl.outLinks.map((l) => (l.target.kind === 'page' ? l.target.key.namespace : '?')), ['bl']);

    const back = must(await s.getBacklinks({ key: { namespace: 'appdev', path: 'shared/topic.md' } }));
    assert.deepEqual(back.entries.map((e) => `${e.source.namespace}/${e.source.path}`), ['appdev/dev-only.md']);
    const blBack = must(await s.getBacklinks({ key: { namespace: 'bl', path: 'shared/topic.md' } }));
    assert.deepEqual(blBack.entries, [], 'self-links are not backlinks and nothing else links here in bl');

    const topics = must(await s.listTopics({ namespace: 'bl' }));
    assert.ok(topics.topics.every((topic) => topic.pages.every((k) => k.namespace === 'bl')));
  });
});

describe('index status and source descriptors', () => {
  test('a refreshed namespace is ready with current graph and unknown (null) content freshness', async () => {
    const t = memoryHost({ bl: { 'a.md': '# A', 'b.md': '# B' } });
    const refreshed = must(await t.host.refresh());
    const entry = refreshed.namespaces[0];
    assert.equal(entry?.state, 'ready');
    assert.equal(entry?.pageCount, 2);
    const source = must(await t.host.service.listSources())[0];
    assert.equal(validateSourceDescriptor(source).ok, true);
    assert.deepEqual(source, {
      schema: 'hq.wiki.source/v1',
      namespace: 'bl',
      ref: 'main',
      commit: commitOf('bl'),
      commitTime: '2026-01-02T03:04:05Z',
      indexedAt: '2026-01-03T04:05:06.250Z',
      freshness: { graph: { state: 'current', indexedCommit: commitOf('bl') }, content: { state: 'unknown', checkedAt: null } },
    });
    assert.equal(validateIndexStatus(refreshed).ok, true);
  });

  test('refresh(namespace) refreshes only that namespace', async () => {
    const t = memoryHost({ bl: { 'a.md': '# A' }, appdev: { 'b.md': '# B' } });
    const status = must(await t.host.refresh('appdev'));
    assert.deepEqual(status.namespaces.map((n) => [n.namespace, n.state]), [['bl', 'unavailable'], ['appdev', 'ready']]);
    assert.equal(errorOf(await t.host.refresh('nope' as never)).code, 'invalid-input');
  });

  test('a source that fails its binding leaves the namespace unavailable with no descriptor', async () => {
    const t = memoryHost({ bl: { 'a.md': '# A' } });
    t.sources.bl!.down = true;
    const status = must(await t.host.refresh());
    assert.deepEqual([status.namespaces[0]?.state, status.namespaces[0]?.source], ['unavailable', null]);
    assert.deepEqual(must(await t.host.service.listSources()), []);
  });

  test('a later commit re-indexes; a vanished source keeps serving the old index as stale', async () => {
    const t = memoryHost({ bl: { 'a.md': '# Alpha' } });
    must(await t.host.refresh());
    const first = must(await t.host.service.listSources())[0];
    t.sources.bl!.replace({ 'a.md': '# Alpha', 'b.md': '# Beta' }, commitOf('two'));
    const second = must(await t.host.refresh());
    assert.equal(second.namespaces[0]?.pageCount, 2);
    assert.notEqual(must(await t.host.service.listSources())[0]?.commit, first?.commit);

    t.sources.bl!.down = true;
    const stale = must(await t.host.refresh());
    const entry = stale.namespaces[0];
    assert.equal(entry?.state, 'stale');
    assert.deepEqual(entry?.source?.freshness.graph, { state: 'stale', indexedCommit: commitOf('two') });
    assert.equal(validateIndexStatus(stale).ok, true);
    assert.equal(must(await t.host.service.search({ query: 'beta' })).hits.length, 1, 'search still answers from the last good index');
    const page = errorOf(await t.host.service.getPage({ key: { namespace: 'bl', path: 'a.md' } }));
    assert.deepEqual([page.code, page.reason], ['unavailable', 'source-unavailable']);

    t.sources.bl!.down = false;
    assert.equal(must(await t.host.refresh()).namespaces[0]?.state, 'ready');
  });

  test('while a refresh runs the status is building with an indexing graph; concurrent refreshes coalesce', async () => {
    const inner = memorySource({ files: { 'a.md': '# A' }, commit: commitOf('gate') });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let listings = 0;
    const gated: GitObjectSource = {
      resolvePin: () => inner.resolvePin(),
      listTree: async (commit) => {
        listings++;
        await gate;
        return inner.listTree(commit);
      },
      readBlob: (oid, max) => inner.readBlob(oid, max),
    };
    const host = createWikiHost({ profiles: [profileFor('bl')], sources: { bl: gated }, store: createMemoryIndexStore(), clock });
    const first = host.refresh();
    const second = host.refresh();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const building = must(await host.service.indexStatus()).namespaces[0];
    assert.equal(building?.state, 'building');
    assert.deepEqual(building?.source?.freshness.graph, { state: 'indexing', indexedCommit: null });
    assert.equal(building?.source?.indexedAt, null);
    release();
    await Promise.all([first, second]);
    assert.equal(listings, 1, 'the second refresh joined the first');
    assert.equal(must(await host.service.indexStatus()).namespaces[0]?.state, 'ready');
  });

  test('unchanged commits are not re-indexed', async () => {
    const t = memoryHost({ bl: { 'a.md': '# A' } });
    must(await t.host.refresh());
    must(await t.host.refresh());
    assert.equal(t.sources.bl?.listings.length, 1);
  });
});

describe('caps and error mapping', () => {
  test('an oversized blob is not indexed, is counted, and getPage is not-found', async () => {
    const big = Buffer.alloc(MAX_PAGE_BLOB_BYTES + 1, 0x61);
    const exact = Buffer.alloc(MAX_PAGE_BLOB_BYTES, 0x62);
    const t = memoryHost({ bl: { 'big.md': big, 'exact.md': exact, 'small.md': '# small' } });
    must(await t.host.refresh());
    assert.equal(errorOf(await t.host.service.getPage({ key: { namespace: 'bl', path: 'big.md' } })).reason, 'not-found');
    assert.equal(must(await t.host.service.getPage({ key: { namespace: 'bl', path: 'exact.md' } })).byteLength, MAX_PAGE_BLOB_BYTES);
    assert.equal(must(await t.host.service.indexStatus()).namespaces[0]?.pageCount, 2);
    const snapshot = JSON.parse([...t.store.entries.values()][0] as string) as { stats: { skippedOversize: number } };
    assert.equal(snapshot.stats.skippedOversize, 1);
    assert.ok(!t.sources.bl?.blobReads.some((oid) => oid.length === 0), 'no blob read was attempted for the oversized entry');
  });

  test('symlinks, submodules and unusual modes are skipped and counted, never read', async () => {
    const t = memoryHost({
      bl: {
        'real.md': '# real',
        'link.md': { content: 'real.md', mode: '120000' },
        'sub.md': { content: '', mode: '160000' },
        'weird.md': { content: 'x', mode: '100664' },
        'exec.md': { content: '# exec', mode: '100755' },
      },
    });
    must(await t.host.refresh());
    const status = must(await t.host.service.indexStatus());
    assert.equal(status.namespaces[0]?.pageCount, 2);
    for (const path of ['link.md', 'sub.md', 'weird.md']) assert.equal(errorOf(await t.host.service.getPage({ key: { namespace: 'bl', path } })).reason, 'not-found');
    const snapshot = JSON.parse([...t.store.entries.values()][0] as string) as { stats: Record<string, number> };
    assert.deepEqual([snapshot.stats['skippedSymlinks'], snapshot.stats['skippedSubmodules'], snapshot.stats['skippedOther']], [1, 1, 1]);
  });

  test('non-page files and invalid page paths never become pages', async () => {
    const t = memoryHost({ bl: { 'a.md': '# A', 'image.png': 'png', 'notes.txt': 'txt', '.md': 'dotfile', 'dir/.hidden.md': 'h', 'a/./b.md': 'dot', 'bad\u0001name.md': 'ctl' } });
    must(await t.host.refresh());
    const snapshot = JSON.parse([...t.store.entries.values()][0] as string) as { stats: Record<string, number>; pages: { path: string }[] };
    assert.deepEqual(snapshot.pages.map((p) => p.path), ['a.md', 'dir/.hidden.md']);
    assert.equal(snapshot.stats['skippedInvalidPaths'], 2);
  });

  test('a throwing source is contained as an internal error and never leaks its message', async () => {
    const real = memorySource({ files: { 'a.md': '# A' }, commit: commitOf('throws') });
    let explode = false;
    const source: GitObjectSource = {
      resolvePin: () => real.resolvePin(),
      listTree: (commit) => real.listTree(commit),
      readBlob: (oid, max) => {
        if (explode) throw new Error('/secret/host/path leaked');
        return real.readBlob(oid, max);
      },
    };
    const host = createWikiHost({ profiles: [profileFor('bl')], sources: { bl: source }, store: createMemoryIndexStore(), clock });
    must(await host.refresh());
    explode = true;
    const error = errorOf(await host.service.getPage({ key: { namespace: 'bl', path: 'a.md' } }));
    assert.deepEqual([error.code, error.reason], ['internal', 'internal']);
    assert.doesNotMatch(JSON.stringify(error), /secret/);
  });

  test('a build that loses its source midway publishes nothing', async () => {
    const real = memorySource({ files: { 'a.md': '# A', 'b.md': '# B', 'c.md': '# C' }, commit: commitOf('midway') });
    let reads = 0;
    const source: GitObjectSource = {
      resolvePin: () => real.resolvePin(),
      listTree: (commit) => real.listTree(commit),
      readBlob: (oid, max) => (++reads > 1 ? Promise.resolve({ ok: false, reason: 'unavailable' }) : real.readBlob(oid, max)),
    };
    const store = createMemoryIndexStore();
    const host = createWikiHost({ profiles: [profileFor('bl')], sources: { bl: source }, store, clock });
    const status = must(await host.refresh());
    assert.equal(status.namespaces[0]?.state, 'unavailable');
    assert.equal(store.entries.size, 0, 'no partial snapshot is stored');
  });
});
