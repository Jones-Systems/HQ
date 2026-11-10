import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalize, isDigest, jcsDigest, sha256Hex } from '../src/model/jcs.ts';

test('JCS sorts keys by UTF-16 code units and emits no whitespace', () => {
  assert.equal(canonicalize({ b: 1, a: [true, null, 'x'], '\u20ac': 0, '\r': 1 }), '{"\\r":1,"a":[true,null,"x"],"b":1,"\u20ac":0}');
});

test('JCS number serialization follows ECMAScript (RFC 8785 vectors)', () => {
  assert.equal(canonicalize([1e21, 0.000001, 1e-7, -0, 4.5, 333333333.3333333]), '[1e+21,0.000001,1e-7,0,4.5,333333333.3333333]');
});

test('JCS rejects values that are not I-JSON', () => {
  for (const bad of [Number.NaN, Infinity, undefined, () => 1, 1n, new Date(0), { a: undefined }]) {
    assert.throws(() => canonicalize(bad));
  }
});

test('SHA-256 golden vectors', async () => {
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const digest = await jcsDigest({ b: 2, a: 1 });
  assert.equal(digest, `sha256:${await sha256Hex('{"a":1,"b":2}')}`);
  assert.ok(isDigest(digest));
});
