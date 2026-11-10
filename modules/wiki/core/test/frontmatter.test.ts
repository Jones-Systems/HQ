import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseFrontmatter } from '../src/index.ts';

function fields(input: string) {
  const result = parseFrontmatter(input);
  assert.equal(result.status, 'ok', `expected ok, got ${result.status}`);
  if (result.status !== 'ok') throw new Error('unreachable');
  return Object.fromEntries(result.fields.map((f) => [f.name, f.value]));
}

function unsupported(input: string) {
  assert.equal(parseFrontmatter(input).status, 'unsupported', JSON.stringify(input));
}

describe('frontmatter delimiters', () => {
  test('no frontmatter when the first line is not ---', () => {
    const result = parseFrontmatter('# Title\n---\nbody');
    assert.deepEqual(result, { status: 'none', body: '# Title\n---\nbody' });
    assert.equal(parseFrontmatter(' ---\na: b\n---\n').status, 'none');
    assert.equal(parseFrontmatter('----\na: b\n---\n').status, 'none');
  });

  test('begins at byte zero after an optional BOM', () => {
    assert.deepEqual(fields('\uFEFF---\ntitle: A\n---\nbody'), { title: 'A' });
    assert.equal(parseFrontmatter('\n---\ntitle: A\n---\n').status, 'none');
  });

  test('closes with --- or ... and the body follows', () => {
    const a = parseFrontmatter('---\ntitle: A\n---\nbody text');
    assert.equal(a.status === 'ok' && a.body, 'body text');
    const b = parseFrontmatter('---\ntitle: A\n...\nbody text');
    assert.equal(b.status === 'ok' && b.body, 'body text');
    const c = parseFrontmatter('---\r\ntitle: A\r\n---\r\nbody');
    assert.equal(c.status === 'ok' && c.body, 'body');
    assert.deepEqual(fields('---\n---\nbody'), {});
  });

  test('an unclosed block is unsupported and keeps the text after the opening line as body', () => {
    const result = parseFrontmatter('---\ntitle: A\nbody continues');
    assert.deepEqual(result, { status: 'unsupported', body: 'title: A\nbody continues' });
  });
});

describe('frontmatter scalars', () => {
  test('plain, quoted, numeric and boolean values', () => {
    const f = fields(
      [
        '---',
        'title: Plain title # comment',
        'quoted: "tab\\there \\u0041 \\x42 \\" \\\\ \\/"',
        "single: 'it''s fine'",
        'int: 42',
        'neg: -7',
        'dec: 3.25',
        'yes_t: true',
        'no_f: false',
        'word_yes: yes',
        'word_no: no',
        'zero_lead: 007',
        'hash: a#b',
        '---',
      ].join('\n'),
    );
    assert.equal(f['title'], 'Plain title');
    assert.equal(f['quoted'], 'tab\there A B " \\ /');
    assert.equal(f['single'], "it's fine");
    assert.equal(f['int'], 42);
    assert.equal(f['neg'], -7);
    assert.equal(f['dec'], 3.25);
    assert.equal(f['yes_t'], true);
    assert.equal(f['no_f'], false);
    assert.equal(f['word_yes'], 'yes', 'yes stays a string');
    assert.equal(f['word_no'], 'no', 'no stays a string');
    assert.equal(f['zero_lead'], '007', 'a leading zero is not a decimal number');
    assert.equal(f['hash'], 'a#b');
  });

  test('quoted values are always strings', () => {
    const f = fields('---\na: "true"\nb: "12"\nc: "null"\nd: ""\n---\n');
    assert.deepEqual(f, { a: 'true', b: '12', c: 'null', d: '' });
  });

  test('overlong numbers and negative zero stay strings (nothing is silently altered)', () => {
    const f = fields('---\nbig: 12345678901234567890\nnz: -0\n---\n');
    assert.equal(f['big'], '12345678901234567890');
    assert.equal(f['nz'], '-0');
  });

  test('comments and blank lines are skipped', () => {
    assert.deepEqual(fields('---\n# a comment\n\ntitle: A\n   # indented comment-only line\n---\n'), { title: 'A' });
  });
});

describe('null projection: omitted, never coerced', () => {
  test('null, ~, empty and comment-only values are omitted and counted', () => {
    const result = parseFrontmatter('---\na: null\nb: ~\nc:\nd: # nothing\ne: kept\n---\n');
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    assert.deepEqual(result.fields, [{ name: 'e', value: 'kept' }]);
    assert.equal(result.nullOmissions, 4);
  });

  test('null list items are omitted from block and flow lists, other items are kept', () => {
    const result = parseFrontmatter('---\nblock:\n  - one\n  - null\n  -\n  - ~\n  - two\nflow: [a, null, ~, "null", b]\n---\n');
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    assert.deepEqual(Object.fromEntries(result.fields.map((f) => [f.name, f.value])), { block: ['one', 'two'], flow: ['a', 'null', 'b'] });
    assert.equal(result.nullOmissions, 5);
  });

  test('a null value never becomes false, 0 or an empty string and never forces raw', () => {
    const f = fields('---\nflag:\ncount: ~\nname: null\nreal: false\n---\n');
    assert.deepEqual(f, { real: false });
  });
});

describe('lists', () => {
  test('block lists at the key indent or indented', () => {
    assert.deepEqual(fields('---\ntags:\n- a\n- b\nnext: 1\n---\n'), { tags: ['a', 'b'], next: 1 });
    assert.deepEqual(fields('---\ntags:\n    - "x y"\n    - 2\n    - true\n---\n'), { tags: ['x y', 2, true] });
  });

  test('flow lists with quotes, trailing comma and empty list', () => {
    assert.deepEqual(fields('---\na: [one, "two, three", \'four\', 5,]\nb: []\n---\n'), { a: ['one', 'two, three', 'four', 5], b: [] });
  });

  test('a blank or comment line may sit between a key and its list', () => {
    assert.deepEqual(fields('---\ntags:\n\n# c\n  - a\n---\n'), { tags: ['a'] });
  });
});

describe('unsupported syntax falls back (no silent loss)', () => {
  const cases: Record<string, string> = {
    'duplicate key': '---\na: 1\na: 2\n---\n',
    'invalid key (spaces)': '---\nbad key: 1\n---\n',
    'invalid key (quoted)': '---\n"a": 1\n---\n',
    'reserved key': '---\n__proto__: 1\n---\n',
    'key without colon': '---\njust text\n---\n',
    'nested map': '---\nparent:\n  child: 1\n---\n',
    'flow map': '---\na: {b: 1}\n---\n',
    anchor: '---\na: &x 1\n---\n',
    alias: '---\na: *x\n---\n',
    tag: '---\na: !!str 1\n---\n',
    'block scalar |': '---\na: |\n  text\n---\n',
    'block scalar >': '---\na: >\n  text\n---\n',
    'multiline plain': '---\na: first\n  second\n---\n',
    'unclosed double quote': '---\na: "open\n---\n',
    'unclosed single quote': "---\na: 'open\n---\n",
    'text after quote': '---\na: "x" y\n---\n',
    'bad escape': '---\na: "\\q"\n---\n',
    'short unicode escape': '---\na: "\\u12"\n---\n',
    'NUL escape': '---\na: "\\x00"\n---\n',
    'lone surrogate escape': '---\na: "\\uD800"\n---\n',
    'nested block list': '---\na:\n  - - x\n---\n',
    'map in list': '---\na:\n  - k: v\n---\n',
    'mixed list indent': '---\na:\n  - x\n    - y\n---\n',
    'nested flow list': '---\na: [[x]]\n---\n',
    'flow map in list': '---\na: [{x: 1}]\n---\n',
    'empty flow item': '---\na: [x,, y]\n---\n',
    'unclosed flow list': '---\na: [x, y\n---\n',
    'colon in plain value': '---\na: x: y\n---\n',
    'value ending in colon': '---\na: x:\n---\n',
    'complex key': '---\n? a\n---\n',
    'list item at top level': '---\n- a\n---\n',
    'indented key': '---\n  a: 1\n---\n',
  };
  for (const [name, input] of Object.entries(cases)) {
    test(name, () => unsupported(input));
  }

  test('structural overflow: too many fields, too many list items, value too long', () => {
    unsupported('---\n' + Array.from({ length: 65 }, (_, i) => `k${i}: v`).join('\n') + '\n---\n');
    assert.equal(Object.keys(fields('---\n' + Array.from({ length: 64 }, (_, i) => `k${i}: v`).join('\n') + '\n---\n')).length, 64);
    unsupported('---\nl:\n' + Array.from({ length: 65 }, () => '  - x').join('\n') + '\n---\n');
    assert.equal((fields('---\nl:\n' + Array.from({ length: 64 }, () => '  - x').join('\n') + '\n---\n')['l'] as unknown[]).length, 64);
    unsupported(`---\nv: "${'x'.repeat(2049)}"\n---\n`);
    assert.equal((fields(`---\nv: "${'x'.repeat(2048)}"\n---\n`)['v'] as string).length, 2048);
    unsupported(`---\n${'k'.repeat(65)}: 1\n---\n`);
  });

  test('the body is still returned so raw pages keep deriving links', () => {
    const result = parseFrontmatter('---\na: 1\na: 2\n---\nSee [x](y.md).');
    assert.deepEqual(result, { status: 'unsupported', body: 'See [x](y.md).' });
  });
});
