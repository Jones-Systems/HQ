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
