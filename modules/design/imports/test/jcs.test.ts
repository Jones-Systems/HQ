import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, digestBytes, digestJson, utf8, webCryptoDigest } from '../src/jcs.ts';

test('RFC 8785 section 3.2.2 sample canonicalizes exactly', () => {
  const input = JSON.parse('{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}');
  assert.equal(
    canonicalize(input),
    '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
  );
});

test('RFC 8785 section 3.2.3 property sorting uses UTF-16 code units', () => {
  const input: Record<string, string> = { '\u20ac': 'Euro Sign', '\r': 'Carriage Return', '\ufb33': 'Hebrew Letter Dalet With Dagesh', '1': 'One', '\ud83d\ude00': 'Emoji: Grinning Face', '\u0080': 'Control', '\u00f6': 'Latin Small Letter O With Diaeresis' };
  // Compare canonical text: Object.keys would hoist the integer-like key.
  const order = ['\r', '1', '\u0080', '\u00f6', '\u20ac', '\ud83d\ude00', '\ufb33'];
  assert.equal(canonicalize(input), `{${order.map((key) => `${JSON.stringify(key)}:${JSON.stringify(input[key])}`).join(',')}}`);
});

test('SHA-256 and JCS digests match independent golden vectors', async () => {
  assert.equal(await digestBytes(webCryptoDigest, utf8('abc')), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  // Independently computed with Python json.dumps(sort_keys, compact) + hashlib for this ASCII-keyed object.
  assert.equal(
    await digestJson(webCryptoDigest, { b: [1, 2.5, true, null], a: { z: 'é€😀', y: -3 }, _: '' }),
    'sha256:98961a62edb5b2a0e88664080b8aa6bc1c50fac23a589600e298fe4caf7953bb',
  );
});

test('unsupported and non-finite values are rejected', () => {
  for (const value of [Number.NaN, Infinity, undefined, () => 1, 1n, new Date(0), { a: undefined }, '\ud800', [, 1]]) {
    assert.throws(() => canonicalize(value), `rejects ${String(value)}`);
  }
  assert.equal(canonicalize(-0), '0');
});
