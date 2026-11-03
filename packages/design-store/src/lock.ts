import { join } from 'node:path';
import { randomId, readOrNull, unlinkIfPresent } from './durable.ts';
import { StoreError } from './errors.ts';
import { errorCode, type StoreFs } from './fs.ts';
import { canonicalBytes } from './jcs.ts';
import { LOCK_FORMAT, TEMP_PREFIX } from './layout.ts';

/** Lock nonces held by open stores in this process; a same-pid lock without one is stale. */
const heldInProcess = new Set<string>();

export interface LockOptions {
  readonly fs: StoreFs;
  readonly root: string;
  readonly lockPath: string;
  readonly pid: number;
  readonly isProcessAlive: (pid: number) => boolean;
}

export function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === 'EPERM';
  }
}

/**
 * Single-writer lock. The lock file is written completely under a temp name and then hard-linked
 * into place, so it is either absent or whole. A lock whose process is gone is reclaimed.
 * Returns the release function.
 */
export async function acquireLock(options: LockOptions): Promise<() => Promise<void>> {
  const nonce = randomId();
  const body = canonicalBytes({ format: LOCK_FORMAT, pid: options.pid, nonce });
  const { fs, lockPath } = options;
  const temp = join(options.root, `${TEMP_PREFIX}lock-${nonce}`);
  await fs.writeNew(temp, body);
  heldInProcess.add(nonce);
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await fs.link(temp, lockPath);
        await fs.unlink(temp);
        return release;
      } catch (error) {
        if (errorCode(error) !== 'EEXIST' || attempt > 0) throw error;
        const holder = parseLock(await readOrNull(fs, lockPath));
        const live = holder !== null && (holder.pid === options.pid ? heldInProcess.has(holder.nonce) : options.isProcessAlive(holder.pid));
        if (live) throw new StoreError('locked', 'Another writer holds the store lock', { pid: holder.pid });
        if (holder === null) throw new StoreError('locked', 'The store lock file is unreadable; refusing to reclaim it');
        await unlinkIfPresent(fs, lockPath);
      }
    }
    throw new StoreError('locked', 'Could not acquire the store lock');
  } catch (error) {
    heldInProcess.delete(nonce);
    await unlinkIfPresent(fs, temp).catch(() => false);
    throw error;
  }

  async function release(): Promise<void> {
    try {
      const holder = parseLock(await readOrNull(fs, lockPath));
      if (holder?.nonce === nonce) await fs.unlink(lockPath);
    } finally {
      heldInProcess.delete(nonce);
    }
  }
}

function parseLock(bytes: Uint8Array | null): { pid: number; nonce: string } | null {
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (typeof value !== 'object' || value === null) return null;
    const record = value as Record<string, unknown>;
    if (record.format !== LOCK_FORMAT || !Number.isSafeInteger(record.pid) || typeof record.nonce !== 'string') return null;
    return { pid: record.pid as number, nonce: record.nonce };
  } catch {
    return null;
  }
}
