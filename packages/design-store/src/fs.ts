import { link, mkdir, open, readdir, readFile, rename, rmdir, stat, unlink } from 'node:fs/promises';

export interface FileStat {
  readonly size: number;
  readonly mtimeMs: number;
  readonly isDirectory: boolean;
}

/**
 * Filesystem operations the store depends on. Every durability-relevant effect is a separate
 * call so a fault injector can stop the process model between any two stages.
 * Missing paths reject with an error whose `code` is `ENOENT`.
 */
export interface StoreFs {
  readFile(path: string): Promise<Uint8Array>;
  readdir(path: string): Promise<string[]>;
  stat(path: string): Promise<FileStat | null>;
  /** Creates one directory; an existing directory is success. */
  mkdir(path: string): Promise<void>;
  /** Creates a new file exclusively (rejects with `EEXIST`) and writes it without syncing. */
  writeNew(path: string, data: Uint8Array): Promise<void>;
  /** Appends to a file, creating it if needed, without syncing. */
  append(path: string, data: Uint8Array): Promise<void>;
  fsyncFile(path: string): Promise<void>;
  /** Returns false when the platform cannot fsync a directory. */
  fsyncDir(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
  /** Hard-links `existing` at `path`; rejects with `EEXIST`. Used for an atomic, complete lock file. */
  link(existing: string, path: string): Promise<void>;
  unlink(path: string): Promise<void>;
  /** Removes one empty directory. */
  rmdir(path: string): Promise<void>;
}

const DIR_FSYNC_UNSUPPORTED = new Set(['EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM', 'EBADF']);

export function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

/** The real Node implementation. */
export const nodeFs: StoreFs = {
  async readFile(path) {
    return new Uint8Array(await readFile(path));
  },
  async readdir(path) {
    return readdir(path);
  },
  async stat(path) {
    try {
      const value = await stat(path);
      return { size: value.size, mtimeMs: value.mtimeMs, isDirectory: value.isDirectory() };
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null;
      throw error;
    }
  },
  async mkdir(path) {
    try {
      await mkdir(path);
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error;
    }
  },
  async writeNew(path, data) {
    const handle = await open(path, 'wx');
    try {
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
  },
  async append(path, data) {
    const handle = await open(path, 'a');
    try {
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
  },
  async fsyncFile(path) {
    const handle = await open(path, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  async fsyncDir(path) {
    let handle;
    try {
      handle = await open(path, 'r');
      await handle.sync();
      return true;
    } catch (error) {
      if (DIR_FSYNC_UNSUPPORTED.has(errorCode(error) ?? '')) return false;
      throw error;
    } finally {
      await handle?.close();
    }
  },
  async rename(from, to) {
    await rename(from, to);
  },
  async link(existing, path) {
    await link(existing, path);
  },
  async unlink(path) {
    await unlink(path);
  },
  async rmdir(path) {
    await rmdir(path);
  },
};
