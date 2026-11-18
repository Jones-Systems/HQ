import { describe, expect, it } from 'vitest';
import { canonicalBytes, canonicalDigest, canonicalJson, closedRecord, ContractError } from './canonical.js';

describe('closed canonical JSON', () => {
  // Literal UTF-8 vectors hashed independently of these modules during fixture authoring.
  it.each([
    [null, 'null', '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b'],
    [{}, '{}', '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'],
    [{ z: 'é', a: [true, null, -9007199254740991, 9007199254740991] },
      '{"a":[true,null,-9007199254740991,9007199254740991],"z":"é"}',
      '016cf2fe3915edc3a028820a7fffb423390308304e3ed8eefd1f3080d7f778cc'],
  ])('pins independent string, bytes and digest for %j', (value, json, hash) => {
    expect(canonicalJson(value)).toBe(json);
    expect(canonicalBytes(value)).toEqual(new TextEncoder().encode(json as string));
    expect(canonicalDigest(value)).toBe(`sha256:${hash}`);
  });

  it('sorts lexically rather than insertion/numeric/locale order without changing strings', () => {
    expect(canonicalJson({ '2': 2, '10': 10, Z: '\n"\\', a: 'e\u0301' }))
      .toBe('{"10":10,"2":2,"Z":"\\n\\"\\\\","a":"é"}');
    expect(canonicalJson(Object.assign(Object.create(null), { b: 2, a: 1 }))).toBe('{"a":1,"b":2}');
    expect(canonicalJson(-0)).toBe('0');
    const shared = { x: 1 };
    expect(canonicalJson([shared, shared])).toBe('[{"x":1},{"x":1}]');
  });

  it.each([undefined, 0.5, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1,
    NaN, Infinity, -Infinity, () => 1, Symbol('x'), 1n, new Date('2026-01-01'), new Map(),
    new Set(), new Uint8Array([1]), /x/u, new (class Example { a = 1; })(),
    { a: undefined }, [undefined], { toJSON: () => ({}) }, new Array(1),
  ].map(value => ({ value })))('rejects unsupported/lossy value $value', ({ value }) => {
    expect(() => canonicalJson(value)).toThrow(ContractError);
  });

  it('rejects cycles, accessors, hidden/symbol fields and decorated arrays without invoking getters', () => {
    const cycle: unknown[] = []; cycle.push(cycle);
    const hidden = Object.defineProperty({}, 'hidden', { value: 1 });
    const getter = Object.defineProperty({}, 'x', { enumerable: true, get() { throw new Error('getter ran'); } });
    const symbol = { [Symbol('hidden')]: 1 };
    const decorated = Object.assign([1], { extra: 2 });
    const subclass = new (class extends Array<number> {})();
    for (const value of [cycle, hidden, getter, symbol, decorated, subclass]) {
      expect(() => canonicalJson(value)).toThrow(ContractError);
    }
    let nested: unknown = null;
    for (let i = 0; i < 130; i += 1) nested = [nested];
    expect(() => canonicalJson(nested)).toThrow(/nesting/u);
  });

  it('rejects missing and unknown closed fields, including own undefined fields', () => {
    expect(() => closedRecord({ a: 1, extra: undefined }, ['a'])).toThrow();
    expect(() => closedRecord(Object.create({ a: 1 }), ['a'])).toThrow();
    expect(() => closedRecord({}, ['a'])).toThrow();
    expect(closedRecord({ a: 1, b: null }, ['a'], ['b'])).toEqual({ a: 1, b: null });
  });
});

import { canonicalFiniteDigest, canonicalFiniteJson } from './canonical.js';

describe('finite canonical JSON for observed geometry', () => {
  it.each([
    [0.5, '0.5', 'd2cbad71ff333de67d07ec676e352ab7f38248eb69c942950157220607c55e84'],
    [0.1, '0.1', '14be4b45f18e0d8c67b4f719b5144eee88497e413709d11d85b096d8e2346310'],
    [123.456, '123.456', '52dad41684065ccf8dd86bc21e739e57c750e4e1305f759956b7373308023eae'],
    [1e-7, '1e-7', '5b33e02f2c5103a05d32f6ba9cb058294452bfbf393967f68bb30c1bdcbbab22'],
    [1920, '1920', '6b5f40c09215713a1fa83ea2de2adcae17e605b8958a2d7379e15b561687ee8f'],
  ] as const)('preserves %s with a literal JSON and SHA-256 vector', (value, json, hash) => {
    expect(canonicalFiniteJson(value)).toBe(json);
    expect(Object.is(JSON.parse(json), value)).toBe(true);
    expect(canonicalFiniteDigest(value)).toBe(`sha256:${hash}`);
  });

  it('preserves exact doubles recursively while strict identity entry points still refuse fractions', () => {
    const values = [0.5, 0.1, 123.456, 1e-7, 1920];
    expect(canonicalFiniteJson(values)).toBe('[0.5,0.1,123.456,1e-7,1920]');
    expect(canonicalFiniteDigest(values)).toBe('sha256:e787111e1349b5dcc55f429038e85fb213d1b867479daff45c6b600146302b1c');
    expect(JSON.parse(canonicalFiniteJson({ z: values, a: 0.30000000000000004 })))
      .toEqual({ a: 0.30000000000000004, z: values });
    expect(canonicalFiniteJson(1e100)).toBe('1e+100');
    for (const value of values.slice(0, 4)) for (const strict of [canonicalJson, canonicalBytes, canonicalDigest]) {
      expect(() => strict([value])).toThrow(ContractError);
    }
    expect(canonicalJson(-0)).toBe('0');
  });

  it.each([-0, NaN, Infinity, -Infinity])('rejects nonfinite or negative zero %s', value => {
    expect(() => canonicalFiniteJson({ x: value })).toThrow(ContractError);
    expect(() => canonicalFiniteDigest(value)).toThrow(ContractError);
  });

  it('shares strict structural checks, lexical sorting and depth limits without invoking accessors', () => {
    const cycle: unknown[] = []; cycle.push(cycle);
    const accessor = Object.defineProperty({}, 'x', { enumerable: true, get() { throw new Error('getter ran'); } });
    for (const value of [cycle, accessor, Object.defineProperty({}, 'x', { value: 1 }), { [Symbol('x')]: 1 },
      new Array(1), Object.assign([0.1], { extra: true }), new (class extends Array<number> {})(),
      new Date('2026-01-01'), { x: undefined }, 1n, () => 1]) {
      expect(() => canonicalFiniteJson(value)).toThrow(ContractError);
    }
    expect(canonicalFiniteJson(Object.assign(Object.create(null), { z: 0.1, '2': 2, '10': 10 })))
      .toBe('{"10":10,"2":2,"z":0.1}');
    let nested: unknown = 0.1;
    for (let i = 0; i < 128; i += 1) nested = [nested];
    expect(() => canonicalFiniteJson(nested)).not.toThrow();
    expect(() => canonicalFiniteJson([nested])).toThrow(/nesting/u);
  });
});
