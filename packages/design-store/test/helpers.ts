import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import type { Clock, NamespaceConfig, NamespaceId } from '../src/contract.ts';
import { sha256Hex } from '../src/jcs.ts';
import { openFileStore, type OpenFileStoreOptions } from '../src/open.ts';

const created = new Set<string>();
// Cancellation (Ctrl-C or a killed runner) still removes every scratch directory this file created.
process.once('exit', () => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/** Exact scratch directory owned by one test; removed on success, failure or cancellation. */
export function scratch(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'hq-design-store-test-'));
  created.add(dir);
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    created.delete(dir);
  });
  return dir;
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

export const WORKSPACE = 'workspace' as NamespaceId;
export const CACHE = 'cache' as NamespaceId;

export function open(root: string, options: Partial<OpenFileStoreOptions> = {}) {
  return openFileStore({ root, schemaVersion: 1, clock: fakeClock(), ...options });
}

export function namespaces(cacheBudget: number, maxItemBytes?: number): NamespaceConfig[] {
  return [
    { id: WORKSPACE, storageClass: 'authoritative' },
    { id: CACHE, storageClass: 'evictable', budgetBytes: cacheBudget, ...(maxItemBytes === undefined ? {} : { maxItemBytes }) },
  ];
}

export interface TreeFile {
  readonly sha256: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/** Every file and directory under `root` with content digests and mtimes, for "not modified" proofs. */
export function treeState(root: string): Record<string, TreeFile | 'dir'> {
  const out: Record<string, TreeFile | 'dir'> = {};
  const walk = (relative: string): void => {
    const dir = join(root, relative);
    for (const name of readdirSync(dir).sort()) {
      const child = relative === '' ? name : `${relative}/${name}`;
      const info = statSync(join(root, child));
      if (info.isDirectory()) {
        out[`${child}/`] = 'dir';
        walk(child);
      } else {
        out[child] = { sha256: sha256Hex(readFileSync(join(root, child))), size: info.size, mtimeMs: info.mtimeMs };
      }
    }
  };
  walk('');
  out['./mtime'] = { sha256: '', size: 0, mtimeMs: statSync(root).mtimeMs };
  return out;
}

/** Content-only tree (no mtimes) under a directory. */
export function treeContent(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [path, entry] of Object.entries(treeState(root))) {
    if (path === './mtime') continue;
    out[path] = entry === 'dir' ? 'dir' : entry.sha256;
  }
  return out;
}

export function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function liveGenerationDir(root: string): string {
  const pointer = JSON.parse(readFileSync(join(root, 'CURRENT'), 'utf8')) as { generation: string };
  return join(root, 'generations', pointer.generation);
}
