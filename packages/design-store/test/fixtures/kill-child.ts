/**
 * Child process for test/kill.test.ts. Opens the store, then pauses before the Nth mutating
 * filesystem call of the scenario so the parent can SIGKILL it at that exact stage.
 * Prints `PAUSED` when parked, or `DONE` when the scenario finished without reaching N.
 */
import { nodeFs, type StoreFs } from '../../src/fs.ts';
import { documentKey, namespaceId, streamId } from '../../src/ids.ts';
import { openFileStore } from '../../src/open.ts';

const [root = '', scenario = '', pauseText = '-1'] = process.argv.slice(2);
const pauseAt = Number(pauseText);
let armed = false;
let calls = 0;

async function gate(): Promise<void> {
  if (!armed) return;
  const index = calls;
  calls += 1;
  if (index === pauseAt) {
    process.stdout.write('PAUSED\n');
    setInterval(() => undefined, 60_000);
    await new Promise<never>(() => undefined);
  }
}

const pausing: StoreFs = {
  ...nodeFs,
  mkdir: async (path) => { await gate(); return nodeFs.mkdir(path); },
  writeNew: async (path, data) => { await gate(); return nodeFs.writeNew(path, data); },
  append: async (path, data) => { await gate(); return nodeFs.append(path, data); },
  fsyncFile: async (path) => { await gate(); return nodeFs.fsyncFile(path); },
  fsyncDir: async (path) => { await gate(); return nodeFs.fsyncDir(path); },
  rename: async (from, to) => { await gate(); return nodeFs.rename(from, to); },
  link: async (existing, path) => { await gate(); return nodeFs.link(existing, path); },
  unlink: async (path) => { await gate(); return nodeFs.unlink(path); },
  rmdir: async (path) => { await gate(); return nodeFs.rmdir(path); },
};

const workspace = namespaceId('workspace');
const { store } = await openFileStore({ root, schemaVersion: 1, fs: pausing });
armed = true;
if (scenario === 'put') {
  await store.putDocument(workspace, documentKey('draft'), { body: 'new text' });
} else if (scenario === 'commit') {
  await store.commit([
    { op: 'put', namespace: workspace, key: documentKey('draft'), value: { body: 'new text', consumed: true } },
    { op: 'put', namespace: workspace, key: documentKey('packet'), value: { frozen: true } },
    { op: 'delete', namespace: workspace, key: documentKey('scratch') },
  ]);
} else if (scenario === 'append') {
  await store.appendEvent(workspace, streamId('decisions'), { type: 'accepted', payload: { candidate: 'c2' } });
} else {
  throw new Error(`unknown scenario ${scenario}`);
}
armed = false;
await store.close();
process.stdout.write('DONE\n');
