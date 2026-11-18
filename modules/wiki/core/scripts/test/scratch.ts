// Task-owned scratch for tests that need real files (synthetic bare repositories, fake git binaries).
//
// Placement: a directory created for this process under the user's home (never /tmp and never the OS
// temp directory); HQ_WIKI_VALIDATION_SCRATCH may name another existing parent. Every process creates its
// own unique base, and every scratch root lives inside it, so concurrent test files can never remove
// each other's state. Cleanup removes exactly the captured paths after owned child closure. Test teardown handles
// success/failure; SIGINT/SIGTERM await closure first. Uncatchable termination retains scratch.

import { closeOwnedProcesses } from '../processes.ts';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, sep } from 'node:path';

const owned = new Set<string>();
let base: string | null = null;
let handlersInstalled = false;

function insideAny(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep));
}

function scratchBase(): string {
  if (base !== null) return base;
  const parent = realpathSync(process.env['HQ_WIKI_VALIDATION_SCRATCH'] ?? homedir());
  const forbidden = ['/tmp', '/var/tmp', realpathSync(tmpdir())];
  if (insideAny(parent, forbidden)) throw new Error('test scratch must live outside /tmp and the OS temp directory');
  base = mkdtempSync(join(parent, '.hq-wiki-validation-'));
  return base;
}

/** Remove everything this process created: its roots, then its base. Never touches another path. */
function removeAll(): void {
  for (const root of owned) {
    if (base !== null && root.startsWith(base + sep)) rmSync(root, { recursive: true, force: true });
    owned.delete(root);
  }
  if (base !== null) {
    rmSync(base, { recursive: true, force: true });
    base = null;
  }
}

function installHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, async () => {
      try {
        await closeOwnedProcesses();
        removeAll();
      } finally { process.exit(signal === 'SIGINT' ? 130 : 143); }
    });
  }
}

export interface Scratch {
  /** The unique, task-owned root. */
  readonly root: string;
  /** Remove exactly `root` (and this process's base once nothing else is owned). Idempotent. */
  cleanup(): Promise<void>;
}

/** Create a unique scratch root. Cleanup is registered before the caller can fail. */
export function createScratch(label: string): Scratch {
  installHandlers();
  const root = mkdtempSync(join(scratchBase(), `${label.replace(/[^A-Za-z0-9_-]/g, '_')}-`));
  owned.add(root);
  return {
    root,
    async cleanup() {
      await closeOwnedProcesses();
      if (!owned.has(root)) return;
      rmSync(root, { recursive: true, force: true });
      owned.delete(root);
      if (owned.size === 0) removeAll();
    },
  };
}

/** Run `work` with a scratch root and always remove it, preserving the work's own outcome. */
export async function withScratch<T>(label: string, work: (root: string) => Promise<T> | T): Promise<T> {
  const scratch = createScratch(label);
  let result: T;
  try {
    result = await work(scratch.root);
  } catch (error) {
    try { await scratch.cleanup(); } finally { throw error; }
  }
  await scratch.cleanup();
  return result;
}

/** The base directory this process created (test introspection only). */
export function currentBase(): string | null {
  return base;
}
