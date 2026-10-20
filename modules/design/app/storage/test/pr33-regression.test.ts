/**
 * Requests PR33 (896a726d) regression through the real requests code, the storage adapter and a
 * real temp file store. Dispatch is a labelled spy: nothing here reaches any transport.
 */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { StoragePort as T6StoragePort } from '../../../requests/src/contract.ts';
import { linkOf } from '../../../requests/src/draft.ts';
import { crashSweep, makeDir, openAt, proveCleanup, removeDir } from './helpers.ts';
import { connectorReturn, LifecycleConnectorFake, newT6Context, t6ReadyDraft, t6Session, t6Store, type T6Context } from './t6-env.ts';
import type { DesignStorage } from '../node.ts';

proveCleanup();

const REQUEST = 'fx-request-0001';
const sendKey = (requestId: string, packetId: string) => `design/requests/${requestId}/sends/${packetId}`;
const handoffKey = (requestId: string, packetId: string) => `design/requests/${requestId}/handoff/${packetId}`;
const port = (storage: DesignStorage) => storage.requests as T6StoragePort;

/** Request with a destination, frozen. Returns the pieces the tests need. */
async function frozen(storage: DesignStorage, context: T6Context) {
  const store = t6Store(port(storage), context);
  const { requestId, session } = await t6ReadyDraft(store, context, 'Tighten home heading', { destination: true });
  const packet = (await session.freeze())!;
  return { store, requestId, session, packet, link: linkOf(packet) };
}

async function withStorage(run: (storage: DesignStorage, root: string) => Promise<void>): Promise<void> {
  const dir = makeDir();
  try {
    const root = join(dir, 'store');
    const { storage } = await openAt(root);
    try {
      await run(storage, root);
    } finally {
      await storage.close();
    }
  } finally {
    removeDir(dir);
  }
}

describe('PR33 send gate (record before transport, single use)', () => {
  it('writes the send record once before requestSend and refuses a second send, also after a reopen', async () => {
    const dir = makeDir();
    try {
      const root = join(dir, 'store');
      const context = newT6Context();
      const spy = new LifecycleConnectorFake();
      const first = await openAt(root);
      const { requestId, session, packet } = await frozen(first.storage, context);
      assert.equal(await first.storage.workspace.getDocument(sendKey(requestId, packet.packetId)), null, 'freezing writes no send record');
      assert.equal(await session.send(spy.dispatch, packet.packetId, 'dest-1'), 'sent');
      assert.equal(spy.sends.length, 1);
      const record = (await first.storage.workspace.getDocument(sendKey(requestId, packet.packetId)))!;
      assert.equal((record.value as { schema: string }).schema, 'hq.design.request-send/v1');
      assert.equal(record.revision, 1);
      assert.equal(await session.send(spy.dispatch, packet.packetId, 'dest-1'), 'blocked');
      assert.equal(spy.sends.length, 1, 'a second send of the same packet never reaches transport');
      await first.storage.close();

      const second = await openAt(root);
      const reopened = await t6Session(t6Store(port(second.storage), context), context, requestId as never);
      assert.equal(reopened.state.sends.length, 1);
      assert.equal(await reopened.send(spy.dispatch, packet.packetId, 'dest-1'), 'blocked');
      assert.equal(spy.sends.length, 1);
      const stored = (await second.storage.workspace.getDocument(sendKey(requestId, packet.packetId)))!;
      assert.equal(stored.revision, 1, 'the send record was never rewritten');
      assert.deepEqual(stored.value, record.value);
      // The adapter-level create-only guard is what holds the line even if a caller tried to bypass the gate.
      const bytes = await second.storage.requests.readDocument('workspace', sendKey(requestId, packet.packetId));
      assert.equal(await second.storage.requests.createDocument('workspace', sendKey(requestId, packet.packetId), bytes!), 'exists-identical');
      await second.storage.close();
    } finally {
      removeDir(dir);
    }
  });

  for (const tear of [false, true]) {
    it(`crash at every filesystem call of the send-record create: no transport without a durable record, no double send, no lost record (${tear ? 'torn' : 'clean'} writes)`, async () => {
      interface Context extends T6Context { spy: LifecycleConnectorFake }
      const retries: string[] = [];
      const report = await crashSweep<Context>({
        makeContext: () => ({ ...newT6Context(), spy: new LifecycleConnectorFake() }),
        setup: async (storage, context) => {
          await frozen(storage, context);
        },
        act: async (storage, context) => {
          const session = await t6Session(t6Store(port(storage), context), context, REQUEST as never);
          await session.send(context.spy.dispatch, session.state.packets[0]!.packetId, 'dest-1');
        },
        observe: async (storage, context) => {
          const store = t6Store(port(storage), context);
          const session = await t6Session(store, context, REQUEST as never);
          const packetId = session.state.packets[0]!.packetId;
          const record = await storage.workspace.getDocument(sendKey(REQUEST, packetId));
          // Transport is reached only after the record is durable.
          if (!record) assert.equal(context.spy.sends.length, 0, 'transport was reached without a durable send record');
          // A retry after reopen: exactly one send in total if there was no record, none if there was.
          const retrySpy = new LifecycleConnectorFake();
          const outcome = await session.send(retrySpy.dispatch, packetId, 'dest-1');
          assert.equal(outcome, record ? 'blocked' : 'sent');
          assert.equal(retrySpy.sends.length, record ? 0 : 1);
          if (record) assert.equal((await storage.workspace.getDocument(sendKey(REQUEST, packetId)))!.revision, 1, 'never rewritten');
          retries.push(outcome);
          return { record: record !== null };
        },
      }, tear);
      assert.ok(report.crashPoints > 3, `swept ${report.crashPoints} crash points`);
      assert.ok(report.old > 0 && report.fresh > 0, 'both outcomes reached');
      assert.ok(retries.includes('sent') && retries.includes('blocked'));
    });
  }
});

describe('PR33 handoff status (mutable, overwritten through writeDocument)', () => {
  it('stores the last connector status, overwrites it in place and stays inside design/requests/', async () => {
    await withStorage(async (storage) => {
      const context = newT6Context();
      const connector = new LifecycleConnectorFake();
      const { requestId, session, packet, link } = await frozen(storage, context);
      assert.equal(await session.send(connector.dispatch, packet.packetId, 'dest-1'), 'sent');
      connector.set(link, 'queued');
      await session.refreshHandoff(connector.status);
      const key = handoffKey(requestId, packet.packetId);
      const queued = (await storage.workspace.getDocument(key))!;
      assert.equal((queued.value as { state: string }).state, 'queued');
      connector.set(link, 'running', { actual: { host: 'fixture-host-a', model: 'fixture-model-1' } });
      await session.refreshHandoff(connector.status);
      const running = (await storage.workspace.getDocument(key))!;
      assert.equal((running.value as { state: string }).state, 'running');
      assert.ok(running.revision > queued.revision, 'the same document was overwritten, not duplicated');
      assert.deepEqual((await storage.workspace.listDocuments(`design/requests/${requestId}/handoff/`)), [key]);
      // Out-of-scope writes stay refused by the adapter.
      const bytes = new TextEncoder().encode('{}');
      for (const bad of [`design/connector/outbox/${packet.packetId}`, `design/requestsX/${requestId}/handoff/${packet.packetId}`]) {
        await assert.rejects(storage.requests.writeDocument('workspace', bad, bytes), (error) => error instanceof Error && error.name === 'RequestsStorageScopeError');
      }
      assert.equal(connector.sends.length, 1, 'polling status sent nothing');
    });
  });
});

describe('PR33 owner-reported return (write-once)', () => {
  it('creates the candidate once, reports exists-identical on a byte-equal retry and never overwrites', async () => {
    await withStorage(async (storage) => {
      const context = newT6Context();
      const { requestId, session, packet } = await frozen(storage, context);
      const stored = (await session.reportReturn({ packetId: packet.packetId, claims: ['I got a new heading screenshot.'], artifacts: [{ kind: 'note', label: 'Saved outside HQ' }], host: 'my-host' }))!;
      assert.equal(stored.provenance?.origin, 'owner-reported');
      const key = `design/requests/${requestId}/candidates/${stored.candidateId}`;
      const original = (await storage.requests.readDocument('workspace', key))!;
      assert.equal(await storage.requests.createDocument('workspace', key, original), 'exists-identical');
      const other = new TextEncoder().encode('{"candidateId":"forged"}');
      assert.equal(await storage.requests.createDocument('workspace', key, other), 'exists-different');
      assert.deepEqual(await storage.requests.readDocument('workspace', key), original);
      assert.equal((await storage.workspace.getDocument(key))!.revision, 1);
      const again = (await session.reportReturn({ packetId: packet.packetId, claims: ['Second report.'] }))!;
      assert.notEqual(again.candidateId, stored.candidateId, 'a second report is a new record');
      // It writes no send record and no handoff status, so it cannot stand in for a send.
      assert.deepEqual(await storage.workspace.listDocuments(`design/requests/${requestId}/sends/`), []);
      assert.deepEqual(await storage.workspace.listDocuments(`design/requests/${requestId}/handoff/`), []);
    });
  });
});

describe('PR33 reject review', () => {
  it('records a reject, appends it once and reloads it after a reopen without creating a draft or a send', async () => {
    const dir = makeDir();
    try {
      const root = join(dir, 'store');
      const context = newT6Context();
      const connector = new LifecycleConnectorFake();
      const first = await openAt(root);
      const { requestId, session, link } = await frozen(first.storage, context);
      const draftBefore = session.draftBytes();
      const event = (await session.review(connectorReturn(link), 'reject', 'Not what I asked for.'))!;
      assert.equal(event.decision, 'reject');
      assert.equal(event.revisionDraftId, undefined);
      assert.deepEqual(session.draftBytes(), draftBefore, 'reject creates no draft');
      const events = await first.storage.requests.readEvents('workspace', `design/requests/${requestId}/review`);
      assert.equal(events.length, 1);
      // A retried append of the same event (an unknown-outcome retry) stays one event.
      await first.storage.requests.appendEvent('workspace', `design/requests/${requestId}/review`, events[0]!);
      assert.equal((await first.storage.requests.readEvents('workspace', `design/requests/${requestId}/review`)).length, 1);
      await first.storage.close();

      const second = await openAt(root);
      const reopened = await t6Session(t6Store(port(second.storage), context), context, requestId as never);
      assert.deepEqual(reopened.state.reviews.map((item) => item.decision), ['reject']);
      assert.equal(reopened.state.packets.length, 1);
      assert.equal(connector.sends.length, 0);
      await second.storage.close();
    } finally {
      removeDir(dir);
    }
  });
});

describe('PR33 lifecycle keeps freeze records in the pinned shape', () => {
  it('a revise → edit → second freeze still stores freeze records the projection accepts', async () => {
    await withStorage(async (storage) => {
      const context = newT6Context();
      const { requestId, session, link } = await frozen(storage, context);
      const revised = (await session.review(connectorReturn(link), 'revise', 'Tighter, please.'))!;
      assert.equal(revised.decision, 'revise');
      assert.ok(revised.revisionDraftId);
      session.edit({ type: 'set-intent', intent: 'Tighter again.' });
      await session.flush();
      const second = await session.freeze();
      assert.ok(second, `second freeze succeeded (${session.state.error ?? 'no error'})`);
      assert.equal(second!.lineage.sequence, 2);
      for (const sequence of ['000001', '000002']) {
        const record = (await storage.workspace.getDocument(`design/requests/${requestId}/packets/${sequence}`))!.value as Record<string, unknown>;
        assert.deepEqual(Object.keys(record).sort(), ['consumed', 'consumedDraft', 'continuation', 'packet', 'schema'], 'stored freeze record keys are unchanged from v1');
      }
    });
  });
});
