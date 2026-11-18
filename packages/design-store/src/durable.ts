import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { errorCode, type StoreFs } from './fs.ts';
import { TEMP_PREFIX } from './layout.ts';

/** Tracks whether directory fsync is available so health() can report weaker durability. */
export class DurabilityProbe {
  directoryFsync: 'supported' | 'unsupported' | 'unknown' = 'unknown';

  record(supported: boolean): void {
    if (!supported) this.directoryFsync = 'unsupported';
    else if (this.directoryFsync === 'unknown') this.directoryFsync = 'supported';
  }
}

export function randomId(bytes = 8): string {
  return randomBytes(bytes).toString('hex');
}

export async function syncDir(fs: StoreFs, dir: string, probe: DurabilityProbe): Promise<void> {
  probe.record(await fs.fsyncDir(dir));
}

/**
 * Baseline per-document atomicity: write a sibling temp file, fsync it, rename over the target,
 * then fsync the directory so the rename itself is durable.
 */
export async function writeAtomic(fs: StoreFs, path: string, bytes: Uint8Array, probe: DurabilityProbe): Promise<void> {
  const dir = dirname(path);
  const temp = join(dir, `${TEMP_PREFIX}${randomId()}`);
  await fs.writeNew(temp, bytes);
  await fs.fsyncFile(temp);
  await fs.rename(temp, path);
  await syncDir(fs, dir, probe);
}

/** Creates each missing directory from `base` down to `dir`, fsyncing every parent entry it adds. */
export async function ensureDir(fs: StoreFs, base: string, dir: string, probe: DurabilityProbe, known: Set<string>): Promise<void> {
  if (known.has(dir)) return;
  if (dir === base) {
    known.add(dir);
    return;
  }
  const parent = dirname(dir);
  if (!dir.startsWith(base) || parent === dir) throw new Error(`Directory ${dir} is outside ${base}`);
  await ensureDir(fs, base, parent, probe, known);
  const existing = await fs.stat(dir);
  if (!existing) {
    await fs.mkdir(dir);
    await syncDir(fs, parent, probe);
  } else if (!existing.isDirectory) {
    throw new Error(`Expected directory at ${dir}`);
  }
  known.add(dir);
}

export async function readOrNull(fs: StoreFs, path: string): Promise<Uint8Array | null> {
  try {
    return await fs.readFile(path);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return null;
    throw error;
  }
}

export async function listOrEmpty(fs: StoreFs, dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).sort();
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return [];
    throw error;
  }
}

export async function unlinkIfPresent(fs: StoreFs, path: string): Promise<boolean> {
  try {
    await fs.unlink(path);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
}

/** Recursively copies a tree, fsyncing every file and directory. Returns relative file paths. */
export async function copyTree(fs: StoreFs, from: string, to: string, probe: DurabilityProbe, skip: ReadonlySet<string> = new Set()): Promise<string[]> {
  const copied: string[] = [];
  await fs.mkdir(to);
  async function walk(relative: string): Promise<void> {
    const source = join(from, relative);
    for (const name of await listOrEmpty(fs, source)) {
      const childRelative = relative === '' ? name : join(relative, name);
      if (skip.has(childRelative) || name.startsWith(TEMP_PREFIX)) continue;
      const info = await fs.stat(join(from, childRelative));
      if (!info) continue;
      if (info.isDirectory) {
        await fs.mkdir(join(to, childRelative));
        await walk(childRelative);
      } else {
        const target = join(to, childRelative);
        await fs.writeNew(target, await fs.readFile(join(from, childRelative)));
        await fs.fsyncFile(target);
        copied.push(childRelative);
      }
    }
    await syncDir(fs, join(to, relative), probe);
  }
  await walk('');
  return copied;
}

export interface TreeEntry {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
}

/** Lists every file under `dir` with its digest, sorted by relative path. */
export async function describeTree(fs: StoreFs, dir: string, digest: (bytes: Uint8Array) => string, skip: ReadonlySet<string> = new Set()): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];
  async function walk(relative: string): Promise<void> {
    for (const name of await listOrEmpty(fs, join(dir, relative))) {
      const childRelative = relative === '' ? name : `${relative}/${name}`;
      if (skip.has(childRelative)) continue;
      const path = join(dir, childRelative);
      const info = await fs.stat(path);
      if (!info) continue;
      if (info.isDirectory) {
        await walk(childRelative);
      } else {
        const bytes = await fs.readFile(path);
        entries.push({ path: childRelative, sha256: digest(bytes), bytes: bytes.length });
      }
    }
  }
  await walk('');
  return entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}
