import { createHash } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { fail } from './errors.ts';

export interface Limits {
  readonly maxFileBytes: number;
  readonly maxJsonBytes: number;
  readonly maxTotalBytes: number;
  readonly maxFiles: number;
}

export const DEFAULT_LIMITS: Limits = Object.freeze({
  maxFileBytes: 64 * 1024 * 1024, maxJsonBytes: 8 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024, maxFiles: 20_000,
});

export function sha256Digest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** Relative references: `/`-separated, no empty, `.` or `..` segment, no control character or backslash. */
export function isSafeRelative(rel: unknown): rel is string {
  if (typeof rel !== 'string' || rel.length === 0 || rel.length > 512) return false;
  if (rel.startsWith('/') || rel.includes('\\') || /[\u0000-\u001f\u007f]/u.test(rel)) return false;
  return rel.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

interface Fingerprint { readonly ino: number; readonly size: number; readonly mtimeMs: number }

/**
 * Reads regular files beneath one real root. Every path component must be a real
 * directory or file (symbolic links are rejected, not followed), sizes are capped,
 * and every file read is fingerprinted so a later `assertUnchanged` can abort the
 * run if the source moved underneath it.
 */
export class ReadSession {
  readonly rootReal: string;
  readonly #limits: Limits;
  readonly #seen = new Map<string, Fingerprint>();
  #totalBytes = 0;

  private constructor(rootReal: string, limits: Limits) {
    this.rootReal = rootReal;
    this.#limits = limits;
  }

  static async open(root: string, limits: Limits): Promise<ReadSession> {
    let real: string;
    try { real = await fs.realpath(root); } catch { return fail('source-root-unavailable'); }
    const stat = await fs.lstat(real);
    if (!stat.isDirectory()) return fail('source-root-not-directory');
    return new ReadSession(real, limits);
  }

  get filesRead(): number { return this.#seen.size; }
  get bytesRead(): number { return this.#totalBytes; }

  async #locate(rel: string): Promise<string> {
    if (!isSafeRelative(rel)) return fail('unsafe-path');
    const segments = rel.split('/');
    let current = this.rootReal;
    for (const [index, segment] of segments.entries()) {
      current = path.join(current, segment);
      let stat;
      try { stat = await fs.lstat(current); } catch (error) {
        return fail((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'file-missing' : 'file-unreadable');
      }
      if (stat.isSymbolicLink()) return fail('symlink-rejected');
      const last = index === segments.length - 1;
      if (!last && !stat.isDirectory()) return fail('not-directory');
      if (last && !stat.isFile()) return fail('not-regular-file');
    }
    if (!current.startsWith(`${this.rootReal}${path.sep}`)) return fail('escapes-root');
    return current;
  }

  /** Reads one file. `kind` picks the byte cap. */
  async read(rel: string, kind: 'json' | 'blob'): Promise<Uint8Array> {
    const target = await this.#locate(rel);
    const cap = kind === 'json' ? this.#limits.maxJsonBytes : this.#limits.maxFileBytes;
    const before = await fs.lstat(target);
    if (before.size > cap) return fail('file-too-large');
    if (!this.#seen.has(rel) && this.#seen.size >= this.#limits.maxFiles) return fail('too-many-files');
    let handle;
    try { handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW); } catch { return fail('file-unreadable'); }
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.ino !== before.ino || stat.size !== before.size) return fail('generation-changed');
      const bytes = new Uint8Array(stat.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (bytesRead === 0) return fail('generation-changed');
        offset += bytesRead;
      }
      const after = await handle.stat();
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ino !== stat.ino) return fail('generation-changed');
      const fingerprint = { ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
      const known = this.#seen.get(rel);
      if (known === undefined) {
        this.#totalBytes += bytes.length;
        if (this.#totalBytes > this.#limits.maxTotalBytes) return fail('source-too-large');
        this.#seen.set(rel, fingerprint);
      } else if (known.ino !== fingerprint.ino || known.size !== fingerprint.size || known.mtimeMs !== fingerprint.mtimeMs) {
        return fail('generation-changed');
      }
      return bytes;
    } finally {
      await handle.close();
    }
  }

  /** Aborts if any file read earlier has since changed, moved or been replaced. */
  async assertUnchanged(): Promise<void> {
    for (const [rel, fingerprint] of this.#seen) {
      let stat;
      try { stat = await fs.lstat(path.join(this.rootReal, ...rel.split('/'))); } catch { return fail('generation-changed'); }
      if (stat.isSymbolicLink() || stat.ino !== fingerprint.ino || stat.size !== fingerprint.size || stat.mtimeMs !== fingerprint.mtimeMs) {
        return fail('generation-changed');
      }
    }
  }

  /** Reads the single declared pointer hop: the pointer must be a symlink naming one allowed release directory. */
  async resolvePointer(pointer: string, allowed: readonly string[]): Promise<{ readonly release: string; readonly ino: number }> {
    if (!isSafeRelative(pointer) || pointer.includes('/')) return fail('unsafe-pointer');
    const link = path.join(this.rootReal, pointer);
    let stat;
    try { stat = await fs.lstat(link); } catch { return fail('pointer-missing'); }
    if (!stat.isSymbolicLink()) return fail('pointer-not-symlink');
    const target = await fs.readlink(link);
    if (!allowed.includes(target) || !isSafeRelative(target) || target.includes('/')) return fail('pointer-target-not-allowed');
    let release;
    try { release = await fs.lstat(path.join(this.rootReal, target)); } catch { return fail('release-missing'); }
    if (release.isSymbolicLink() || !release.isDirectory()) return fail('release-not-directory');
    return { release: target, ino: stat.ino };
  }
}

/** True if `candidate` is `parent` or beneath it. */
export function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Nearest existing ancestor (or itself) of a path, resolved to a real path. */
async function nearestReal(target: string): Promise<string> {
  let current = path.resolve(target);
  for (;;) {
    try { return await fs.realpath(current); } catch {
      const parent = path.dirname(current);
      if (parent === current) return fail('output-unresolvable');
      current = parent;
    }
  }
}

/**
 * Rejects an output location with a Git ancestor of any kind: a `.git` directory or a `.git`
 * file (a linked worktree), at the path itself or any parent, checked on both the lexical and
 * the resolved path.
 */
export async function assertNoGitAncestor(output: string): Promise<void> {
  if (!path.isAbsolute(output)) return fail('output-not-absolute');
  const lexical = path.resolve(output);
  const real = await nearestReal(lexical);
  for (const start of new Set([lexical, real])) {
    for (let dir = start; ; dir = path.dirname(dir)) {
      if (await entryExists(path.join(dir, '.git'))) return fail('output-git-ancestor');
      if (path.dirname(dir) === dir) break;
    }
  }
}

/** Any entry at all (file, directory or link) counts; only a clean "not there" is false. */
async function entryExists(target: string): Promise<boolean> {
  try { await fs.lstat(target); return true; } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== 'ENOENT' && code !== 'ENOTDIR';
  }
}
