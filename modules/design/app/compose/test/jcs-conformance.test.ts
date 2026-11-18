import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canonicalize as compose, authoringDigest, sameCanonical, type AuthoringDigest, type WireDigest } from '../canonical.ts';
import { canonicalize as store, digestOfJson } from '../../../../../packages/design-store/src/jcs.ts';
import { canonicalize as components, jcsDigest as componentsDigest } from '../../../components/src/model/jcs.ts';
import { canonicalize as flows, jcsDigest as flowsDigest } from '../../../flows/src/jcs.ts';
import { canonicalize as discovery, jcsSha256Hex as discoveryHex } from '../../../discovery/src/jcs.ts';
import { canonicalize as imports, digestJson as importsDigest, webCryptoDigest as importsPort } from '../../../imports/src/jcs.ts';
import { canonicalize as references, jcsDigest as referencesDigest } from '../../../references/src/jcs.ts';
import { canonicalJson as canvas } from '../../../canvas/src/codec.ts';

type Canonicalize = (value: unknown) => string;
const IMPLEMENTATIONS: Readonly<Record<string, Canonicalize>> = { compose, store, components, flows, discovery, imports, references, canvas };

const RFC_8785_EXAMPLE = JSON.parse('{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}') as unknown;
const RFC_8785_EXPECTED = '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}';

/** Inputs every implementation must serialize identically. */
const AGREED: readonly (readonly [string, unknown, string])[] = [
  ['RFC 8785 section 3.2.2 example', RFC_8785_EXAMPLE, RFC_8785_EXPECTED],
  ['ES number form and negative zero', [-0, 1e21, 1e-7, 0.1, 100, 5e-324], '[0,1e+21,1e-7,0.1,100,5e-324]'],
  ['UTF-16 code unit key order', { '€': 1, '\r': 2, 'דּ': 3, 'b': 4, '😀': 5, 'a': 6, 'ö': 7 }, '{"\\r":2,"a":6,"b":4,"ö":7,"דּ":3,"€":1,"😀":5}'],
  ['null-prototype objects', Object.assign(Object.create(null), { b: 1, a: 2 }), '{"a":2,"b":1}'],
  ['control characters and escapes', 'a\u0000\u001f"\\', '"a\\u0000\\u001f\\"\\\\"'],
  ['nesting and literals', { z: [true, false, null, { y: 1, x: [] }], a: {} }, '{"a":{},"z":[true,false,null,{"x":[],"y":1}]}'],
];

/** Inputs every implementation rejects. */
const UNIVERSAL_REJECTIONS: readonly (readonly [string, unknown])[] = [
  ['NaN', [Number.NaN]], ['Infinity', [Number.POSITIVE_INFINITY]], ['bigint', 1n], ['function', () => 1], ['Date', new Date(0)],
];

describe('JCS conformance across composition, the store and the lanes', () => {
  for (const [name, implementation] of Object.entries(IMPLEMENTATIONS)) {
    it(`${name} serializes the agreed vectors identically`, () => {
      for (const [label, input, expected] of AGREED) assert.equal(implementation(input), expected, label);
    });
    it(`${name} rejects values JSON cannot represent`, () => {
      for (const [label, input] of UNIVERSAL_REJECTIONS) assert.throws(() => implementation(input), (error: unknown) => error instanceof Error, label);
    });
  }

  /**
   * Where the implementations deliberately or accidentally differ. Pinned so a change in any lane or in the
   * store shows up here instead of silently forking digests. `true` means the implementation REJECTS the input.
   */
  const DIVERGENCES: readonly (readonly [string, unknown, Readonly<Record<string, boolean>>])[] = [
    ['undefined member', { a: undefined }, { compose: true, store: true, components: true, flows: true, discovery: false, imports: true, references: false, canvas: true }],
    ['lone high surrogate', ['\ud800'], { compose: true, store: true, components: false, flows: false, discovery: true, imports: true, references: true, canvas: false }],
    ['lone low surrogate in a key', { '\udc00': 1 }, { compose: true, store: true, components: false, flows: false, discovery: true, imports: true, references: true, canvas: false }],
    ['sparse array', [1, , 3], { compose: true, store: true, components: false, flows: false, discovery: false, imports: true, references: false, canvas: false }],
  ];
  for (const [label, input, expected] of DIVERGENCES) {
    it(`pins which implementations reject: ${label}`, () => {
      const actual = Object.fromEntries(Object.entries(IMPLEMENTATIONS).map(([name, implementation]) => {
        try { implementation(input); return [name, false]; } catch { return [name, true]; }
      }));
      assert.deepEqual(actual, expected);
    });
  }

  it('the lenient implementations emit text a strict JSON parser rejects for a sparse array (hole between commas)', () => {
    assert.equal(flows([1, , 3]), '[1,,3]');
    assert.throws(() => JSON.parse(flows([1, , 3])));
  });

  it('every SHA-256 JCS digest agrees on the same record, so authoring digests do not fork', async () => {
    const record = { schema: 'hq.design.example/v1', id: 'x', n: [1, 2.5, -0], nested: { b: true, a: null } };
    const expected = digestOfJson(record as never);
    assert.equal(await authoringDigest(record), expected);
    assert.equal(await componentsDigest(record), expected);
    assert.equal(await flowsDigest(record), expected);
    // references' jcsDigest returns the bare hex without the `sha256:` prefix every other digest carries.
    assert.equal(await referencesDigest(record), expected.slice('sha256:'.length));
    assert.equal(`sha256:${await discoveryHex(record)}`, expected);
    assert.equal(await importsDigest(importsPort, record as never), expected);
  });

  it('digests of the known empty object match the published SHA-256 vector', async () => {
    assert.equal(await authoringDigest({}), 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  });

  it('compares records by canonical form, ignoring key order, and treats unrepresentable values as unequal', () => {
    assert.equal(sameCanonical({ a: 1, b: [2] }, { b: [2], a: 1 }), true);
    assert.equal(sameCanonical({ a: 1 }, { a: 2 }), false);
    assert.equal(sameCanonical({ a: Number.NaN }, { a: Number.NaN }), false);
  });

  it('keeps authoring and wire digests distinct types (a wire digest is never an authoring digest)', () => {
    const authoring = 'sha256:0'.padEnd(71, '0') as AuthoringDigest;
    // @ts-expect-error a wire digest cannot be passed where an authoring digest is expected
    const asAuthoring: AuthoringDigest = 'sha256:0'.padEnd(71, '0') as WireDigest;
    // @ts-expect-error an authoring digest cannot be passed where a wire digest is expected
    const asWire: WireDigest = authoring;
    assert.equal(typeof asAuthoring, 'string');
    assert.equal(typeof asWire, 'string');
  });
});
