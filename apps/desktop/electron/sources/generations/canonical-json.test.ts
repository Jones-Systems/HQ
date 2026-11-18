import { expect, it } from 'vitest';
import { canonicalJson, parseCanonicalJson } from './canonical-json.js';

const utf8 = (value: string) => new TextEncoder().encode(value);
it('requires byte-identical canonical UTF-8 including duplicate keys, integer spelling and escapes', () => {
  expect(parseCanonicalJson(utf8('{"a":1,"b":"é"}'))).toEqual({ a: 1, b: 'é' });
  for (const text of ['{"b":2,"a":1}', '{"a":1,"a":1}', '{"a":1.0}', '{"a":-0}', '{"a":1e0}',
    '{"a":1} ', '\ufeff{"a":1}', '{"a":"\\u0061"}', '{"a":"\\ud800"}', '{"a":9007199254740992}'])
    expect(() => parseCanonicalJson(utf8(text)), text).toThrow();
  expect(() => parseCanonicalJson(new Uint8Array([0xc3, 0x28]))).toThrow();
});
it('orders keys by Unicode code point rather than UTF-16 units at every level', () => {
  const value = { nested: { '\u{10000}': 2, '\ue000': 1 } };
  const expected = '{"nested":{"\ue000":1,"\u{10000}":2}}';
  expect(new TextDecoder().decode(canonicalJson(value))).toBe(expected);
  expect(parseCanonicalJson(utf8(expected))).toEqual(value);
  expect(() => parseCanonicalJson(utf8('{"nested":{"\u{10000}":2,"\ue000":1}}'))).toThrow();
});
it('bounds nesting and accepts only safe integer JSON values', () => {
  let nested: unknown = null;
  for (let i = 0; i < 48; i++) nested = [nested];
  expect(parseCanonicalJson(canonicalJson(nested))).toEqual(nested);
  expect(() => canonicalJson([nested])).toThrow('document_too_deep');
  for (const value of [undefined, NaN, Infinity, 0.5, -0, 9007199254740992, new Date(), '\ud800'])
    expect(() => canonicalJson(value)).toThrow();
  const cycle: unknown[] = []; cycle.push(cycle);
  expect(() => canonicalJson(cycle)).toThrow('invalid_json');
  expect(() => parseCanonicalJson(utf8('null'), 3)).toThrow('document_too_large');
});
