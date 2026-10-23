import type { FileStat, StoreFs } from './fs.ts';

/**
 * LABELLED TEST FAKE — fault-injecting and recording wrapper around a real StoreFs.
 * It models a process kill: completed calls stay visible, the crashing call either does
 * nothing or (with `tear`) writes only a prefix, and every later call fails.
 * It does not model power loss of unsynced data; fsync ordering is checked from the trace.
 */
export const FAULT_FS_LABEL = 'fake:fault-injecting-fs';

export type MutatingOp = 'mkdir' | 'writeNew' | 'append' | 'fsyncFile' | 'fsyncDir' | 'rename' | 'link' | 'unlink' | 'rmdir';

export interface TraceEntry {
  readonly index: number;
  readonly op: MutatingOp;
  readonly path: string;
  readonly to?: string;
}

export interface FaultPlan {
  /** Zero-based index of the mutating call that crashes. Omit to only record. */
  readonly crashAt?: number;
  /** For a crashing write/append, persist the first half of the bytes first. */
  readonly tear?: boolean;
}

export class SimulatedCrash extends Error {
  readonly atIndex: number;

  constructor(atIndex: number) {
    super(`Simulated crash at mutating call ${atIndex}`);
    this.name = 'SimulatedCrash';
    this.atIndex = atIndex;
  }
}

export interface FaultInjectingFs extends StoreFs {
  readonly label: typeof FAULT_FS_LABEL;
  readonly trace: readonly TraceEntry[];
  readonly crashed: boolean;
  readonly mutatingCalls: number;
}

export function createFaultInjectingFs(inner: StoreFs, plan: FaultPlan = {}): FaultInjectingFs {
  const trace: TraceEntry[] = [];
  let crashed = false;
  let counter = 0;

  const alive = (): void => {
    if (crashed) throw new SimulatedCrash(plan.crashAt ?? -1);
  };

  async function mutate(op: MutatingOp, path: string, run: () => Promise<void>, tear?: () => Promise<void>, to?: string): Promise<void> {
    alive();
    const index = counter;
    counter += 1;
    if (plan.crashAt === index) {
      crashed = true;
      if (plan.tear && tear) await tear();
      throw new SimulatedCrash(index);
    }
    await run();
    trace.push(to === undefined ? { index, op, path } : { index, op, path, to });
  }

  return {
    label: FAULT_FS_LABEL,
    get trace() {
      return trace;
    },
    get crashed() {
      return crashed;
    },
    get mutatingCalls() {
      return counter;
    },
    async readFile(path) {
      alive();
      return inner.readFile(path);
    },
    async readdir(path) {
      alive();
      return inner.readdir(path);
    },
    async stat(path): Promise<FileStat | null> {
      alive();
      return inner.stat(path);
    },
    mkdir: (path) => mutate('mkdir', path, () => inner.mkdir(path)),
    writeNew: (path, data) => mutate('writeNew', path, () => inner.writeNew(path, data),
      () => inner.writeNew(path, data.subarray(0, Math.floor(data.length / 2)))),
    append: (path, data) => mutate('append', path, () => inner.append(path, data),
      () => inner.append(path, data.subarray(0, Math.max(1, Math.floor(data.length / 2))))),
    fsyncFile: (path) => mutate('fsyncFile', path, () => inner.fsyncFile(path)),
    async fsyncDir(path) {
      let supported = true;
      await mutate('fsyncDir', path, async () => {
        supported = await inner.fsyncDir(path);
      });
      return supported;
    },
    rename: (from, to) => mutate('rename', from, () => inner.rename(from, to), undefined, to),
    link: (existing, path) => mutate('link', existing, () => inner.link(existing, path), undefined, path),
    unlink: (path) => mutate('unlink', path, () => inner.unlink(path)),
    rmdir: (path) => mutate('rmdir', path, () => inner.rmdir(path)),
  };
}
