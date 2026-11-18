// End to end without a DOM: the synthetic committed-Git corpus is indexed by the real core through the real Git
// object adapter, then read only through the module's renderer client over a structured-clone bridge.
// Synthetic content only; no private corpus is read.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  validateGetBacklinksRequest,
  validateGetPageRequest,
  validateListTopicsRequest,
  validateResolveAliasRequest,
  validateSearchRequest,
  WIKI_SERVICE_METHODS,
  type Page,
  type WikiResult,
} from '../../contract/src/index.ts';
import { advanceMain, buildCorpus, mainOf } from './corpus.ts';
import { assemble, type Assembly } from './harness.ts';
import { createScratch } from './scratch.ts';

function must<T>(result: WikiResult<T>): T {
  if (!result.ok) assert.fail(`expected ok, got ${result.error.code}/${result.error.reason}: ${result.error.message}`);
  return result.value;
}

function fingerprint(root: string): string {
  const lines: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      const path = rel === '' ? entry : `${rel}/${entry}`;
      if (statSync(full).isDirectory()) {
        lines.push(`d ${path}`);
        walk(full, path);
      } else lines.push(`f ${path} ${statSync(full).size} ${createHash('sha256').update(readFileSync(full)).digest('hex')}`);
    }
  };
  walk(root, '');
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

let a: Assembly;
before(async () => {
  a = await assemble('assembly');
});
after(() => {
  a?.cleanup();
  assert.throws(() => statSync(a.corpus.repos.bl.gitDir), 'the synthetic repositories are removed');
  assert.throws(() => statSync(a.corpus.repos.appdev.gitDir));
});

const key = (namespace: 'bl' | 'appdev', path: string) => ({ namespace, path }) as const;

describe('the committed corpus', () => {
  test('the host pins exactly the commits Git reports, and the graph is current for them', async () => {
    const sources = must(await a.client.listSources());
    assert.deepEqual(sources.map((s) => s.namespace), ['bl', 'appdev']);
    for (const source of sources) {
      const gitDir = a.corpus.repos[source.namespace].gitDir;
      assert.equal(source.commit, mainOf(gitDir), 'independent git rev-parse agrees');
      assert.equal(source.commit, a.corpus.repos[source.namespace].commit);
      assert.equal(source.ref, 'main');
      assert.deepEqual(source.freshness, {
        graph: { state: 'current', indexedCommit: source.commit },
        content: { state: 'unknown', checkedAt: null },
      });
    }
  });

  test('the fixture is reproducible: a second build has identical commit ids', () => {
    const scratch = createScratch('repro');
    try {
      const again = buildCorpus(scratch.root);
      assert.equal(again.repos.bl.commit, a.corpus.repos.bl.commit);
      assert.equal(again.repos.appdev.commit, a.corpus.repos.appdev.commit);
    } finally {
      scratch.cleanup();
    }
  });

  test('only regular pages beneath the root prefix are indexed', async () => {
    const status = must(await a.client.indexStatus());
    assert.deepEqual(status.namespaces.map((n) => [n.namespace, n.state, n.pageCount]), [['bl', 'ready', 9], ['appdev', 'ready', 4]]);
    for (const absent of [
      key('bl', 'link-to-index.md'), // symlink entry: never followed
      key('bl', 'assets/diagram.bin'), // not a page
      key('bl', 'vendor/submodule'), // submodule-style link
      key('appdev', 'outside/readme.md'), // outside rootPrefix
      key('appdev', 'notes/index.md'), // keys are relative to the prefix
    ]) {
      const result = await a.client.getPage({ key: absent });
      assert.ok(!result.ok && result.error.code === 'not-found', `${absent.namespace}:${absent.path}`);
    }
  });
});

describe('the seven read methods over the bridge', () => {
  test('search finds a term across both repositories and keeps them separate', async () => {
    const result = must(await a.client.search({ query: 'quokkaharbor' }));
    assert.equal(result.totalHits, 2);
    assert.deepEqual(result.hits.map((h) => `${h.key.namespace}:${h.key.path}`).sort(), ['appdev:architecture/overview.md', 'bl:policies/retry-policy.md']);
    const filtered = must(await a.client.search({ query: 'quokkaharbor', namespaces: ['appdev'] }));
    assert.deepEqual(filtered.hits.map((h) => h.key.namespace), ['appdev']);
  });

  test('the same title in two repositories stays two pages', async () => {
    const result = must(await a.client.search({ query: 'Shared Title' }));
    const shared = result.hits.filter((h) => h.title === 'Shared Title');
    assert.deepEqual(shared.map((h) => h.key.namespace).sort(), ['appdev', 'bl']);
    const bl = must(await a.client.getPage({ key: key('bl', 'shared-title.md') }));
    const appdev = must(await a.client.getPage({ key: key('appdev', 'shared-title.md') }));
    assert.notEqual(bl.commit, appdev.commit);
    assert.notDeepEqual(bl.key, appdev.key);
  });

  test('aliases resolve inside their namespace only, and ambiguity lists candidates', async () => {
    assert.deepEqual(must(await a.client.resolveAlias({ namespace: 'bl', alias: 'getting started' })), { status: 'resolved', target: key('bl', 'guides/onboarding.md') });
    assert.deepEqual(must(await a.client.resolveAlias({ namespace: 'appdev', alias: 'Getting Started' })), { status: 'missing' });
    assert.deepEqual(must(await a.client.resolveAlias({ namespace: 'bl', alias: 'Duplicate Alias' })), {
      status: 'ambiguous',
      candidates: [key('bl', 'ambiguous-a.md'), key('bl', 'ambiguous-b.md')],
    });
  });

  test('a parsed page carries provenance, ordinary fields and resolved out-links', async () => {
    const page = must(await a.client.getPage({ key: key('bl', 'guides/onboarding.md') }));
    assert.equal(page.title, 'Onboarding Guide');
    assert.equal(page.commit, a.corpus.repos.bl.commit);
    assert.deepEqual(page.fields.map((f) => f.name), ['title', 'aliases', 'tags', 'related']);
    assert.deepEqual(page.outLinks.map((l) => l.text), ['Retry Policy', 'home page', 'Shared Title']);
    assert.ok(page.outLinks.every((l) => l.target.kind === 'page'));
    assert.equal(page.content.state, 'parsed');
  });

  test('a page the core cannot parse is returned verbatim as raw text with its reason', async () => {
    const page = must(await a.client.getPage({ key: key('bl', 'raw-frontmatter.md') }));
    assert.equal(page.content.state, 'raw');
    if (page.content.state === 'raw') {
      assert.equal(page.content.reason, 'frontmatter-unsupported');
      assert.equal(page.content.text, readFileSync(join(import.meta.dirname, '..', 'fixtures', 'corpus', 'bl', 'raw-frontmatter.md'), 'utf8'));
    }
  });

  test('hostile Markdown arrives as inert text, and an escaping link is missing, not followed', async () => {
    const page = must(await a.client.getPage({ key: key('bl', 'hostile/inert.md') }));
    const json = JSON.stringify(page.content);
    assert.ok(json.includes('<script>window.__wikiPwned = true</script>'), 'script-looking text kept as text');
    assert.ok(json.includes('[run it](javascript:window.__wikiPwned=true)'), 'unsafe-scheme link kept as text');
    assert.ok(json.includes('![tracking pixel](https://example.invalid/pixel.png)'), 'image kept as text');
    assert.deepEqual(page.outLinks.map((l) => l.target.kind), ['missing']);
    assert.ok(!/"type":"(?:image|html)"/.test(json));
  });

  test('backlinks come from real page links', async () => {
    const back = must(await a.client.getBacklinks({ key: key('bl', 'policies/retry-policy.md') }));
    assert.equal(back.total, 2);
    assert.deepEqual(back.entries.map((e) => e.source.path).sort(), ['guides/onboarding.md', 'index.md']);
    // Both repositories link to a page titled "Shared Title"; each link resolves inside its own repository.
    const blShared = must(await a.client.getBacklinks({ key: key('bl', 'shared-title.md') }));
    assert.deepEqual(blShared.entries.map((e) => `${e.source.namespace}:${e.source.path}`), ['bl:guides/onboarding.md']);
    const appdevShared = must(await a.client.getBacklinks({ key: key('appdev', 'shared-title.md') }));
    assert.deepEqual(appdevShared.entries.map((e) => `${e.source.namespace}:${e.source.path}`), ['appdev:index.md']);
  });

  test('a cross-namespace wiki link stays unresolved', async () => {
    const page = must(await a.client.getPage({ key: key('appdev', 'index.md') }));
    const retry = page.outLinks.find((l) => l.text === 'Retry Policy');
    assert.equal(retry?.target.kind, 'missing');
  });

  test('topics follow each repository\'s mode', async () => {
    const bl = must(await a.client.listTopics({ namespace: 'bl' }));
    assert.deepEqual(bl.topics.map((t) => t.id).slice(0, 3), ['f-ambiguity', 'f-guides', 'f-home']);
    const appdev = must(await a.client.listTopics({ namespace: 'appdev' }));
    assert.deepEqual(appdev.topics.map((t) => [t.id, t.pageCount]), [['d-architecture', 2]]);
  });

  test('a path with spaces, non-ASCII letters and an ampersand is addressable by its logical key', async () => {
    const page = must(await a.client.getPage({ key: key('bl', 'notes/Ünï café & spaces.md') }));
    assert.equal(page.title, 'Spaced Unicode Page');
  });
});

describe('the bridge boundary', () => {
  test('the bridge has exactly the seven methods; host-only refresh is not on it', () => {
    assert.deepEqual(Object.keys(a.bridge.port), [...WIKI_SERVICE_METHODS]);
    assert.equal('refresh' in a.bridge.port, false);
  });

  test('every request that crossed the bridge is a valid contract request, and nothing else was sent', async () => {
    a.bridge.calls.length = 0;
    await a.client.listSources();
    await a.client.indexStatus();
    await a.client.search({ query: 'retry', limit: 5 });
    await a.client.getPage({ key: key('bl', 'index.md') });
    await a.client.resolveAlias({ namespace: 'bl', alias: 'Backoff' });
    await a.client.getBacklinks({ key: key('bl', 'index.md'), limit: 3 });
    await a.client.listTopics({ namespace: 'bl' });
    await a.client.getPage({ key: { namespace: 'bl', path: '../escape' }, root: '/' } as never);
    assert.deepEqual(
      a.bridge.calls.map((c) => c.method),
      ['listSources', 'indexStatus', 'search', 'getPage', 'resolveAlias', 'getBacklinks', 'listTopics'],
      'one call per method; the forbidden request never crossed',
    );
    const validators: Record<string, (v: unknown) => WikiResult<unknown>> = {
      search: validateSearchRequest,
      getPage: validateGetPageRequest,
      resolveAlias: validateResolveAliasRequest,
      getBacklinks: validateGetBacklinksRequest,
      listTopics: validateListTopicsRequest,
    };
    for (const sent of a.bridge.calls) {
      const validate = validators[sent.method];
      if (validate === undefined) assert.deepEqual(sent.args, [], `${sent.method} takes no argument`);
      else assert.equal(validate(sent.args[0]).ok, true, sent.method);
    }
  });

  test('reading never writes to the repositories', async () => {
    const before = [fingerprint(a.corpus.repos.bl.gitDir), fingerprint(a.corpus.repos.appdev.gitDir)];
    for (const path of ['index.md', 'guides/onboarding.md', 'hostile/inert.md']) must(await a.client.getPage({ key: key('bl', path) }));
    must(await a.client.search({ query: 'quokkaharbor' }));
    assert.deepEqual([fingerprint(a.corpus.repos.bl.gitDir), fingerprint(a.corpus.repos.appdev.gitDir)], before);
  });

  test('a later commit is invisible to the renderer until the host refreshes', async () => {
    const pinned = must(await a.client.listSources()).find((s) => s.namespace === 'appdev')?.commit;
    const next = advanceMain(a.corpus.repos.appdev.gitDir, 'later synthetic commit');
    assert.notEqual(next, pinned);
    assert.equal(must(await a.client.listSources()).find((s) => s.namespace === 'appdev')?.commit, pinned, 'nothing the renderer can do re-pins');
    must(await a.host.refresh('appdev'));
    const after = must(await a.client.listSources()).find((s) => s.namespace === 'appdev');
    assert.equal(after?.commit, next);
    assert.equal(after?.freshness.graph.state, 'current');
    const page: Page = must(await a.client.getPage({ key: key('appdev', 'index.md') }));
    assert.equal(page.commit, next, 'pages are now read from the new pin');
  });
});
