import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalize, digestOfBytes, digestOfJson, sha256Hex } from '../src/jcs.ts';
import { isStoreError } from '../src/errors.ts';

describe('RFC 8785 canonical JSON', () => {
  it('matches the RFC 8785 section 3.2.2 example', () => {
    const input = JSON.parse('{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}');
    assert.equal(
      canonicalize(input),
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts properties by UTF-16 code units (RFC 8785 section 3.2.3)', () => {
    const input = { '€': 'Euro Sign', '\r': 'Carriage Return', 'דּ': 'Hebrew Letter Dalet With Dagesh', '1': 'One', '😀': 'Emoji: Grinning Face', '\u0080': 'Control', 'ö': 'Latin Small Letter O With Diaeresis' };
    // Read the order from the text: Object.keys would hoist the integer-like key "1".
    const keys = [...canonicalize(input).matchAll(/"((?:[^"\\]|\\.)*)":/gu)].map((match) => JSON.parse(`"${match[1] ?? ''}"`) as string);
    assert.deepEqual(keys, ['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ']);
  });

  it('serializes numbers in ECMAScript form and -0 as 0', () => {
    assert.equal(canonicalize([-0, 1e21, 1e-7, 0.1, 100, 5e-324]), '[0,1e+21,1e-7,0.1,100,5e-324]');
  });

  it('rejects values JSON cannot represent exactly', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, undefined, 1n, () => 1, new Date(0), { a: undefined }, ['\ud800'], { '\udc00': 1 }, cyclic, [1, , 3]]) {
      assert.throws(() => canonicalize(value), (error) => isStoreError(error, 'invalid-argument'));
    }
  });

  it('digests use SHA-256 golden vectors', () => {
    assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(digestOfJson({}), 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
    assert.equal(digestOfBytes(new TextEncoder().encode('hello')), 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    assert.equal(digestOfJson({ b: 1, a: [true, null] }), digestOfJson({ a: [true, null], b: 1 }));
  });
});
