import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { encodeName } from '../../../../../packages/design-store/src/layout.ts';
import { parseBundle, restoreBundle } from '../../../imports/src/bundle.ts';
import type { StoragePort as RequestsStoragePort } from '../../../requests/src/contract.ts';
import { createRequestsStoragePort } from '../requests.ts';
import { createImportsStorage, type EngineResult } from '../transactions.ts';
import { makeDir, removeDir, proveCleanup } from './helpers.ts';
import { engineAt, allCallFs } from './engine-fixture.ts';
import { newT6Context, t6ReadyDraft, t6Store, imageBytes } from './t6-env.ts';
proveCleanup();
const unwrap = <T>(result: EngineResult<T>): T => { assert.ok(result.ok); return result.value; };
const AT = '2026-01-01T00:00:00.000Z';
it('bundle uses field projections, exact omissions and deterministic bytes; restores projected state', async () => {
  const dir = makeDir();
  try {
    const e = await engineAt(join(dir, 'from'));
    const context = newT6Context(), store = t6Store(createRequestsStoragePort({ workspace: e.transactions.workspace }) as RequestsStoragePort, context);
    const { requestId, session } = await t6ReadyDraft(store, context);
    await session.addAttachment(imageBytes(1), { attachmentId: 'selected', mediaType: 'image/png', label: 'chosen' });
    await session.addAttachment(imageBytes(2), { attachmentId: 'private', mediaType: 'image/png', label: 'SECRET-ATTACHMENT' });
    session.edit({ type: 'select-attachment', attachmentId: 'selected' as never, selected: true });
    await session.freeze();
    session.edit({ type: 'set-intent', intent: 'SECRET-DRAFT' }); await session.flush();
    const w = e.runtime.raw;
    await w.putDocument(`design/requests/${requestId}/sends/x`, { secret: 'SECRET-SEND' });
    await w.putDocument(`design/requests/${requestId}/handoff/x`, { secret: 'SECRET-HOST' });
    await w.putDocument(`design/requests/${requestId}/candidates/nonv1`, { candidateId: 'nonv1', provenance: {}, candidateVersionId: null, text: 'SECRET-RETURN' });
    await w.putDocument('design/connector/outbox/d', { secret: 'SECRET-OUTBOX' });
    await w.putDocument('design/connector/evidence/d/e', { secret: 'SECRET-EVIDENCE' });
    await e.production.cache.putDocument('design.discovery.catalog', { format: 'hq.design.storage.text/v1', text: 'SECRET-CACHE' });
    await w.putDocument('design/projects/design.projects/content/p', { schema: 'hq.design.project-content/v1', projectId: 'p', views: [], versions: [], links: [], updatedAt: AT, extra: 'SECRET-FUTURE' });
    await e.transactions.commit([{ op: 'put-document', namespace: 'workspace', key: 'design/annotations/v', expectedRevision: null,
      value: { schema: 'hq.design.annotations/v1', versionId: 'v', nextLetterIndex: 0, annotations: [], revisit: [] } }]);
    const first = unwrap(await e.exportBundle.build(AT));
    assert.deepEqual(unwrap(await e.exportBundle.preview(AT)), first.report);
    assert.deepEqual(unwrap(await e.exportBundle.build(AT)).bytes, first.bytes);
    const text = new TextDecoder().decode(first.bytes);
    for (const secret of ['SECRET-ATTACHMENT', 'SECRET-DRAFT', 'SECRET-SEND', 'SECRET-HOST', 'SECRET-RETURN', 'SECRET-OUTBOX', 'SECRET-EVIDENCE', 'SECRET-CACHE', 'SECRET-FUTURE']) assert.equal(text.includes(secret), false, secret);
    const counts = Object.fromEntries(first.report.omitted.map(o => [o.category, o.count]));
    assert.deepEqual(counts, {
      cache: 1, continuations: 1, 'corrupt-streams': 0, 'draft-history': 1, drafts: 1, evidence: 1, 'handoff-status': 1,
      'missing-blobs': 0, 'non-v1-candidates': 1, outbox: 1, 'pending-import-keys': 0, 'pending-import-streams': 0,
      'reviews-of-omitted-candidates': 0, sends: 1, 'storage-internals': 3, 'torn-streams': 0,
      'unclassified-events': 0, 'unclassified-keys': 0, 'unclassified-streams': 0, 'unselected-attachments': 1,
    });
    const parsed = await parseBundle(first.bytes); assert.ok(parsed.ok);
    const target = await engineAt(join(dir, 'to'));
    const restored = await restoreBundle({ storage: createImportsStorage(target.transactions), clock: { now: () => AT } }, parsed.bundle);
    assert.ok(restored.ok);
    for (const ns of parsed.bundle.namespaces) {
      for (const doc of ns.documents) assert.deepEqual((await target.transactions.workspace.getDocument(doc.key))?.value, doc.value);
      for (const stream of ns.streams) assert.deepEqual((await target.transactions.workspace.readEvents(stream.stream)).events.map(e => e.payload), stream.events.map(e => e.payload));
      for (const blob of ns.blobs) assert.deepEqual(await target.transactions.workspace.getBlob(blob.digest), new Uint8Array(Buffer.from(blob.data, 'base64')));
    }
    await target.close(); await e.close();
  } finally { removeDir(dir); }
});
it('pending keys, torn/corrupt streams and missing blobs are counted without exporting their contents', async () => {
  const dir = makeDir();
  try {
    const root = join(dir, 'store'), fs = allCallFs(); let e = await engineAt(root, fs.fs);
    await e.runtime.raw.putDocument('design/references/library', { schema: 'hq.design.references/v1', references: { r: { id: 'r', asset: { digest: 'sha256:' + '0'.repeat(64), mediaType: 'image/png', bytes: 4 } } }, collections: {}, uses: {} });
    await e.runtime.raw.appendEvent('design/flows/torn', { type: 'x', payload: {} });
    await e.runtime.raw.appendEvent('design/flows/corrupt', { type: 'x', payload: {} });
    const path = (s: string) => join(root, 'generations/g000001/ns/workspace/events', encodeName(s) + '.jsonl');
    appendFileSync(path('design/flows/torn'), '{'); appendFileSync(path('design/flows/corrupt'), '{}\n');
    const append = fs.fs.append;
    fs.fs.append = async (p, b) => { await append(p, b.subarray(0, 3)); throw new Error('torn replay'); };
    await assert.rejects(e.transactions.commit([
      { op: 'put-document', namespace: 'workspace', key: 'design/projects/pending', expectedRevision: null, value: { schema: 'hq.design.project-content/v1', projectId: 'SECRET-PENDING' } },
      { op: 'append-event', namespace: 'workspace', stream: 'design/imports', expectedSeq: 0, payload: { type: 'import.applied', secret: 'SECRET-EVENT' } },
    ]));
    await e.close(); e = await engineAt(root);
    const result = unwrap(await e.exportBundle.build(AT));
    const counts = Object.fromEntries(result.report.omitted.map(o => [o.category, o.count]));
    assert.equal(counts['pending-import-keys'], 1); assert.equal(counts['pending-import-streams'], 1);
    assert.equal(counts['torn-streams'], 1); assert.equal(counts['corrupt-streams'], 1); assert.equal(counts['missing-blobs'], 1);
    assert.doesNotMatch(new TextDecoder().decode(result.bytes), /SECRET-PENDING|SECRET-EVENT/);
    await e.close();
  } finally { removeDir(dir); }
});
