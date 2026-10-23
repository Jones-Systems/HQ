/**
 * Conformance scaffolding for the UNACCEPTED T13 transaction proposal (stage blobs, journal event
 * intents inside one document manifest, replay idempotently). These checks exercise a proposal on
 * a process-kill fault model. They do not establish cross-record durability, power-loss safety or
 * acceptance.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isStoreError } from '../../../../../packages/design-store/src/errors.ts';
import { StorageConflictError, type StoragePort as T13StoragePort, type WriteOp } from '../../../imports/src/contract.ts';
import { FakeStoragePort } from '../../../imports/src/fake-storage.ts';
import { digestBytes, webCryptoDigest } from '../../../imports/src/jcs.ts';
import type { DesignStorage } from '../node.ts';
import { createProposedImportsStorage, PROPOSAL_STATUS, RESERVED_KEY_ROOT } from '../proposal/imports-txn.ts';
import { crashSweep, makeDir, openAt, proveCleanup, removeDir } from './helpers.ts';

proveCleanup();

const NS = 'workspace';
const bytesOf = (text: string) => new TextEncoder().encode(text);
const proposed = (storage: DesignStorage) => createProposedImportsStorage(storage.workspace, { conflictError: (message) => new StorageConflictError(message) });
const asT13 = (value: unknown) => value as T13StoragePort;
const asOps = (ops: readonly WriteOp[]): readonly WriteOp[] => ops;

async function blobOp(text: string, mediaType = 'text/plain'): Promise<WriteOp> {
  const bytes = bytesOf(text);
  return { op: 'put-blob', namespace: NS, digest: await digestBytes(webCryptoDigest, bytes), mediaType, bytes };
}

const doc = (key: string, value: unknown, expectedRevision: string | null): WriteOp => ({ op: 'put-document', namespace: NS, key, value: value as never, expectedRevision });
const event = (stream: string, payload: unknown, expectedSeq: number): WriteOp => ({ op: 'append-event', namespace: NS, stream, payload: payload as never, expectedSeq });

async function view(port: T13StoragePort): Promise<unknown> {
  const documents = (await port.listDocuments(NS)).map((item) => ({ key: item.key, value: item.value }));
  const blobs = await port.listBlobs(NS);
  const streams = [];
  for (const stream of await port.listStreams(NS)) streams.push({ stream, events: (await port.readEvents(NS, stream)).map((item) => ({ seq: item.seq, payload: item.payload })) });
  return { documents, blobs, streams };
}

describe('the proposal is labelled unaccepted', () => {
  it('says so in code and in its header', () => {
    assert.equal(PROPOSAL_STATUS.accepted, false);
    assert.match(PROPOSAL_STATUS.label, /UNACCEPTED PROPOSAL/u);
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../proposal/imports-txn.ts'), 'utf8');
    assert.match(source, /UNACCEPTED PROPOSAL/u);
    assert.match(source, /document CAS alone does NOT establish\s+\*?\s*atomicity across T13's documents, blobs and events/u);
  });
});

describe('behaves like the T13 in-memory port for ordinary commits (parity)', () => {
  it('produces the same observable state and the same conflicts', async () => {
    const dir = makeDir();
    try {
      const { storage } = await openAt(join(dir, 'store'));
      const real = asT13(proposed(storage));
      const fake = new FakeStoragePort([{ name: NS, class: 'workspace' }]);
      const both = [real, fake as T13StoragePort];
      const blob = await blobOp('hello blob');
      const steps: { label: string; ops: (port: T13StoragePort) => Promise<WriteOp[]>; conflict?: boolean }[] = [
        { label: 'create doc, blob and two events', ops: async () => [doc('a/one', { n: 1 }, null), blob, event('imports', { e: 1 }, 0), event('imports', { e: 2 }, 1)] },
        { label: 'swap on the current revision', ops: async (port) => [doc('a/one', { n: 2 }, (await port.getDocument(NS, 'a/one'))!.revision)] },
        { label: 'stale revision', ops: async () => [doc('a/one', { n: 3 }, 'stale')], conflict: true },
        { label: 'create over an existing key', ops: async () => [doc('a/one', { n: 3 }, null)], conflict: true },
        { label: 'wrong expected sequence', ops: async () => [event('imports', { e: 3 }, 0)], conflict: true },
        { label: 'same key twice in one batch', ops: async () => [doc('a/two', 1, null), doc('a/two', 2, null)], conflict: true },
        { label: 'blob digest mismatch', ops: async () => [{ ...(blob as object), bytes: bytesOf('other bytes') } as WriteOp], conflict: true },
        { label: 'blob media type mismatch', ops: async () => [{ ...(blob as object), mediaType: 'image/png' } as WriteOp], conflict: true },
        { label: 'idempotent blob re-put with a new event stream', ops: async () => [blob, event('other', 'x', 0)] },
        { label: 'a failing op rejects the whole batch', ops: async () => [doc('a/three', 1, null), event('imports', 'late', 99)], conflict: true },
      ];
      for (const step of steps) {
        const outcomes: string[] = [];
        for (const port of both) {
          try {
            await port.commit(await step.ops(port));
            outcomes.push('ok');
          } catch (error) {
            assert.ok(error instanceof StorageConflictError, `${step.label}: ${String(error)}`);
            outcomes.push('conflict');
          }
        }
        assert.deepEqual(outcomes, step.conflict ? ['conflict', 'conflict'] : ['ok', 'ok'], step.label);
        assert.deepEqual(await view(real), await view(fake), `state after: ${step.label}`);
      }
      assert.deepEqual((await real.namespaces()), [{ name: NS, class: 'workspace' }]);
      await storage.close();
    } finally {
      removeDir(dir);
    }
  });

  it('keeps its bookkeeping documents out of sight and refuses user keys in the reserved root', async () => {
    const dir = makeDir();
    try {
      const { storage } = await openAt(join(dir, 'store'));
      const port = asT13(proposed(storage));
      await port.commit(asOps([doc('k', 1, null), event('s', 'e', 0), await blobOp('b')]));
      assert.deepEqual((await port.listDocuments(NS)).map((item) => item.key), ['k']);
      assert.ok((await storage.workspace.listDocuments(RESERVED_KEY_ROOT)).length >= 2, 'intent and blob records exist underneath');
      await assert.rejects(port.commit(asOps([doc(`${RESERVED_KEY_ROOT}intents/forged`, 1, null)])), StorageConflictError);
      await assert.rejects(port.getDocument(NS, `${RESERVED_KEY_ROOT}intents/x`), StorageConflictError);
      await assert.rejects(port.getBlob('other', 'sha256:' + '0'.repeat(64) as never), StorageConflictError);
      await storage.close();
    } finally {
      removeDir(dir);
    }
  });

  it('writes nothing, not even a staged blob, when validation fails', async () => {
    const dir = makeDir();
    try {
      const { storage } = await openAt(join(dir, 'store'));
      const port = asT13(proposed(storage));
      const blob = await blobOp('should not be staged');
      await assert.rejects(port.commit([blob, event('s', 'x', 5)]), StorageConflictError);
      assert.equal(await storage.workspace.hasBlob((blob as { digest: string }).digest), false);
      assert.deepEqual(await storage.workspace.listDocuments(RESERVED_KEY_ROOT), []);
      await storage.close();
    } finally {
      removeDir(dir);
    }
  });
});

describe('crash and replay at every filesystem call of a mixed commit', () => {
  for (const tear of [false, true]) {
    it(`after recovery the commit is all-or-nothing, with no duplicate events (${tear ? 'torn' : 'clean'} writes)`, async () => {
      const raws: { docs: boolean; events: number; blobBytes: boolean }[] = [];
      const blocked: string[] = [];
      const blob = await blobOp('staged payload', 'image/png');
      const digest = (blob as { digest: string }).digest;
      const report = await crashSweep({
        makeContext: () => ({}),
        setup: async (storage) => {
          await proposed(storage).commit(asOps([doc('d1', { v: 'old' }, null)]));
        },
        act: async (storage) => {
          const port = proposed(storage);
          await port.commit(asOps([doc('d1', { v: 'new' }, '1'), doc('d2', { v: 'created' }, null), blob, event('stream', 'first', 0), event('stream', 'second', 1)]));
        },
        observe: async (storage, _context, store) => {
          // What the raw store shows BEFORE the proposal's recovery runs.
          raws.push({
            docs: (await storage.workspace.getDocument('d2')) !== null,
            events: (await storage.workspace.readEvents('stream')).events.length,
            blobBytes: await storage.workspace.hasBlob(digest),
          });
          try {
            return await view(asT13(proposed(storage)));
          } catch (error) {
            // A crash that tore an event line leaves that journal fail-closed (T9 never repairs it
            // on its own), so recovery cannot replay. Only the owner-level repair unblocks it.
            if (!isStoreError(error, 'stream-unavailable')) throw error;
            blocked.push(error.message);
            await store.repairTornTail('workspace' as never, 'stream' as never);
            return view(asT13(proposed(storage)));
          }
        },
      }, tear);
      assert.ok(report.crashPoints > 8, `swept ${report.crashPoints} crash points`);
      assert.ok(report.old > 0 && report.fresh > 0, 'both outcomes reached after recovery');
      // Honest limits, observed rather than assumed: visibility is eventual, and orphan blobs stay behind.
      assert.ok(raws.some((raw) => raw.docs && raw.events < 2), 'a raw state with documents committed but events not yet replayed exists');
      assert.ok(raws.some((raw) => !raw.docs && raw.blobBytes), 'an orphan staged blob exists in a crash that never committed');
      assert.ok(raws.every((raw) => raw.events === 0 || raw.docs), 'events are never visible before their documents');
      // Finding: a torn event append blocks replay (fail-closed) until the explicit repair.
      if (tear) assert.ok(blocked.length > 0, 'a torn event append blocked recovery until repairTornTail');
      else assert.equal(blocked.length, 0, 'clean crashes never block recovery');
    });
  }
});
