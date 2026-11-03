import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { constants, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

/**
 * Starts a local Fieldnotes (the private Social workspace service) for the compatibility check. It binds
 * 127.0.0.1 only, keeps its data in a temporary directory and never reads the checkout's own data.
 */

export interface FieldnotesEnvironment {
  /** A local checkout of the service's repository. */
  readonly root: string;
  readonly python: string;
}

const READY_MS = 20_000;
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** Reads and checks the opt-in variables. The message says what to set, so a missing one fails fast. */
export function readEnvironment(env: NodeJS.ProcessEnv = process.env): FieldnotesEnvironment {
  const given = env.HQ_FIELDNOTES_ROOT?.trim();
  if (!given) {
    throw new Error('HQ_FIELDNOTES_ROOT is not set. This check is opt-in: point it at a local checkout of the Fieldnotes repository, '
      + 'for example `HQ_FIELDNOTES_ROOT=/path/to/growth-intel node_modules/.bin/vitest run --config tools/social-compat/vitest.config.ts`. '
      + 'HQ_FIELDNOTES_PYTHON optionally names the Python (3.13) interpreter; the default is python3.');
  }
  const root = resolve(given);
  if (!existsSync(join(root, 'apps', 'social_dashboard', '__main__.py'))) {
    throw new Error(`HQ_FIELDNOTES_ROOT=${root} has no apps/social_dashboard/__main__.py; it must be a Fieldnotes repository checkout.`);
  }
  const python = env.HQ_FIELDNOTES_PYTHON?.trim() || 'python3';
  try {
    execFileSync(python, ['--version'], { stdio: 'ignore' });
  } catch {
    throw new Error(`Python interpreter "${python}" could not run. Install Python 3.13 or set HQ_FIELDNOTES_PYTHON.`);
  }
  return { root, python };
}

/** The checkout's HEAD commit, or "unknown" when git cannot say. */
export async function revisionOf(root: string): Promise<string> {
  try {
    return (await promisify(execFile)('git', ['-C', root, 'rev-parse', 'HEAD'])).stdout.trim();
  } catch {
    return 'unknown';
  }
}

function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => resolvePort(port));
    });
  });
}

const instances = new Set<FieldnotesInstance>();
let handlersInstalled = false;

/** Kill every instance and remove its directory on normal exit and on SIGINT, SIGTERM and SIGHUP. */
function installCleanup(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on('exit', () => { for (const instance of instances) instance.kill(); });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(signal, () => {
      for (const instance of instances) instance.kill();
      process.exit(128 + constants.signals[signal]);
    });
  }
}

export class FieldnotesInstance {
  private child: ChildProcess | undefined;
  private exited = false;
  private output = '';

  private constructor(
    private readonly environment: FieldnotesEnvironment,
    readonly port: number,
    private readonly scratch: string,
    private readonly dataDir: string,
  ) {}

  /** The loopback origin. A restart keeps it, so the desktop's cached token origin stays the same. */
  get url(): URL { return new URL(`http://127.0.0.1:${this.port}/`); }

  static async create(environment: FieldnotesEnvironment): Promise<FieldnotesInstance> {
    installCleanup();
    const scratch = await mkdtemp(join(tmpdir(), 'hq-fieldnotes-compat-'));
    const dataDir = join(scratch, 'data');
    await mkdir(dataDir, { mode: 0o700 });
    const instance = new FieldnotesInstance(environment, await freePort(), scratch, dataDir);
    instances.add(instance);
    try {
      await instance.start();
    } catch (error) {
      await instance.dispose();
      throw error;
    }
    return instance;
  }

  /** Starts the service on the same port and data directory, then waits until it answers. */
  async start(): Promise<void> {
    const child = spawn(this.environment.python, ['-m', 'apps.social_dashboard', '--host', '127.0.0.1', '--port', String(this.port), '--data', this.dataDir], {
      cwd: this.environment.root,
      // Its own process group, so stopping it also stops a run worker it launched.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // No inherited environment: nothing is written under the real home, and no bytecode lands in the checkout.
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: this.scratch, TMPDIR: this.scratch, PYTHONDONTWRITEBYTECODE: '1' },
    });
    this.child = child;
    this.exited = false;
    this.output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk: Buffer) => { this.output = (this.output + chunk).slice(-2000); });
    child.once('exit', () => { this.exited = true; });
    child.once('error', (error) => { this.exited = true; this.output += String(error); });
    const deadline = Date.now() + READY_MS;
    while (Date.now() < deadline) {
      if (this.exited) throw new Error(`Fieldnotes exited before it was ready:\n${this.output}`);
      if (await this.answers()) return;
      await sleep(100);
    }
    throw new Error(`Fieldnotes did not answer within ${READY_MS} ms:\n${this.output}`);
  }

  private async answers(): Promise<boolean> {
    try {
      return (await fetch(new URL('api/workspace', this.url), { signal: AbortSignal.timeout(1000) })).ok;
    } catch {
      return false;
    }
  }

  async stop(): Promise<void> {
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    if (!this.exited) {
      const finished = once(child, 'exit');
      this.signal(child, 'SIGTERM');
      const forced = setTimeout(() => this.signal(child, 'SIGKILL'), 5000);
      await finished;
      clearTimeout(forced);
    }
    this.signal(child, 'SIGKILL'); // sweep a straggling run worker
  }

  /** Stops and starts the service on the same port and data, so queued and running work is interrupted. */
  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  async dispose(): Promise<void> {
    await this.stop();
    instances.delete(this);
    rmSync(this.scratch, { recursive: true, force: true });
  }

  /** Synchronous teardown for exit and signal handlers. */
  kill(): void {
    if (this.child) this.signal(this.child, 'SIGKILL');
    rmSync(this.scratch, { recursive: true, force: true });
  }

  private signal(child: ChildProcess, signal: NodeJS.Signals): void {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); } catch { /* the group is already gone */ }
  }
}
