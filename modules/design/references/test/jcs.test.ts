import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalize, CanonicalizationError, jcsDigest, sha256Hex } from '../src/jcs.ts';

test('JCS golden vectors: key order, numbers and escapes', () => {
  assert.equal(canonicalize({ b: 2, a: 1, c: [true, null, 'x'] }), '{"a":1,"b":2,"c":[true,null,"x"]}');
  // RFC 8785 §3.2.2.3 number samples.
  assert.equal(canonicalize([1e21, 1e-7, 0.000001, -0, 333333333.3333333, 1e23]), '[1e+21,1e-7,0.000001,0,333333333.3333333,1e+23]');
  assert.equal(canonicalize('\u20ac$\u000f\nA\'B"\\\\"/'), '"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"');
  // Keys sort by UTF-16 code units (RFC 8785 §3.2.3 sample subset).
  assert.equal(canonicalize({ '\u20ac': 1, '\r': 2, '\ud83d\ude00': 3, '1': 4, '\u0080': 5 }), '{"\\r":2,"1":4,"\u0080":5,"\u20ac":1,"\ud83d\ude00":3}');
  assert.equal(canonicalize({ a: undefined, b: 1 }), '{"b":1}');
});

test('JCS rejects values it cannot represent', () => {
  for (const value of [Number.NaN, Number.POSITIVE_INFINITY, '\ud800', new Date(0), 1n, [undefined]]) {
    assert.throws(() => canonicalize(value), CanonicalizationError);
  }
});

test('SHA-256 golden vectors', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(await sha256Hex(new Uint8Array()), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(await jcsDigest({ b: 1, a: 2 }), await sha256Hex('{"a":2,"b":1}'));
});
