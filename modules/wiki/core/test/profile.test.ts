import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { createWikiHost, createMemoryIndexStore, profileIndexKey, validateSourceProfile } from '../src/index.ts';
import { REMOTE, clock, memorySource, profileFor } from './support.ts';

describe('validateSourceProfile', () => {
  test('a minimal profile gets generic defaults and is frozen', () => {
    const result = validateSourceProfile({ namespace: 'bl', gitDir: '/data/wiki.git', expectedRemote: REMOTE, ref: 'main' });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value, {
      namespace: 'bl',
      gitDir: '/data/wiki.git',
      expectedRemote: REMOTE,
      ref: 'main',
      rootPrefix: '',
      pageExtensions: ['.md'],
      fieldMappings: { title: 'title', aliases: ['aliases'], topics: ['tags'], relationships: [] },
      topicMode: 'field',
    });
    assert.ok(Object.isFrozen(result.value));
    assert.ok(Object.isFrozen(result.value.pageExtensions));
  });

  test('a full profile is normalised (extensions lowercased) and never retains the input', () => {
    const input = profileFor('appdev', { rootPrefix: 'docs/wiki', pageExtensions: ['.MD', '.markdown'], topicMode: 'directory' });
    const result = validateSourceProfile(input);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.pageExtensions, ['.md', '.markdown']);
    assert.equal(result.value.rootPrefix, 'docs/wiki');
    (input['fieldMappings'] as { aliases: string[] }).aliases.push('mutated');
    assert.deepEqual(result.value.fieldMappings.aliases, ['aliases']);
  });

  const bad: Record<string, Record<string, unknown>> = {
    'unknown namespace': { namespace: 'other' },
    'unknown key': { extra: 1 },
    'relative gitDir': { gitDir: 'relative/wiki.git' },
    'gitDir with dot-dot': { gitDir: '/data/../etc/wiki.git' },
    'gitDir with NUL': { gitDir: '/data/\u0000x' },
    'empty remote': { expectedRemote: '' },
    'remote with whitespace': { expectedRemote: 'https://a.invalid/x y' },
    'remote with embedded credentials': { expectedRemote: 'https://user:secret@a.invalid/x.git' },
    'remote starting with a dash': { expectedRemote: '--upload-pack=x' },
    'ref with option form': { ref: '--upload-pack=x' },
    'ref with dot-dot': { ref: 'a..b' },
    'ref with lock suffix': { ref: 'main.lock' },
    'ref with leading dot segment': { ref: 'a/.hidden' },
    'ref with trailing slash': { ref: 'main/' },
    'ref with caret': { ref: 'main^{commit}' },
    'ref with space': { ref: 'my branch' },
    'empty ref': { ref: '' },
    'absolute rootPrefix': { rootPrefix: '/docs' },
    'rootPrefix with traversal': { rootPrefix: 'docs/../x' },
    'rootPrefix with trailing slash': { rootPrefix: 'docs/' },
    'no extensions': { pageExtensions: [] },
    'extension without dot': { pageExtensions: ['md'] },
    'duplicate extension': { pageExtensions: ['.md', '.MD'] },
    'unknown topic mode': { topicMode: 'tree' },
    'field mappings not an object': { fieldMappings: [] },
    'unknown mapping key': { fieldMappings: { nope: [] } },
    'invalid field name': { fieldMappings: { aliases: ['bad name'] } },
    'reserved field name': { fieldMappings: { topics: ['__proto__'] } },
    'duplicate field name': { fieldMappings: { relationships: ['a', 'a'] } },
    'too many mapped fields': { fieldMappings: { relationships: Array.from({ length: 17 }, (_, i) => `f${i}`) } },
  };
  for (const [name, patch] of Object.entries(bad)) {
    test(`rejects ${name}`, () => {
      const result = validateSourceProfile(profileFor('bl', patch));
      assert.equal(result.ok, false);
    });
  }

  test('rejects non-objects and arrays', () => {
    for (const value of [null, undefined, 'x', 1, [], () => 1]) assert.equal(validateSourceProfile(value).ok, false);
  });

  test('requires namespace, gitDir, expectedRemote and ref', () => {
    for (const key of ['namespace', 'gitDir', 'expectedRemote', 'ref']) {
      const input = profileFor('bl');
      delete input[key];
      const result = validateSourceProfile(input);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.reason, 'missing-property');
    }
  });

  test('the index key changes with anything that changes index content, not with the git directory', () => {
    const base = validateSourceProfile(profileFor('bl'));
    const moved = validateSourceProfile(profileFor('bl', { gitDir: '/elsewhere/wiki.git', expectedRemote: 'https://other.invalid/r.git' }));
    const retitled = validateSourceProfile(profileFor('bl', { fieldMappings: { title: 'name' } }));
    const moded = validateSourceProfile(profileFor('bl', { topicMode: 'directory' }));
    assert.ok(base.ok && moved.ok && retitled.ok && moded.ok);
    if (!(base.ok && moved.ok && retitled.ok && moded.ok)) return;
    assert.equal(profileIndexKey(base.value), profileIndexKey(moved.value));
    assert.notEqual(profileIndexKey(base.value), profileIndexKey(retitled.value));
    assert.notEqual(profileIndexKey(base.value), profileIndexKey(moded.value));
  });
});

describe('createWikiHost configuration errors', () => {
  const sources = { bl: memorySource({ files: {} }) };
  const store = createMemoryIndexStore();

  test('an invalid profile throws, without echoing its values', () => {
    assert.throws(() => createWikiHost({ profiles: [profileFor('bl', { gitDir: 'relative-secret-path' })], sources, store, clock }), (error: Error) => {
      assert.match(error.message, /invalid source profile/);
      assert.doesNotMatch(error.message, /relative-secret-path/);
      return true;
    });
  });

  test('two profiles for one namespace throw', () => {
    assert.throws(() => createWikiHost({ profiles: [profileFor('bl'), profileFor('bl')], sources, store, clock }), /duplicate source profile/);
  });
});
