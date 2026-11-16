import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'node:test';
import { encodeName } from '../../../../../packages/design-store/src/layout.ts';
import { parseBundle, restoreBundle } from '../../../imports/src/bundle.ts';
import { createDesignExport } from '../design-export.ts';
import { createImportsStorage, type EngineResult } from '../transactions.ts';
import { allCallFs, engineAt, TestCrash } from './engine-fixture.ts';
import { makeDir, removeDir, proveCleanup } from './helpers.ts';

proveCleanup();
const unwrap = <T>(result: EngineResult<T>): T => { assert.ok(result.ok); return result.value; };
const AT = '2026-01-01T00:00:00.000Z';

// Synthetic metadata only: no captured image, producer attestation or installed-reader claim.
const receipt = {
  schema: 'hq.design.capture-evidence/v1', captureId: 'synthetic-capture-current-reader',
  producer: { id: 'hq.electron-preview', contract: 1, mode: 'qualification', appVersion: '0.0.0-synthetic', packaged: false },
  host: { sessionId: 'synthetic-session', hostVersionId: 'synthetic-host-version', generation: 1 },
  page: { origin: 'https://example.invalid', route: '/synthetic', state: '' },
  viewport: { w: 800, h: 600, dpr: 1 }, scroll: { x: 0.1, y: 0.0000001 },
  pageExtentCss: { width: 800, height: 1200 }, imageRectCss: { x: 0, y: 0, width: 800, height: 600 },
  image: { mediaType: 'image/png', digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', byteLength: 1234, pixelWidth: 800, pixelHeight: 600 },
  time: { capturedAt: AT, basis: 'host-clock-after-coherence-before-persist', acquisition: null },
  persistedAt: AT, fixture: { state: 'unknown', attestedBy: null },
};
const receiptKey = `hq/captures/receipts/${receipt.captureId}`;
const controlKey = 'design/projects/synthetic-receipt-control';
const control = { schema: 'hq.design.project-content/v1', projectId: 'synthetic-control', views: [], versions: [], links: [], updatedAt: AT };
const importedEvent = { type: 'import.applied', importId: 'synthetic-receipt-import', at: AT,
  sourceDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', counts: { items: 0, created: 0, updated: 0, unchanged: 0, conflicts: 0 } };

it('synthetic receipt: current reader reopen, committed import recovery, export and cleanup', async () => {
  const dir = makeDir(), root = join(dir, 'source'), fs = allCallFs();
  type Engine = Awaited<ReturnType<typeof engineAt>>;
  let source: Engine | undefined, target: Engine | undefined;
  const documentPath = (key: string) => join(root, 'generations/g000001/ns/workspace/docs', encodeName(key) + '.json');
  try {
    source = await engineAt(root, fs.fs);
    // The existing raw workspace accepts hq keys; the Design import writer remains Design-only.
    const retainedReceipt = await source.runtime.raw.putDocument(receiptKey, receipt, { expectedRevision: null });
    const retainedControl = await source.runtime.raw.putDocument(controlKey, control, { expectedRevision: null });
    const receiptBytes = readFileSync(documentPath(receiptKey)), controlBytes = readFileSync(documentPath(controlKey));
    assert.equal(retainedReceipt.revision, 1);
    assert.equal(retainedControl.revision, 1);

    // REOPEN compares actual retained document bytes and revisions, without a receipt codec.
    await source.close(); source = undefined;
    source = await engineAt(root, fs.fs);
    assert.deepEqual(await source.transactions.workspace.getDocument(receiptKey), retainedReceipt);
    assert.deepEqual(await source.transactions.workspace.getDocument(controlKey), retainedControl);
    assert.deepEqual(readFileSync(documentPath(receiptKey)), receiptBytes);
    assert.deepEqual(readFileSync(documentPath(controlKey)), controlBytes);
    assert.deepEqual(await source.transactions.workspace.listDocuments('design/'), [controlKey]);
    const reopenedReceipt = (await source.transactions.workspace.getDocument(receiptKey))!.value as typeof receipt;
    assert.deepEqual(reopenedReceipt, receipt);
    assert.equal(reopenedReceipt.scroll.x, 0.1);
    assert.equal(reopenedReceipt.scroll.y, 0.0000001);

    // RECOVERY terminates at the first replay append, after the intent manifest committed.
    const eventPath = join(root, 'generations/g000001/ns/workspace/events', encodeName('design/imports') + '.jsonl');
    const append = fs.fs.append;
    let reachedReplay = false;
    fs.fs.append = async (path, bytes) => {
      if (path === eventPath) { reachedReplay = true; fs.arm(0); }
      return append(path, bytes);
    };
    await assert.rejects(source.transactions.commit([
      { op: 'append-event', namespace: 'workspace', stream: 'design/imports', expectedSeq: 0, payload: importedEvent },
    ]), error => error instanceof TestCrash && error.message === 'Crash 0: append');
    assert.equal(reachedReplay, true);
    assert.equal(fs.crashed, true);
    assert.deepEqual(fs.trace, ['append']);
    fs.disarm();
    const intents = await source.runtime.raw.listDocuments('design/storage/intents/');
    assert.equal(intents.length, 1);
    const intentKey = intents[0]!;
    const committed = await source.runtime.raw.getDocument(intentKey);
    assert.ok(committed);
    const intent = committed.value as { schema: string; txnId: string; state: string; keys: string[]; blobs: string[]; streams: { stream: string; baseSeq: number; payloads: unknown[] }[] };
    assert.equal(intent.schema, 'hq.design.storage.import-txn/v1');
    assert.equal(intent.state, 'committed');
    assert.equal(committed.revision, 1);
    assert.equal(intentKey, `design/storage/intents/${intent.txnId}`);
    assert.deepEqual(intent.keys, []);
    assert.deepEqual(intent.blobs, []);
    assert.equal(intent.streams.length, 1);
    assert.equal(intent.streams[0]!.stream, 'design/imports');
    assert.equal(intent.streams[0]!.baseSeq, 0);
    assert.deepEqual(intent.streams[0]!.payloads, [importedEvent]);
    const persistedIntent = JSON.parse(readFileSync(documentPath(intentKey), 'utf8'));
    assert.equal(persistedIntent.value.state, 'committed');
    assert.equal(persistedIntent.revision, committed.revision);
    assert.deepEqual(persistedIntent.value, committed.value);
    const unapplied = await source.runtime.raw.readEvents('design/imports');
    assert.equal(unapplied.status.state, 'ok');
    assert.deepEqual(unapplied.events, []);
    assert.equal(unapplied.head, null);

    await source.close(); source = undefined;
    source = await engineAt(root);
    const applied = await source.runtime.raw.getDocument(intentKey);
    assert.ok(applied);
    assert.equal(applied.revision, committed.revision + 1);
    assert.deepEqual(applied.value, { ...intent, state: 'applied' });
    const replayed = await source.transactions.workspace.readEvents('design/imports');
    assert.equal(replayed.status.state, 'ok');
    assert.equal(replayed.events.length, 1);
    assert.deepEqual(replayed.events[0]!.payload, importedEvent);
    assert.equal(replayed.events[0]!.clientEventId, `${intent.txnId}:0:0`);
    const diagnostics = unwrap(await source.transactions.diagnostics());
    assert.deepEqual(diagnostics.pending, []);
    assert.deepEqual(diagnostics.blocked, []);
    assert.deepEqual(existsSync(join(root, 'quarantine')) ? readdirSync(join(root, 'quarantine')) : [], []);
    assert.deepEqual(await source.transactions.workspace.getDocument(receiptKey), retainedReceipt);
    assert.deepEqual(await source.transactions.workspace.getDocument(controlKey), retainedControl);
    assert.deepEqual(readFileSync(documentPath(receiptKey)), receiptBytes);
    assert.deepEqual(readFileSync(documentPath(controlKey)), controlBytes);
    assert.deepEqual(await source.transactions.workspace.listDocuments('design/'), [controlKey]);

    // EXPORT pins the current unclassified-key omission, without widening projections.
    const exporter = createDesignExport(source.runtime, true);
    const preview = unwrap(await exporter.preview(AT)), output = unwrap(await exporter.build(AT));
    assert.deepEqual(preview, output.report);
    assert.deepEqual(output.report.omitted.find(item => item.category === 'unclassified-keys'), {
      category: 'unclassified-keys', count: 1, unit: 'documents', reason: 'No accepted field projection',
    });
    assert.equal(output.report.documents, 1);
    assert.equal(output.report.events, 1);
    assert.equal(output.report.blobs, 0);
    const parsed = await parseBundle(output.bytes);
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.bundle.namespaces.flatMap(ns => ns.documents), [{ key: controlKey, value: control }]);
    for (const ns of parsed.bundle.namespaces) {
      assert.ok(ns.documents.every(doc => !doc.key.startsWith('hq/')));
      assert.ok(ns.streams.every(stream => !stream.stream.startsWith('hq/')));
    }
    assert.equal(new TextDecoder().decode(output.bytes).includes(receipt.captureId), false);
    target = await engineAt(join(dir, 'restored'));
    assert.deepEqual(await target.runtime.raw.listDocuments(), []);
    const restored = await restoreBundle({ storage: createImportsStorage(target.transactions), clock: { now: () => AT } }, parsed.bundle);
    assert.ok(restored.ok);
    assert.deepEqual((await target.transactions.workspace.getDocument(controlKey))?.value, control);
    assert.equal(await target.transactions.workspace.getDocument(receiptKey), null);
    assert.deepEqual(await target.runtime.raw.listDocuments('hq/'), []);
    assert.deepEqual(await target.transactions.workspace.listDocuments('design/'), [controlKey]);
    assert.deepEqual((await target.transactions.workspace.readEvents('design/imports')).events.map(event => event.payload), [importedEvent]);
    assert.deepEqual(await source.transactions.workspace.getDocument(receiptKey), retainedReceipt);
    assert.deepEqual(readFileSync(documentPath(receiptKey)), receiptBytes);
    assert.deepEqual(readFileSync(documentPath(controlKey)), controlBytes);
  } finally {
    // CLEANUP closes both owned stores even when an oracle fails; remove only this owned root.
    fs.disarm();
    try { if (target) await target.close(); }
    finally {
      try { if (source) await source.close(); }
      finally { removeDir(dir); }
    }
  }
});
