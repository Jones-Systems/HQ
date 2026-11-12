import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Test-only: a disposable real Planner (services/planner) on loopback, its SQLite file under the OS temporary
// directory and never the checkout. Every test that starts one owns it and calls `dispose()`.

const SERVICE_DIR = fileURLToPath(new URL('../../../../services/planner/', import.meta.url));
const STARTUP_MS = 10_000;
const GRACE_MS = 2_000;
const BANNER = /Planning hub on (http:\/\/\S+?\/)(?:\s|$)/;

export interface PlannerOptions {
  /** Loopback address to bind. Default `127.0.0.1`. */
  host?: string;
  /** Port to bind. Default 0: an available port, kept for every later `start()` on the same data. */
  port?: number;
  /** Extra `Host` header values the Planner accepts (`--allowed-host`). */
  allowedHosts?: string[];
  /** An existing directory under the OS temporary directory that the Planner owns from now on; `dispose()` removes it. */
  root?: string;
}

export interface TestPlanner {
  readonly url: URL;
  readonly port: number;
  readonly root: string;
  readonly dataPath: string;
  /** SIGTERM, then SIGKILL after a short grace; resolves once the process has exited. A stopped Planner keeps its data. */
  stop(): Promise<void>;
  /** Starts again on the same data and the same port. */
  start(): Promise<void>;
  /** Stops the Planner and removes exactly its root. Safe to call more than once. */
  dispose(): Promise<void>;
}

const running = new Set<ChildProcess>();
let guarded = false;
/** A crashed test process must not leave a Planner behind. */
function guard() {
  if (guarded) return;
  guarded = true;
  process.once('exit', () => { for (const child of running) child.kill('SIGKILL'); });
}

interface Started { child: ChildProcess; url: URL; exited: Promise<void> }

function launch(args: string[]): Promise<Started> {
  guard();
  return new Promise<Started>((resolveStart, rejectStart) => {
    const child = spawn('python3', ['-m', 'planning', ...args], {
      cwd: SERVICE_DIR, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    running.add(child);
    let out = ''; let err = ''; let settled = false;
    const exited = new Promise<void>(resolveExit => child.once('close', () => { running.delete(child); resolveExit(); }));
    const fail = (reason: string) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      void exited.then(() => rejectStart(new Error(`Planner ${reason}\nstderr: ${err.trim() || '(empty)'}`)));
    };
    const timer = setTimeout(() => fail(`did not start within ${STARTUP_MS} ms`), STARTUP_MS);
    child.stderr!.on('data', (chunk: Buffer) => { err += chunk; });
    child.stdout!.on('data', (chunk: Buffer) => {
      out += chunk;
      const match = BANNER.exec(out);
      if (match && !settled) { settled = true; clearTimeout(timer); resolveStart({ child, url: new URL(match[1]!), exited }); }
    });
    child.once('error', error => fail(`failed to spawn: ${error.message}`));
    child.once('exit', (code, signal) => fail(`exited before it was ready (${signal ?? `code ${code}`})`));
  });
}

async function ownRoot(root: string | undefined): Promise<string> {
  if (root === undefined) return mkdtemp(join(tmpdir(), 'hq-planner-'));
  const own = resolve(root);
  const bases = [resolve(tmpdir()), await realpath(tmpdir())];
  const under = bases.some(base => { const inside = relative(base, own); return inside !== '' && !inside.startsWith('..') && !isAbsolute(inside); });
  if (!under) throw new Error(`Planner root must be a directory under ${bases[0]}: ${root}`);
  await mkdir(own, { recursive: true });
  return own;
}

/** Starts a Planner on a fresh store and resolves once it prints its URL. Rejects with its stderr on failure. */
export async function startPlanner(options: PlannerOptions = {}): Promise<TestPlanner> {
  const host = options.host ?? '127.0.0.1';
  const root = await ownRoot(options.root);
  const dataPath = join(root, 'planning.sqlite3');
  let port = options.port ?? 0;
  let current: Started | null = null;
  let url!: URL;
  const argv = () => ['--data', dataPath, '--host', host, '--port', String(port), ...(options.allowedHosts ?? []).flatMap(h => ['--allowed-host', h])];

  async function start() {
    if (current) throw new Error('Planner is already running');
    const started = await launch(argv());
    current = started; url = started.url; port = Number(started.url.port);
  }
  let stopping: Promise<void> | null = null;
  function stop() {
    const started = current;
    if (!started) return stopping ?? Promise.resolve();
    current = null;
    const { child, exited } = started;
    child.kill('SIGTERM');
    const hard = setTimeout(() => child.kill('SIGKILL'), GRACE_MS);
    return stopping = exited.finally(() => { clearTimeout(hard); stopping = null; });
  }
  try { await start(); } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
  return {
    get url() { return url; },
    get port() { return port; },
    root, dataPath, start, stop,
    async dispose() { await stop(); await rm(root, { recursive: true, force: true }); },
  };
}
