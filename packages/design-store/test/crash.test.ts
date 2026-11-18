import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, type TestContext } from 'node:test';
import type { BlobDigest, DocumentKey, JsonValue, StoragePort, StreamId } from '../src/contract.ts';
import { createFaultInjectingFs } from '../src/fault-fs.ts';
import { nodeFs, type StoreFs } from '../src/fs.ts';
import { documentKey, streamId } from '../src/ids.ts';
import { canonicalize, digestOfBytes } from '../src/jcs.ts';
import type { OpenFileStoreOptions } from '../src/open.ts';
import { bytes, CACHE, namespaces, open, scratch, WORKSPACE } from './helpers.ts';

const key = (value: string): DocumentKey => documentKey(value);
const STREAM: StreamId = streamId('decisions');
const BLOB = bytes('captured pixels v2');
const BLOB_DIGEST: BlobDigest = digestOfBytes(BLOB);

interface Scenario {
  readonly setup: (store: StoragePort) => Promise<void>;
  readonly act: (store: StoragePort) => Promise<void>;
  readonly observe: (store: StoragePort) => Promise<JsonValue>;
  readonly options?: Partial<OpenFileStoreOptions>;
}

interface SweepResult {
  readonly crashPoints: number;
  readonly old: number;
  readonly new: number;
}

async function prepare(t: TestContext, scenario: Scenario, label: string): Promise<string> {
  const root = join(scratch(t), label);
  const { store } = await open(root, scenario.options);
  await scenario.setup(store);
  await store.close();
  return root;
}

async function observeWith(root: string, scenario: Scenario): Promise<JsonValue> {
  const { store } = await open(root, scenario.options);
  try {
    const state = await scenario.observe(store);
    assert.equal(store.health().pendingRecovery, false);
    return state;
  } finally {
    await store.close();
  }
}

async function runCrashing(root: string, fs: StoreFs, run: (store: StoragePort) => Promise<void>, options: Partial<OpenFileStoreOptions> = {}): Promise<void> {
  try {
    const { store } = await open(root, { ...options, fs });
    try {
      await run(store);
    } finally {
      // Models process exit: the lock nonce is dropped even though the dead fs cannot unlink.
      await store.close().catch(() => undefined);
    }
  } catch (error) {
    if (!(fs as { crashed?: boolean }).crashed) throw error;
  }
}

/**
 * Crashes the operation at every mutating filesystem call (including the open that precedes it),
 * reopens with the real filesystem, and requires exactly the old or the new observable state.
 */
async function sweep(t: TestContext, scenario: Scenario, tear: boolean): Promise<SweepResult> {
  const oldState = canonicalize(await observeWith(await prepare(t, scenario, 'old'), scenario));
  const newRoot = await prepare(t, scenario, 'new');
  await runCrashing(newRoot, nodeFs, scenario.act, scenario.options);
  const newState = canonicalize(await observeWith(newRoot, scenario));
  assert.notEqual(oldState, newState);
  let old = 0;
  let fresh = 0;
  for (let crashAt = 0; ; crashAt += 1) {
    const root = await prepare(t, scenario, `crash-${tear ? 'torn' : 'clean'}-${crashAt}`);
    const fs = createFaultInjectingFs(nodeFs, { crashAt, tear });
    await runCrashing(root, fs, scenario.act, scenario.options);
    const state = canonicalize(await observeWith(root, scenario));
    if (state === oldState) old += 1;
    else if (state === newState) fresh += 1;
    else assert.fail(`crash at mutating call ${crashAt} produced a mixed state: ${state}`);
    if (!fs.crashed) {
      assert.equal(state, newState, 'an uninterrupted run must reach the new state');
      // The recovered store remains writable.
      const { store } = await open(root, scenario.options);
      await store.putDocument(WORKSPACE, key('after-recovery'), true);
      await store.close();
      return { crashPoints: crashAt, old, new: fresh };
    }
  }
}

async function documentsOf(store: StoragePort): Promise<JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const name of await store.listDocuments(WORKSPACE)) {
    if (name === 'after-recovery') continue;
    const document = await store.getDocument(WORKSPACE, name);
    out[name] = document ? { revision: document.revision, value: document.value } : null;
  }
  return out;
}

const scenarios: Record<string, Scenario> = {
  'single document replace': {
    setup: async (store) => {
      await store.putDocument(WORKSPACE, key('draft'), { body: 'old text', attachments: ['a'] });
    },
    act: async (store) => {
      await store.putDocument(WORKSPACE, key('draft'), { body: 'new text', attachments: ['a', 'b'] }, { expectedRevision: 1 });
    },
    observe: documentsOf,
  },
  'multi-document transaction (put, put, delete, create)': {
    setup: async (store) => {
      await store.putDocument(WORKSPACE, key('request/1/draft'), { text: 'draft v1' });
      await store.putDocument(WORKSPACE, key('request/1/meta'), { state: 'draft' });
      await store.putDocument(WORKSPACE, key('request/1/scratch'), { temp: true });
    },
    act: async (store) => {
      await store.commit([
        { op: 'put', namespace: WORKSPACE, key: key('request/1/draft'), value: { text: 'draft v1', consumed: true } },
        { op: 'put', namespace: WORKSPACE, key: key('request/1/meta'), value: { state: 'frozen' } },
        { op: 'delete', namespace: WORKSPACE, key: key('request/1/scratch') },
        { op: 'put', namespace: WORKSPACE, key: key('request/1/packet'), value: { digest: 'sha256:00', lineage: [] } },
      ]);
    },
    observe: documentsOf,
  },
  'content-addressed blob write': {
    setup: async (store) => {
      await store.putBlob(WORKSPACE, bytes('captured pixels v1'));
    },
    act: async (store) => {
      await store.putBlob(WORKSPACE, BLOB, { expectedDigest: BLOB_DIGEST });
    },
    observe: async (store) => {
      const present = await store.getBlob(WORKSPACE, BLOB_DIGEST);
      // A present blob is always whole and verified.
      if (present) assert.equal(digestOfBytes(present), BLOB_DIGEST);
      return { present: present !== null };
    },
  },
  'event append': {
    setup: async (store) => {
      await store.appendEvent(WORKSPACE, STREAM, { type: 'rated', payload: { overall: 3 } });
    },
    act: async (store) => {
      await store.appendEvent(WORKSPACE, STREAM, { type: 'rerated', payload: { overall: 4 }, clientEventId: 'c-2' });
    },
    observe: async (store) => {
      const read = await store.readEvents(WORKSPACE, STREAM);
      assert.ok(read.status.state === 'ok' || read.status.state === 'torn-tail', `unexpected status ${read.status.state}`);
      return read.events.map((event) => ({ seq: event.seq, type: event.type, payload: event.payload }));
    },
  },
  'evictable cache write with eviction': {
    setup: async (store) => {
      await store.putBlob(CACHE, bytes('x'.repeat(40)));
    },
    act: async (store) => {
      await store.putDocument(WORKSPACE, key('pinned'), { keep: true });
      await store.putBlob(CACHE, new Uint8Array(1));
    },
    // Cache eviction may run at any point after the write; only authoritative state is observed.
    observe: async (store) => ({ workspace: await documentsOf(store) }),
    options: { namespaces: namespaces(40) },
  },
};

describe('kill during commit leaves the old or the new state, never a mix (fault injection)', () => {
  for (const [name, scenario] of Object.entries(scenarios)) {
    for (const tear of [false, true]) {
      it(`${name}${tear ? ' with torn writes' : ''}`, async (t) => {
        const result = await sweep(t, scenario, tear);
        assert.ok(result.crashPoints >= 3, `expected several crash points, saw ${result.crashPoints}`);
        assert.ok(result.old > 0, 'some crash points must preserve the old state');
        t.diagnostic(`${result.crashPoints} crash points: ${result.old} old, ${result.new} new`);
      });
    }
  }

  it('a crash during recovery of a committed transaction still yields old or new', async (t) => {
    const scenario = scenarios['multi-document transaction (put, put, delete, create)'] as Scenario;
    const oldState = canonicalize(await observeWith(await prepare(t, scenario, 'old'), scenario));
    const newRoot = await prepare(t, scenario, 'new');
    await runCrashing(newRoot, nodeFs, scenario.act);
    const newState = canonicalize(await observeWith(newRoot, scenario));
    let doubleCrashes = 0;
    for (let first = 0; ; first += 1) {
      const probeRoot = await prepare(t, scenario, `probe-${first}`);
      const firstFs = createFaultInjectingFs(nodeFs, { crashAt: first });
      await runCrashing(probeRoot, firstFs, scenario.act);
      if (!firstFs.crashed) break;
      for (let second = 0; ; second += 1) {
        const root = await prepare(t, scenario, `double-${first}-${second}`);
        await runCrashing(root, createFaultInjectingFs(nodeFs, { crashAt: first }), scenario.act);
        const recoveryFs = createFaultInjectingFs(nodeFs, { crashAt: second });
        await runCrashing(root, recoveryFs, async () => undefined);
        const state = canonicalize(await observeWith(root, scenario));
        assert.ok(state === oldState || state === newState, `double crash ${first}/${second} produced a mixed state`);
        doubleCrashes += 1;
        if (!recoveryFs.crashed) break;
      }
    }
    t.diagnostic(`${doubleCrashes} commit/recovery crash pairs`);
    assert.ok(doubleCrashes > 10);
  });

  it('a crash during first initialization leaves no store or a usable empty store', async (t) => {
    for (let crashAt = 0; ; crashAt += 1) {
      const root = join(scratch(t), `init-${crashAt}`);
      mkdirSync(root);
      const fs = createFaultInjectingFs(nodeFs, { crashAt, tear: true });
      await runCrashing(root, fs, async () => undefined);
      const { store } = await open(root);
      assert.deepEqual(await store.listDocuments(WORKSPACE), []);
      await store.putDocument(WORKSPACE, key('first'), 1);
      await store.close();
      if (!fs.crashed) break;
    }
  });
});
