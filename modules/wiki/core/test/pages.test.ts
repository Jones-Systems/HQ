// Page-level behaviour through the host: titles, fields, raw fallbacks, link resolution.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_OUT_LINKS, MAX_PAGE_BLOB_BYTES, validatePage, type Page, type WikiNamespace } from '../../contract/src/index.ts';
import { memoryHost, must } from './support.ts';

async function load(files: Record<string, string | Uint8Array>, overrides: Record<string, unknown> = {}) {
  const t = memoryHost({ bl: files }, { bl: overrides });
  must(await t.host.refresh());
  return t;
}

async function pageOf(files: Record<string, string | Uint8Array>, path: string, overrides: Record<string, unknown> = {}, namespace: WikiNamespace = 'bl'): Promise<Page> {
  const t = await load(files, overrides);
  const page = must(await t.host.service.getPage({ key: { namespace, path } }));
  assert.equal(validatePage(page).ok, true);
  return page;
}

function textOf(page: Page): string {
  assert.equal(page.content.state, 'parsed');
  if (page.content.state !== 'parsed') return '';
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return;
    const n = node as Record<string, unknown>;
    if (n['type'] === 'text' || n['type'] === 'inlineCode') out.push(String(n['value']));
    for (const key of ['children', 'items', 'cells', 'rows']) if (Array.isArray(n[key])) (n[key] as unknown[]).forEach(walk);
    if (n['header'] !== undefined) walk(n['header']);
  };
  walk(page.content.ast);
  return out.join('');
}

describe('titles and fields', () => {
  test('title prefers the configured field, then H1, then file stem', async () => {
    const files = {
      'a.md': '---\ntitle: From Field\n---\n# From Heading\n',
      'b.md': '# From Heading\n\ntext',
      'dir/c-note.md': 'no heading at all',
      'd.md': '---\nother: x\n---\n# Heading D\n',
    };
    const t = await load(files);
    const titles: Record<string, string> = {};
    for (const path of Object.keys(files)) titles[path] = must(await t.host.service.getPage({ key: { namespace: 'bl', path } })).title;
    assert.deepEqual(titles, { 'a.md': 'From Field', 'b.md': 'From Heading', 'dir/c-note.md': 'c-note', 'd.md': 'Heading D' });
  });

  test('a profile with no title field ignores a title field in the file', async () => {
    const page = await pageOf({ 'a.md': '---\ntitle: Field\n---\n# Heading\n' }, 'a.md', { fieldMappings: { title: null } });
    assert.equal(page.title, 'Heading');
  });

  test('labels collapse whitespace, drop controls and truncate without splitting a surrogate pair', async () => {
    const long = '😀'.repeat(200);
    const page = await pageOf({ 'a.md': `---\ntitle: "  spaced \\t\\n out  "\n---\n`, 'b.md': `---\ntitle: "${long}"\n---\n` }, 'a.md');
    assert.equal(page.title, 'spaced out');
    const b = await pageOf({ 'b.md': `---\ntitle: "${long}"\n---\n` }, 'b.md');
    assert.ok(b.title.length <= 256 && b.title.length > 0);
    assert.doesNotMatch(b.title, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    const control = await pageOf({ 'c.md': '---\ntitle: "\\x01\\x02"\n---\n' }, 'c.md');
    assert.equal(control.title, 'c', 'a title that is only controls is empty, so the file stem is used');
  });

  test('null fields and null list items are omitted, never coerced, and the page stays parsed', async () => {
    const page = await pageOf(
      { 'n.md': '---\ntitle: Nulls\nempty:\ntilde: ~\nword: null\ntags:\n  - a\n  - null\n  -\n  - b\nflag: false\ncount: 0\n---\n# Body\n\ntext' },
      'n.md',
    );
    assert.equal(page.content.state, 'parsed');
    assert.deepEqual(page.fields, [
      { name: 'title', value: 'Nulls' },
      { name: 'tags', value: ['a', 'b'] },
      { name: 'flag', value: false },
      { name: 'count', value: 0 },
    ]);
  });

  test('scalars and lists project in order; yes/no stay strings', async () => {
    const page = await pageOf({ 'f.md': '---\nyes_word: yes\nnum: 12\nflow: [x, "y z"]\nok: true\n---\nbody' }, 'f.md');
    assert.deepEqual(page.fields, [
      { name: 'yes_word', value: 'yes' },
      { name: 'num', value: 12 },
      { name: 'flow', value: ['x', 'y z'] },
      { name: 'ok', value: true },
    ]);
  });

  test('page identity: byteLength and commit come from the blob and the pinned commit', async () => {
    const t = await load({ 'a.md': 'héllo' });
    const page = must(await t.host.service.getPage({ key: { namespace: 'bl', path: 'a.md' } }));
    assert.equal(page.byteLength, Buffer.byteLength('héllo'));
    const sources = must(await t.host.service.listSources());
    assert.equal(page.commit, sources[0]?.commit);
  });
});

describe('raw fallbacks stay readable and inert', () => {
  test('malformed (duplicate-key) frontmatter becomes raw text and still derives body links', async () => {
    const text = '---\ntitle: One\ntitle: Two\n---\n# Raw Heading\n\nSee [other](other.md).';
    const page = await pageOf({ 'bad.md': text, 'other.md': '# Other' }, 'bad.md');
    assert.deepEqual(page.content, { state: 'raw', reason: 'frontmatter-unsupported', text });
    assert.deepEqual(page.fields, []);
    assert.equal(page.title, 'Raw Heading');
    assert.deepEqual(page.outLinks, [{ text: 'other', target: { kind: 'page', key: { namespace: 'bl', path: 'other.md' } } }]);
    const t = await load({ 'bad.md': text, 'other.md': '# Other' });
    const back = must(await t.host.service.getBacklinks({ key: { namespace: 'bl', path: 'other.md' } }));
    assert.deepEqual(back.entries.map((e) => e.source.path), ['bad.md'], 'raw pages still contribute backlinks');
  });

  test('an unclosed frontmatter block is raw and links after the opening line are kept', async () => {
    const text = '---\ntitle: Open\n\nSee [x](x.md)';
    const page = await pageOf({ 'u.md': text, 'x.md': 'x' }, 'u.md');
    assert.equal(page.content.state, 'raw');
    assert.equal(page.outLinks.length, 1);
  });

  test('NUL and invalid UTF-8 become not-text raw with replacement characters, no links, bounded', async () => {
    const nul = new Uint8Array([0x61, 0x00, 0x62, 0x20, 0x5b, 0x78, 0x5d, 0x28, 0x79, 0x2e, 0x6d, 0x64, 0x29]);
    const bad = new Uint8Array([0x66, 0xff, 0xfe, 0x6f]);
    const t = await load({ 'nul.md': nul, 'bad.md': bad, 'y.md': 'y' });
    const nulPage = must(await t.host.service.getPage({ key: { namespace: 'bl', path: 'nul.md' } }));
    assert.deepEqual(nulPage.content, { state: 'raw', reason: 'not-text', text: 'a�b [x](y.md)' });
    assert.deepEqual(nulPage.outLinks, []);
    assert.equal(nulPage.title, 'nul');
    const badPage = must(await t.host.service.getPage({ key: { namespace: 'bl', path: 'bad.md' } }));
    assert.equal(badPage.content.state === 'raw' && badPage.content.text, 'f��o');
    assert.equal(badPage.content.state === 'raw' && badPage.content.reason, 'not-text');
  });

  test('a large invalid-UTF-8 blob keeps its displayed text within the contract byte cap', async () => {
    const big = new Uint8Array(MAX_PAGE_BLOB_BYTES).fill(0xff);
    const page = await pageOf({ 'big.md': big }, 'big.md');
    assert.equal(page.content.state, 'raw');
    assert.equal(page.byteLength, MAX_PAGE_BLOB_BYTES);
    assert.equal(validatePage(page).ok, true);
  });

  test('markdown that overflows the structural bounds is markdown-unsupported raw, links via a flat scan', async () => {
    const text = '> '.repeat(40) + 'see [x](x.md)';
    const page = await pageOf({ 'deep.md': text, 'x.md': 'x' }, 'deep.md');
    assert.equal(page.content.state === 'raw' && page.content.reason, 'markdown-unsupported');
    assert.deepEqual(page.outLinks.map((l) => l.target.kind), ['page']);
  });

  test('markdown within parser bounds but beyond the contract depth is markdown-unsupported raw', async () => {
    const n = 24;
    const emphasis = Array.from({ length: n }, (_, i) => `${i % 2 === 0 ? '*' : '_'}w `).join('') + 'x' + Array.from({ length: n }, (_, i) => ` w${(n - 1 - i) % 2 === 0 ? '*' : '_'}`).join('');
    const lists = Array.from({ length: n }, (_, i) => `${'  '.repeat(i)}- ${i === n - 1 ? emphasis : `x${i}`}`).join('\n');
    const page = await pageOf({ 'deep.md': lists }, 'deep.md');
    assert.equal(page.content.state === 'raw' && page.content.reason, 'markdown-unsupported');
  });

  test('valid frontmatter with raw markdown keeps its fields', async () => {
    const text = `---\ntitle: Keep\n---\n${'> '.repeat(40)}x`;
    const page = await pageOf({ 'k.md': text }, 'k.md');
    assert.equal(page.content.state === 'raw' && page.content.reason, 'markdown-unsupported');
    assert.deepEqual(page.fields, [{ name: 'title', value: 'Keep' }]);
    assert.equal(page.title, 'Keep');
  });
});

describe('HTML, unsafe schemes and code are inert', () => {
  const source = [
    '# Safe',
    '',
    '<script>alert(1)</script> and <img src=x onerror=alert(1)>',
    '',
    '[js](javascript:alert(1)) [data](data:text/html;base64,AAAA) ![img](http://example.invalid/a.png)',
    '',
    '`[code](code.md)`',
    '',
    '```',
    '[fenced](fenced.md)',
    '```',
    '',
    '[real](real.md)',
  ].join('\n');

  test('only the real link becomes a link; everything else is verbatim text', async () => {
    const page = await pageOf({ 'doc.md': source, 'real.md': 'r', 'code.md': 'c', 'fenced.md': 'f' }, 'doc.md');
    assert.deepEqual(page.outLinks.map((l) => (l.target.kind === 'page' ? l.target.key.path : l.target.kind)), ['real.md']);
    const text = textOf(page);
    assert.ok(text.includes('<script>alert(1)</script>'));
    assert.ok(text.includes('[js](javascript:alert(1))'));
    assert.ok(text.includes('![img](http://example.invalid/a.png)'));
    assert.ok(JSON.stringify(page.content).indexOf('"type":"image"') < 0);
  });

  test('a single-quote URL stays the exact original text', async () => {
    const page = await pageOf({ 'q.md': "[x](https://a.example/it's)" }, 'q.md');
    assert.deepEqual(page.outLinks, []);
    assert.equal(textOf(page), "[x](https://a.example/it's)");
  });

  test('only http, https and mailto become external links', async () => {
    const page = await pageOf({ 'e.md': '[a](https://a.example/x) [b](mailto:b@a.example) [c](ftp://a.example/x) [d](http://a.example)' }, 'e.md');
    assert.deepEqual(
      page.outLinks.map((l) => (l.target.kind === 'external' ? l.target.url : l.target.kind)),
      ['https://a.example/x', 'mailto:b@a.example', 'http://a.example'],
    );
  });
});

describe('link resolution', () => {
  const files = {
    'index.md': '# Index',
    'notes/a.md': '# A',
    'notes/b.md': '# B',
    'notes/sub/c.md': '# C',
    'other/a.md': '# A elsewhere',
    'with space.md': '# Spaced',
    'dupe-one.md': '---\ntitle: Dupe\n---\n',
    'dupe-two.md': '---\ntitle: Dupe\n---\n',
    'zebra.md': '---\ntitle: Zebra\naliases: [Striped Horse, "horse"]\n---\n',
  };

  async function outLinksOf(body: string, from = 'notes/src.md'): Promise<Page['outLinks']> {
    const page = await pageOf({ ...files, [from]: body }, from);
    return page.outLinks;
  }
  const summary = (links: Page['outLinks']) =>
    links.map((l) => {
      const t = l.target;
      return t.kind === 'page' ? t.key.path : t.kind === 'missing' ? `missing:${t.label}` : t.kind === 'ambiguous' ? `ambiguous:${t.candidates.map((c) => c.path).join('+')}` : t.url;
    });

  test('relative, parent, root-relative and extensionless links resolve lexically inside the namespace', async () => {
    const links = await outLinksOf('[a](b.md) [b](./sub/c.md) [c](../index.md) [d](/other/a.md) [e](b) [f](../with%20space.md) [g](b.md#frag) [h](b.md?x=1)');
    assert.deepEqual(summary(links), ['notes/b.md', 'notes/sub/c.md', 'index.md', 'other/a.md', 'with space.md'], 'duplicates by target collapse');
  });

  test('dangling and escaping targets are preserved as missing, never resolved elsewhere', async () => {
    const links = await outLinksOf('[a](nope.md) [b](../../etc/passwd) [c](%2e%2e/%2e%2e/x.md) [d](%ZZ) [e](dir/) [f](..%2f..%2fx.md) [g](a%00b.md)');
    assert.deepEqual(summary(links), ['missing:nope.md', 'missing:../../etc/passwd', 'missing:%2e%2e/%2e%2e/x.md', 'missing:%ZZ', 'missing:dir/', 'missing:..%2f..%2fx.md', 'missing:a%00b.md']);
  });

  test('a root-relative markdown link resolves within the namespace, not the host filesystem', async () => {
    const links = await outLinksOf('[a](/index.md) [b](/etc/passwd) [c](/../index.md)');
    assert.deepEqual(summary(links), ['index.md', 'missing:/etc/passwd', 'missing:/../index.md']);
  });

  test('wiki links resolve by exact path, then by namespace-scoped alias (title, alias field, stem)', async () => {
    const links = await outLinksOf('[[index]] [[notes/b]] [[Zebra]] [[striped HORSE]] [[Horse|label]] [[c]] [[Nowhere]] [[A]] [[Dupe]] [[#anchor]]');
    assert.deepEqual(summary(links), [
      'index.md',
      'notes/b.md',
      'zebra.md',
      'notes/sub/c.md',
      'missing:Nowhere',
      'ambiguous:notes/a.md+other/a.md',
      'ambiguous:dupe-one.md+dupe-two.md',
    ]);
  });

  test('ambiguity is preserved as sorted candidates; the AST link carries the same target', async () => {
    const page = await pageOf({ ...files, 'src.md': 'see [[Dupe]]' }, 'src.md');
    const first = page.content.state === 'parsed' ? page.content.ast.children[0] : undefined;
    assert.equal(first?.type, 'paragraph');
    const link = first?.type === 'paragraph' ? first.children.find((c) => c.type === 'link') : undefined;
    assert.deepEqual(link?.type === 'link' && link.target, {
      kind: 'ambiguous',
      candidates: [
        { namespace: 'bl', path: 'dupe-one.md' },
        { namespace: 'bl', path: 'dupe-two.md' },
      ],
    });
  });

  test('relationship fields from the profile become links (and wiki-link wrappers are accepted)', async () => {
    const page = await pageOf({ ...files, 'r.md': '---\nrelated:\n  - "[[Zebra]]"\n  - notes/b\n  - Missing One\n---\nbody' }, 'r.md');
    assert.deepEqual(summary(page.outLinks), ['zebra.md', 'notes/b.md', 'missing:Missing One']);
  });

  test('outLinks de-duplicate by target and cap at the contract limit while the index keeps every target', async () => {
    const count = MAX_OUT_LINKS + 50;
    const targets: Record<string, string> = {};
    const body: string[] = [];
    for (let i = 0; i < count; i++) {
      targets[`t/${i}.md`] = `# T${i}`;
      body.push(`[l${i}](t/${i}.md) [again${i}](t/${i}.md)`);
    }
    const t = await load({ ...targets, 'hub.md': body.join('\n') });
    const page = must(await t.host.service.getPage({ key: { namespace: 'bl', path: 'hub.md' } }));
    assert.equal(page.outLinks.length, MAX_OUT_LINKS);
    assert.equal(page.outLinks[0]?.text, 'l0', 'first text wins for a duplicated target');
    const last = must(await t.host.service.getBacklinks({ key: { namespace: 'bl', path: `t/${count - 1}.md` } }));
    assert.deepEqual(last.entries.map((e) => e.source.path), ['hub.md'], 'a target beyond the cap still has its backlink');
    const snapshot = JSON.parse([...t.store.entries.values()][0] as string) as { stats: { outLinkCaps: number } };
    assert.equal(snapshot.stats.outLinkCaps, 1);
  });
});

describe('root prefix', () => {
  test('page keys are relative to the namespace root; files outside it are ignored', async () => {
    const files = { 'docs/a.md': '# A [b](b.md) [up](../outside.md)', 'docs/b.md': '# B', 'outside.md': '# Out', 'README.md': 'x' };
    const t = await load(files, { rootPrefix: 'docs' });
    const status = must(await t.host.service.indexStatus());
    assert.equal(status.namespaces[0]?.pageCount, 2);
    const page = must(await t.host.service.getPage({ key: { namespace: 'bl', path: 'a.md' } }));
    assert.deepEqual(summary(page.outLinks), ['b.md', 'missing:../outside.md']);
    const out = await t.host.service.getPage({ key: { namespace: 'bl', path: 'outside.md' } });
    assert.equal(out.ok, false);
  });

  test('a root with nothing beneath it is a binding mismatch, not an empty wiki', async () => {
    const t = memoryHost({ bl: { 'a.md': '# A' } }, { bl: { rootPrefix: 'missing' } });
    const status = must(await t.host.refresh());
    assert.equal(status.namespaces[0]?.state, 'unavailable');
  });
});

function summary(links: Page['outLinks']): string[] {
  return links.map((l) => {
    const t = l.target;
    return t.kind === 'page' ? t.key.path : t.kind === 'missing' ? `missing:${t.label}` : t.kind === 'ambiguous' ? 'ambiguous' : t.url;
  });
}
