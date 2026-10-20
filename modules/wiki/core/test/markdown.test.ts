import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { MAX_AST_DEPTH, MAX_TABLE_COLUMNS, validateMarkdownDocument } from '../../contract/src/index.ts';
import { parseMarkdown, resolveDocument, scanLinks } from '../src/index.ts';
import { parse, show, showInline } from './md-helpers.ts';

describe('block structure', () => {
  test('ATX and setext headings, hashtag is not a heading', () => {
    assert.equal(show('# One\n\n## Two ##\n\nThree\n===\n\nFour\n---\n\n#hashtag'), 'h1["One"] h2["Two"] h1["Three"] h2["Four"] p["#hashtag"]');
    assert.equal(show('####### seven'), 'p["####### seven"]');
  });

  test('paragraph lines join with a newline', () => {
    assert.equal(show('one\ntwo\n\nthree'), 'p["one\\ntwo"] p["three"]');
  });

  test('nested ordered and bullet lists keep their start number and separators', () => {
    assert.equal(
      show('- a\n- b\n  - nested\n  - nested2\n\n1. one\n2. two\n\n3) other'),
      'ul[li[p["a"]] li[p["b"] ul[li[p["nested"]] li[p["nested2"]]]]] ol1[li[p["one"]] li[p["two"]]] ol3[li[p["other"]]]',
    );
    assert.equal(show('5. five\n6. six'), 'ol5[li[p["five"]] li[p["six"]]]');
    assert.equal(show('- a\n+ b'), 'ul[li[p["a"]]] ul[li[p["b"]]]', 'a different bullet starts a new list');
  });

  test('list items hold several blocks and lazy continuations', () => {
    assert.equal(show('- first\n  second\n\n  para two\n- next'), 'ul[li[p["first\\nsecond"] p["para two"]] li[p["next"]]]');
    assert.equal(show('- lazy\ncontinuation'), 'ul[li[p["lazy\\ncontinuation"]]]');
    assert.equal(show('1. a\n   - b\n2. c'), 'ol1[li[p["a"] ul[li[p["b"]]]] li[p["c"]]]');
  });

  test('task markers stay verbatim text', () => {
    assert.equal(show('- [ ] todo\n- [x] done'), 'ul[li[p["[ ] todo"]] li[p["[x] done"]]]');
  });

  test('fenced code (backtick and tilde), info string, unclosed fence and indented code', () => {
    assert.equal(show('```ts extra\nlet a = 1;\n```'), 'code(ts):"let a = 1;\\n"');
    assert.equal(show('~~~\nraw\n~~~'), 'code():"raw\\n"');
    assert.equal(show('```\nunclosed fence'), 'code():"unclosed fence\\n"');
    assert.equal(show('    indented\n\n    more'), 'code():"indented\\n\\nmore\\n"');
    assert.equal(show('````\n```\ninner\n```\n````'), 'code():"```\\ninner\\n```\\n"');
  });

  test('block quotes nest and continue lazily', () => {
    assert.equal(show('> a\n> b\n\n> > deep'), 'q[p["a\\nb"]] q[q[p["deep"]]]');
    assert.equal(show('> lazy\ncontinued'), 'q[p["lazy\\ncontinued"]]');
    assert.equal(show('> # head\n> - item'), 'q[h1["head"] ul[li[p["item"]]]]');
  });

  test('GFM tables: alignment, escaped pipes, short rows are padded', () => {
    assert.equal(
      show('| a | b | c |\n|:--|:-:|--:|\n| 1 | \\| 2 | 3 |\n| only |'),
      'table(left,center,right)["a" | "b" | "c" / "1" | "| 2" | "3" / "only" |  | ]',
    );
    assert.equal(show('a | b\n--|--\n*x* | `y`'), 'table(-,-)["a" | "b" / em("x") | `y`]');
    assert.equal(show('not | a table\n\njust text'), 'p["not | a table"] p["just text"]');
  });

  test(`tables beyond ${MAX_TABLE_COLUMNS} columns become plain paragraph text`, () => {
    const wide = (n: number) => [`|${'h|'.repeat(n)}`, `|${'-|'.repeat(n)}`, `|${'c|'.repeat(n)}`].join('\n');
    assert.match(show(wide(MAX_TABLE_COLUMNS)), /^table\(/);
    const tooWide = show(wide(MAX_TABLE_COLUMNS + 1));
    assert.match(tooWide, /^p\["\|h\|/);
    assert.equal(parse(wide(MAX_TABLE_COLUMNS + 1)).ast.children[0]?.type, 'paragraph');
  });
});

describe('inline structure', () => {
  test('emphasis, strong, nesting and intraword underscores', () => {
    assert.equal(
      showInline('*em* **strong** ***both*** _u_ snake_case_word **a *b* c**'),
      '' + 'em("em") " " strong("strong") " " em(strong("both")) " " em("u") " snake_case_word " strong("a " em("b") " c")',
    );
    assert.equal(showInline('2 * 3 * 4 and a*b'), '"2 * 3 * 4 and a*b"');
    assert.equal(showInline('**unclosed'), '"**unclosed"');
  });

  test('inline code, escapes and code with backticks', () => {
    assert.equal(showInline('`a` and ``b ` c`` and \\*lit\\*'), '`a` " and " `b ` c` " and *lit*"');
    assert.equal(showInline('`unterminated'), '"`unterminated"');
  });

  test('links inside code are never links', () => {
    const doc = parse('`[a](b.md)` and\n\n```\n[c](d.md)\n```\n\n    [e](f.md)');
    assert.deepEqual(doc.links, []);
  });
});

describe('excluded constructs stay verbatim inert text', () => {
  test('thematic breaks, HTML, footnotes, strikethrough, images and task text', () => {
    assert.equal(show('***'), 'p["***"]');
    assert.equal(show('---\n\ntext'), 'p["---"] p["text"]');
    assert.equal(show('<div>\n[x](y.md)\n</div>\n\nafter'), 'p["<div>\\n[x](y.md)\\n</div>"] p["after"]');
    assert.equal(show('<!-- a [x](y.md)\n\nstill comment -->\n\nafter'), 'p["<!-- a [x](y.md)\\n\\nstill comment -->"] p["after"]');
    assert.equal(show('[^1]: the note'), 'p["[^1]: the note"]');
    assert.equal(showInline('text ~~strike~~ <b>bold</b> <script>alert(1)</script> &amp; [^1]'), '"text ~~strike~~ <b>bold</b> <script>alert(1)</script> &amp; [^1]"');
    const image = parse('![alt](pic.png) and ![ref][r]\n\n[r]: pic.png');
    assert.deepEqual(image.links, [], 'an image yields no link');
    assert.equal(blocksText(image.ast.children), '![alt](pic.png) and ![ref][r]');
  });

  test('unsafe, anchor-only, empty and protocol-relative links remain the original text', () => {
    const text =
      '[bad](javascript:alert(1)) [anchor](#sec) [empty]() [proto](//evil.example/x) [d](data:text/html,x) [f](file:///etc/passwd) [v](vbscript:x) [w](C:\\\\x)';
    const doc = parse(text);
    assert.deepEqual(doc.links, []);
    assert.equal(blocksText(doc.ast.children), text);
    assert.deepEqual(parse('[ok](https://a.example/p?q=1#f) [m](mailto:a@b.example) [h](HTTP://UP.example)').links.map((l) => l.link), [
      { kind: 'external', url: 'https://a.example/p?q=1#f' },
      { kind: 'external', url: 'mailto:a@b.example' },
      { kind: 'external', url: 'HTTP://UP.example' },
    ]);
  });

  test('a single-quote URL is kept as its exact text, never rewritten', () => {
    const doc = parse("[sq](https://a.example/it's) <https://a.example/it's> [tick](https://a.example/a'b \"title\")");
    assert.deepEqual(doc.links, []);
    assert.equal(blocksText(doc.ast.children), "[sq](https://a.example/it's) <https://a.example/it's> [tick](https://a.example/a'b \"title\")");
    assert.ok(!blocksText(doc.ast.children).includes('%27'));
    const ok = parse('[t](https://a.example/ "title") [t2](https://a.example/x \'single title\')');
    assert.equal(ok.links.length, 2, 'single quotes as a title delimiter are fine');
  });
});

describe('links', () => {
  test('inline, reference, shortcut, autolink and wiki links are discovered with their labels', () => {
    const doc = parse('[a](b.md) [r][ref] [short] [coll][] <https://x.example/a> [[Wiki Page|label]] [[plain]] [[Target#frag]]\n\n[ref]: c.md "title"\n[short]: <d e.md>\n[coll]: f.md');
    assert.deepEqual(
      doc.links.map((l) => [l.text, l.link]),
      [
        ['a', { kind: 'path', dest: 'b.md' }],
        ['r', { kind: 'path', dest: 'c.md' }],
        ['short', { kind: 'path', dest: 'd e.md' }],
        ['coll', { kind: 'path', dest: 'f.md' }],
        ['https://x.example/a', { kind: 'external', url: 'https://x.example/a' }],
        ['label', { kind: 'wiki', target: 'Wiki Page' }],
        ['plain', { kind: 'wiki', target: 'plain' }],
        ['Target#frag', { kind: 'wiki', target: 'Target' }],
      ],
    );
  });

  test('query and fragment are dropped from relative destinations; fragment-only is text', () => {
    assert.deepEqual(parse('[a](x.md#h) [b](y.md?q=1#z) [c](?q=1)').links.map((l) => l.link), [
      { kind: 'path', dest: 'x.md' },
      { kind: 'path', dest: 'y.md' },
    ]);
  });

  test('links do not nest; emphasis and code inside labels work', () => {
    assert.equal(showInline('[a **b** `c`](x.md)'), 'link<ref:x.md>("a " strong("b") " " `c`)');
    assert.equal(showInline('[a [b](c.md) d](e.md)'), 'link<ref:e.md>("a [b](c.md) d")');
    assert.equal(showInline('**[a](b.md)**'), 'strong(link<ref:b.md>("a"))');
  });

  test('definitions are consumed and not rendered; unknown references stay text', () => {
    assert.equal(show('[x]: y.md\n\ntext [nope] [x]'), 'p["text [nope] " link<ref:y.md>("x")]');
    assert.equal(show('[x]: y.md'), '');
  });
});

describe('structural bounds and hostile input', () => {
  test('every parsed sample validates against the contract AST', () => {
    const doc = parse('# T\n\n- a\n  1. b\n\n> q\n\n| h |\n|---|\n| c |\n\n```\ncode\n```\n\ntext [l](m.md) **s**');
    assert.equal(validateMarkdownDocument(doc.ast).ok, true);
  });

  test('container nesting beyond the bound overflows to a flat link scan (raw upstream)', () => {
    const deep = '> '.repeat(40) + 'see [x](y.md)';
    const result = parseMarkdown(deep);
    assert.equal(result.ok, false);
    if (!result.ok) assert.deepEqual(result.links.map((l) => l.link), [{ kind: 'path', dest: 'y.md' }]);
    const lists = Array.from({ length: 40 }, (_, i) => `${'  '.repeat(i)}- item ${i} [l${i}](p${i}.md)`).join('\n');
    const listResult = parseMarkdown(lists);
    assert.equal(listResult.ok, false);
    if (!listResult.ok) assert.equal(listResult.links.length, 40);
  });

  test('nesting within the parser bounds can still exceed the contract depth and is rejected there', () => {
    const levels = 24;
    const emphasis = (n: number) =>
      Array.from({ length: n }, (_, i) => `${i % 2 === 0 ? '*' : '_'}w `).join('') + 'x' + Array.from({ length: n }, (_, i) => ` w${(n - 1 - i) % 2 === 0 ? '*' : '_'}`).join('');
    const lists = Array.from({ length: levels }, (_, i) => `${'  '.repeat(i)}- ${i === levels - 1 ? emphasis(levels) : `x${i}`}`).join('\n');
    const result = parseMarkdown(lists);
    assert.equal(result.ok, true, 'the parser itself accepts it');
    if (!result.ok) return;
    const ast = resolveDocument(result.doc, () => ({ kind: 'missing', label: 'x' }));
    const checked = validateMarkdownDocument(ast);
    assert.equal(checked.ok, false, `depth beyond ${MAX_AST_DEPTH} is rejected by the contract validator`);
    if (!checked.ok) assert.equal(checked.error.reason, 'too-deep');
  });

  test('pathological inputs return quickly and never throw', () => {
    const started = Date.now();
    const inputs = [
      '*'.repeat(200_000),
      '['.repeat(100_000),
      '[a]('.repeat(50_000),
      '`'.repeat(100_001),
      '*a '.repeat(100_000),
      '_a*'.repeat(60_000),
      '> '.repeat(100_000),
      '|'.repeat(100_000),
      'x'.repeat(2_000_000),
      '<'.repeat(100_000),
      '[[a]]'.repeat(50_000),
      '- '.repeat(50_000),
    ];
    for (const input of inputs) {
      const result = parseMarkdown(input);
      assert.equal(typeof result.ok, 'boolean');
    }
    assert.ok(Date.now() - started < 20_000, `took ${Date.now() - started} ms`);
  });

  test('scanLinks skips fences and code and strips quote and list prefixes', () => {
    const text = ['> - see [a](a.md)', '', '```', '[x](x.md)', '```', '', '    [c](c.md)', '', '1. [b](b.md) and [[Wiki]]', '[ref]: r.md', 'use [ref]'].join('\n');
    assert.deepEqual(
      scanLinks(text).map((l) => l.link),
      [{ kind: 'path', dest: 'a.md' }, { kind: 'path', dest: 'b.md' }, { kind: 'wiki', target: 'Wiki' }, { kind: 'path', dest: 'r.md' }],
    );
  });
});

function blocksText(nodes: readonly import('../../contract/src/index.ts').BlockNode[]): string {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.type === 'paragraph') {
      out.push(
        node.children
          .map((child) => {
            if (child.type !== 'text') throw new Error(`expected only text, found ${child.type}`);
            return child.value;
          })
          .join(''),
      );
    } else throw new Error(`expected paragraphs, found ${node.type}`);
  }
  return out.join('\n\n');
}
