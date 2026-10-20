import { spawn } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export async function withService(action) {
  const root = await mkdtemp(resolve(here, '.scratch-'));
  let child, cleanupPromise, primaryError;
  const cleanup = () => cleanupPromise ??= (async () => {
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
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
    child = spawn('python3', ['-m', 'planning', '--data', resolve(root, 'p.sqlite3'), '--port', '0'], { cwd: resolve(here, '../../../../services/planner'), env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const origin = await new Promise((done, reject) => {
      let output = '', errors = '';
      const timer = setTimeout(() => reject(Error('Synthetic Planner startup timed out')), 10000);
      child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(Error(`Synthetic Planner exited ${code}: ${errors}`)); });
      child.stdout.on('data', chunk => {
        output = (output + chunk).slice(-4000);
        const match = /Planning hub on (http:\/\/127\.0\.0\.1:(\d+))\//.exec(output);
        if (match && Number(match[2]) > 0) { clearTimeout(timer); done(match[1]); }
      });
    });
    return await action({ origin, root, pid: child.pid });
  } catch (error) { primaryError = error; throw error; } finally {
    try { await cleanup(); }
    catch (error) { if (primaryError) throw new AggregateError([primaryError, error], `${primaryError.message}; cleanup also failed: ${error.message}`); throw error; }
    finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate); }
  }
}
