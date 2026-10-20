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
  projectCandidate, projectFreezeRecord, projectReviewEvent, REQUESTS_PACKET_PIN, reviewStreamOf,
} from '../export.ts';
import { makeDir, openAt, proveCleanup, removeDir } from './helpers.ts';
import { connectorReturn, imageBytes, LifecycleConnectorFake, newT6Context, t6ReadyDraft, t6Store, versionless } from './t6-env.ts';

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
        ['drafts', 2], ['draft-history', 1], ['continuations', 1], ['unselected-attachments', 1], ['sends', 0], ['handoff-status', 0],
        ['non-v1-candidates', 0], ['reviews-of-omitted-candidates', 0], ['unclassified-keys', 0], ['cache', 0],
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
    assert.deepEqual(classifyRequestsKey('design/requests/r1/sends/p1'), { kind: 'send', requestId: 'r1', packetId: 'p1' });
    assert.deepEqual(classifyRequestsKey('design/requests/r1/handoff/p1'), { kind: 'handoff', requestId: 'r1', packetId: 'p1' });
    for (const key of ['design/requests/r1/sends/p1/x', 'design/requests/r1/handoff/', 'design/requests/r1/draft/x', 'design/requests/r1/packets/2', 'design/requests/r1/other', 'design/requests//draft', 'x/design/requests/r1/draft']) {
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

const PR33_SECRETS = [
  'SECRET-PINNED-HOST', 'SECRET-ACTUAL-MODEL', 'SECRET-HANDOFF-DETAIL', 'SECRET-CONNECTOR-LABEL', 'SECRET-PROV-HOST', 'SECRET-PROV-MODEL',
  'SECRET-CONNECTOR-CLAIM', 'SECRET-OWNER-CLAIM', 'SECRET-OWNER-NOTE', 'SECRET-OWNER-HOST', 'SECRET-VERSIONLESS-CLAIM', 'SECRET-REVIEW-OF-OMITTED',
  'SECRET-FUTURE-FIELD', 'SECRET-FUTURE-CLAIM-FIELD', 'SECRET-FUTURE-EVIDENCE-FIELD', 'fx-send-0001',
];

describe('privacy projection for the PR33 inputs (sends, handoff status, provenance, reject)', () => {
  it('leaves out destination/host/model state and every non-v1 return, and says so', async () => {
    const dir = makeDir();
    try {
      const { storage } = await openAt(join(dir, 'store'));
      try {
        const context = newT6Context();
        const connector = new LifecycleConnectorFake();
        const store = t6Store(storage.requests as T6StoragePort, context);
        const { requestId, session } = await t6ReadyDraft(store, context, 'Tighten home heading', { destination: true });
        const packet = (await session.freeze())!;
        const link = linkOf(packet);
        assert.equal(await session.send(connector.dispatch, packet.packetId, 'dest-1'), 'sent');
        connector.set(link, 'running', {
          pinned: { host: 'SECRET-PINNED-HOST' }, actual: { model: 'SECRET-ACTUAL-MODEL' }, detail: 'SECRET-HANDOFF-DETAIL',
          destination: { destinationId: 'dest-1', label: 'SECRET-CONNECTOR-LABEL' },
        });
        await session.refreshHandoff(connector.status);
        // Returns: a v1-shaped connector return, one with provenance, one versionless, and an owner-reported one.
        const plainReturn = connectorReturn(link, 'cand-plain');
        const { provenance: _omit, ...v1Return } = plainReturn;
        connector.publishReturn(v1Return);
        connector.publishReturn({ ...connectorReturn(link, 'cand-prov'), claims: [{ claimId: 'k1', text: 'SECRET-CONNECTOR-CLAIM', level: 'agent-reported', evidence: [] }], provenance: { origin: 'connector', host: 'SECRET-PROV-HOST', model: 'SECRET-PROV-MODEL' } });
        connector.publishReturn({ ...versionless(link, 'cand-nover'), claims: [{ claimId: 'k1', text: 'SECRET-VERSIONLESS-CLAIM', level: 'agent-reported', evidence: [] }] });
        await session.refreshReturns(connector.returns);
        const owner = (await session.reportReturn({ packetId: packet.packetId, claims: ['SECRET-OWNER-CLAIM'], artifacts: [{ kind: 'note', label: 'SECRET-OWNER-NOTE' }], host: 'SECRET-OWNER-HOST' }))!;
        assert.ok(await session.review(v1Return as never, 'reject', 'visible reject note'));
        assert.ok(await session.review(owner, 'defer', 'SECRET-REVIEW-OF-OMITTED'));
        // A future field planted next to and inside an otherwise v1 candidate, written straight to storage.
        const planted = (await storage.workspace.getDocument(`design/requests/${requestId}/candidates/cand-plain`))!;
        const base = planted.value as { claims: Record<string, unknown>[]; evidence: Record<string, unknown>[] };
        await storage.workspace.putDocument(`design/requests/${requestId}/candidates/cand-plain`, {
          ...planted.value as object, futurePrivate: 'SECRET-FUTURE-FIELD',
          claims: base.claims.map((claim) => ({ ...claim, extra: 'SECRET-FUTURE-CLAIM-FIELD' })),
          evidence: base.evidence.map((item) => ({ ...item, extra: 'SECRET-FUTURE-EVIDENCE-FIELD' })),
        } as never, { expectedRevision: planted.revision });

        // Control: every marker really is in the raw stored records.
        const raw: string[] = [];
        for (const key of await storage.workspace.listDocuments('design/requests/')) raw.push(JSON.stringify((await storage.workspace.getDocument(key))!.value));
        raw.push(JSON.stringify((await storage.workspace.readEvents(reviewStreamOf(requestId))).events.map((event) => event.payload)));
        const rawText = raw.join('\n');
        for (const marker of PR33_SECRETS) assert.ok(rawText.includes(marker), `control: raw store holds ${marker}`);

        const { projection, bytes } = await createRequestsExport(asReader(storage.workspace), { enabled: true }).exportRequests('t');
        const text = decode(bytes);
        for (const marker of PR33_SECRETS) assert.equal(text.includes(marker), false, `export must not contain ${marker}`);
        for (const field of ['provenance', 'sendId', 'destinationLabel', 'pinned', 'actual', 'futurePrivate']) assert.equal(decode(canonicalBytes({ requests: projection.requests })).includes(`"${field}"`), false, `exported content has no ${field} field`);

        const [request] = projection.requests;
        assert.deepEqual(request!.candidates.map((item) => (item as { candidateId: string }).candidateId), ['cand-plain'], 'only the v1-shaped return is exported');
        assert.deepEqual(Object.keys(request!.candidates[0] as object).sort(), ['baselineVersionId', 'candidateId', 'candidateVersionId', 'claims', 'evidence', 'observedAt', 'observedStatus', 'packet'], 'allow-listed keys only');
        assert.deepEqual(request!.reviews.map((item) => [(item as { decision: string }).decision, (item as { note: string }).note]), [['reject', 'visible reject note']]);
        assert.deepEqual(projection.omitted.map((item) => [item.store, item.count]), [
          ['drafts', 1], ['draft-history', 1], ['continuations', 1], ['unselected-attachments', 0], ['sends', 1], ['handoff-status', 1],
          ['non-v1-candidates', 3], ['reviews-of-omitted-candidates', 1], ['unclassified-keys', 0], ['cache', 0],
        ]);
        for (const store of ['sends', 'handoff-status', 'non-v1-candidates', 'reviews-of-omitted-candidates']) {
          assert.ok(projection.omitted.find((item) => item.store === store)!.reason.length > 20, `${store} says why it is omitted`);
        }
      } finally {
        await storage.close();
      }
    } finally {
      removeDir(dir);
    }
  });

  it('never reads a send record or a handoff status document', async () => {
    const dir = makeDir();
    try {
      const { storage } = await openAt(join(dir, 'store'));
      try {
        const context = newT6Context();
        const store = t6Store(storage.requests as T6StoragePort, context);
        const { requestId, session } = await t6ReadyDraft(store, context, 'Tighten home heading', { destination: true });
        const packet = (await session.freeze())!;
        const connector = new LifecycleConnectorFake();
        await session.send(connector.dispatch, packet.packetId, 'dest-1');
        connector.set(linkOf(packet), 'queued');
        await session.refreshHandoff(connector.status);
        const reader = asReader(storage.workspace);
        const read: string[] = [];
        const spy: WorkspaceReader = { ...reader, getDocument: async (key) => { read.push(key); return reader.getDocument(key); } };
        await createRequestsExport(spy, { enabled: true }).exportRequests('t');
        assert.deepEqual(read.filter((key) => /\/(sends|handoff|draft)\//u.test(key) || key.endsWith('/draft')), []);
        assert.ok(read.includes(`design/requests/${requestId}/packets/000001`));
      } finally {
        await storage.close();
      }
    } finally {
      removeDir(dir);
    }
  });

  it('exports a second freeze after a revise lifecycle with only schema, packet and consumed', async () => {
    const dir = makeDir();
    try {
      const { storage } = await openAt(join(dir, 'store'));
      try {
        const context = newT6Context();
        const store = t6Store(storage.requests as T6StoragePort, context);
        const { session } = await t6ReadyDraft(store, context, 'Tighten home heading', { destination: true });
        const first = (await session.freeze())!;
        assert.ok(await session.review(candidate(linkOf(first)), 'revise', 'Tighter, please.'));
        session.edit({ type: 'set-intent', intent: 'UNSENT-CONTINUATION-SECRET' });
        await session.flush();
        const second = await session.freeze();
        assert.ok(second, session.state.error ?? 'second freeze');
        const { projection, bytes } = await createRequestsExport(asReader(storage.workspace), { enabled: true }).exportRequests('t');
        const [request] = projection.requests;
        assert.equal(request!.freezes.length, 2);
        for (const freeze of request!.freezes) assert.deepEqual(Object.keys(freeze).sort(), ['consumed', 'packet', 'schema']);
        assert.equal(request!.reviews.length, 1);
        assert.equal(request!.candidates.length, 1);
        // The second packet's content is exported (it is the frozen decision); nothing but frozen content.
        assert.equal((request!.freezes[1]!.packet as { lineage: { sequence: number } }).lineage.sequence, 2);
        assert.equal(decode(bytes).includes('local-unsent'), false);
        assert.equal(decode(bytes).includes('"continuation"'), false);
        assert.equal(decode(bytes).includes('"consumedDraft"'), false);
      } finally {
        await storage.close();
      }
    } finally {
      removeDir(dir);
    }
  });

  it('projects candidates and review events by allow-list', () => {
    const base = connectorReturn({ packetId: 'p1' as never, authoringDigest: 'sha256:' + 'a'.repeat(64) as never }, 'c1');
    const { provenance: _drop, ...v1 } = base;
    assert.equal(projectCandidate({ ...v1, extra: 'X' }).kind, 'exported');
    assert.equal(JSON.stringify(projectCandidate({ ...v1, extra: 'X' })).includes('extra'), false);
    assert.deepEqual(projectCandidate(base), { kind: 'omitted', reason: 'provenance' });
    assert.deepEqual(projectCandidate({ ...v1, candidateVersionId: null }), { kind: 'omitted', reason: 'no-comparable-version' });
    assert.deepEqual(projectCandidate({ ...v1, provenance: { origin: 'owner-reported' }, candidateVersionId: null }), { kind: 'omitted', reason: 'provenance' });
    for (const bad of [null, [], { ...v1, candidateVersionId: 7 }, { ...v1, claims: 'x' }, { ...v1, packet: null }, { ...v1, evidence: [null] }]) {
      assert.throws(() => projectCandidate(bad), ExportProjectionError);
    }
    const event = { schema: REVIEW_EVENT_SCHEMA, eventId: 'e1', requestId: 'r1', packet: { packetId: 'p1', authoringDigest: 'sha256:x' }, candidateId: 'c1', decision: 'reject', note: 'n', at: 't', judgments: [{ claimId: 'k', judgment: 'confirmed' }] };
    for (const decision of ['accept', 'revise', 'defer', 'reject']) assert.equal(projectReviewEvent({ ...event, decision, extra: 'X' }).decision, decision);
    assert.equal(JSON.stringify(projectReviewEvent({ ...event, extra: 'X' })).includes('extra'), false);
    for (const bad of [{ ...event, decision: 'approve' }, { ...event, schema: 'hq.design.request-review-event/v2' }, { ...event, judgments: [{ claimId: 'k', judgment: 'maybe' }] }, { ...event, note: 5 }, null]) {
      assert.throws(() => projectReviewEvent(bad), ExportProjectionError);
    }
  });
});
