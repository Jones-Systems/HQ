// Task-owned scratch for the assembly tests (synthetic bare repositories). Same placement rule as the core's tests:
// a unique directory under the user's home (never /tmp or the OS temp directory; HQ_WIKI_ASSEMBLY_SCRATCH may name
// another existing parent). Cleanup removes exactly the paths this process created and is registered before any
// work starts, so success, failure and cancellation (exit, SIGINT, SIGTERM) all leave nothing behind.

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, sep } from 'node:path';

let base: string | null = null;
let installed = false;

function inside(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep));
}

function scratchBase(): string {
  if (base !== null) return base;
  const parent = realpathSync(process.env['HQ_WIKI_ASSEMBLY_SCRATCH'] ?? homedir());
  if (inside(parent, ['/tmp', '/var/tmp', realpathSync(tmpdir())])) throw new Error('test scratch must live outside /tmp and the OS temp directory');
  base = mkdtempSync(join(parent, '.hq-wiki-assembly-'));
  return base;
}

/** Remove exactly this process's base directory (and so everything created under it). */
function removeAll(): void {
  if (base !== null) rmSync(base, { recursive: true, force: true });
  base = null;
}

function install(): void {
  if (installed) return;
  installed = true;
  process.on('exit', removeAll);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      removeAll();
      process.kill(process.pid, signal);
    });
  }
}

export interface Scratch {
  readonly root: string;
  cleanup(): void;
}

/** A unique scratch root. Cleanup is registered before the caller can fail and is idempotent. */
export function createScratch(label: string): Scratch {
  install();
  const root = mkdtempSync(join(scratchBase(), `${label.replace(/[^A-Za-z0-9_-]/g, '_')}-`));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** The base this process created, or null once everything is removed (test introspection only). */
export function currentBase(): string | null {
  return base;
}
