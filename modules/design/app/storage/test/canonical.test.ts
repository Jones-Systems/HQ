import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalize as storeCanonicalize } from '../../../../../packages/design-store/src/jcs.ts';
import { canonicalize as requestsCanonicalize } from '../../../requests/src/jcs.ts';
import { canonicalBytes, CanonicalJsonError, NonCanonicalBytesError, parseCanonicalBytes, toJson } from '../canonical.ts';

const SAMPLES: unknown[] = [
  null, true, 0, -0.5, 1e21, 'é€\u{1F3AF}\n"q"', [], {}, { b: 1, a: [1, { z: null, y: 'x' }], 'ä': 2 },
  { n: 123456789012345680000, s: '\u0007', nested: { '€': 1, '\r': 2 } },
];

describe('canonical JSON', () => {
  it('matches the store and requests serializers byte for byte', () => {
    for (const sample of SAMPLES) {
      assert.equal(canonicalize(sample), storeCanonicalize(sample as never));
      assert.equal(canonicalize(sample), requestsCanonicalize(sample));
    }
  });

  it('refuses values JSON cannot carry', () => {
    for (const bad of [Number.NaN, Infinity, () => 1, 1n, Symbol('x'), '\ud800', new Date(0), (() => { const a: unknown[] = []; a.push(a); return a; })()]) {
      assert.throws(() => canonicalize(bad), CanonicalJsonError);
    }
  });

  it('round-trips canonical bytes and rejects everything else', () => {
    const value = { b: [1, 2], a: 'x' };
    const bytes = canonicalBytes(value);
    assert.deepEqual(parseCanonicalBytes(bytes), toJson(value));
    const encode = (text: string) => new TextEncoder().encode(text);
    for (const text of ['{"b":1,"a":2}', '{"a": 1}', '[1, 2]', ' null', '{"a":1}\n', '{']) {
      assert.throws(() => parseCanonicalBytes(encode(text)), NonCanonicalBytesError, text);
    }
    assert.throws(() => parseCanonicalBytes(new Uint8Array([0xff, 0xfe])), NonCanonicalBytesError);
  });
});

function canonicalize(value: unknown): string {
  return canonicalBytes(value).length === 0 ? '' : new TextDecoder().decode(canonicalBytes(value));
}
