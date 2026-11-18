// Observe only children created through this tool's adapter seams, including retired batch readers.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import type { NodeGitOptions } from '../src/index.ts';

const owners = new Set<ReturnType<typeof createProcessTracker>>();

export async function closeOwnedProcesses(): Promise<void> {
  await Promise.all([...owners].map((owner) => owner.close()));
}

export function createProcessTracker() {
  const pending = new Map<ChildProcess, Promise<void>>();
  const counts = { refresh: 0, sampling: 0, oneShot: 0, batch: 0, closed: 0, failedStarts: 0, active: 0 };
  let phase: 'refresh' | 'sampling' = 'refresh';
  let stopped = false;
  let closing: Promise<void> | undefined;

  function observe(child: ChildProcess, kind: 'oneShot' | 'batch'): void {
    const launchedIn = phase;
    let started = false;
    pending.set(child, new Promise<void>((resolve) => {
      child.once('spawn', () => {
        started = true;
        counts[launchedIn]++;
        counts[kind]++;
        counts.active++;
      });
      // An error alone does not prove stdio/process closure. Node emits close after failed spawn.
      child.once('close', () => {
        if (started) { counts.closed++; counts.active--; }
        else counts.failedStarts++;
        pending.delete(child);
        resolve();
      });
    }));
  }

  const options: NodeGitOptions = {
    exec(file, args, options, callback) {
      if (stopped) throw new Error('validation stopped');
      const child = execFile(file, args, options, callback);
      observe(child, 'oneShot');
      return child;
    },
    spawn(file, args, options) {
      if (stopped) throw new Error('validation stopped');
      const child = spawn(file, args, options);
      observe(child, 'batch');
      return child;
    },
  };
  const owner = {
    options,
    observe,
    sampling() { phase = 'sampling'; },
    figures() { return { ...counts }; },
    close(): Promise<void> {
      if (closing !== undefined) return closing;
      stopped = true;
      closing = (async () => {
        for (const child of pending.keys()) child.kill('SIGKILL');
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            Promise.all([...pending.values()]),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('validation cleanup incomplete')), 5000);
            }),
          ]);
          if (pending.size !== 0 || counts.active !== 0 || counts.closed !== counts.oneShot + counts.batch) {
            throw new Error('validation cleanup incomplete');
          }
          owners.delete(owner);
        } finally { clearTimeout(timer); }
      })();
      return closing;
    },
  };
  owners.add(owner);
  return owner;
}
