// Synthetic handled-signal fixture; paths and pid travel only to its parent test.
import { once } from 'node:events';
import { createProcessTracker } from '../processes.ts';
import { createScratch } from './scratch.ts';

const scratch = createScratch('signal');
const owner = createProcessTracker();
const child = owner.options.spawn!(process.execPath, ['-e', 'process.stdin.resume()'], {
  cwd: scratch.root, env: {}, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
});
await once(child as unknown as NodeJS.EventEmitter, 'spawn');
process.stdout.write(`${JSON.stringify({ root: scratch.root, pid: (child as unknown as { pid: number }).pid })}\n`);
