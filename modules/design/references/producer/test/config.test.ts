/** The external configuration: closed shape, absolute paths, caps that can only go down, no value echo. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { CONFIG_SCHEMA, parseConfig } from '../src/config.ts';
import { ProducerError } from '../src/errors.ts';
import { DEFAULT_LIMITS } from '../src/safe-fs.ts';

const base = (): Record<string, any> => ({
  schema: CONFIG_SCHEMA, outputRoot: '/srv/out',
  sources: [{ id: 'one', kind: 'gallery', root: '/srv/gallery', pointer: 'current', releases: ['A', 'B'] }],
});
const parse = (value: unknown): ReturnType<typeof parseConfig> => parseConfig(Buffer.from(JSON.stringify(value)));
function codeOf(run: () => unknown): ProducerError {
  try { run(); } catch (error) { assert.ok(error instanceof ProducerError); return error; }
  throw new Error('expected a ProducerError');
}

describe('parseConfig', () => {
  test('accepts a minimal gallery and a study, with defaults for limits, rights and producer', () => {
    const config = base();
    config.sources.push({ id: 'two', kind: 'study', root: '/srv/study' });
    const parsed = parse(config);
    assert.equal(parsed.sources.length, 2);
    assert.deepEqual(parsed.sources[0]!.limits, DEFAULT_LIMITS);
    assert.equal(parsed.sources[1]!.rights, null);
    assert.equal(parsed.sources[1]!.producer, null);
  });

  test('limits can be lowered but never raised', () => {
    const config = base();
    config.sources[0].limits = { maxFileBytes: 1024 };
    assert.equal(parse(config).sources[0]!.limits.maxFileBytes, 1024);
    config.sources[0].limits = { maxFileBytes: DEFAULT_LIMITS.maxFileBytes + 1 };
    assert.equal(codeOf(() => parse(config)).code, 'config-invalid');
    for (const bad of [0, -1, 1.5, '10', null]) {
      config.sources[0].limits = { maxFiles: bad };
      assert.equal(codeOf(() => parse(config)).code, 'config-invalid');
    }
  });

  const rejected: [string, (c: Record<string, any>) => void, string][] = [
    ['an unknown top-level field', (c) => { c.extra = 1; }, 'config-unknown-field'],
    ['an unknown source field', (c) => { c.sources[0].extra = 1; }, 'config-unknown-field'],
    ['a different schema', (c) => { c.schema = 'other/v1'; }, 'config-invalid'],
    ['a future version', (c) => { c.schema = 'hq.design.reference-producer-config/v2'; }, 'config-future-version'],
    ['a relative output root', (c) => { c.outputRoot = 'out'; }, 'config-invalid'],
    ['a relative source root', (c) => { c.sources[0].root = 'gallery'; }, 'config-invalid'],
    ['no sources', (c) => { c.sources = []; }, 'config-invalid'],
    ['a duplicate source id', (c) => { c.sources.push({ ...c.sources[0] }); }, 'config-invalid'],
    ['an id that is not a lower-case token', (c) => { c.sources[0].id = '../x'; }, 'config-invalid'],
    ['an unknown kind', (c) => { c.sources[0].kind = 'folder'; }, 'config-invalid'],
    ['a gallery with no pointer', (c) => { delete c.sources[0].pointer; }, 'config-invalid'],
    ['a gallery with no releases', (c) => { c.sources[0].releases = []; }, 'config-invalid'],
    ['a pointer name that is also a release', (c) => { c.sources[0].releases = ['current']; }, 'config-invalid'],
    ['a release name with a separator', (c) => { c.sources[0].releases = ['a/b']; }, 'config-invalid'],
    ['duplicate releases', (c) => { c.sources[0].releases = ['A', 'A']; }, 'config-invalid'],
    ['a study with a pointer', (c) => { c.sources[0] = { id: 'one', kind: 'study', root: '/srv/s', pointer: 'x' }; }, 'config-unknown-field'],
    ['rights with an unknown field', (c) => { c.sources[0].rights = { vocabulary: 'v', value: 'x', extra: 1 }; }, 'config-unknown-field'],
    ['rights with no value', (c) => { c.sources[0].rights = { vocabulary: 'v' }; }, 'config-invalid'],
    ['a producer with no id', (c) => { c.sources[0].producer = { label: 'x' }; }, 'config-invalid'],
  ];
  for (const [name, change, code] of rejected) {
    test(`rejects ${name}`, () => {
      const config = base();
      change(config);
      assert.equal(codeOf(() => parse(config)).code, code);
    });
  }

  test('rejects text that is not JSON, and bytes that are not UTF-8', () => {
    assert.equal(codeOf(() => parseConfig(Buffer.from('{nope'))).code, 'config-not-json');
    assert.equal(codeOf(() => parseConfig(Buffer.from([0xff, 0xfe, 0x7b]))).code, 'config-not-json');
  });

  test('errors never echo configured values', () => {
    const config = base();
    config.sources[0].root = 'SENTINEL-RELATIVE-ROOT';
    const error = codeOf(() => parse(config));
    assert.doesNotMatch(`${error.message} ${error.where}`, /SENTINEL/u);
    const unknown = base();
    unknown.sources[0]['SENTINEL-FIELD'] = 'SENTINEL-VALUE';
    const second = codeOf(() => parse(unknown));
    assert.equal(second.code, 'config-unknown-field');
    assert.doesNotMatch(`${second.message} ${second.where}`, /SENTINEL/u);
  });
});
