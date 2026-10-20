import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DRAFT_SCHEMA, FREEZE_SCHEMA, PACKET_SCHEMA, REVIEW_EVENT_SCHEMA, type StoragePort as T6StoragePort } from '../../../requests/src/contract.ts';
import { linkOf } from '../../../requests/src/draft.ts';
import { candidate } from '../../../requests/test/fixtures.ts';
import { canonicalBytes } from '../canonical.ts';
import { asReader, type WorkspaceReader } from '../backing.ts';
import {
  classifyRequestsKey, createRequestsExport, EXPORT_SCHEMA, EXPORT_STATUS, ExportDisabledError, ExportProjectionError,
  projectFreezeRecord, REQUESTS_PACKET_PIN, reviewStreamOf,
} from '../export.ts';
import { makeDir, openAt, proveCleanup, removeDir } from './helpers.ts';
import { imageBytes, newT6Context, t6ReadyDraft, t6Store } from './t6-env.ts';

proveCleanup();

const SECRETS = ['UNSENT-CONTINUATION-SECRET', 'UNSENT-DRAFT-TITLE', 'PRIVATE-UNSELECTED-LABEL', 'att-private', 'local-unsent'];
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

async function fixture(run: (ctx: {
  readonly storage: Awaited<ReturnType<typeof openAt>>['storage'];
  readonly requestId: string;
  readonly otherId: string;
  readonly selected: Uint8Array;
  readonly unselected: Uint8Array;
  readonly unselectedDigest: string;
}) => Promise<void>): Promise<void> {
  const dir = makeDir();
  try {
    const { storage } = await openAt(join(dir, 'store'));
    try {
      const context = newT6Context();
      const store = t6Store(storage.requests as T6StoragePort, context);
      const { requestId, session } = await t6ReadyDraft(store, context);
      const selected = imageBytes(1);
      const unselected = imageBytes(2);
      await session.addAttachment(selected, { attachmentId: 'att-selected', mediaType: 'image/png', label: 'Chosen crop' });
      await session.addAttachment(unselected, { attachmentId: 'att-private', mediaType: 'image/png', label: 'PRIVATE-UNSELECTED-LABEL' });
      session.edit({ type: 'select-attachment', attachmentId: 'att-selected' as never, selected: true });
      const packet = (await session.freeze())!;
      const unselectedDigest = session.state.draft!.attachments.find((item) => item.attachmentId === 'att-private')!.blobDigest;
      await store.recordReview({ requestId, candidate: candidate(linkOf(packet)), decision: 'defer', note: 'later' });
      session.edit({ type: 'set-intent', intent: 'UNSENT-CONTINUATION-SECRET' }); // unsent edit after the freeze
      await session.flush();
      const other = await store.createRequest({ title: 'UNSENT-DRAFT-TITLE' }); // never frozen
      await run({ storage, requestId, otherId: other.requestId, selected, unselected, unselectedDigest });
    } finally {
      await storage.close();
    }
  } finally {
    removeDir(dir);
  }
}

describe('export is disabled by default', () => {
  it('fails closed from every default construction path', async () => {
    await fixture(async ({ storage }) => {
      assert.equal(EXPORT_STATUS.state, 'disabled');
      const reader = asReader(storage.workspace);
      for (const port of [
        storage.requestsExport,
        createRequestsExport(reader),
        createRequestsExport(reader, {}),
        createRequestsExport(reader, { enabled: false }),
        createRequestsExport(reader, { enabled: 'true' as never }),
        createRequestsExport(reader, { enabled: 1 as never }),
      ]) {
        assert.equal(port.status.state, 'disabled');
        await assert.rejects(port.exportRequests('2026-01-03T00:00:00.000Z'), ExportDisabledError);
      }
    });
  });

  it('never reads the store while disabled', async () => {
    await fixture(async ({ storage }) => {
      const reads: string[] = [];
      const spy = { ...asReader(storage.workspace), listDocuments: async (prefix?: string) => { reads.push(`list ${prefix}`); return []; } } as WorkspaceReader;
      await assert.rejects(createRequestsExport(spy).exportRequests('t'), ExportDisabledError);
      assert.deepEqual(reads, []);
    });
  });
});

describe('privacy projection (PR17 v1 packet)', () => {
  it('exports frozen decisions and selected images only, with visible omissions', async () => {
    await fixture(async ({ storage, requestId, otherId, selected, unselectedDigest, unselected }) => {
      // Control: the raw freeze record really does hold the private material, so the checks below mean something.
      const raw = JSON.stringify((await storage.workspace.getDocument(`design/requests/${requestId}/packets/000001`))!.value);
      for (const secret of ['PRIVATE-UNSELECTED-LABEL', 'att-private', 'local-unsent', 'consumedDraft', 'continuation']) assert.ok(raw.includes(secret), `control: raw record holds ${secret}`);
      const rawDraft = JSON.stringify((await storage.workspace.getDocument(`design/requests/${requestId}/draft`))!.value);
      assert.ok(rawDraft.includes('UNSENT-CONTINUATION-SECRET'), 'control: the live draft holds the unsent edit');

      const port = createRequestsExport(asReader(storage.workspace), { enabled: true });
      const { projection, bytes } = await port.exportRequests('2026-01-03T00:00:00.000Z');
      const text = decode(bytes);
      // The omission notes below name what was left out, so the structural check covers the exported content only.
      const content = decode(canonicalBytes({ requests: projection.requests, blobs: projection.blobs }));
      for (const secret of [...SECRETS, unselectedDigest, b64(unselected), otherId]) {
        assert.equal(text.includes(secret), false, `export must not contain ${secret}`);
      }
      for (const field of ['consumedDraft', 'continuation', 'continuesFrom']) assert.equal(content.includes(field), false, `exported content must not contain ${field}`);
      assert.equal(text.includes(b64(selected)), true, 'the selected image is exported');
      assert.equal(projection.schema, EXPORT_SCHEMA);
      assert.equal(projection.pin, REQUESTS_PACKET_PIN.requestsHead);
      assert.deepEqual(projection.requests.map((item) => item.requestId), [requestId], 'a never-frozen request is not exported');
      const [request] = projection.requests;
      assert.equal(request!.freezes.length, 1);
      assert.deepEqual(Object.keys(request!.freezes[0]!).sort(), ['consumed', 'packet', 'schema'], 'only the allow-listed record fields survive');
      assert.equal(request!.candidates.length, 1, "the returned candidate stored by recordReview is exported");
      assert.equal(request!.reviews.length, 1);
      assert.deepEqual(projection.omitted.map((item) => [item.store, item.count]), [
        ['drafts', 2], ['draft-history', 1], ['continuations', 1], ['unselected-attachments', 1], ['unclassified-keys', 0], ['cache', 0],
      ]);
    });
  });

  it('never reads a draft document', async () => {
    await fixture(async ({ storage }) => {
      const reader = asReader(storage.workspace);
      const read: string[] = [];
      const spy: WorkspaceReader = { ...reader, getDocument: async (key) => { read.push(key); return reader.getDocument(key); } };
      await createRequestsExport(spy, { enabled: true }).exportRequests('t');
      assert.ok(read.length > 0);
      assert.deepEqual(read.filter((key) => key.endsWith('/draft')), []);
    });
  });

  it('omits and counts keys the pinned projection does not know instead of exporting them', async () => {
    await fixture(async ({ storage }) => {
      await storage.workspace.putDocument('design/requests/r9/notes', { text: 'SECRET-NOTES' });
      await storage.workspace.putDocument('design/requests/r9/packets/abc', { text: 'SECRET-BADLY-NAMED' });
      await storage.workspace.putDocument('design/requests/r9/draft-backup', { text: 'SECRET-DRAFT-BACKUP' });
      await storage.workspace.putDocument('design/connector/outbox/d1', { dispatchId: 'd1', text: 'SECRET-OUTBOX' });
      const { projection, bytes } = await createRequestsExport(asReader(storage.workspace), { enabled: true }).exportRequests('t');
      const text = decode(bytes);
      for (const secret of ['SECRET-NOTES', 'SECRET-BADLY-NAMED', 'SECRET-DRAFT-BACKUP', 'SECRET-OUTBOX']) assert.equal(text.includes(secret), false, secret);
      assert.equal(projection.omitted.find((item) => item.store === 'unclassified-keys')!.count, 3, 'outbox keys are outside the requests root and not even listed');
    });
  });

  it('refuses the whole export when a record is not the pinned v1 shape', async () => {
    await fixture(async ({ storage, requestId }) => {
      const key = `design/requests/${requestId}/packets/000001`;
      const good = (await storage.workspace.getDocument(key))!;
      const port = () => createRequestsExport(asReader(storage.workspace), { enabled: true });
      const bad = [
        { ...(good.value as object), schema: 'hq.design.request-freeze/v2' },
        { ...(good.value as object), packet: { ...(good.value as { packet: object }).packet, schema: 'hq.design.decision-packet/v2' } },
        { ...(good.value as object), consumed: null },
        { ...(good.value as object), packet: { ...(good.value as { packet: object }).packet, attachments: 'nope' } },
      ];
      for (const value of bad) {
        await storage.workspace.putDocument(key, value as never, { expectedRevision: (await storage.workspace.getDocument(key))!.revision });
        await assert.rejects(port().exportRequests('t'), ExportProjectionError);
      }
    });
  });

  it('projects a record by allow-list even when a future field appears next to the packet', () => {
    const value = { schema: FREEZE_SCHEMA, packet: { schema: PACKET_SCHEMA, attachments: [], lineage: { sequence: 1 } }, consumed: { draftId: 'd', revision: 1 }, consumedDraft: { x: 'PRIVATE' }, continuation: { x: 'PRIVATE' }, futurePrivate: 'PRIVATE' };
    const { record } = projectFreezeRecord(value);
    assert.equal(JSON.stringify(record).includes('PRIVATE'), false);
  });

  it('classifies keys by allow-list', () => {
    assert.deepEqual(classifyRequestsKey('design/requests/r1/draft'), { kind: 'draft', requestId: 'r1' });
    assert.deepEqual(classifyRequestsKey('design/requests/r1/packets/000002'), { kind: 'packet', requestId: 'r1', sequence: 2 });
    assert.deepEqual(classifyRequestsKey('design/requests/r1/candidates/c1'), { kind: 'candidate', requestId: 'r1', candidateId: 'c1' });
    for (const key of ['design/requests/r1/draft/x', 'design/requests/r1/packets/2', 'design/requests/r1/other', 'design/requests//draft', 'x/design/requests/r1/draft']) {
      assert.deepEqual(classifyRequestsKey(key), { kind: 'unclassified' }, key);
    }
    assert.equal(reviewStreamOf('r1'), 'design/requests/r1/review');
  });
});

describe('binding to the exact PR17 v1 packet', () => {
  it('uses the schema names of the pinned requests code', () => {
    assert.equal(REQUESTS_PACKET_PIN.packetSchema, PACKET_SCHEMA);
    assert.equal(REQUESTS_PACKET_PIN.freezeSchema, FREEZE_SCHEMA);
    assert.equal(REQUESTS_PACKET_PIN.reviewEventSchema, REVIEW_EVENT_SCHEMA);
    assert.equal(REQUESTS_PACKET_PIN.draftSchema, DRAFT_SCHEMA);
    assert.equal(REQUESTS_PACKET_PIN.requestsHead, '2438d6ff96a84141e12e30bab2d28d042aa80d01');
  });

  it('fails loudly if the requests source changes, so an extension is re-bound deliberately', () => {
    // Digest of modules/design/requests/src/*.ts at 2438d6ff. When the requests extension is accepted,
    // re-run the projection tests against it and update this value together with REQUESTS_PACKET_PIN.
    const dir = join(dirname(fileURLToPath(import.meta.url)), '../../../requests/src');
    const lines = readdirSync(dir).filter((name) => name.endsWith('.ts')).sort()
      .map((name) => `${name}\0${createHash('sha256').update(readFileSync(join(dir, name))).digest('hex')}\n`);
    assert.equal(createHash('sha256').update(lines.join('')).digest('hex'), 'a1196f0a9d2b502fe1af56445f076af361cc6d6bf2d9e989521aa25dacf616a0');
  });
});
