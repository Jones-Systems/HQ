import type { AppendHandle, LockAcquisition, LockHolder, TasteFileSystem } from './contract.ts';

/**
 * LABELLED FAKE — in-memory TasteFileSystem for tests and the review preview.
 * It is not durable and proves nothing about a real disk. Faults are armed
 * explicitly and fire once.
 */

export const FAKE_FILE_SYSTEM_LABEL = 'Fake in-memory taste storage (not durable)';

export type FakeFault =
  /** The next write hands only this many bytes to "disk", then reports the short count. */
  | { readonly kind: 'short-write'; readonly bytes: number }
  /** The next write stores this many bytes, then throws (a crash mid-write). */
  | { readonly kind: 'write-throws'; readonly bytesBeforeThrow: number }
  | { readonly kind: 'sync-throws' }
  | { readonly kind: 'directory-sync-throws' };

export interface FakeTasteFileSystem extends TasteFileSystem {
  readonly label: string;
  bytes(path: string): Uint8Array | null;
  /** Overwrites a file outright; used to simulate tampering or a crash image. */
  setBytes(path: string, bytes: Uint8Array): void;
  arm(fault: FakeFault): void;
  /** Marks a lock holder's process as gone for stale-lock tests. */
  markDead(pid: number): void;
  readonly calls: { write: number; sync: number; directorySync: number };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function createFakeTasteFileSystem(): FakeTasteFileSystem {
  const files = new Map<string, Uint8Array>();
  const locks = new Map<string, LockHolder>();
  const dead = new Set<number>();
  const faults: FakeFault[] = [];
  const calls = { write: 0, sync: 0, directorySync: 0 };

  function takeFault<K extends FakeFault['kind']>(kind: K): Extract<FakeFault, { kind: K }> | null {
    const index = faults.findIndex((fault) => fault.kind === kind);
    if (index < 0) return null;
    return faults.splice(index, 1)[0] as Extract<FakeFault, { kind: K }>;
  }

  function handleFor(path: string): AppendHandle {
    let open = true;
    return {
      async write(bytes) {
        if (!open) throw new Error('Handle closed');
        calls.write += 1;
        const current = files.get(path) ?? new Uint8Array();
        const short = takeFault('short-write');
        if (short) {
          const count = Math.min(short.bytes, bytes.length);
          files.set(path, concat(current, bytes.subarray(0, count)));
          return count;
        }
        const crash = takeFault('write-throws');
        if (crash) {
          files.set(path, concat(current, bytes.subarray(0, Math.min(crash.bytesBeforeThrow, bytes.length))));
          throw new Error('Injected write failure');
        }
        files.set(path, concat(current, bytes));
        return bytes.length;
      },
      async sync() {
        calls.sync += 1;
        if (takeFault('sync-throws')) throw new Error('Injected sync failure');
      },
      async close() {
        open = false;
      },
    };
  }

  return {
    label: FAKE_FILE_SYSTEM_LABEL,
    calls,
    bytes: (path) => files.get(path)?.slice() ?? null,
    setBytes: (path, bytes) => { files.set(path, bytes.slice()); },
    arm: (fault) => { faults.push(fault); },
    markDead: (pid) => { dead.add(pid); },

    async readFile(path) {
      return files.get(path)?.slice() ?? null;
    },
    async openAppend(path) {
      const created = !files.has(path);
      if (created) files.set(path, new Uint8Array());
      return { handle: handleFor(path), created };
    },
    async syncDirectoryOf() {
      calls.directorySync += 1;
      if (takeFault('directory-sync-throws')) throw new Error('Injected directory sync failure');
    },
    async acquireLock(lockPath, holder): Promise<LockAcquisition> {
      const current = locks.get(lockPath);
      if (current) return { acquired: false, holder: current };
      locks.set(lockPath, holder);
      return { acquired: true };
    },
    async releaseLock(lockPath, token) {
      if (locks.get(lockPath)?.token === token) locks.delete(lockPath);
    },
    async isLockHolderAlive(holder) {
      return !dead.has(holder.pid);
    },
    async reclaimStaleLock(lockPath, token) {
      if (locks.get(lockPath)?.token !== token) return false;
      locks.delete(lockPath);
      return true;
    },
  };
}

