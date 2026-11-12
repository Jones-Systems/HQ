// Backlink provenance (`via`, `excerpt`) and topic page titles: what the index records, what the service
// serves, and how the snapshot persists and re-validates it. Synthetic content only.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  MAX_BACKLINK_EXCERPT_LENGTH,
  MAX_BACKLINK_VIA,
  MAX_RESULTS,
  validateBacklinkResult,
  validateTopicList,
  type BacklinkEntry,
} from '../../contract/src/index.ts';
import { INDEX_RULES_VERSION, createMemoryIndexStore, createWikiHost, parseSnapshot, profileIndexKey, validateSourceProfile, type SourceProfile } from '../src/index.ts';
import { fnv64Hex } from '../src/text.ts';
import { clock, commitOf, memoryHost, memorySource, must, profileFor } from './support.ts';

const key = (path: string) => ({ namespace: 'bl' as const, path });
const relationships = (...names: string[]) => ({ fieldMappings: { title: 'title', aliases: ['aliases'], topics: ['tags'], relationships: names } });

type Files = Record<string, string | Uint8Array>;

/** Backlinks of `target` over `files`, contract-validated; `profile` overrides the default `related` mapping. */
async function backlinks(files: Files, target = 'target.md', profile: Record<string, unknown> = {}): Promise<BacklinkEntry[]> {
  const t = memoryHost({ bl: files }, { bl: profile });
  must(await t.host.refresh());
  const result = must(await t.host.service.getBacklinks({ key: key(target) }));
  assert.equal(validateBacklinkResult(result).ok, true);
  return [...result.entries];
}

/** The single entry that `src.md` yields for `target.md`. */
async function entryFor(source: string, profile: Record<string, unknown> = {}, extra: Files = {}): Promise<BacklinkEntry> {
  const entries = await backlinks({ 'target.md': '# Target', 'src.md': source, ...extra }, 'target.md', profile);
  assert.equal(entries.length, 1);
  return entries[0] as BacklinkEntry;
}

describe('via', () => {
  test('a body link reports `body` and the text of its paragraph', async () => {
    assert.deepEqual(await entryFor('# Src\n\nSee the [target page](target.md) for details.'), {
      source: key('src.md'),
      title: 'Src',
      via: ['body'],
      excerpt: 'See the target page for details.',
    });
  });

  test('a relationship field reports its configured name and has no excerpt', async () => {
    const entry = await entryFor('---\nrelated: [Target]\n---\n# Src\n\nNo links in the text.');
    assert.deepEqual(entry, { source: key('src.md'), title: 'Src', via: ['related'] });
    assert.equal('excerpt' in entry, false, 'omitted, not undefined');
  });

  test('a body link and a field together report both, sorted, with the body excerpt', async () => {
    assert.deepEqual(await entryFor('---\nrelated: [Target]\n---\n# Src\n\nHello [t](target.md) there.'), {
      source: key('src.md'),
      title: 'Src',
      via: ['body', 'related'],
      excerpt: 'Hello t there.',
    });
  });

  test('several fields are reported once each, in code-unit order, whatever their order in the file', async () => {
    const source = '---\nzeta: [Target]\nrelated: [Target, Target]\nparent: Target\n---\n# Src';
    const entry = await entryFor(source, relationships('related', 'parent', 'zeta'));
    assert.deepEqual(entry.via, ['parent', 'related', 'zeta']);
    const mixed = await entryFor('---\nalpha: Target\nZeta: Target\n---\n# Src', relationships('alpha', 'Zeta'));
    assert.deepEqual(mixed.via, ['Zeta', 'alpha'], 'uppercase sorts before lowercase');
  });

  test('a field value that is a wiki-link wrapper or a path still links', async () => {
    const entry = await entryFor('---\nrelated:\n  - "[[Target]]"\nparent: target\n---\n# Src', relationships('related', 'parent'));
    assert.deepEqual(entry.via, ['parent', 'related']);
  });

  test('more than MAX_BACKLINK_VIA origins keep `body` and the first fields; without a body link, the first fields', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `a${String(i).padStart(2, '0')}`);
    const frontmatter = `---\n${names.map((n) => `${n}: [Target]`).join('\n')}\n---\n# Src`;
    const without = await entryFor(frontmatter, relationships(...names));
    assert.deepEqual(without.via, names.slice(0, MAX_BACKLINK_VIA));
    const withBody = await entryFor(`${frontmatter}\n\nAlso [t](target.md).`, relationships(...names));
    assert.equal(withBody.via?.length, MAX_BACKLINK_VIA);
    assert.deepEqual(withBody.via, [...names.slice(0, MAX_BACKLINK_VIA - 1), 'body'], '`body` sorts after a00..a06 but is not dropped');
    assert.equal(withBody.excerpt, 'Also t.');
  });

  test('a relationship field named `body` does not stop the body link from supplying the excerpt', async () => {
    const entry = await entryFor('---\nbody: [Target]\n---\n# Src\n\nSee [t](target.md).', relationships('body'));
    assert.deepEqual(entry.via, ['body']);
    assert.equal(entry.excerpt, 'See t.');
  });

  test('one entry per source page however many links it holds; only resolved pages other than itself count', async () => {
    const entries = await backlinks({
      'target.md': '# Target',
      'src.md': '---\nrelated: [Target]\n---\n# Src\n\nOne [a](target.md).\n\nTwo [b](target.md) and [[Target]].\n\n[me](src.md)',
      'other.md': '# Other\n\n[x](missing.md) [e](https://example.invalid/target.md)',
    });
    assert.deepEqual(entries.map((e) => [e.source.path, e.via, e.excerpt]), [['src.md', ['body', 'related'], 'One a.']]);
  });
});

describe('excerpt', () => {
  test('is the flattened, inert text of the block: markup is not interpreted, whitespace collapses', async () => {
    const entry = await entryFor('# Src\n\nAlpha *beta* **gamma** `delta` [the target](target.md) <b>x</b>\n   second   line\twith tab');
    assert.equal(entry.excerpt, 'Alpha beta gamma delta the target <b>x</b> second line with tab');
  });

  test('comes from the first body link in document order, not the last or the busiest', async () => {
    const entry = await entryFor('# Src\n\nFirst [a](target.md).\n\nSecond [b](target.md) and [c](target.md).');
    assert.equal(entry.excerpt, 'First a.');
  });

  test('is the innermost block: a heading, one list item, one quote paragraph or one table row', async () => {
    const entries = await backlinks({
      'target.md': '# Target',
      'a-heading.md': '# A\n\n## About [t](target.md)\n\nOther text.',
      'b-list.md': '# B\n\n- one\n- two [t](target.md) here\n- three',
      'c-quote.md': '# C\n\n> quoted [t](target.md) text\n\nafter',
      'd-row.md': '# D\n\n| Name | Link |\n| --- | --- |\n| Bob | [t](target.md) |\n| Eve | none |',
      'e-header.md': '# E\n\n| [t](target.md) | Link |\n| --- | --- |\n| Bob | x |',
    });
    assert.deepEqual(
      entries.map((e) => [e.source.path, e.excerpt]),
      [
        ['a-heading.md', 'About t'],
        ['b-list.md', 'two t here'],
        ['c-quote.md', 'quoted t text'],
        ['d-row.md', 'Bob t'],
        ['e-header.md', 't Link'],
      ],
    );
  });

  test('is cut at the cap without splitting a surrogate pair, and is never empty or multi-line', async () => {
    const long = await entryFor(`# Src\n\n${'x'.repeat(100)} ${'y'.repeat(100)} [t](target.md)`);
    assert.equal(long.excerpt?.length, MAX_BACKLINK_EXCERPT_LENGTH);
    assert.equal(long.excerpt, `${'x'.repeat(100)} ${'y'.repeat(59)}`);
    const whole = await entryFor(`# Src\n\n${'a'.repeat(158)}😀 [t](target.md)`);
    assert.equal(whole.excerpt, `${'a'.repeat(158)}😀`, 'a pair that ends exactly on the cap stays whole');
    const split = await entryFor(`# Src\n\n${'a'.repeat(159)}😀 [t](target.md)`);
    assert.equal(split.excerpt, 'a'.repeat(159), 'a pair that would cross the cap is dropped, not halved');
    assert.doesNotMatch(split.excerpt as string, /[\ud800-\udfff]/);
  });

  test('control characters become separators and collapse with the surrounding whitespace', async () => {
    const entry = await entryFor('# Src\n\nBell\u0007here [t](target.md)\u0001 end');
    assert.equal(entry.excerpt, 'Bell here t end');
    assert.doesNotMatch(entry.excerpt as string, /[\u0000-\u001f\u007f-\u009f]/);
  });

  test('a block with no text yields no excerpt (the entry still reports via)', async () => {
    const entry = await entryFor('# Src\n\n[](target.md)');
    assert.deepEqual(entry, { source: key('src.md'), title: 'Src', via: ['body'] });
  });

  test('the first body link decides: later links do not fill in for an empty first block', async () => {
    const entry = await entryFor('# Src\n\n[](target.md)\n\nLater [t](target.md).');
    assert.equal('excerpt' in entry, false);
  });
});

describe('raw pages', () => {
  test('unsupported frontmatter: body links still give via body and the paragraph text', async () => {
    const text = '---\ntitle: One\ntitle: Two\n---\n# Raw Heading\n\nSee [t](target.md) now.';
    const t = memoryHost({ bl: { 'target.md': '# Target', 'raw.md': text } });
    must(await t.host.refresh());
    assert.equal(must(await t.host.service.getPage({ key: key('raw.md') })).content.state, 'raw');
    const back = must(await t.host.service.getBacklinks({ key: key('target.md') }));
    assert.deepEqual(back.entries, [{ source: key('raw.md'), title: 'Raw Heading', via: ['body'], excerpt: 'See t now.' }]);
  });

  test('structural overflow: the flat scan supplies the paragraph text, never the raw source line', async () => {
    const text = `> ${'> '.repeat(40)}see **the** [t](target.md) here\n`;
    const t = memoryHost({ bl: { 'target.md': '# Target', 'deep.md': text } });
    must(await t.host.refresh());
    const page = must(await t.host.service.getPage({ key: key('deep.md') }));
    assert.deepEqual([page.content.state, page.content.state === 'raw' ? page.content.reason : null], ['raw', 'markdown-unsupported']);
    const back = must(await t.host.service.getBacklinks({ key: key('target.md') }));
    assert.deepEqual(back.entries.map((e) => [e.source.path, e.via, e.excerpt]), [['deep.md', ['body'], 'see the t here']]);
  });

  test('not-text pages have no links and so no backlinks', async () => {
    const entries = await backlinks({ 'target.md': '# Target', 'bin.md': new Uint8Array([0x61, 0x00, 0x5b, 0x74, 0x5d, 0x28, 0x74, 0x61, 0x72, 0x67, 0x65, 0x74, 0x2e, 0x6d, 0x64, 0x29]) });
    assert.deepEqual(entries, []);
  });
});

describe('truncation and ordering are unchanged', () => {
  test('limit, total and truncated still count source pages; entries keep the title-then-key order', async () => {
    const files: Files = { 'target.md': '# Target' };
    for (let i = 0; i < 60; i++) files[`s${String(i).padStart(2, '0')}.md`] = `# S${String(i).padStart(2, '0')}\n\n[t](target.md) ${i}`;
    const t = memoryHost({ bl: files });
    must(await t.host.refresh());
    const all = must(await t.host.service.getBacklinks({ key: key('target.md') }));
    assert.deepEqual([all.entries.length, all.total, all.truncated], [MAX_RESULTS, 60, true]);
    assert.equal(all.entries[0]?.source.path, 's00.md');
    assert.ok(all.entries.every((e) => e.via?.[0] === 'body' && typeof e.excerpt === 'string'));
    const small = must(await t.host.service.getBacklinks({ key: key('target.md'), limit: 3 }));
    assert.deepEqual(small.entries.map((e) => e.excerpt), ['t 0', 't 1', 't 2']);
  });
});

describe('topic page titles', () => {
  async function topicsOf(files: Files, profile: Record<string, unknown> = {}) {
    const t = memoryHost({ bl: files }, { bl: profile });
    must(await t.host.refresh());
    const list = must(await t.host.service.listTopics({ namespace: 'bl' }));
    assert.equal(validateTopicList(list).ok, true);
    return { t, list };
  }

  test('pageTitles runs parallel to pages: title then key order, duplicates kept', async () => {
    const tagged = (title: string) => `---\ntitle: ${title}\ntags: [Group]\n---\nbody`;
    const { list } = await topicsOf({ 'z.md': tagged('Zulu'), 'm2.md': tagged('Mike'), 'a.md': tagged('Alpha'), 'm1.md': tagged('Mike') });
    const group = list.topics.find((topic) => topic.label === 'Group');
    assert.deepEqual(group?.pages.map((k) => k.path), ['a.md', 'm1.md', 'm2.md', 'z.md']);
    assert.deepEqual(group?.pageTitles, ['Alpha', 'Mike', 'Mike', 'Zulu']);
  });

  test('every title is the title getPage reports for the page at the same position', async () => {
    const files: Files = {};
    for (let i = 0; i < 6; i++) files[`p${i}.md`] = `---\ntags: [One, Two]\n---\n# Heading ${5 - i}`;
    const { t, list } = await topicsOf(files);
    for (const topic of list.topics) {
      assert.equal(topic.pageTitles?.length, topic.pages.length);
      for (const [i, pageKey] of topic.pages.entries()) {
        assert.equal(topic.pageTitles?.[i], must(await t.host.service.getPage({ key: pageKey })).title);
      }
    }
  });

  test('the preview is capped at MAX_RESULTS pages and the same number of titles; pageCount stays the full count', async () => {
    const files: Files = {};
    for (let i = 0; i < 60; i++) files[`p${String(i).padStart(2, '0')}.md`] = `---\ntitle: T${String(i).padStart(2, '0')}\ntags: [Big]\n---\n`;
    const { list } = await topicsOf(files);
    const big = list.topics.find((topic) => topic.label === 'Big');
    assert.equal(big?.pageCount, 60);
    assert.equal(big?.pages.length, MAX_RESULTS);
    assert.deepEqual(big?.pageTitles, Array.from({ length: MAX_RESULTS }, (_, i) => `T${String(i).padStart(2, '0')}`));
  });

  test('directory topics carry titles too, and a topic with no direct members has empty titles', async () => {
    const { list } = await topicsOf({ 'guides/intro.md': '# Intro', 'guides/deep/more.md': '# More', 'top.md': '# Top' }, { topicMode: 'directory' });
    const byLabel = Object.fromEntries(list.topics.map((topic) => [topic.label, topic]));
    assert.deepEqual(byLabel['guides']?.pageTitles, ['Intro']);
    assert.deepEqual(byLabel['deep']?.pageTitles, ['More']);
    const bare = await topicsOf({ 'outer/inner/leaf.md': '# Leaf' }, { topicMode: 'directory' });
    const outer = bare.list.topics.find((topic) => topic.label === 'outer');
    assert.deepEqual([outer?.pages, outer?.pageTitles], [[], []]);
  });
});

describe('snapshot', () => {
  const files: Files = {
    'a.md': '---\nrelated: [B]\n---\n# A\n\nSee [b](b.md) and [c](c.md).',
    'b.md': '# B\n\nback to [[A]]',
    'c.md': '# C\n\n[a](a.md)',
    'self.md': '# Self\n\n[me](self.md) [a](a.md)',
    'ext.md': '# Ext\n\n[x](https://example.invalid/) [m](missing.md)',
  };
  const profile = validateSourceProfile(profileFor('bl'));
  assert.ok(profile.ok);
  const expected = { namespace: 'bl' as const, commit: commitOf('bl'), profileKey: profile.ok ? profileIndexKey(profile.value) : '' };

  async function built(source: Files = files) {
    const t = memoryHost({ bl: source });
    must(await t.host.refresh());
    const text = t.store.entries.get(`bl/${commitOf('bl')}`) as string;
    return { t, text, snapshot: JSON.parse(text) as { pages: any[] } & Record<string, any> };
  }
  const originsOf = (snapshot: { pages: any[] }, path: string) => snapshot.pages.find((page) => page.path === path).linkOrigins;

  test('records one sorted origin per target page, excluding the page itself and every non-page target', async () => {
    const { snapshot } = await built();
    assert.deepEqual(originsOf(snapshot, 'a.md'), [
      { path: 'b.md', via: ['body', 'related'], excerpt: 'See b and c.' },
      { path: 'c.md', via: ['body'], excerpt: 'See b and c.' },
    ]);
    assert.deepEqual(originsOf(snapshot, 'b.md'), [{ path: 'a.md', via: ['body'], excerpt: 'back to A' }]);
    assert.deepEqual(originsOf(snapshot, 'self.md'), [{ path: 'a.md', via: ['body'], excerpt: 'me a' }]);
    assert.deepEqual(originsOf(snapshot, 'ext.md'), []);
    assert.ok(snapshot.pages.every((page) => page.links.length >= page.linkOrigins.length));
  });

  test('the same corpus gives a byte-identical snapshot, whatever order the source lists it in', async () => {
    const first = await built();
    const reversed = Object.fromEntries(Object.entries(files).reverse());
    const second = await built(reversed);
    assert.equal(second.text, first.text);
  });

  test('parseSnapshot accepts what the builder wrote and gives it back unchanged', async () => {
    const { text } = await built();
    const parsed = parseSnapshot(JSON.parse(text), expected);
    assert.notEqual(parsed, null);
    assert.equal(JSON.stringify(parsed), text);
  });

  test('a stored snapshot is served with the same backlinks and topics, without reading the source', async () => {
    const first = await built();
    const reload = memorySource({ files, commit: commitOf('bl') });
    const host = createWikiHost({ profiles: [profileFor('bl')], sources: { bl: reload }, store: first.t.store, clock });
    must(await host.refresh());
    assert.equal(reload.listings.length, 0);
    for (const path of ['a.md', 'b.md', 'c.md']) {
      assert.deepEqual(must(await host.service.getBacklinks({ key: key(path) })), must(await first.t.host.service.getBacklinks({ key: key(path) })));
    }
    assert.deepEqual(must(await host.service.listTopics({ namespace: 'bl' })), must(await first.t.host.service.listTopics({ namespace: 'bl' })));
  });

  describe('strict re-validation of linkOrigins', () => {
    const edit = async (change: (a: any, snapshot: any) => void): Promise<unknown> => {
      const { snapshot } = await built();
      change(snapshot.pages.find((page) => page.path === 'a.md'), snapshot);
      return parseSnapshot(snapshot, expected);
    };

    const rejected: Record<string, (a: any, snapshot: any) => void> = {
      'origins removed': (a) => delete a.linkOrigins,
      'origins not an array': (a) => (a.linkOrigins = {}),
      'an origin dropped': (a) => a.linkOrigins.pop(),
      'an origin for a path the page does not link to': (a) => (a.linkOrigins[1].path = 'self.md'),
      'an extra origin': (a) => a.linkOrigins.push({ path: 'zzz.md', via: ['body'], excerpt: null }),
      'a duplicate origin path': (a) => (a.linkOrigins[1].path = a.linkOrigins[0].path),
      'origins out of order': (a) => a.linkOrigins.reverse(),
      'a self origin on another page': (_a, s) => s.pages.find((p: any) => p.path === 'b.md').linkOrigins.push({ path: 'b.md', via: ['body'], excerpt: null }),
      'an origin with an extra key': (a) => (a.linkOrigins[0].rank = 1),
      'an origin without its excerpt key': (a) => delete a.linkOrigins[0].excerpt,
      'an origin without its via key': (a) => delete a.linkOrigins[0].via,
      'an empty via': (a) => (a.linkOrigins[0].via = []),
      'a via that is not an array': (a) => (a.linkOrigins[0].via = 'body'),
      'nine origins in via': (a) => (a.linkOrigins[0].via = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']),
      'via out of order': (a) => (a.linkOrigins[0].via = ['related', 'body']),
      'a duplicate in via': (a) => (a.linkOrigins[0].via = ['body', 'body']),
      'a field name with a space': (a) => (a.linkOrigins[0].via = ['has space']),
      'a prototype key in via': (a) => (a.linkOrigins[0].via = ['__proto__']),
      'a 65-character field name': (a) => (a.linkOrigins[0].via = ['a'.repeat(65)]),
      'a non-string in via': (a) => (a.linkOrigins[0].via = [1]),
      'an excerpt over the cap': (a) => (a.linkOrigins[0].excerpt = 'x'.repeat(MAX_BACKLINK_EXCERPT_LENGTH + 1)),
      'an empty excerpt': (a) => (a.linkOrigins[0].excerpt = ''),
      'a multi-line excerpt': (a) => (a.linkOrigins[0].excerpt = 'two\nlines'),
      'an excerpt with NUL': (a) => (a.linkOrigins[0].excerpt = 'a\u0000b'),
      'an excerpt with a lone surrogate': (a) => (a.linkOrigins[0].excerpt = 'a\ud800b'),
      'an excerpt that is not text': (a) => (a.linkOrigins[0].excerpt = 5),
    };
    for (const [name, change] of Object.entries(rejected)) {
      test(`rejects ${name}`, async () => {
        assert.equal(await edit(change), null);
      });
    }

    test('accepts the boundary values: eight origins, a 64-character field name, an excerpt of exactly the cap', async () => {
      const names = ['a'.repeat(64), 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      assert.equal(names.length, MAX_BACKLINK_VIA);
      assert.notEqual(
        await edit((a) => {
          a.linkOrigins[0].via = names;
          a.linkOrigins[0].excerpt = 'x'.repeat(MAX_BACKLINK_EXCERPT_LENGTH);
        }),
        null,
      );
    });

    test('a rejected stored snapshot is rebuilt from the source and the store is repaired', async () => {
      const first = await built();
      const corrupt = JSON.parse(first.text);
      corrupt.pages[0].linkOrigins[0].via = ['related', 'body'];
      const store = createMemoryIndexStore();
      store.entries.set(`bl/${commitOf('bl')}`, JSON.stringify(corrupt));
      const source = memorySource({ files, commit: commitOf('bl') });
      const host = createWikiHost({ profiles: [profileFor('bl')], sources: { bl: source }, store, clock });
      must(await host.refresh());
      assert.equal(source.listings.length, 1);
      assert.equal(store.entries.get(`bl/${commitOf('bl')}`), first.text);
      assert.deepEqual(must(await host.service.getBacklinks({ key: key('b.md') })).entries[0]?.via, ['body', 'related']);
    });
  });

  describe('snapshots written before the rules bump', () => {
    const legacyKeyOf = (p: SourceProfile) =>
      fnv64Hex(JSON.stringify([1, p.namespace, p.ref, p.rootPrefix, p.pageExtensions, p.fieldMappings.title, p.fieldMappings.aliases, p.fieldMappings.topics, p.fieldMappings.relationships, p.topicMode]));

    test('the rules version moved past 1, so the profile key of version-1 snapshots no longer matches', () => {
      assert.ok(profile.ok);
      if (!profile.ok) return;
      assert.ok(INDEX_RULES_VERSION >= 2);
      assert.notEqual(legacyKeyOf(profile.value), profileIndexKey(profile.value));
    });

    test('a version-1 snapshot is rejected by its key and, even with the current key, by its shape', async () => {
      assert.ok(profile.ok);
      if (!profile.ok) return;
      const { snapshot } = await built();
      for (const page of snapshot.pages) delete page.linkOrigins;
      assert.equal(parseSnapshot({ ...snapshot, profileKey: legacyKeyOf(profile.value) }, expected), null);
      assert.equal(parseSnapshot(snapshot, expected), null);
    });

    test('the host rebuilds from the source and replaces a stored version-1 snapshot', async () => {
      assert.ok(profile.ok);
      if (!profile.ok) return;
      const first = await built();
      const legacy = JSON.parse(first.text);
      for (const page of legacy.pages) delete page.linkOrigins;
      legacy.profileKey = legacyKeyOf(profile.value);
      const store = createMemoryIndexStore();
      store.entries.set(`bl/${commitOf('bl')}`, JSON.stringify(legacy));
      const source = memorySource({ files, commit: commitOf('bl') });
      const host = createWikiHost({ profiles: [profileFor('bl')], sources: { bl: source }, store, clock });
      assert.equal(must(await host.refresh()).namespaces[0]?.state, 'ready');
      assert.equal(source.listings.length, 1, 'rebuilt from the source');
      assert.equal(store.entries.get(`bl/${commitOf('bl')}`), first.text, 'the store now holds a current snapshot');
      const back = must(await host.service.getBacklinks({ key: key('b.md') }));
      assert.deepEqual(back.entries.map((e) => [e.source.path, e.via]), [['a.md', ['body', 'related']]]);
    });
  });
});
