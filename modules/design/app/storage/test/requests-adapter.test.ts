import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { StoragePort as T6StoragePort } from '../../../requests/src/contract.ts';
import { bindWorkspace } from '../backing.ts';
import { canonicalBytes, NonCanonicalBytesError } from '../canonical.ts';
import { createRequestsStoragePort, RequestsStorageScopeError } from '../requests.ts';
import { crashSweep, makeDir, openAt, proveCleanup, removeDir } from './helpers.ts';
import { imageBytes, newT6Context, t6ReadyDraft, t6Session, t6Store } from './t6-env.ts';

proveCleanup();

const enc = (value: unknown) => canonicalBytes(value);

async function withPort(run: (port: T6StoragePort, root: string) => Promise<void>): Promise<void> {
  const dir = makeDir();
  try {
    const root = join(dir, 'store');
    const { storage } = await openAt(root);
    try {
      await run(storage.requests as T6StoragePort, root);
    } finally {
      await storage.close();
    }
  } finally {
    removeDir(dir);
  }
}

describe('requests adapter: create-only freeze', () => {
  it('creates once, reports an identical retry, and refuses to overwrite a different document', async () => {
    await withPort(async (port, root) => {
      const key = 'design/requests/r1/packets/000001';
      assert.equal(await port.createDocument('workspace', key, enc({ packet: 'first' })), 'created');
      assert.equal(await port.createDocument('workspace', key, enc({ packet: 'first' })), 'exists-identical');
      assert.equal(await port.createDocument('workspace', key, enc({ packet: 'second' })), 'exists-different');
      assert.deepEqual(await port.readDocument('workspace', key), enc({ packet: 'first' }), 'the original bytes survive the refused overwrite');
      const files = readdirSync(join(root, 'generations'), { recursive: true }).map(String).filter((name) => name.endsWith('.json') && name.includes('docs'));
      assert.ok(files.some((name) => readFileSync(join(root, 'generations', name), 'utf8').includes('first')));
      assert.equal(files.some((name) => readFileSync(join(root, 'generations', name), 'utf8').includes('second')), false);
    });
  });

  it('keeps writeDocument as a plain replace, and reads back the exact bytes', async () => {
    await withPort(async (port) => {
      const key = 'design/requests/r1/draft';
      await port.writeDocument('workspace', key, enc({ revision: 1 }));
      await port.writeDocument('workspace', key, enc({ revision: 2, text: 'é🎯' }));
      assert.deepEqual(await port.readDocument('workspace', key), enc({ revision: 2, text: 'é🎯' }));
      assert.equal(await port.readDocument('workspace', 'design/requests/r1/none'), null);
      assert.deepEqual(await port.listDocuments('workspace', 'design/requests/'), [key]);
    });
  });

  it('refuses bytes that are not canonical JSON and keys outside its scope', async () => {
    await withPort(async (port) => {
      await assert.rejects(port.writeDocument('workspace', 'design/requests/r1/draft', new TextEncoder().encode('{"b":1,"a":2}')), NonCanonicalBytesError);
      await assert.rejects(port.createDocument('workspace', 'design/requests/r1/draft', new TextEncoder().encode('not json')), NonCanonicalBytesError);
      for (const key of ['design/connector/outbox/d1', 'workspace', 'design/requestsX/a']) {
        await assert.rejects(port.readDocument('workspace', key), RequestsStorageScopeError, key);
        await assert.rejects(port.createDocument('workspace', key, enc({})), RequestsStorageScopeError, key);
      }
      await assert.rejects(port.listDocuments('workspace', 'design/'), RequestsStorageScopeError);
    });
  });

  it('stores blobs by sha256 digest and appends events idempotently by eventId', async () => {
    await withPort(async (port) => {
      const digest = await port.putBlob(imageBytes(3));
      assert.match(digest, /^sha256:[0-9a-f]{64}$/u);
      assert.deepEqual(await port.getBlob(digest), imageBytes(3));
      assert.equal(await port.getBlob('sha256:' + '0'.repeat(64) as never), null);
      const stream = 'design/requests/r1/review';
      await port.appendEvent('workspace', stream, enc({ eventId: 'e1', decision: 'accept' }));
      await port.appendEvent('workspace', stream, enc({ eventId: 'e1', decision: 'accept' })); // retry after an unknown outcome
      await port.appendEvent('workspace', stream, enc({ eventId: 'e2', decision: 'defer' }));
      assert.deepEqual(await port.readEvents('workspace', stream), [enc({ eventId: 'e1', decision: 'accept' }), enc({ eventId: 'e2', decision: 'defer' })]);
      assert.deepEqual(await port.readEvents('workspace', 'design/requests/r2/review'), []);
    });
  });

  it('has no cache namespace unless one is supplied, and never puts events there', async () => {
    const dir = makeDir();
    try {
      const { store, storage } = await openAt(join(dir, 'store'));
      try {
        const workspaceOnly = createRequestsStoragePort({ workspace: await bindWorkspace(store) });
        await assert.rejects(workspaceOnly.readDocument('cache', 'design/requests/x'), RequestsStorageScopeError);
        await assert.rejects(storage.requests.appendEvent('cache', 'design/requests/x/review', enc({})), RequestsStorageScopeError);
        await storage.requests.writeDocument('cache', 'design/requests/x', enc({ cached: true }));
        assert.equal(await storage.requests.readDocument('workspace', 'design/requests/x'), null, 'a cache write is invisible to the workspace');
        assert.deepEqual(await storage.requests.readDocument('cache', 'design/requests/x'), enc({ cached: true }));
      } finally {
        await storage.close();
      }
    } finally {
      removeDir(dir);
    }
  });
});

describe('requests adapter: the real PR33 RequestStore over the real file store', () => {
  it('freezes, survives a reopen, and refuses a second freeze of the same slot', async () => {
    const dir = makeDir();
    try {
      const root = join(dir, 'store');
      const context = newT6Context();
      const first = await openAt(root);
      const store = t6Store(first.storage.requests as T6StoragePort, context);
      const { requestId, session } = await t6ReadyDraft(store, context);
      const stale = session.state.draft!;
      const packet = (await session.freeze())!;
      assert.equal(packet.lineage.sequence, 1);
      await first.storage.close();

      const second = await openAt(root);
      const reopened = t6Store(second.storage.requests as T6StoragePort, context);
      const snapshot = await reopened.open(requestId);
      assert.equal(snapshot.packets.length, 1);
      assert.equal(snapshot.packets[0]!.authoringDigest, packet.authoringDigest);
      assert.equal(snapshot.history.length, 1, 'the consumed draft is kept as local history');
      assert.equal(snapshot.readOnly, null);
      // A second writer holding the consumed draft cannot take the slot or replace the packet.
      await assert.rejects(reopened.freeze(stale), (error) => error instanceof Error && error.name === 'StaleDraftError');
      const key = `design/requests/${requestId}/packets/000001`;
      const before = await second.storage.requests.readDocument('workspace', key);
      assert.equal(await second.storage.requests.createDocument('workspace', key, enc({ forged: true })), 'exists-different');
      assert.deepEqual(await second.storage.requests.readDocument('workspace', key), before);
      await second.storage.close();
    } finally {
      removeDir(dir);
    }
  });

  for (const tear of [false, true]) {
    it(`crash at every filesystem call of freeze leaves the request either unfrozen or recoverable (${tear ? 'torn' : 'clean'} writes)`, async () => {
      const report = await crashSweep({
        makeContext: newT6Context,
        setup: async (storage, context) => {
          const store = t6Store(storage.requests as T6StoragePort, context);
          await t6ReadyDraft(store, context);
        },
        act: async (storage, context) => {
          const store = t6Store(storage.requests as T6StoragePort, context);
          const snapshot = await store.open('fx-request-0001' as never);
          await store.freeze(snapshot.draft!);
        },
        observe: async (storage, context) => {
          const store = t6Store(storage.requests as T6StoragePort, context);
          const snapshot = await store.open('fx-request-0001' as never); // open completes an interrupted freeze
          assert.equal(snapshot.readOnly, null);
          return { packets: snapshot.packets.map((packet) => packet.authoringDigest.length), draft: snapshot.draft?.continuesFrom ? 'continuation' : 'original', history: snapshot.history.length };
        },
      }, tear);
      assert.ok(report.crashPoints > 5, `swept ${report.crashPoints} crash points`);
      assert.ok(report.old > 0 && report.fresh > 0, 'both outcomes were reached');
    });
  }

  it('keeps the session API working over the adapter (edit, flush, restart)', async () => {
    const dir = makeDir();
    try {
      const root = join(dir, 'store');
      const context = newT6Context();
      const first = await openAt(root);
      const store = t6Store(first.storage.requests as T6StoragePort, context);
      const { requestId, session } = await t6ReadyDraft(store, context, 'Original title');
      session.edit({ type: 'set-title', title: 'Edited title' });
      await session.flush();
      await first.storage.close();
      const second = await openAt(root);
      const again = await t6Session(t6Store(second.storage.requests as T6StoragePort, context), context, requestId);
      assert.equal(again.state.draft?.title, 'Edited title');
      await second.storage.close();
    } finally {
      removeDir(dir);
    }
  });
});
