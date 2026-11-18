/** Synthetic-only constructors. No production module imports this file. */
import { openFileStore } from '../../../../../packages/design-store/src/open.ts';
import { nodeFs, type StoreFs } from '../../../../../packages/design-store/src/fs.ts';
import { bindDesignStorage } from '../node.ts';
import { createTransactionRuntime } from '../transactions.ts';
import { createDesignExport } from '../design-export.ts';
import { fakeClock } from './helpers.ts';

export async function engineAt(root: string, fs: StoreFs = nodeFs) {
  const { store } = await openFileStore({ root, schemaVersion: 1, clock: fakeClock(), fs });
  const production = await bindDesignStorage(store);
  const runtime = await createTransactionRuntime(store, true);
  await runtime.initialize();
  return { store, production, runtime, transactions: runtime.port, exportBundle: createDesignExport(runtime, true), close: () => store.close() };
}

export class TestCrash extends Error {}
/** Counts reads and mutations; once crashed, all subsequent calls fail until disarmed. */
export function allCallFs() {
  let at = -1, count = 0, armed = false, crashed = false, torn = false;
  const trace: string[] = [];
  const call = async <T>(name: string, run: () => Promise<T>, tear?: () => Promise<unknown>): Promise<T> => {
    if (crashed) throw new TestCrash('Process terminated');
    if (armed) {
      const i = count++; trace.push(name);
      if (i === at) { crashed = true; if (torn && tear) await tear(); throw new TestCrash(`Crash ${i}: ${name}`); }
    }
    return run();
  };
  const fs: StoreFs = {
    readFile: p => call('readFile', () => nodeFs.readFile(p)),
    readdir: p => call('readdir', () => nodeFs.readdir(p)),
    stat: p => call('stat', () => nodeFs.stat(p)),
    mkdir: p => call('mkdir', () => nodeFs.mkdir(p)),
    writeNew: (p, b) => call('writeNew', () => nodeFs.writeNew(p, b), () => nodeFs.writeNew(p, b.subarray(0, Math.floor(b.length / 2)))),
    append: (p, b) => call('append', () => nodeFs.append(p, b), () => nodeFs.append(p, b.subarray(0, Math.max(1, Math.floor(b.length / 2))))),
    fsyncFile: p => call('fsyncFile', () => nodeFs.fsyncFile(p)),
    fsyncDir: p => call('fsyncDir', () => nodeFs.fsyncDir(p)),
    rename: (a, b) => call('rename', () => nodeFs.rename(a, b)),
    link: (a, b) => call('link', () => nodeFs.link(a, b)),
    unlink: p => call('unlink', () => nodeFs.unlink(p)),
    rmdir: p => call('rmdir', () => nodeFs.rmdir(p)),
  };
  return { fs, trace, get count() { return count; }, get crashed() { return crashed; },
    arm(index = -1, tear = false) { at = index; torn = tear; count = 0; armed = true; trace.length = 0; },
    disarm() { armed = false; crashed = false; },
  };
}
