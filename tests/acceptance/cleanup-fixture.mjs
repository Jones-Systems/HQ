import { createServer } from 'node:http';
import { createRuntime } from './runtime.mjs';
let finish;
const gate = new Promise(resolve => { finish = resolve; });
process.once('SIGTERM', () => finish());
process.once('SIGINT', () => finish());
const runtime = await createRuntime(process.argv[2]);
try {
  const child = runtime.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const origin = await runtime.listen(createServer((_req, res) => res.end('owned')));
  if (['cleanup-failure', 'cleanup-only'].includes(process.argv[3])) runtime.own('deliberate cleanup failure', () => { throw new Error('cleanup failed'); });
  console.log(JSON.stringify({ root: runtime.root, pid: child.pid, origin }));
  if (process.argv[3] === 'partial') {
    const missing = runtime.spawn('acceptance-no-such-executable', []);
    await missing.done;
    throw new Error('partial start failure');
  }
  if (process.argv[3] === 'failure' || process.argv[3] === 'cleanup-failure') throw new Error('deliberate fixture failure');
  if (process.argv[3] === 'signal') await gate;
} catch (error) {
  console.error(error.message);
  process.exitCode = 7;
} finally {
  try { await runtime.close(); } catch (error) { console.error(error.message); process.exitCode ||= 8; }
}
