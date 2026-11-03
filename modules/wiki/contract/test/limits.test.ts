import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MAX_PAGE_BLOB_BYTES,
  MAX_QUERY_LENGTH,
  MAX_RESULTS,
  clampQuery,
  clampResultLimit,
  validatePageBlobSize,
  validatePageText,
  validateQuery,
  validateResultLimit,
} from '../src/index.ts';

function reason(result: { ok: boolean; error?: { reason: string } }): string | undefined {
  return result.ok ? undefined : result.error?.reason;
}

test('limit constants are the planned values', () => {
  assert.equal(MAX_QUERY_LENGTH, 256);
  assert.equal(MAX_RESULTS, 50);
  assert.equal(MAX_PAGE_BLOB_BYTES, 2_097_152);
});

test('query: accepts exactly 256 characters, rejects 257', () => {
  assert.equal(validateQuery('a'.repeat(256)).ok, true);
  assert.equal(reason(validateQuery('a'.repeat(257))), 'too-long');
  assert.equal(validateQuery('a').ok, true);
});

test('query length counts code points, not UTF-16 units', () => {
  assert.equal(validateQuery('😀'.repeat(256)).ok, true);
  assert.equal(reason(validateQuery('😀'.repeat(257))), 'too-long');
});

test('query: rejects empty, blank, non-string, NUL, controls and lone surrogates', () => {
  assert.equal(reason(validateQuery('')), 'empty');
  assert.equal(reason(validateQuery('   ')), 'empty');
  assert.equal(reason(validateQuery(42)), 'wrong-type');
  assert.equal(reason(validateQuery(undefined)), 'wrong-type');
  assert.equal(reason(validateQuery('a\u0000b')), 'nul');
  assert.equal(reason(validateQuery('a\nb')), 'control-character');
  assert.equal(reason(validateQuery('a\ud800b')), 'lone-surrogate');
  assert.equal(reason(validateQuery('x'.repeat(1_000_000))), 'too-long');
});

test('query clamp truncates to 256 code points without splitting a pair', () => {
  assert.equal(clampQuery('abc'), 'abc');
  assert.equal(Array.from(clampQuery('a'.repeat(300))).length, 256);
  const clamped = clampQuery('😀'.repeat(300));
  assert.equal(Array.from(clamped).length, 256);
  assert.equal(validateQuery(clamped).ok, true);
  assert.equal(Array.from(clampQuery('x'.repeat(5_000_000))).length, 256);
});

test('result limit: 1 and 50 accepted, 0 and 51 rejected, non-integers rejected', () => {
  assert.equal(validateResultLimit(1).ok, true);
  assert.equal(validateResultLimit(50).ok, true);
  assert.equal(reason(validateResultLimit(0)), 'out-of-range');
  assert.equal(reason(validateResultLimit(51)), 'out-of-range');
  assert.equal(reason(validateResultLimit(-1)), 'out-of-range');
  assert.equal(reason(validateResultLimit(1.5)), 'wrong-type');
  assert.equal(reason(validateResultLimit(Number.NaN)), 'wrong-type');
  assert.equal(reason(validateResultLimit('10')), 'wrong-type');
});

test('result limit clamp bounds any input into 1..50', () => {
  assert.equal(clampResultLimit(50), 50);
  assert.equal(clampResultLimit(51), 50);
  assert.equal(clampResultLimit(10_000), 50);
  assert.equal(clampResultLimit(49), 49);
  assert.equal(clampResultLimit(1), 1);
  assert.equal(clampResultLimit(0), 1);
  assert.equal(clampResultLimit(-7), 1);
  assert.equal(clampResultLimit(12.9), 12);
  assert.equal(clampResultLimit(Number.POSITIVE_INFINITY), 50);
  assert.equal(clampResultLimit(Number.NaN), 50);
  assert.equal(clampResultLimit(undefined), 50);
  assert.equal(clampResultLimit('7'), 50);
  assert.equal(clampResultLimit(undefined, 10), 10);
});

test('page blob size: exactly 2 MiB accepted, one byte over rejected', () => {
  assert.equal(validatePageBlobSize(0).ok, true);
  assert.equal(validatePageBlobSize(MAX_PAGE_BLOB_BYTES - 1).ok, true);
  assert.equal(validatePageBlobSize(MAX_PAGE_BLOB_BYTES).ok, true);
  assert.equal(reason(validatePageBlobSize(MAX_PAGE_BLOB_BYTES + 1)), 'too-large');
  assert.equal(reason(validatePageBlobSize(-1)), 'out-of-range');
  assert.equal(reason(validatePageBlobSize(1.5)), 'wrong-type');
  assert.equal(reason(validatePageBlobSize('10')), 'wrong-type');
});

test('page text is measured in UTF-8 bytes', () => {
  assert.equal(validatePageText('a'.repeat(MAX_PAGE_BLOB_BYTES)).ok, true);
  assert.equal(reason(validatePageText('a'.repeat(MAX_PAGE_BLOB_BYTES + 1))), 'too-large');
  // 2-byte characters: half the cap in characters hits the byte cap exactly.
  const twoByte = 'é'.repeat(MAX_PAGE_BLOB_BYTES / 2);
  assert.equal(validatePageText(twoByte).ok, true);
  assert.equal(reason(validatePageText(twoByte + 'a')), 'too-large');
  assert.equal(reason(validatePageText(7)), 'wrong-type');
});
