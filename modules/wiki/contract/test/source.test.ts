import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SOURCE_SCHEMA_ID, validateSourceDescriptor } from '../src/index.ts';
import { COMMIT_A, COMMIT_B, clone, descriptor } from './fixtures.ts';

function reason(result: { ok: boolean; error?: { reason: string } }): string | undefined {
  return result.ok ? undefined : result.error?.reason;
}

test('schema id is hq.wiki.source/v1', () => {
  assert.equal(SOURCE_SCHEMA_ID, 'hq.wiki.source/v1');
  assert.equal(descriptor().schema, SOURCE_SCHEMA_ID);
});

test('valid descriptors: unknown remote freshness, behind, and 64-hex commits', () => {
  assert.equal(validateSourceDescriptor(descriptor()).ok, true);
  const behind = descriptor({
    namespace: 'appdev',
    freshness: { graph: { state: 'stale', indexedCommit: COMMIT_B }, content: { state: 'behind', checkedAt: '2026-01-03T00:00:00Z' } },
  });
  assert.equal(validateSourceDescriptor(behind).ok, true);
  assert.equal(validateSourceDescriptor(descriptor({ commit: 'c'.repeat(64), freshness: { graph: { state: 'indexing', indexedCommit: null }, content: { state: 'unknown', checkedAt: null } }, indexedAt: null })).ok, true);
});

test('graph freshness and content freshness are independent axes', () => {
  // Graph current while remote freshness is unknown...
  assert.equal(validateSourceDescriptor(descriptor()).ok, true);
  // ...and graph stale while content is known current.
  const mixed = descriptor({
    freshness: { graph: { state: 'stale', indexedCommit: COMMIT_B }, content: { state: 'current', checkedAt: '2026-01-02T05:00:00Z' } },
  });
  assert.equal(validateSourceDescriptor(mixed).ok, true);
});

test('a current graph must be built from the descriptor commit and have an indexedAt', () => {
  const wrongCommit = descriptor({ freshness: { graph: { state: 'current', indexedCommit: COMMIT_B }, content: { state: 'unknown', checkedAt: null } } });
  assert.equal(reason(validateSourceDescriptor(wrongCommit)), 'inconsistent');
  const noIndexedAt = descriptor({ indexedAt: null });
  assert.equal(reason(validateSourceDescriptor(noIndexedAt)), 'inconsistent');
});

test('content freshness: unknown carries no check time, known requires one', () => {
  const unknownWithTime = descriptor({ freshness: { graph: { state: 'current', indexedCommit: COMMIT_A }, content: { state: 'unknown', checkedAt: '2026-01-02T05:00:00Z' } } });
  assert.equal(reason(validateSourceDescriptor(unknownWithTime)), 'inconsistent');
  const knownWithout = descriptor({ freshness: { graph: { state: 'current', indexedCommit: COMMIT_A }, content: { state: 'current', checkedAt: null } } });
  assert.equal(reason(validateSourceDescriptor(knownWithout)), 'inconsistent');
});

test('rejects bad schema, namespace, ref, commit, timestamps and unknown properties', () => {
  const bad = (mutate: (d: any) => void) => {
    const d = clone(descriptor());
    mutate(d);
    return validateSourceDescriptor(d);
  };
  assert.equal(reason(bad((d) => (d.schema = 'hq.wiki.source/v2'))), 'invalid-format');
  assert.equal(reason(bad((d) => (d.namespace = 'zz'))), 'unknown-namespace');
  assert.equal(reason(bad((d) => (d.ref = '../main'))), 'invalid-format');
  assert.equal(reason(bad((d) => (d.ref = 'has space'))), 'invalid-format');
  assert.equal(reason(bad((d) => (d.ref = ''))), 'empty');
  assert.equal(reason(bad((d) => (d.commit = 'abc123'))), 'invalid-format');
  assert.equal(reason(bad((d) => (d.commit = 'A'.repeat(40)))), 'invalid-format');
  assert.equal(reason(bad((d) => (d.commitTime = '2026-01-02'))), 'invalid-format');
  assert.equal(reason(bad((d) => (d.commitTime = '2026-02-30T00:00:00Z'))), 'invalid-format');
  assert.equal(reason(bad((d) => (d.commitTime = '2026-01-02T03:04:05+01:00'))), 'invalid-format');
  assert.equal(reason(bad((d) => (d.indexedAt = 'yesterday'))), 'invalid-format');
  assert.equal(reason(bad((d) => (d.url = 'https://example.com/repo.git'))), 'unknown-property');
  assert.equal(reason(bad((d) => delete d.freshness)), 'missing-property');
  assert.equal(reason(bad((d) => (d.freshness.graph.state = 'fresh'))), 'invalid-format');
  assert.equal(reason(validateSourceDescriptor(null)), 'wrong-type');
});
