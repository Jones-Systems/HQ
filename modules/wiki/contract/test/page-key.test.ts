import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  NAMESPACES,
  PAGE_KEY_ADAPTER_RULES,
  makePageKey,
  pageKeyEquals,
  pageKeyId,
  validateNamespace,
  validatePageKey,
  validatePagePath,
} from '../src/index.ts';

function reason(result: { ok: boolean; error?: { reason: string } }): string | undefined {
  return result.ok ? undefined : result.error?.reason;
}

test('namespaces are exactly bl and appdev', () => {
  assert.deepEqual([...NAMESPACES], ['bl', 'appdev']);
  assert.equal(validateNamespace('bl').ok, true);
  assert.equal(validateNamespace('appdev').ok, true);
  assert.equal(reason(validateNamespace('other')), 'unknown-namespace');
  assert.equal(reason(validateNamespace('BL')), 'unknown-namespace');
  assert.equal(reason(validateNamespace(null)), 'wrong-type');
});

test('page path: accepts ordinary relative paths', () => {
  for (const path of ['a.md', 'dir/a.md', 'Dir With Spaces/Note (1).md', 'a/b/c/d.md', 'ünï/cödé.md', 'x/a:b/c.md', '.hidden', 'a/.hidden/b', '...', 'a..b/c']) {
    assert.equal(validatePagePath(path).ok, true, path);
  }
});

test('page path: rejects traversal', () => {
  for (const path of ['..', '../a', 'a/../b', 'a/..', 'a/./b', '.', './a']) {
    assert.equal(reason(validatePagePath(path)), 'traversal', path);
  }
});

test('page path: rejects absolute paths and UNC-style leading slashes', () => {
  for (const path of ['/etc/passwd', '/a', '//host/share']) {
    assert.equal(reason(validatePagePath(path)), 'absolute-path', path);
  }
});

test('page path: rejects NUL and other control characters', () => {
  assert.equal(reason(validatePagePath('a\u0000b')), 'nul');
  assert.equal(reason(validatePagePath('a.md\u0000.png')), 'nul');
  assert.equal(reason(validatePagePath('a\nb')), 'control-character');
  assert.equal(reason(validatePagePath('a\tb')), 'control-character');
  assert.equal(reason(validatePagePath('a\u007fb')), 'control-character');
  assert.equal(reason(validatePagePath('a\ud800b')), 'lone-surrogate');
});

test('page path: rejects backslash and drive forms', () => {
  assert.equal(reason(validatePagePath('a\\b')), 'backslash');
  assert.equal(reason(validatePagePath('..\\a')), 'backslash');
  assert.equal(reason(validatePagePath('C:\\Windows')), 'backslash');
  assert.equal(reason(validatePagePath('C:/Windows')), 'drive-form');
  assert.equal(reason(validatePagePath('c:a.md')), 'drive-form');
});

test('page path: rejects scheme-like inputs', () => {
  for (const path of ['http://example.com/a', 'https:evil', 'javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'vbscript:x', 'mailto:a@b.c', 'ssh+git:repo/x', 'JAVASCRIPT:x']) {
    const result = validatePagePath(path);
    assert.equal(result.ok, false, path);
    assert.ok(['scheme', 'empty-segment'].includes(reason(result) ?? ''), `${path}: ${reason(result)}`);
  }
  assert.equal(reason(validatePagePath('javascript:alert(1)')), 'scheme');
});

test('page path: rejects empty segments, empty input, wrong types and over-long input', () => {
  assert.equal(reason(validatePagePath('')), 'empty');
  assert.equal(reason(validatePagePath('a//b')), 'empty-segment');
  assert.equal(reason(validatePagePath('a/')), 'empty-segment');
  assert.equal(reason(validatePagePath(7)), 'wrong-type');
  assert.equal(reason(validatePagePath(null)), 'wrong-type');
  assert.equal(reason(validatePagePath('a'.repeat(256))), 'too-long');
  assert.equal(validatePagePath('a'.repeat(255)).ok, true);
  assert.equal(validatePagePath(Array.from({ length: 4 }, () => 'a'.repeat(255)).join('/')).ok, true);
  assert.equal(reason(validatePagePath(Array.from({ length: 5 }, () => 'a'.repeat(255)).join('/'))), 'too-long');
});

test('page key: validates shape strictly', () => {
  assert.equal(validatePageKey({ namespace: 'bl', path: 'a.md' }).ok, true);
  assert.equal(reason(validatePageKey({ namespace: 'bl' })), 'missing-property');
  assert.equal(reason(validatePageKey({ namespace: 'bl', path: 'a.md', ref: 'main' })), 'unknown-property');
  assert.equal(reason(validatePageKey({ namespace: 'x', path: 'a.md' })), 'unknown-namespace');
  assert.equal(reason(validatePageKey({ namespace: 'bl', path: '../a' })), 'traversal');
  assert.equal(reason(validatePageKey('bl/a.md')), 'wrong-type');
  assert.equal(reason(validatePageKey(null)), 'wrong-type');
  assert.equal(reason(validatePageKey([])), 'wrong-type');
});

test('same title in different namespaces yields distinct keys', () => {
  const bl = makePageKey('bl', 'Topics/Pricing.md');
  const dev = makePageKey('appdev', 'Topics/Pricing.md');
  assert.ok(bl.ok && dev.ok);
  assert.notEqual(pageKeyId(bl.value), pageKeyId(dev.value));
  assert.equal(pageKeyEquals(bl.value, dev.value), false);
  assert.equal(pageKeyEquals(bl.value, { namespace: 'bl', path: 'Topics/Pricing.md' }), true);
  assert.equal(reason(makePageKey('nope', 'a.md')), 'unknown-namespace');
  assert.equal(reason(makePageKey('bl', '/a.md')), 'absolute-path');
});

test('adapter rules state the symlink policy', () => {
  assert.ok(PAGE_KEY_ADAPTER_RULES.some((rule) => rule.includes('symlink') && rule.includes('never follow')));
  assert.ok(PAGE_KEY_ADAPTER_RULES.some((rule) => rule.includes('MAX_PAGE_BLOB_BYTES')));
});
