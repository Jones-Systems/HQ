import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CanonicalizationError, canonicalize } from '../src/jcs.ts';
import { nodeSha256 } from '../src/node-file-system.ts';
import { webCryptoSha256 } from '../src/web-digest.ts';

const encoder = new TextEncoder();

describe('RFC 8785 canonicalization', () => {
  it('matches the RFC 8785 section 3.2.2 golden vector', () => {
    const input = JSON.parse('{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}');
    assert.equal(canonicalize(input), '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}');
  });

  it('sorts keys by UTF-16 code units (RFC 8785 section 3.2.3 order)', () => {
    const input = { '€': 'Euro Sign', '\r': 'Carriage Return', 'דּ': 'Hebrew Letter Dalet With Dagesh', '1': 'One', '😀': 'Emoji: Grinning Face', '\u0080': 'Control', 'ö': 'Latin Small Letter O With Diaeresis' };
    // Parse the output text directly: object key enumeration would hoist "1".
    const keys = [...canonicalize(input).matchAll(/"((?:[^"\\]|\\.)*)":/gu)].map((match) => JSON.parse(`"${match[1]}"`));
    assert.deepEqual(keys, ['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ']);
  });

  it('rejects values that are not I-JSON', () => {
    for (const value of [Number.NaN, Infinity, undefined, () => 1, 1n, new Date(0), '\ud800', { a: undefined }]) {
      assert.throws(() => canonicalize(value), CanonicalizationError);
    }
  });
});

describe('SHA-256 adapters', () => {
  it('node and WebCrypto agree on the FIPS 180-2 vectors', async () => {
    for (const sha256 of [nodeSha256, webCryptoSha256]) {
      assert.equal(await sha256(encoder.encode('')), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
      assert.equal(await sha256(encoder.encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    }
  });
});
