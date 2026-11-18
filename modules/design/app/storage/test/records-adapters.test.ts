import assert from 'node:assert/strict';
import { join } from 'node:path';
import { it } from 'node:test';
import type { OutboxStorePort, EvidenceStorePort } from '../../../connector/src/contract.ts';
import type { DispatchRecord } from '../../../connector/src/dispatch.ts';
import { brandId } from '../../../connector/src/ids.ts';
import type { DispatchId, EvidenceId } from '../../../connector/src/ids.ts';
import type { EvidenceEntry } from '../../../connector/src/evidence.ts';
import type { ReferenceStoragePort } from '../../../references/src/contract.ts';
import type { CacheStoragePort } from '../../../discovery/src/contract.ts';
import { createEvidenceStore, createReferencesStorage, createDiscoveryCacheStore, createOutboxAdapter, createRequestsStoragePort } from '../index.ts';
import type { OutboxAdapter, WorkspaceRecords, DiscoveryCacheStore } from '../index.ts';
import { makeDir, openAt, removeDir, proveCleanup } from './helpers.ts';
proveCleanup();
type Assert<T extends true> = T;
export type OutboxAligned = Assert<OutboxAdapter<DispatchRecord, DispatchId> extends OutboxStorePort ? true : false>;
export type OutboxReverseAligned = Assert<OutboxStorePort extends OutboxAdapter<DispatchRecord, DispatchId> ? true : false>;
export type CacheAligned = Assert<DiscoveryCacheStore extends Pick<CacheStoragePort, 'namespace' | 'readDocument' | 'writeDocument'> ? true : false>;
const entry = (dispatchId: string, evidenceId: string): EvidenceEntry => ({
  evidence: { schema: 'hq.design.result-evidence/v1', dispatchId: brandId('DispatchId', dispatchId), evidenceId: brandId('EvidenceId', evidenceId),
    attemptId: brandId('AttemptId', 'a'), receiptId: brandId('ReceiptId', 'receipt'), packet: { packetId: brandId('PacketId', 'p'), packetDigest: 'sha256:fixture' },
    candidate: { candidateId: brandId('CandidateId', 'c'), summary: 'Synthetic', artifacts: [] }, claimLevel: 'agent-reported',
    execution: { status: 'completed', observedAt: '2026-01-01T00:00:00Z', hostId: brandId('HostId', 'fake'), receiverId: brandId('ReceiverId', 'fake'), model: null }, provenance: 'fake' },
  digest: 'sha256:fixture', receivedAt: '2026-01-01T00:00:00Z', fake: true,
});
it('references round trip revisions, record mediaType and immutable asset bytes', async () => {
  const dir = makeDir();
  try {
    const { storage } = await openAt(join(dir, 'store'));
    const refs: ReferenceStoragePort = createReferencesStorage(storage.workspace);
    const asset = await refs.putBlob(new Uint8Array([1, 2, 3]), 'image/png');
    const value = { asset: { ...asset, mediaType: 'image/png' } };
    assert.equal(await refs.hasBlob(asset.digest), true);
    assert.deepEqual(await refs.writeDocument('workspace', 'design/references/library', value, null), { ok: true, revision: '1' });
    assert.deepEqual(await refs.readDocument('workspace', 'design/references/library'), { value, revision: '1' });
    assert.deepEqual(await refs.writeDocument('workspace', 'design/references/library', {}, null), { ok: false, reason: 'conflict' });
    assert.deepEqual(await refs.writeDocument('workspace', 'design/references/library', value, '1'), { ok: true, revision: '2' });
    assert.deepEqual(await refs.writeDocument('workspace', 'design/references/library', {}, '01'), { ok: false, reason: 'conflict' });
    await assert.rejects(refs.readDocument('workspace', 'design/requests/x'));
    assert.equal('deleteBlob' in refs, false);
    await storage.close();
  } finally { removeDir(dir); }
});
it('evidence create-only reconciliation, global IDs and exact dispatch prefix', async () => {
  const dir = makeDir();
  try {
    const { storage } = await openAt(join(dir, 'store'));
    const a: EvidenceStorePort = createEvidenceStore(storage.workspace), b = createEvidenceStore(storage.workspace);
    assert.deepEqual(await Promise.all([a.append(entry('d', 'e')), b.append(entry('d2', 'e'))]), ['appended', 'exists']);
    await a.append(entry('d2', 'e2'));
    assert.deepEqual(await a.get('e' as EvidenceId), entry('d', 'e'));
    assert.deepEqual(await a.listByDispatch('d' as DispatchId), [entry('d', 'e')]);
    assert.equal(await a.append({ ...entry('d', 'e'), receivedAt: 'other' }), 'exists');
    assert.equal((await storage.workspace.getDocument('design/connector/evidence/d/e'))?.revision, 1);
    assert.equal('delete' in a, false);
    await storage.close();
  } finally { removeDir(dir); }
});
it('cache writes only the exact catalog envelope; requests accept records-only backing', async () => {
  const dir = makeDir();
  try {
    const { storage } = await openAt(join(dir, 'store'));
    const cache = createDiscoveryCacheStore(storage.cache);
    await cache.writeDocument('design.discovery.catalog', ' text\n🎯');
    assert.equal(await cache.readDocument('design.discovery.catalog'), ' text\n🎯');
    for (const key of ['', 'design.discovery.catalog/x', 'elsewhere']) {
      await assert.rejects(cache.writeDocument(key, 'bad')); await assert.rejects(cache.readDocument(key));
    }
    assert.deepEqual(Object.keys(cache).sort(), ['namespace', 'readDocument', 'writeDocument']);
    const w = storage.workspace;
    const records: WorkspaceRecords = { kind: w.kind, namespace: w.namespace, getDocument: w.getDocument, putDocument: w.putDocument, listDocuments: w.listDocuments,
      putBlob: w.putBlob, getBlob: w.getBlob, hasBlob: w.hasBlob, appendEvent: w.appendEvent, readEvents: w.readEvents };
    const requests = createRequestsStoragePort({ workspace: records });
    assert.equal(await requests.createDocument('workspace', 'design/requests/r/packets/000001', new TextEncoder().encode('{}')), 'created');
    const outbox: OutboxStorePort = createOutboxAdapter<DispatchRecord, DispatchId>(w);
    assert.equal(await outbox.get('missing' as DispatchId), null);
    await storage.close();
  } finally { removeDir(dir); }
});
