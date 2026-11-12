// Match the acceptance runner's Darwin/Linux routes without modifying its stack.
import { join } from 'node:path';
import { until } from '../../tests/acceptance/runtime.mjs';

export function createLauncher(runtime, repo, env, platform = process.platform) {
  if (!['darwin', 'linux'].includes(platform)) throw new Error(`Unsupported preview platform: ${platform}`);
  if (platform === 'darwin') {
    env.TMPDIR = join(runtime.root, 'tmp');
    delete env.DISPLAY;
    // createRuntime owns detached process groups and closes all owned children.
    return (command, args, options = {}) => runtime.spawn(command, args, { cwd: repo, env, ...options });
  }
  return (command, args, options = {}) => runtime.spawn('bwrap', [
    '--die-with-parent', '--unshare-user', '--unshare-pid', '--bind', '/', '/',
    '--bind', join(runtime.root, 'tmp'), '/tmp', '--bind', repo, repo,
    '--proc', '/proc', '--dev', '/dev', command, ...args,
  ], { cwd: repo, env, ...options });
}

export async function startDisplay(wrapped, env, size, platform = process.platform) {
  if (platform === 'darwin') return;
  if (platform !== 'linux') throw new Error(`Unsupported preview platform: ${platform}`);
  let display = '';
  let log = '';
  const child = wrapped('Xvfb', ['-displayfd', '3', '-screen', '0',
    `${Math.max(1920, size.width)}x${Math.max(1200, size.height)}x24`, '-nolisten', 'tcp'],
  { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', data => { log = (log + data).slice(-4000); });
  child.stdio[3].on('data', data => { display += data; });
  await until(() => {
    if (child.exitCode !== null || child.launchError) throw new Error(`Xvfb failed to start under bubblewrap: ${log}`);
    return /^\d+\s*$/.test(display);
  }, 'Xvfb display', 20_000);
  env.DISPLAY = `:${display.trim()}`;
}
