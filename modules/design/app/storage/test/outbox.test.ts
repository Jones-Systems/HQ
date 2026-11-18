import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { createConfirmation } from '../../../connector/src/confirmation.ts';
import type { OutboxStorePort, StoredDispatch } from '../../../connector/src/contract.ts';
import type { DispatchRecord } from '../../../connector/src/dispatch.ts';
import { createFakeClock, createFakeReceiver, syntheticDestination, syntheticIdentity, syntheticPacket } from '../../../connector/src/fakes.ts';
import { createOutbox } from '../../../connector/src/outbox.ts';
import { createOutboxAdapter, OutboxRecordError } from '../outbox.ts';
import { crashSweep, makeDir, openAt, proveCleanup, removeDir } from './helpers.ts';

proveCleanup();

type Stored = StoredDispatch;
const record = (dispatchId: string, note = 'a'): DispatchRecord => ({ dispatchId, note } as unknown as DispatchRecord);

async function withAdapter(run: (adapter: OutboxStorePort, root: string) => Promise<void>): Promise<void> {
  const dir = makeDir();
  try {
    const root = join(dir, 'store');
    const { storage } = await openAt(root);
    try {
      await run(storage.outbox<DispatchRecord, string>() as unknown as OutboxStorePort, root);
    } finally {
      await storage.close();
    }
  } finally {
    removeDir(dir);
  }
}

describe('outbox adapter: compare-and-swap', () => {
  it('creates only if absent, then swaps on the exact revision', async () => {
    await withAdapter(async (outbox) => {
      assert.equal(await outbox.get('d1' as never), null);
      assert.deepEqual(await outbox.put(record('d1'), null), { ok: true, revision: 1 });
      const lostCreate = await outbox.put(record('d1', 'other'), null);
      assert.equal(lostCreate.ok, false);
      assert.equal((lostCreate as { current: Stored | null }).current?.revision, 1);
      assert.deepEqual((lostCreate as { current: Stored | null }).current?.record, record('d1'), 'the winner is untouched');
      assert.deepEqual(await outbox.put(record('d1', 'b'), 1), { ok: true, revision: 2 });
      const stale = await outbox.put(record('d1', 'c'), 1);
      assert.equal(stale.ok, false);
      assert.equal((stale as { current: Stored | null }).current?.revision, 2);
      assert.deepEqual((await outbox.get('d1' as never))?.record, record('d1', 'b'));
      const missing = await outbox.put(record('d9'), 3);
      assert.equal(missing.ok, false, 'a swap on a revision of a document that does not exist is a conflict');
      assert.equal((missing as { current: Stored | null }).current, null);
    });
  });

  it('lists every dispatch sorted by id and survives a reopen', async () => {
    const dir = makeDir();
    try {
      const root = join(dir, 'store');
      const first = await openAt(root);
      const outbox = first.storage.outbox<DispatchRecord, string>() as unknown as OutboxStorePort;
      for (const id of ['d/2', 'd1', 'd/1']) await outbox.put(record(id), null);
      await first.storage.close();
      const second = await openAt(root);
      const reopened = second.storage.outbox<DispatchRecord, string>() as unknown as OutboxStorePort;
      assert.deepEqual((await reopened.list()).map((item) => (item.record as unknown as { dispatchId: string }).dispatchId), ['d/1', 'd/2', 'd1']);
      await second.storage.close();
    } finally {
      removeDir(dir);
    }
  });

  it('refuses a document that holds another dispatch and ids it cannot key', async () => {
    const dir = makeDir();
    try {
      const { storage } = await openAt(join(dir, 'store'));
      await storage.workspace.putDocument('design/connector/outbox/d1', { dispatchId: 'other' });
      const outbox = createOutboxAdapter<{ dispatchId: string }>(storage.workspace);
      await assert.rejects(outbox.get('d1'), OutboxRecordError);
      await assert.rejects(outbox.put({ dispatchId: '' }, null), OutboxRecordError);
      await storage.close();
    } finally {
      removeDir(dir);
    }
  });
});

describe('outbox adapter: the real T12 outbox over the real file store', () => {
  it('persists submitting before transport and never resends after a restart', async () => {
    const dir = makeDir();
    try {
      const root = join(dir, 'store');
      const clock = createFakeClock();
      const receiver = createFakeReceiver({ identity: syntheticIdentity(), clock });
      const transports = { 'fake-receiver': receiver };
      const packet = await syntheticPacket();
      const destination = syntheticDestination();
      let seq = 0;
      const request = () => ({ packet, destination, confirmation: createConfirmation({ packet, destination, clock, newId: () => `c-${(seq += 1)}` }) });

      const first = await openAt(root);
      const outbox = createOutbox({ store: first.storage.outbox() as unknown as OutboxStorePort, transports, clock, sessionId: 's1', sendTimeoutMs: 50, probeTimeoutMs: 50 });
      const result = await outbox.submit(request());
      assert.equal(result.outcome, 'attempted');
      assert.equal(receiver.handoffs.length, 1);
      await first.storage.close();

      const second = await openAt(root);
      const restarted = createOutbox({ store: second.storage.outbox() as unknown as OutboxStorePort, transports, clock, sessionId: 's2', sendTimeoutMs: 50, probeTimeoutMs: 50 });
      await restarted.recover();
      clock.advance(1000);
      const again = await restarted.submit(request());
      assert.equal(again.outcome, 'refused');
      assert.equal(receiver.handoffs.length, 1, 'no second handoff after the durable accepted record');
      await second.storage.close();
    } finally {
      removeDir(dir);
    }
  });
});

describe('outbox adapter: crash at every filesystem call of a put', () => {
  for (const tear of [false, true]) {
    for (const scenario of ['create', 'swap'] as const) {
      it(`${scenario} leaves exactly the old or the new record (${tear ? 'torn' : 'clean'} writes)`, async () => {
        const report = await crashSweep({
          makeContext: () => ({}),
          setup: async (storage) => {
            if (scenario === 'swap') await storage.outbox<DispatchRecord, string>().put(record('d1', 'old'), null);
          },
          act: async (storage) => {
            const outbox = storage.outbox<DispatchRecord, string>();
            if (scenario === 'create') await outbox.put(record('d1', 'new'), null);
            else await outbox.put(record('d1', 'new'), 1);
          },
          observe: async (storage) => {
            const stored = await storage.outbox<DispatchRecord, string>().get('d1');
            return stored ? { revision: stored.revision, note: (stored.record as unknown as { note: string }).note } : null;
          },
        }, tear);
        assert.ok(report.crashPoints > 3);
        assert.ok(report.old > 0 && report.fresh > 0, 'both outcomes reached');
      });
    }
  }
});
