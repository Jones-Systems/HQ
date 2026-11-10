// Node Git adapter: the only module (besides tests) that may import node:*.
//
// Read-only access to one configured bare repository through a fixed set of Git plumbing commands,
// started without a shell, with a minimal environment and bounded time and output:
//
//   rev-parse --is-bare-repository                     bare-status read
//   config --get remote.origin.url                     fixed remote lookup
//   rev-parse --verify --end-of-options refs/heads/<ref>^{commit}
//   show -s --no-show-signature --format=%ct --end-of-options <commit>
//   ls-tree -r -z -l --full-tree <commit>
//   cat-file --batch                                   one persistent child per source; stdin gets only
//                                                      validated hex object ids, one per line
//
// Every command is prefixed with: --git-dir=<realpath> --no-replace-objects --literal-pathspecs
// -c core.fsmonitor=false. No fetch, pull, -C, worktree or write command exists in this file.
// `show` passes --no-show-signature so a repository's log.showSignature cannot start its gpg.program.
// The first five run once through execFile; blob reads share the batch child (started lazily, replaced
// after any failure or realpath change, closed after a short idle period and on `close()`).

import { execFile as nodeExecFile, spawn as nodeSpawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { MAX_PAGE_BLOB_BYTES } from '../../contract/src/index.ts';
import type { GitObjectSource, Pin, SkippedEntries, SourceFailureReason, SourceResult, TreeEntry, TreeListing } from './ports.ts';
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
export type GitExec = (file: string, args: string[], options: GitExecOptions, callback: GitExecCallback) => { stdin?: { end(): void } | null; kill?(signal: 'SIGKILL'): unknown } | void;

export interface GitSpawnOptions {
  readonly stdio: ['pipe', 'pipe', 'ignore'];
  readonly shell: false;
  readonly windowsHide: true;
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
}

/** The part of a child process the batch reader uses. `node:child_process` children satisfy it. */
export interface GitBatchChild {
  readonly stdin: { write(chunk: string): unknown; end(): unknown; on(event: 'error', listener: (error: Error) => void): unknown };
  readonly stdout: { on(event: 'data', listener: (chunk: Buffer) => void): unknown; on(event: 'error', listener: (error: Error) => void): unknown };
  on(event: 'close', listener: () => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  kill(signal: 'SIGKILL'): unknown;
}

/** The spawn seam for the persistent `cat-file --batch` child; the default is `node:child_process` spawn. */
export type GitSpawn = (file: string, args: string[], options: GitSpawnOptions) => GitBatchChild;

export interface NodeGitOptions {
  /** Git executable (default `git`, found through PATH). */
  readonly gitExecutable?: string;
  readonly exec?: GitExec;
  readonly spawn?: GitSpawn;
  /** Timeout for the small commands, ms (default 15000). */
  readonly commandTimeoutMs?: number;
  /** Timeout for ls-tree, ms (default 60000). */
  readonly treeTimeoutMs?: number;
  /** Timeout for one blob read through the batch child, ms (default 30000). */
  readonly blobTimeoutMs?: number;
  /** The batch child is closed after this long without a read, ms (default 1500). */
  readonly batchIdleMs?: number;
  /** Largest accepted ls-tree output, bytes (default 64 MiB). */
  readonly maxTreeBytes?: number;
  /** Concurrent one-shot Git processes (default 4); the single batch child is not counted. */
  readonly concurrency?: number;
}

/** A source whose batch child and one-shot processes can be stopped. After `close()` every call is `unavailable`. */
export type NodeGitObjectSource = GitObjectSource & {
  /** Kill the batch child and any running one-shot process, fail queued reads, and wait for the child to exit. */
  close(): Promise<void>;
};

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const BATCH_HEADER = /^([0-9a-f]{40}|[0-9a-f]{64}) ([a-z]{1,16}) ([0-9]{1,15})$/;
const SMALL_OUTPUT_BYTES = 64 * 1024;
/** A batch header is `<oid> <type> <size>`; anything longer without a line feed is a framing error. */
const BATCH_HEADER_LIMIT = 256;
const BATCH_IDLE_MS = 1500;
/** An idle child that ignores end-of-input is killed after this long. */
const BATCH_EXIT_GRACE_MS = 2000;

const defaultExec: GitExec = (file, args, options, callback) => nodeExecFile(file, args, options, callback);
const defaultSpawn: GitSpawn = (file, args, options) => nodeSpawn(file, args, options);

const refuse = (reason: SourceFailureReason): SourceResult<never> => ({ ok: false, reason });

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

/** One queued blob read. `dir` is undefined while its real path is being resolved. */
interface BlobRequest {
  readonly oid: string;
  readonly limit: number;
  dir: string | null | undefined;
  readonly resolve: (result: SourceResult<Uint8Array>) => void;
}

/** A running `cat-file --batch` child bound to one real git directory. At most one request is in flight. */
interface BatchChild {
  readonly child: GitBatchChild;
  readonly dir: string;
  request: BlobRequest | null;
  /** Output received for the current request, not yet consumed. */
  chunks: Buffer[];
  length: number;
  /** Set once the header of the current object was read: where the body starts and how long it is. */
  frame: { readonly start: number; readonly size: number } | null;
  timer: ReturnType<typeof setTimeout> | null;
  retired: boolean;
  exited: boolean;
  killer: ReturnType<typeof setTimeout> | null;
  /** Resolves when the process is gone (its stdio closed or it failed to start). */
  readonly gone: Promise<void>;
  markGone(): void;
}

/**
 * Create the Git-object source for one profile. The profile is validated here; an invalid profile
 * is a configuration error and throws. Every runtime failure (binding mismatch, non-bare
 * repository, wrong remote or ref, timeout, oversized output, Git error) is reported as data.
 */
export function createNodeGitObjectSource(profileInput: unknown, options: NodeGitOptions = {}): NodeGitObjectSource {
  const checked = validateSourceProfile(profileInput);
  if (!checked.ok) throw new Error(`invalid source profile: ${checked.error.reason} at ${checked.error.path ?? '$'}`);
  const profile = checked.value;
  const exec = options.exec ?? defaultExec;
  const spawn = options.spawn ?? defaultSpawn;
  const gitExecutable = options.gitExecutable ?? 'git';
  const commandTimeout = options.commandTimeoutMs ?? 15_000;
  const treeTimeout = options.treeTimeoutMs ?? 60_000;
  const blobTimeout = options.blobTimeoutMs ?? 30_000;
  const idleTimeout = options.batchIdleMs ?? BATCH_IDLE_MS;
  const maxTreeBytes = options.maxTreeBytes ?? 64 * 1024 * 1024;
  const width = Math.max(1, options.concurrency ?? 4);

  let closed = false;
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

  const oneShots = new Set<{ kill?(signal: 'SIGKILL'): unknown }>();
  const run = async (dir: string, command: readonly string[], timeout: number, maxBuffer: number): Promise<RunOutcome> => {
    const argv = [`--git-dir=${dir}`, '--no-replace-objects', '--literal-pathspecs', '-c', 'core.fsmonitor=false', ...command];
    await acquire();
    try {
      if (closed) return { ok: false, kind: 'failed', stderr: '' };
      return await new Promise<RunOutcome>((resolve) => {
        let settled = false;
        const child = exec(
          gitExecutable,
          argv,
          { timeout, maxBuffer, encoding: 'buffer', shell: false, windowsHide: true, killSignal: 'SIGKILL', env: gitEnvironment(), cwd: dir },
          (error, stdout, stderr) => {
            settled = true;
            if (child) oneShots.delete(child);
            if (error === null) return resolve({ ok: true, stdout });
            const text = stderr.toString('latin1').slice(0, 2048);
            if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return resolve({ ok: false, kind: 'too-large', stderr: '' });
            if (error.killed === true) return resolve({ ok: false, kind: 'timeout', stderr: '' });
            const missing = /Not a valid object name|bad file|unable to read/.test(text);
            return resolve({ ok: false, kind: missing ? 'missing-object' : 'failed', stderr: text });
          },
        );
        if (child && !settled) oneShots.add(child);
        child?.stdin?.end();
      });
    } catch {
      return { ok: false, kind: 'failed', stderr: '' };
    } finally {
      release();
    }
  };

  const text = (outcome: RunOutcome): string | null => (outcome.ok ? outcome.stdout.toString('utf8').replace(/\r?\n$/, '') : null);

  // ---- blob reads: one persistent `git cat-file --batch`, strictly one request in flight ----
  //
  // Requests are written and answered in arrival order. Anything unexpected (framing error, early exit,
  // stream error, timeout) kills the child, answers the request `unavailable` and leaves later requests
  // for a fresh child. A header larger than the request's limit, or a non-blob, kills the child before
  // its body is read, so an oversized object is never buffered.

  let batch: BatchChild | null = null;
  const queue: BlobRequest[] = [];
  const retiring = new Set<BatchChild>();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let pumping = false;

  const disarmIdle = () => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = null;
  };

  const killChild = (target: BatchChild) => {
    try {
      target.child.kill('SIGKILL');
    } catch {
      // already gone
    }
  };

  /** Stop using a child. Gracefully: close its input and let it exit; otherwise kill it now. */
  const retire = (target: BatchChild, graceful: boolean): void => {
    if (target.retired) return;
    target.retired = true;
    if (batch === target) batch = null;
    if (target.timer !== null) clearTimeout(target.timer);
    target.timer = null;
    if (target.exited) return;
    retiring.add(target);
    if (!graceful) return killChild(target);
    try {
      target.child.stdin.end();
    } catch {
      // the kill below still applies
    }
    target.killer = setTimeout(() => {
      target.killer = null;
      killChild(target);
    }, BATCH_EXIT_GRACE_MS);
  };

  /** Answer the in-flight request, if any, and keep the child. */
  const answer = (target: BatchChild, result: SourceResult<Uint8Array>): void => {
    const request = target.request;
    target.request = null;
    target.chunks = [];
    target.length = 0;
    target.frame = null;
    if (target.timer !== null) clearTimeout(target.timer);
    target.timer = null;
    request?.resolve(result);
  };

  /** Answer the in-flight request and throw the child away; the next read starts a fresh one. */
  const abandon = (target: BatchChild, result: SourceResult<Uint8Array>): void => {
    retire(target, false);
    answer(target, result);
    pump();
  };

  const collapse = (target: BatchChild): Buffer => {
    const first = target.chunks[0];
    const data = target.chunks.length === 1 && first !== undefined ? first : Buffer.concat(target.chunks, target.length);
    target.chunks = [data];
    return data;
  };

  const onData = (target: BatchChild, chunk: Buffer): void => {
    if (target.retired) return;
    const request = target.request;
    if (request === null) return abandon(target, refuse('unavailable')); // output nobody asked for
    target.chunks.push(chunk);
    target.length += chunk.length;
    if (target.frame === null) {
      const data = collapse(target);
      const eol = data.indexOf(0x0a);
      if (eol < 0 || eol > BATCH_HEADER_LIMIT) {
        if (data.length > BATCH_HEADER_LIMIT) abandon(target, refuse('unavailable'));
        return;
      }
      const line = data.toString('latin1', 0, eol);
      if (line === `${request.oid} missing`) {
        if (data.length !== eol + 1) return abandon(target, refuse('unavailable'));
        answer(target, refuse('not-found'));
        return pump();
      }
      const header = BATCH_HEADER.exec(line);
      if (header === null || header[1] !== request.oid) return abandon(target, refuse('unavailable'));
      if (header[2] !== 'blob') return abandon(target, refuse('not-found'));
      const size = Number(header[3]);
      if (size > request.limit) return abandon(target, refuse('too-large'));
      target.frame = { start: eol + 1, size };
    }
    const { start, size } = target.frame;
    const end = start + size + 1; // the object, then one line feed
    if (target.length > end) return abandon(target, refuse('unavailable'));
    if (target.length < end) return;
    const data = collapse(target);
    if (data[end - 1] !== 0x0a) return abandon(target, refuse('unavailable'));
    answer(target, { ok: true, value: new Uint8Array(data.buffer, data.byteOffset + start, size) });
    pump();
  };

  const launch = (dir: string): BatchChild | null => {
    const argv = [`--git-dir=${dir}`, '--no-replace-objects', '--literal-pathspecs', '-c', 'core.fsmonitor=false', 'cat-file', '--batch'];
    let child: GitBatchChild;
    try {
      child = spawn(gitExecutable, argv, { stdio: ['pipe', 'pipe', 'ignore'], shell: false, windowsHide: true, env: gitEnvironment(), cwd: dir });
    } catch {
      return null;
    }
    let markGone!: () => void;
    const gone = new Promise<void>((resolve) => (markGone = resolve));
    const target: BatchChild = { child, dir, request: null, chunks: [], length: 0, frame: null, timer: null, retired: false, exited: false, killer: null, gone, markGone };
    const failed = () => {
      if (!target.retired) abandon(target, refuse('unavailable'));
    };
    const exited = () => {
      target.exited = true;
      if (target.killer !== null) clearTimeout(target.killer);
      target.killer = null;
      retiring.delete(target);
      failed(); // an exit nobody asked for; retired children are already handled
      target.markGone();
    };
    child.stdout.on('data', (chunk) => onData(target, chunk));
    child.stdout.on('error', failed);
    child.stdin.on('error', failed);
    child.on('error', exited);
    child.on('close', exited);
    return target;
  };

  const begin = (target: BatchChild, request: BlobRequest): void => {
    target.request = request;
    target.timer = setTimeout(() => {
      target.timer = null;
      if (target.request === request) abandon(target, refuse('unavailable'));
    }, blobTimeout);
    try {
      target.child.stdin.write(`${request.oid}\n`);
    } catch {
      abandon(target, refuse('unavailable'));
    }
  };

  const armIdle = () => {
    if (idleTimer !== null || batch === null || closed) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (batch !== null && batch.request === null && queue.length === 0) retire(batch, true);
    }, idleTimeout);
  };

  /** Start queued requests, oldest first, one at a time. Re-entrant calls return at once. */
  const pump = (): void => {
    if (pumping) return;
    pumping = true;
    try {
      while (!closed && (batch === null || batch.request === null)) {
        const next = queue[0];
        if (next === undefined) return armIdle();
        if (next.dir === undefined) return; // its real path is still being resolved; it calls pump when done
        queue.shift();
        disarmIdle();
        if (next.dir === null) {
          next.resolve(refuse('unavailable'));
          continue;
        }
        if (batch !== null && batch.dir !== next.dir) retire(batch, false); // the real path changed: never reuse the old child
        batch ??= launch(next.dir);
        if (batch === null) next.resolve(refuse('unavailable'));
        else begin(batch, next);
      }
    } finally {
      pumping = false;
    }
  };

  const readThroughBatch = (oid: string, limit: number): Promise<SourceResult<Uint8Array>> =>
    new Promise((resolve) => {
      const request: BlobRequest = { oid, limit, dir: undefined, resolve };
      queue.push(request);
      void resolveGitDir().then((dir) => {
        request.dir = dir;
        pump();
      });
    });

  const close = async (): Promise<void> => {
    closed = true;
    disarmIdle();
    for (const request of queue.splice(0)) request.resolve(refuse('unavailable'));
    if (batch !== null) {
      const target = batch;
      retire(target, false);
      answer(target, refuse('unavailable'));
    }
    for (const child of oneShots) {
      try {
        child.kill?.('SIGKILL');
      } catch {
        // already gone
      }
    }
    // A fake child may never report that it closed; do not wait for it forever.
    const grace = new Promise<void>((resolve) => setTimeout(resolve, BATCH_EXIT_GRACE_MS).unref());
    await Promise.race([Promise.all([...retiring].map((target) => target.gone)), grace]);
  };

  return {
    close,

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

    readBlob(oid: string, maxBytes: number): Promise<SourceResult<Uint8Array>> {
      if (closed || !OBJECT_ID.test(oid) || !Number.isInteger(maxBytes) || maxBytes < 0) return Promise.resolve(refuse('unavailable'));
      return readThroughBatch(oid, Math.min(maxBytes, MAX_PAGE_BLOB_BYTES));
    },
  };
}
