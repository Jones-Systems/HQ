import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CanonicalJsonError, canonicalJson, digestOf, isDigest, sha256Hex } from '../src/canonical.ts';

describe('RFC 8785 canonical JSON', () => {
  it('matches the RFC 8785 §3.2.2 example', () => {
    const input = JSON.parse('{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}');
    assert.equal(
      canonicalJson(input),
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts keys by UTF-16 code units', () => {
    // RFC 8785 §3.2.3 sorting example keys.
    const input = { '€': 'Euro Sign', '\r': 'Carriage Return', 'דּ': 'Hebrew Letter Dalet With Dagesh', '1': 'One', '😀': 'Emoji: Grinning Face', '\u0080': 'Control', 'ö': 'Latin Small Letter O With Diaeresis' };
    // Read keys from the text: re-parsing would let the engine move the integer-like key "1" first.
    const keys = [...canonicalJson(input).matchAll(/"((?:[^"\\]|\\.)*)":/gu)].map((match) => JSON.parse(`"${match[1]}"`) as string);
    assert.deepEqual(keys, ['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ']);
  });

  it('normalizes -0 and rejects values JSON cannot represent', () => {
    assert.equal(canonicalJson({ a: -0 }), '{"a":0}');
    for (const bad of [{ a: Number.NaN }, { a: Infinity }, { a: undefined }, { a: 1n }, { a: () => 1 }, { a: new Date(0) }, { a: new Map() }]) {
      assert.throws(() => canonicalJson(bad), CanonicalJsonError);
    }
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.throws(() => canonicalJson(cyclic), CanonicalJsonError);
  });

  it('allows a repeated non-cyclic reference', () => {
    const shared = { x: 1 };
    assert.equal(canonicalJson({ a: shared, b: shared }), '{"a":{"x":1},"b":{"x":1}}');
  });
});

describe('SHA-256 digests', () => {
  it('matches known vectors', async () => {
    assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('digests the canonical form, so key order does not matter', async () => {
    const a = await digestOf({ b: 1, a: [true, null] });
    const b = await digestOf({ a: [true, null], b: 1 });
    assert.equal(a, b);
    assert.equal(a, `sha256:${await sha256Hex('{"a":[true,null],"b":1}')}`);
    assert.ok(isDigest(a));
    assert.ok(!isDigest('sha256:ABC'));
  });
});
