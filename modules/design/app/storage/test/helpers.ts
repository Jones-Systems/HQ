/** Synthetic temp stores only, with exact cleanup proofs. Nothing here reads private data. */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import type { Clock, StoragePort } from '../../../../../packages/design-store/src/contract.ts';
import { createFaultInjectingFs } from '../../../../../packages/design-store/src/fault-fs.ts';
import { nodeFs, type StoreFs } from '../../../../../packages/design-store/src/fs.ts';
import { openFileStore } from '../../../../../packages/design-store/src/open.ts';
import { bindDesignStorage, type DesignStorage } from '../node.ts';
import { canonicalize } from '../canonical.ts';

const PREFIX = `hq-design-app-storage-${process.pid}-`;
const everCreated: string[] = [];
const live = new Set<string>();

process.once('exit', () => {
  for (const dir of live) rmSync(dir, { recursive: true, force: true });
});

/** Call once per test file: proves every directory this file made is gone afterwards. */
export function proveCleanup(): void {
  after(() => {
    for (const dir of [...live]) removeDir(dir); // safety net only; tests remove their own
    for (const dir of everCreated) assert.equal(existsSync(dir), false, `${dir} must be removed`);
    const leftovers = readdirSync(tmpdir()).filter((name) => name.startsWith(PREFIX));
    assert.deepEqual(leftovers, [], 'no scratch directory of this process may remain in the temp directory');
  });
}

export function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), PREFIX));
  everCreated.push(dir);
  live.add(dir);
  return dir;
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
  live.delete(dir);
}

/** LABELLED FAKE clock: deterministic, one second per call. */
export function fakeClock(start = Date.UTC(2026, 0, 1)): Clock {
  let now = start;
  return {
    now: () => {
      now += 1000;
      return new Date(now).toISOString();
    },
  };
}

export async function openAt(root: string, fs: StoreFs = nodeFs): Promise<{ readonly store: StoragePort; readonly storage: DesignStorage }> {
  const { store } = await openFileStore({ root, schemaVersion: 1, clock: fakeClock(), fs });
  return { store, storage: await bindDesignStorage(store) };
}

export interface SweepScenario<C> {
  readonly makeContext: () => C;
  readonly setup: (storage: DesignStorage, context: C) => Promise<void>;
  readonly act: (storage: DesignStorage, context: C) => Promise<void>;
  /** Canonical observation after reopening with the real filesystem. */
  /** `store` is the raw store, for owner-level actions such as repairing a torn journal. */
  readonly observe: (storage: DesignStorage, context: C, store: StoragePort) => Promise<unknown>;
}

export interface SweepReport {
  readonly crashPoints: number;
  readonly old: number;
  readonly fresh: number;
  readonly oldState: string;
  readonly newState: string;
}

/**
 * Crashes the action at every mutating filesystem call (clean and torn), reopens with the real
 * filesystem and requires exactly the old or the new observation, never a mix. Directories are
 * removed as soon as each run ends.
 */
export async function crashSweep<C>(scenario: SweepScenario<C>, tear: boolean): Promise<SweepReport> {
  const run = async (crashAt: number | null) => {
    const dir = makeDir();
    try {
      const root = join(dir, 'store');
      const context = scenario.makeContext();
      let crashedFlag = false;
      const first = await openAt(root);
      await scenario.setup(first.storage, context);
      await first.storage.close();
      if (crashAt === null) {
        const again = await openAt(root);
        await scenario.act(again.storage, context);
        await again.storage.close();
      } else {
        const fs = createFaultInjectingFs(nodeFs, { crashAt, tear });
        try {
          const crashing = await openAt(root, fs);
          try {
            await scenario.act(crashing.storage, context);
          } finally {
            await crashing.store.close().catch(() => undefined);
          }
        } catch (error) {
          if (!fs.crashed) throw error;
        }
        crashedFlag = fs.crashed;
      }
      const reopened = await openAt(root);
      try {
        const state = canonicalize(await scenario.observe(reopened.storage, context, reopened.store));
        return { state, crashed: crashedFlag };
      } finally {
        await reopened.storage.close();
      }
    } finally {
      removeDir(dir);
    }
  };
  const initial = await (async () => {
    const dir = makeDir();
    try {
      const root = join(dir, 'store');
      const context = scenario.makeContext();
      const first = await openAt(root);
      await scenario.setup(first.storage, context);
      await first.storage.close();
      const again = await openAt(root);
      try {
        return canonicalize(await scenario.observe(again.storage, context, again.store));
      } finally {
        await again.storage.close();
      }
    } finally {
      removeDir(dir);
    }
  })();
  const completed = (await run(null)).state;
  assert.notEqual(initial, completed, 'the action must change the observation or the sweep proves nothing');
  let old = 0;
  let fresh = 0;
  for (let crashAt = 0; ; crashAt += 1) {
    const result = await run(crashAt);
    if (result.state === initial) old += 1;
    else if (result.state === completed) fresh += 1;
    else assert.fail(`crash at mutating call ${crashAt}${tear ? ' (torn)' : ''} left a mixed state: ${result.state}`);
    if (!result.crashed) {
      assert.equal(result.state, completed, 'an uninterrupted run must reach the new state');
      return { crashPoints: crashAt, old, fresh, oldState: initial, newState: completed };
    }
  }
}
