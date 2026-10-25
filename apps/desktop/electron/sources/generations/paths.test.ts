import { expect, it } from 'vitest';
import { counter, digest, fileRoute, manifestRoute, opaque, pathSet, relativePath } from './paths.js';

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
