import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, readFile, rename, unlink, type FileHandle } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { AppendHandle, LockAcquisition, LockHolder, Sha256Hex, TasteFileSystem } from './contract.ts';

/**
 * Node adapter for the main process. Root chooses the paths; this adapter
 * never deletes or truncates a journal. The lock is an exclusively created
 * file holding only an opaque token, a pid and a timestamp.
 */

export const nodeSha256: Sha256Hex = async (bytes) => createHash('sha256').update(bytes).digest('hex');

function code(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
}

class NodeAppendHandle implements AppendHandle {
  readonly #file: FileHandle;

  constructor(file: FileHandle) {
    this.#file = file;
  }

  async write(bytes: Uint8Array): Promise<number> {
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesWritten } = await this.#file.write(bytes, offset, bytes.length - offset);
      if (bytesWritten === 0) break;
      offset += bytesWritten;
    }
    return offset;
  }

  sync(): Promise<void> {
    return this.#file.sync();
  }

  close(): Promise<void> {
    return this.#file.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(dirname(path), constants.O_RDONLY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function parseHolder(text: string): LockHolder | null {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== 'object' || value === null) return null;
    const { token, pid, acquiredAt } = value as Record<string, unknown>;
    return typeof token === 'string' && typeof pid === 'number' && Number.isInteger(pid) && typeof acquiredAt === 'string'
      ? { token, pid, acquiredAt }
      : null;
  } catch {
    return null;
  }
}

async function readHolder(lockPath: string): Promise<LockHolder | null> {
  try {
    return parseHolder(await readFile(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

export function createNodeTasteFileSystem(): TasteFileSystem {
  return {
    async readFile(path) {
      try {
        return new Uint8Array(await readFile(path));
      } catch (error) {
        if (code(error) === 'ENOENT') return null;
        throw error;
      }
    },

    async openAppend(path) {
      let created = false;
      let file: FileHandle;
      try {
        file = await open(path, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL, 0o600);
        created = true;
      } catch (error) {
        if (code(error) !== 'EEXIST') throw error;
        file = await open(path, constants.O_WRONLY | constants.O_APPEND);
      }
      return { handle: new NodeAppendHandle(file), created };
    },

    syncDirectoryOf: syncDirectory,

    async acquireLock(lockPath, holder): Promise<LockAcquisition> {
      let file: FileHandle;
      try {
        file = await open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      } catch (error) {
        if (code(error) !== 'EEXIST') throw error;
        return { acquired: false, holder: await readHolder(lockPath) };
      }
      try {
        await file.writeFile(JSON.stringify(holder));
        await file.sync();
      } finally {
        await file.close();
      }
      await syncDirectory(lockPath);
      return { acquired: true };
    },

    async releaseLock(lockPath, token) {
      const holder = await readHolder(lockPath);
      if (holder?.token !== token) return;
      await unlink(lockPath);
      await syncDirectory(lockPath);
    },

    async isLockHolderAlive(holder) {
      if (holder.pid === process.pid) return true;
      try {
        process.kill(holder.pid, 0);
        return true;
      } catch (error) {
        // ESRCH proves absence on this host; EPERM and anything else means unknown, treated as alive.
        return code(error) !== 'ESRCH';
      }
    },

    async reclaimStaleLock(lockPath, token) {
      const holder = await readHolder(lockPath);
      if (holder?.token !== token) return false;
      // Rename is atomic: only one reclaimer can move the stale lock aside.
      const aside = `${lockPath}.stale-${token}`;
      try {
        await rename(lockPath, aside);
      } catch (error) {
        if (code(error) === 'ENOENT') return false;
        throw error;
      }
      const moved = await readHolder(aside);
      if (moved?.token !== token) {
        // Another reclaimer won between our read and rename; put its lock back without clobbering.
        try {
          await link(aside, lockPath);
        } catch (error) {
          if (code(error) !== 'EEXIST') throw error;
        }
      }
      await unlink(aside);
      await syncDirectory(lockPath);
      return moved?.token === token;
    },
  };
}
