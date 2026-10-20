import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MAX_DESTINATION_LENGTH, formatDestination, parseDestination, type Destination } from '../src/index.ts';

function reason(result: { ok: boolean; error?: { reason: string } }): string | undefined {
  return result.ok ? undefined : result.error?.reason;
}

function roundTrip(destination: Destination): string {
  const formatted = formatDestination(destination);
  assert.ok(formatted.ok, JSON.stringify(formatted));
  const parsed = parseDestination(formatted.value);
  assert.ok(parsed.ok, `${formatted.value}: ${JSON.stringify(parsed)}`);
  assert.deepEqual(parsed.value, destination);
  const again = formatDestination(parsed.value);
  assert.ok(again.ok && again.value === formatted.value);
  return formatted.value;
}

test('page destinations format as page/<namespace>/<encoded path> and round-trip', () => {
  assert.equal(roundTrip({ kind: 'page', key: { namespace: 'bl', path: 'notes/a.md' } }), 'page/bl/notes/a.md');
  assert.equal(roundTrip({ kind: 'page', key: { namespace: 'appdev', path: 'Dir With Space/Note #1 (draft)?.md' } }), 'page/appdev/Dir%20With%20Space/Note%20%231%20(draft)%3F.md');
  assert.equal(roundTrip({ kind: 'page', key: { namespace: 'bl', path: 'ünï/日本語.md' } }), 'page/bl/%C3%BCn%C3%AF/%E6%97%A5%E6%9C%AC%E8%AA%9E.md');
  assert.equal(roundTrip({ kind: 'page', key: { namespace: 'bl', path: 'x/a:b/100%.md' } }), 'page/bl/x/a%3Ab/100%25.md');
  roundTrip({ kind: 'page', key: { namespace: 'bl', path: 'x/😀.md' } });
});

test('search destinations format as search?q= and round-trip', () => {
  assert.equal(roundTrip({ kind: 'search', query: 'pricing model' }), 'search?q=pricing%20model');
  assert.equal(roundTrip({ kind: 'search', query: 'a&b=c+d#e?f' }), 'search?q=a%26b%3Dc%2Bd%23e%3Ff');
  roundTrip({ kind: 'search', query: '  padded  ' });
  roundTrip({ kind: 'search', query: 'http://example.com' });
  roundTrip({ kind: 'search', query: 'x'.repeat(256) });
});

test('topics destinations format as topics/<namespace> and round-trip', () => {
  assert.equal(roundTrip({ kind: 'topics', namespace: 'bl' }), 'topics/bl');
  assert.equal(roundTrip({ kind: 'topics', namespace: 'appdev' }), 'topics/appdev');
});

test('format rejects invalid keys, namespaces and queries', () => {
  assert.equal(reason(formatDestination({ kind: 'page', key: { namespace: 'bl', path: '../x' } })), 'traversal');
  assert.equal(reason(formatDestination({ kind: 'page', key: { namespace: 'zz' as never, path: 'a.md' } })), 'unknown-namespace');
  assert.equal(reason(formatDestination({ kind: 'search', query: '' })), 'empty');
  assert.equal(reason(formatDestination({ kind: 'search', query: 'x'.repeat(257) })), 'too-long');
  assert.equal(reason(formatDestination({ kind: 'topics', namespace: 'zz' as never })), 'unknown-namespace');
  assert.equal(reason(formatDestination({ kind: 'file', path: '/etc/passwd' } as never)), 'invalid-destination');
});

test('scheme-like destinations fail validation', () => {
  for (const text of [
    'http://example.com',
    'https://example.com/page/bl/a.md',
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'file:///etc/passwd',
    'data:text/html,hi',
    'vbscript:x',
    'mailto:a@example.com',
    'blob:https://example.com/x',
    'page:bl/a.md',
    'topics:bl',
    'search:q',
    'ssh+git://host/repo',
  ]) {
    assert.equal(reason(parseDestination(text)), 'scheme', text);
  }
  assert.equal(reason(parseDestination('java\tscript:alert(1)')), 'control-character');
});

test('absolute, relative-escape, backslash and control forms fail', () => {
  assert.equal(reason(parseDestination('/page/bl/a.md')), 'absolute-path');
  assert.equal(reason(parseDestination('//evil.example/x')), 'absolute-path');
  assert.equal(reason(parseDestination('page\\bl\\a.md')), 'backslash');
  assert.equal(reason(parseDestination('page/bl/a.md\u0000')), 'nul');
  assert.equal(reason(parseDestination('page/bl/a%00.md')), 'nul');
  assert.equal(reason(parseDestination('page/bl/a\nb')), 'control-character');
  assert.equal(reason(parseDestination('../page/bl/a.md')), 'invalid-destination');
  assert.equal(reason(parseDestination('')), 'empty');
  assert.equal(reason(parseDestination(null)), 'wrong-type');
  assert.equal(reason(parseDestination('x'.repeat(MAX_DESTINATION_LENGTH + 1))), 'too-long');
});

test('traversal and path attacks fail, including encoded and double-encoded forms', () => {
  assert.equal(reason(parseDestination('page/bl/../etc/passwd')), 'traversal');
  assert.equal(reason(parseDestination('page/bl/a/../../b')), 'traversal');
  assert.equal(reason(parseDestination('page/bl/%2e%2e/etc')), 'traversal');
  assert.equal(reason(parseDestination('page/bl/%2E%2E%2Fetc')), 'traversal');
  assert.equal(reason(parseDestination('page/bl/a%2Fb')), 'non-canonical');
  assert.equal(reason(parseDestination('page/bl//a.md')), 'absolute-path');
  assert.equal(reason(parseDestination('page/bl/a//b.md')), 'empty-segment');
  assert.equal(reason(parseDestination('page/bl/a/')), 'empty-segment');
  assert.equal(reason(parseDestination('page/bl/')), 'empty');
  assert.equal(reason(parseDestination('page/bl/http%3A%2F%2Fevil')), 'scheme');
  assert.equal(reason(parseDestination('page/bl/http%3Aevil')), 'scheme');
  assert.equal(reason(parseDestination('page/bl/C%3A/x')), 'drive-form');
  assert.equal(reason(parseDestination('page/bl/a%5Cb')), 'backslash');
});

test('malformed or non-canonical encodings and shapes fail', () => {
  assert.equal(reason(parseDestination('page/bl/%')), 'non-canonical');
  assert.equal(reason(parseDestination('page/bl/%E0%A4%A')), 'non-canonical');
  assert.equal(reason(parseDestination('page/bl/%61.md')), 'non-canonical');
  assert.equal(reason(parseDestination('page/bl/a%2fb')), 'non-canonical');
  assert.equal(reason(parseDestination('page/bl/a b.md')), 'non-canonical');
  assert.equal(reason(parseDestination('page/bl')), 'invalid-destination');
  assert.equal(reason(parseDestination('page/zz/a.md')), 'unknown-namespace');
  assert.equal(reason(parseDestination('page/BL/a.md')), 'unknown-namespace');
  assert.equal(reason(parseDestination('Page/bl/a.md')), 'invalid-destination');
  assert.equal(reason(parseDestination('search?q=')), 'empty');
  assert.equal(reason(parseDestination('search?q=a&r=b')), 'non-canonical');
  assert.equal(reason(parseDestination('search?q=a+b')), 'non-canonical');
  assert.equal(reason(parseDestination('search?q=%')), 'non-canonical');
  assert.equal(reason(parseDestination('search?x=a')), 'invalid-destination');
  assert.equal(reason(parseDestination('search')), 'invalid-destination');
  assert.equal(reason(parseDestination('search?q=' + 'x'.repeat(257))), 'too-long');
  assert.equal(reason(parseDestination('topics/')), 'unknown-namespace');
  assert.equal(reason(parseDestination('topics/bl/extra')), 'unknown-namespace');
  assert.equal(reason(parseDestination('topics/zz')), 'unknown-namespace');
  assert.equal(reason(parseDestination('home')), 'invalid-destination');
});

test('search query boundary through destinations: 256 ok, 257 rejected', () => {
  assert.equal(parseDestination(`search?q=${'x'.repeat(256)}`).ok, true);
  assert.equal(reason(parseDestination(`search?q=${'x'.repeat(257)}`)), 'too-long');
});
