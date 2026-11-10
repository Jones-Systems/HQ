import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { emptyArrangement, addArtboard } from '../../../canvas/src/arrangement.ts';
import { loadArrangement, saveArrangement } from '../../../canvas/src/codec.ts';
import type { CanvasStoragePort } from '../../../canvas/src/contract.ts';
import { CanvasScopeError, CanvasWriteConflictError, createCanvasStorage } from '../canvas.ts';
import { crashSweep, makeDir, openAt, proveCleanup, removeDir } from './helpers.ts';

proveCleanup();

const KEY = 'design.canvas.arrangement.v1/cv1';
const base = () => emptyArrangement('cv1' as never, 'p1' as never);
const frame = { x: 0, y: 0, width: 100, height: 80 };
const withBoard = (name: string) => addArtboard(base(), { id: 'ab1' as never, name, frame });

async function withStorage(run: (open: () => Promise<{ port: CanvasStoragePort; close: () => Promise<void> }>) => Promise<void>): Promise<void> {
  const dir = makeDir();
  try {
    const root = join(dir, 'store');
    const handles: { storage: { close(): Promise<void> } }[] = [];
    const open = async () => {
      const opened = await openAt(root);
      handles.push(opened);
      return { port: opened.storage.canvas as CanvasStoragePort, close: () => opened.storage.close() };
    };
    await run(open);
    for (const handle of handles) await handle.storage.close();
  } finally {
    removeDir(dir);
  }
}

describe('canvas adapter: real compare-and-swap', () => {
  it('runs T3 load/save over the store and survives a reopen', async () => {
    await withStorage(async (open) => {
      const first = await open();
      assert.deepEqual(await loadArrangement(first.port, 'cv1' as never), { status: 'missing' });
      const saved = await saveArrangement(first.port, withBoard('Home'), null);
      assert.equal(saved.status, 'saved');
      await first.close();
      const second = await open();
      const loaded = await loadArrangement(second.port, 'cv1' as never);
      assert.equal(loaded.status, 'loaded');
      assert.equal((loaded as { baseText: string }).baseText, (saved as { baseText: string }).baseText);
    });
  });

  it('rejects the second writer of the same base even though T3 compared equal before writing', async () => {
    // Two processes cannot share a lock, so model the race with one store and two adapters: both
    // read revision 1, one writes, and the other's write must be refused by the store.
    const dir = makeDir();
    try {
      const { storage } = await openAt(join(dir, 'store'));
      const a = storage.canvas;
      const b = createCanvasStorage(storage.workspace);
      const loaded = await saveArrangement(a, withBoard('Start'), null);
      assert.equal(loaded.status, 'saved');
      const baseA = await a.readDocument('workspace', KEY);
      const baseB = await b.readDocument('workspace', KEY);
      assert.equal(baseA, baseB);
      await a.writeDocument('workspace', KEY, 'writer A');
      await assert.rejects(b.writeDocument('workspace', KEY, 'writer B'), (error) => error instanceof CanvasWriteConflictError && error.reason === 'revision-changed');
      assert.equal(await a.readDocument('workspace', KEY), 'writer A', 'the first writer survives');
      await storage.close();
    } finally {
      removeDir(dir);
    }
  });

  it('treats a create race as a conflict and requires a fresh read for every write', async () => {
    const dir = makeDir();
    try {
      const { storage } = await openAt(join(dir, 'store'));
      const a = storage.canvas;
      const b = createCanvasStorage(storage.workspace);
      assert.equal(await a.readDocument('workspace', KEY), null);
      assert.equal(await b.readDocument('workspace', KEY), null);
      await a.writeDocument('workspace', KEY, 'first');
      await assert.rejects(b.writeDocument('workspace', KEY, 'second'), CanvasWriteConflictError);
      await assert.rejects(a.writeDocument('workspace', KEY, 'again without a read'), (error) => error instanceof CanvasWriteConflictError && error.reason === 'no-read-token');
      await assert.rejects(createCanvasStorage(storage.workspace).writeDocument('workspace', KEY, 'never read'), (error) => error instanceof CanvasWriteConflictError && error.reason === 'no-read-token');
      assert.equal(await a.readDocument('workspace', KEY), 'first');
      await storage.close();
    } finally {
      removeDir(dir);
    }
  });

  it('stays inside the canvas key root and the workspace namespace, and keeps text byte-exact', async () => {
    const dir = makeDir();
    try {
      const { storage } = await openAt(join(dir, 'store'));
      const port = storage.canvas;
      await assert.rejects(port.readDocument('workspace', 'design/requests/r1/draft'), CanvasScopeError);
      await assert.rejects(port.readDocument('cache' as never, KEY), CanvasScopeError);
      const text = '{"b":1, "a":[1,2]}\n  with spaces — and 🎯\r\n';
      await port.readDocument('workspace', KEY);
      await port.writeDocument('workspace', KEY, text);
      assert.equal(await port.readDocument('workspace', KEY), text);
      await storage.workspace.putDocument(`${KEY}-bad`, { not: 'an envelope' });
      await assert.rejects(port.readDocument('workspace', `${KEY}-bad`), CanvasScopeError);
      await storage.close();
    } finally {
      removeDir(dir);
    }
  });
});

describe('canvas adapter: crash at every filesystem call of a save', () => {
  for (const tear of [false, true]) {
    it(`leaves exactly the old or the new arrangement (${tear ? 'torn' : 'clean'} writes)`, async () => {
      const report = await crashSweep({
        makeContext: () => ({}),
        setup: async (storage) => {
          assert.equal((await saveArrangement(storage.canvas, withBoard('Old'), null)).status, 'saved');
        },
        act: async (storage) => {
          const loaded = await loadArrangement(storage.canvas, 'cv1' as never);
          assert.equal(loaded.status, 'loaded');
          await saveArrangement(storage.canvas, withBoard('New'), (loaded as { baseText: string }).baseText);
        },
        observe: async (storage) => {
          const loaded = await loadArrangement(storage.canvas, 'cv1' as never);
          assert.equal(loaded.status, 'loaded', 'never a torn or unreadable arrangement');
          return (loaded as { baseText: string }).baseText.includes('"New"') ? 'new' : 'old';
        },
      }, tear);
      assert.ok(report.crashPoints > 3);
      assert.ok(report.old > 0 && report.fresh > 0);
    });
  }
});
