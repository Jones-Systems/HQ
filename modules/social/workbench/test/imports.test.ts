import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES } from '../../core';
import { describeShape, lineColumn, parseImportText, parseJsonLines, parseJsonText, readImportFile } from '../imports';

describe('typed file import', () => {
  it('reports JSON syntax errors with a line and column', () => {
    const result = parseJsonText('{\n  "name": "x",\n  oops\n}');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/^Not valid JSON at line 3, column 3/u);
    expect(lineColumn('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
  });

  it('reads JSON Lines by name or as a fallback, and names the failing line', () => {
    expect(parseImportText('{"a":1}\n\n{"a":2}\n', 'answers.jsonl', 'json-or-jsonl')).toEqual({ ok: true, value: [{ a: 1 }, { a: 2 }] });
    expect(parseImportText('{"a":1}\n{"a":2}', 'answers.txt', 'json-or-jsonl')).toEqual({ ok: true, value: [{ a: 1 }, { a: 2 }] });
    expect(parseImportText('{"a":1}\n{"a":2}', 'answers.json', 'json').ok).toBe(false);
    const bad = parseJsonLines('{"a":1}\n{"a":}\n');
    expect(!bad.ok && bad.message).toMatch(/line 2/u);
  });

  it('rejects empty and oversized files without reading them as input', async () => {
    expect(await readImportFile(new File([''], 'empty.json'), 'json')).toEqual({ ok: false, message: 'empty.json is empty.' });
    const big = new File([new Uint8Array(MAX_BODY_BYTES + 1)], 'big.json');
    expect(await readImportFile(big, 'json')).toMatchObject({ ok: false, message: expect.stringMatching(/larger than 2 MB/u) });
    expect(await readImportFile(new File(['{"x": [1]}'], 'ok.json'), 'json')).toEqual({ ok: true, imported: { value: { x: [1] }, origin: { kind: 'file', name: 'ok.json', bytes: 10 } } });
  });

  it('previews shape without echoing values', () => {
    expect(describeShape({ name: 'Secret-ish value', terms: ['a', 'b'], as_of: 'x' })).toBe('Object · 3 keys (name, terms, as_of) · terms: 2 items');
    expect(describeShape([{ id: 1, title: 'A' }, { id: 2 }])).toBe('List of 2 records · keys id, title');
    expect(describeShape([1, 2, 3])).toBe('List of 3 values');
    expect(describeShape([])).toBe('Empty list');
    expect(describeShape('text')).toBe('Text');
  });
});
