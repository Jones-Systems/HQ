// Node Git adapter: the only module (besides tests) that may import node:*.
//
// Read-only access to one configured bare repository through a fixed set of Git plumbing commands,
// started with execFile (no shell), a minimal environment and bounded time and output:
//
//   rev-parse --is-bare-repository                     bare-status read
//   config --get remote.origin.url                     fixed remote lookup
//   rev-parse --verify --end-of-options refs/heads/<ref>^{commit}
//   show -s --no-show-signature --format=%ct --end-of-options <commit>
//   ls-tree -r -z -l --full-tree <commit>
//   cat-file blob <oid>
//
// Every command is prefixed with: --git-dir=<realpath> --no-replace-objects --literal-pathspecs
// -c core.fsmonitor=false. No fetch, pull, -C, worktree or write command exists in this file.
// `show` passes --no-show-signature so a repository's log.showSignature cannot start its gpg.program.

import { execFile as nodeExecFile } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { MAX_PAGE_BLOB_BYTES } from '../../contract/src/index.ts';
import type { GitObjectSource, Pin, SkippedEntries, SourceResult, TreeEntry, TreeListing } from './ports.ts';
import { validateSourceProfile } from './profile.ts';

export interface GitExecOptions {
  readonly timeout: number;
  readonly maxBuffer: number;
  readonly encoding: 'buffer';
  readonly shell: false;
  readonly windowsHide: true;
  readonly killSignal: 'SIGKILL';
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
}

export interface GitExecError extends Error {
  readonly code?: unknown;
  readonly killed?: boolean;
}

export type GitExecCallback = (error: GitExecError | null, stdout: Buffer, stderr: Buffer) => void;

/** The execFile seam. Tests may wrap it to record argv; the default is `node:child_process` execFile. */
export type GitExec = (file: string, args: string[], options: GitExecOptions, callback: GitExecCallback) => { stdin?: { end(): void } | null } | void;

export interface NodeGitOptions {
  /** Git executable (default `git`, found through PATH). */
  readonly gitExecutable?: string;
  readonly exec?: GitExec;
  /** Timeout for the small commands, ms (default 15000). */
  readonly commandTimeoutMs?: number;
  /** Timeout for ls-tree, ms (default 60000). */
  readonly treeTimeoutMs?: number;
  /** Timeout for cat-file, ms (default 30000). */
  readonly blobTimeoutMs?: number;
  /** Largest accepted ls-tree output, bytes (default 64 MiB). */
  readonly maxTreeBytes?: number;
  /** Concurrent Git processes (default 4). */
  readonly concurrency?: number;
}

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SMALL_OUTPUT_BYTES = 64 * 1024;

const defaultExec: GitExec = (file, args, options, callback) => nodeExecFile(file, args, options, callback);

function gitEnvironment(): Record<string, string> {
  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const env: Record<string, string> = {
    PATH: process.env['PATH'] ?? '',
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: nullDevice,
    GIT_CONFIG_SYSTEM: nullDevice,
    GIT_ATTR_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_NO_LAZY_FETCH: '1',
  };
  const systemRoot = process.env['SystemRoot'];
  if (systemRoot !== undefined) env['SystemRoot'] = systemRoot;
  return env;
}

type RunOutcome =
  | { readonly ok: true; readonly stdout: Buffer }
  | { readonly ok: false; readonly kind: 'too-large' | 'timeout' | 'failed' | 'missing-object'; readonly stderr: string };

function secondsToIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Parse `ls-tree -r -z -l` output. Non-regular entries are counted, never returned. */
export function parseLsTree(output: Buffer): TreeListing {
  const entries: TreeEntry[] = [];
  const skipped = { symlinks: 0, submodules: 0, other: 0, invalidPaths: 0 };
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let start = 0;
  while (start < output.length) {
    let end = output.indexOf(0, start);
    if (end < 0) end = output.length;
    const record = output.subarray(start, end);
    start = end + 1;
    if (record.length === 0) continue;
    const tab = record.indexOf(9);
    if (tab < 0) {
      skipped.other++;
      continue;
    }
    const meta = record.subarray(0, tab).toString('latin1').trim().split(/\s+/);
    const [mode, type, oid, size] = meta;
    if (mode === undefined || type === undefined || oid === undefined || size === undefined || !OBJECT_ID.test(oid)) {
      skipped.other++;
      continue;
    }
    if (mode === '120000') {
      skipped.symlinks++;
      continue;
    }
    if (mode === '160000' || type === 'commit') {
      skipped.submodules++;
      continue;
    }
    if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) {
      skipped.other++;
      continue;
    }
    let path: string;
    try {
      path = decoder.decode(record.subarray(tab + 1));
    } catch {
      skipped.invalidPaths++;
      continue;
    }
    const bytes = Number(size);
    if (!Number.isInteger(bytes) || bytes < 0) {
      skipped.other++;
      continue;
    }
    entries.push({ path, mode, oid, size: bytes });
  }
  return { entries, skipped: skipped as SkippedEntries };
}

/**
 * Create the Git-object source for one profile. The profile is validated here; an invalid profile
 * is a configuration error and throws. Every runtime failure (binding mismatch, non-bare
 * repository, wrong remote or ref, timeout, oversized output, Git error) is reported as data.
 */
export function createNodeGitObjectSource(profileInput: unknown, options: NodeGitOptions = {}): GitObjectSource {
  const checked = validateSourceProfile(profileInput);
  if (!checked.ok) throw new Error(`invalid source profile: ${checked.error.reason} at ${checked.error.path ?? '$'}`);
  const profile = checked.value;
  const exec = options.exec ?? defaultExec;
  const gitExecutable = options.gitExecutable ?? 'git';
  const commandTimeout = options.commandTimeoutMs ?? 15_000;
  const treeTimeout = options.treeTimeoutMs ?? 60_000;
  const blobTimeout = options.blobTimeoutMs ?? 30_000;
  const maxTreeBytes = options.maxTreeBytes ?? 64 * 1024 * 1024;
  const width = Math.max(1, options.concurrency ?? 4);

  let running = 0;
  const waiting: (() => void)[] = [];
  const acquire = (): Promise<void> => {
    if (running < width) {
      running++;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    if (next === undefined) running--;
    else next();
  };

  /** The configured directory as a real path, or null when it is not an existing directory. */
  const resolveGitDir = async (): Promise<string | null> => {
    try {
      const real = await realpath(profile.gitDir);
      return (await stat(real)).isDirectory() ? real : null;
    } catch {
      return null;
    }
  };

  const run = async (dir: string, command: readonly string[], timeout: number, maxBuffer: number): Promise<RunOutcome> => {
    const argv = [`--git-dir=${dir}`, '--no-replace-objects', '--literal-pathspecs', '-c', 'core.fsmonitor=false', ...command];
    await acquire();
    try {
      return await new Promise<RunOutcome>((resolve) => {
        const child = exec(
          gitExecutable,
          argv,
          { timeout, maxBuffer, encoding: 'buffer', shell: false, windowsHide: true, killSignal: 'SIGKILL', env: gitEnvironment(), cwd: dir },
          (error, stdout, stderr) => {
            if (error === null) return resolve({ ok: true, stdout });
            const text = stderr.toString('latin1').slice(0, 2048);
            if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve({ ok: false, kind: 'too-large', stderr: '' });
            if (error.killed === true) return resolve({ ok: false, kind: 'timeout', stderr: '' });
            const missing = /Not a valid object name|bad file|unable to read/.test(text);
            return resolve({ ok: false, kind: missing ? 'missing-object' : 'failed', stderr: text });
          },
        );
        child?.stdin?.end();
      });
    } catch {
      return { ok: false, kind: 'failed', stderr: '' };
    } finally {
      release();
    }
  };

  const text = (outcome: RunOutcome): string | null => (outcome.ok ? outcome.stdout.toString('utf8').replace(/\r?\n$/, '') : null);

  return {
    async resolvePin(): Promise<SourceResult<Pin>> {
      const dir = await resolveGitDir();
      if (dir === null) return { ok: false, reason: 'unavailable' };

      const bare = text(await run(dir, ['rev-parse', '--is-bare-repository'], commandTimeout, SMALL_OUTPUT_BYTES));
      if (bare !== 'true') return { ok: false, reason: 'unavailable' };

      const remote = text(await run(dir, ['config', '--get', 'remote.origin.url'], commandTimeout, SMALL_OUTPUT_BYTES));
      if (remote === null || remote !== profile.expectedRemote) return { ok: false, reason: 'unavailable' };

      const commit = text(await run(dir, ['rev-parse', '--verify', '--end-of-options', `refs/heads/${profile.ref}^{commit}`], commandTimeout, SMALL_OUTPUT_BYTES));
      if (commit === null || !OBJECT_ID.test(commit)) return { ok: false, reason: 'unavailable' };

      const seconds = text(await run(dir, ['show', '-s', '--no-show-signature', '--format=%ct', '--end-of-options', commit], commandTimeout, SMALL_OUTPUT_BYTES));
      if (seconds === null || !/^\d{1,12}$/.test(seconds)) return { ok: false, reason: 'unavailable' };

      return { ok: true, value: { ref: profile.ref, commit, commitTime: secondsToIso(Number(seconds)) } };
    },

    async listTree(commit: string): Promise<SourceResult<TreeListing>> {
      if (!OBJECT_ID.test(commit)) return { ok: false, reason: 'unavailable' };
      const dir = await resolveGitDir();
      if (dir === null) return { ok: false, reason: 'unavailable' };
      const outcome = await run(dir, ['ls-tree', '-r', '-z', '-l', '--full-tree', commit], treeTimeout, maxTreeBytes);
      if (!outcome.ok) return { ok: false, reason: outcome.kind === 'too-large' ? 'too-large' : 'unavailable' };
      return { ok: true, value: parseLsTree(outcome.stdout) };
    },

    async readBlob(oid: string, maxBytes: number): Promise<SourceResult<Uint8Array>> {
      if (!OBJECT_ID.test(oid) || !Number.isInteger(maxBytes) || maxBytes < 0) return { ok: false, reason: 'unavailable' };
      const dir = await resolveGitDir();
      if (dir === null) return { ok: false, reason: 'unavailable' };
      const limit = Math.min(maxBytes, MAX_PAGE_BLOB_BYTES);
      // maxBuffer 0 would mean "unlimited" to some versions of the API; ask for at least one byte.
      const outcome = await run(dir, ['cat-file', 'blob', oid], blobTimeout, Math.max(1, limit));
      if (!outcome.ok) {
        if (outcome.kind === 'too-large') return { ok: false, reason: 'too-large' };
        return { ok: false, reason: outcome.kind === 'missing-object' ? 'not-found' : 'unavailable' };
      }
      if (outcome.stdout.length > limit) return { ok: false, reason: 'too-large' };
      return { ok: true, value: new Uint8Array(outcome.stdout.buffer, outcome.stdout.byteOffset, outcome.stdout.length) };
    },
  };
}
