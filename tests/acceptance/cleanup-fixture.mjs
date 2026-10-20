import { createRuntime } from './runtime.mjs';
const runtime = await createRuntime(process.argv[2]);
let finish;
const gate = new Promise(resolve => { finish = resolve; });
process.once('SIGTERM', () => finish());
process.once('SIGINT', () => finish());
try {
  const child = runtime.spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  console.log(JSON.stringify({ root: runtime.root, pid: child.pid }));
  if (process.argv[3] === 'failure') throw new Error('deliberate fixture failure');
  if (process.argv[3] === 'signal') await gate;
} catch (error) {
  console.error(error.message);
  process.exitCode = 7;
} finally {
  await runtime.close();
}
