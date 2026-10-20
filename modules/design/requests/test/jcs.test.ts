import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalize, sha256 } from '../src/jcs.ts';

const encode = (text: string) => new TextEncoder().encode(text);

test('RFC 8785 §3.2.3 number, string and literal vector', () => {
  const input = JSON.parse('{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}');
  assert.equal(canonicalize(input), '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}');
});

test('RFC 8785 §3.2.3 property sorting by UTF-16 code units', () => {
  const input = JSON.parse('{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One","\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control","\\u00f6":"Latin Small Letter O With Diaeresis"}');
  const keys = Object.keys(JSON.parse(canonicalize(input)) as object);
  assert.deepEqual(keys.map((key) => [...key].map((char) => char.codePointAt(0)!.toString(16)).join('+')), ['31', 'd', '80', 'f6', '20ac', '1f600', 'fb33']);
  assert.ok(canonicalize(input).startsWith('{"\\r":"Carriage Return","1":"One","\u0080":"Control"'));
});

test('negative zero and nested values serialize canonically', () => {
  assert.equal(canonicalize({ b: [-0, 1.5, { d: null, c: 'x' }], a: true }), '{"a":true,"b":[0,1.5,{"c":"x","d":null}]}');
});

test('unsupported values are rejected', () => {
  assert.throws(() => canonicalize({ value: Number.NaN }), /non-finite/u);
  assert.throws(() => canonicalize({ value: Infinity }), /non-finite/u);
  assert.throws(() => canonicalize({ value: 1n }), /unsupported/u);
  assert.throws(() => canonicalize({ value: '\ud800' }), /lone surrogate/u);
  assert.throws(() => canonicalize({ value: new Date(0) }), /non-plain/u);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalize(cyclic), /cyclic/u);
});

test('SHA-256 golden vectors', async () => {
  assert.equal(await sha256(encode('')), 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await sha256(encode('abc')), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
