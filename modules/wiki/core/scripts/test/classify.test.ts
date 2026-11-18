// Unit tests of the shape classifiers and statistics: every input maps to a member of a fixed enumeration.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { AMBIGUOUS_BUCKETS, MISSING_SHAPES, ambiguousBucket, everyNth, missingShape, percentile, round2 } from '../classify.ts';

const MD = ['.md'];

describe('missingShape', () => {
  const cases: readonly [string, readonly string[], string][] = [
    ['docs/gone.md', MD, 'md-path-not-found'],
    ['gone.MD', MD, 'md-path-not-found'],
    ['../../../outside.md', MD, 'md-path-not-found'],
    ['notes.markdown', ['.markdown'], 'md-path-not-found'],
    ['assets/figure.png', MD, 'non-page-extension'],
    ['report.pdf', MD, 'non-page-extension'],
    ['notes.markdown', MD, 'non-page-extension'],
    ['nowhere/deeper/path', MD, 'path-like'],
    ['./sibling', MD, 'path-like'],
    ['/rooted', MD, 'path-like'],
    ['missing-slug-target', MD, 'slug-like'],
    ['snake_case_word', MD, 'slug-like'],
    ['lowercase', MD, 'slug-like'],
    ['日本語', MD, 'slug-like'],
    ['Missing Title Words', MD, 'title-like'],
    ['some words here', MD, 'title-like'],
    ['Capitalised', MD, 'title-like'],
    ['Read/Write Policy', MD, 'title-like'],
    ['???', MD, 'other'],
    ['.md', MD, 'other'],
    ['12 34', MD, 'other'],
    ['', MD, 'other'],
  ];
  for (const [label, extensions, shape] of cases) {
    test(`${JSON.stringify(label)} with ${extensions.join(',')} is ${shape}`, () => assert.equal(missingShape(label, extensions), shape));
  }

  test('every result is a member of the fixed list', () => {
    for (const label of ['a', 'A b', 'x/y', 'z.png', 'q.md', '', '#', '日本語', 'Ünï']) assert.ok((MISSING_SHAPES as readonly string[]).includes(missingShape(label, MD)));
  });
});

describe('ambiguousBucket', () => {
  test('buckets by candidate count, with the contract cap last', () => {
    const expected: [number, string][] = [[2, '2'], [3, '3'], [4, '4'], [5, '5-9'], [9, '5-9'], [10, '10-24'], [24, '10-24'], [25, '25-49'], [49, '25-49'], [50, 'cap']];
    for (const [count, bucket] of expected) assert.equal(ambiguousBucket(count), bucket, String(count));
    assert.ok(AMBIGUOUS_BUCKETS.every((bucket) => expected.some(([, name]) => name === bucket)));
  });
});

describe('statistics', () => {
  test('percentile is nearest-rank and total', () => {
    assert.equal(percentile([], 50), 0);
    assert.equal(percentile([7], 95), 7);
    const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    assert.equal(percentile(ten, 50), 5);
    assert.equal(percentile(ten, 95), 10);
    assert.equal(percentile(ten, 10), 1);
    assert.equal(percentile(ten, 0), 1);
  });

  test('everyNth keeps every item up to the cap and otherwise every Nth, at most max items, starting at the first', () => {
    const items = Array.from({ length: 450 }, (_, i) => i);
    assert.deepEqual(everyNth([], 200), []);
    assert.deepEqual(everyNth([5, 6, 7], 200), [5, 6, 7]);
    assert.equal(everyNth(items.slice(0, 200), 200).length, 200);
    const odd = everyNth(items.slice(0, 201), 200);
    assert.deepEqual(odd.slice(0, 3), [0, 2, 4]);
    assert.equal(odd.length, 101);
    const big = everyNth(items, 200);
    assert.ok(big.length <= 200);
    assert.deepEqual(big.slice(0, 3), [0, 3, 6]);
  });

  test('round2 keeps two decimals', () => {
    assert.equal(round2(1.005 + 0.0001), 1.01);
    assert.equal(round2(33.3333), 33.33);
    assert.equal(round2(0), 0);
  });
});
