import { spawn } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const plannerRoot = resolve(here, '../../../../services/planner');
// `seed(dataPath)` may prepare the store before the service opens it.
export async function withService(action, { seed } = {}) {
  const root = await mkdtemp(resolve(here, '.scratch-'));
  let child, cleanupPromise, primaryError, stopping = false, crashed, errors = '';
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  const cleanup = () => cleanupPromise ??= (async () => {
    stopping = true;
    if (child?.pid && !exited()) {
      await new Promise((done, reject) => {
        const force = setTimeout(() => child.kill('SIGKILL'), 3000);
        child.once('close', () => { clearTimeout(force); done(); });
        child.once('error', error => { clearTimeout(force); reject(error); });
        child.kill('SIGTERM');
      });
    }
    await rm(root, { recursive: true, force: true });
    await access(root).then(() => { throw Error('Owned scratch survived cleanup'); }, error => { if (error.code !== 'ENOENT') throw error; });
  })();
  const interrupt = () => { void cleanup().then(() => process.exit(130), () => process.exit(1)); };
  const terminate = () => { void cleanup().then(() => process.exit(143), () => process.exit(1)); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    const data = resolve(root, 'p.sqlite3');
    if (seed) await seed(data);
    child = spawn('python3', ['-m', 'planning', '--data', data, '--port', '0'], { cwd: plannerRoot, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
    const origin = await new Promise((done, reject) => {
      let output = '';
      const settle = (fn, value) => { clearTimeout(timer); child.off('error', onError); child.off('exit', onExit); child.stdout.off('data', onData); fn(value); };
      const timer = setTimeout(() => settle(reject, Error(`Synthetic Planner startup timed out: ${errors}`)), 10000);
      const onError = error => settle(reject, error);
      const onExit = code => settle(reject, Error(`Synthetic Planner exited ${code}: ${errors}`));
      const onData = chunk => {
        output = (output + chunk).slice(-4000);
        const match = /Planning hub on (http:\/\/127\.0\.0\.1:(\d+))\//.exec(output);
        if (match && Number(match[2]) > 0) settle(done, match[1]);
      };
      child.once('error', onError); child.once('exit', onExit); child.stdout.on('data', onData);
    });
    child.stdout.resume(); // keep draining after startup so the pipe never blocks
    child.on('error', error => { crashed ??= error; });
    const lost = new Promise(done => child.once('exit', (code, signal) => {
      if (!stopping) crashed = Error(`Synthetic Planner exited unexpectedly (${signal ?? code}): ${errors}`);
      done();
    }));
    let value;
    try { value = await action({ origin, root, pid: child.pid }); }
    catch (error) {
      // A crash usually surfaces first as a refused request; give its exit a moment to land.
      if (!exited()) await Promise.race([lost, new Promise(done => setTimeout(done, 1000).unref())]);
      throw crashed && crashed !== error ? new AggregateError([error, crashed], `${error.message}; ${crashed.message}`) : error;
    }
    if (crashed) throw crashed;
    return value;
  } catch (error) { primaryError = error; throw error; } finally {
    try { await cleanup(); }
    catch (error) { if (primaryError) throw new AggregateError([primaryError, error], `${primaryError.message}; cleanup also failed: ${error.message}`); throw error; }
    finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
  }
}
