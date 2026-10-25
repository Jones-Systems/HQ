import { expect, it } from 'vitest';
import { collisionKey, counter, digest, fileRoute, manifestRoute, opaque, pathSet, relativePath } from './paths.js';

it('retains counters above 2^53 without numeric rounding and enforces signed64 bounds', () => {
  for (const value of ['1', '9007199254740993', '9223372036854775807']) expect(() => counter(value)).not.toThrow();
  for (const value of ['0', '01', '-1', '1.0', '1\n', '9223372036854775808', '10000000000000000000', 1]) expect(() => counter(value)).toThrow('invalid_counter');
  expect(() => opaque('identity\n')).toThrow('invalid_identity');
  expect(() => digest('a'.repeat(64) + '\n')).toThrow('invalid_digest');
});
it('rejects ambiguous paths while retaining ordinary Unicode and distinct dotless i', () => {
  for (const value of ['', '/one', 'a//b', '.', 'a/../b', 'a\\b', 'a\0b', 'a\u200db', 'e\u0301', '\ud800', 'x/'.repeat(32) + 'x', 'é'.repeat(513)])
    expect(() => relativePath(value)).toThrow();
  expect(() => pathSet(['写真/一.png', 'résumé.txt', 'ı', 'i'])).not.toThrow();
  for (const paths of [['A', 'a'], ['ß', 'ẞ'], ['Straße', 'STRASSE'], ['Σ', 'ς'], ['ﬀ', 'ff']])
    expect(() => pathSet(paths)).toThrow('path_collision');
});
it('builds fixed pinned routes with Python quote safe-slash encoding parity', () => {
  const identity = { rootId: 'sample-root', epoch: '9007199254740993', sequence: '7', manifestSha256: 'a'.repeat(64) };
  const base = `/hq-sync/v1/roots/sample-root/generations/9007199254740993/7/${'a'.repeat(64)}`;
  expect(manifestRoute(identity)).toBe(base + '/manifest.json');
  expect(fileRoute(identity, "one/é !'()*~?#%.txt")).toBe(base + '/files/one/%C3%A9%20%21%27%28%29%2A~%3F%23%25.txt');
});
it('rejects Unicode full-fold collisions across expansions, scripts and supplementary scalars', () => {
  for (const paths of [
    ['ẞ', 'ss'], ['Straße', 'STRASSE'], ['ﬃ', 'ffi'], ['ΟΣ', 'ος'],
    ['İ', 'i\u0307'], ['\u13a0', '\uab70'], ['\u{10400}', '\u{10428}'],
  ]) expect(() => pathSet(paths)).toThrow('path_collision');
  // Cherokee full folding uses the uppercase key direction.
  expect(collisionKey('\uab70')).toBe('\u13a0');
});
it('keeps dotless i, accents, width variants and ordinary Japanese distinct', () => {
  for (const paths of [
    ['I', 'ı'], ['İ', 'i'], ['é', 'e'], ['A', '\uff21'], ['写真/一.png', '写真/二.png'],
  ]) expect(() => pathSet(paths)).not.toThrow();
});
it('validates NFC input without normalizing the full-fold output', () => {
  expect(() => pathSet(['\u1e9b\u0323', '\u1e69'])).not.toThrow();
  expect(collisionKey('\u1e9b\u0323')).toBe('\u1e61\u0323');
  expect(collisionKey('\u1e69')).toBe('\u1e69');
  expect(() => relativePath('e\u0301')).toThrow('noncanonical_path');
  for (const path of ['\ud800', '\udc00', 'a\0b', 'a\u200db', '\ue000', '\u0378'])
    expect(() => relativePath(path)).toThrow('invalid_path');
});
it('pins category-C admission to Unicode 15.1 even when the runtime assigns newer characters', () => {
  // U+088F and U+1C89 are explicitly Cn in Unicode 15.1 DerivedGeneralCategory.txt.
  for (const character of ['\u088f', '\u1c89', '\u0085', '\u200d', '\ue000', '\u{f0000}', '\u{10fffd}', '\u{10ffff}'])
    expect(() => relativePath(`files/${character}.txt`)).toThrow('invalid_path');
  for (const path of ['plain/readme.txt', '写真/一.png', 'résumé.txt', '\u088e', '\u1c88', '\u{1f600}'])
    expect(() => relativePath(path)).not.toThrow();
});
