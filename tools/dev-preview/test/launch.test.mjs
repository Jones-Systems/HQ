import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createLauncher, startDisplay } from '../launch.mjs';

function fakeRuntime() {
  const calls = [];
  return { root: '/synthetic/preview', calls,
    spawn(...args) { calls.push(args); return { owned: true }; } };
}

test('Darwin delegates directly to the owned runtime with isolated temp and no DISPLAY', async () => {
  const runtime = fakeRuntime();
  const env = { HOME: '/synthetic/home', DISPLAY: ':99' };
  const spawn = createLauncher(runtime, '/synthetic/repo', env, 'darwin');
  assert.equal(env.TMPDIR, '/synthetic/preview/tmp');
  assert.equal(Object.hasOwn(env, 'DISPLAY'), false);
  await startDisplay(spawn, env, { width: 760, height: 560 }, 'darwin');
  assert.equal(runtime.calls.length, 0);
  const args = ['main.js', '--remote-debugging-port=0'];
  assert.deepEqual(spawn('Electron', args), { owned: true });
  assert.deepEqual(runtime.calls[0], ['Electron', args, { cwd: '/synthetic/repo', env }]);
  spawn('python3', ['-m', 'planning'], { cwd: '/synthetic/planner', env: { SYNTHETIC: '1' } });
  assert.deepEqual(runtime.calls[1][2], { cwd: '/synthetic/planner', env: { SYNTHETIC: '1' } });
});

test('Linux retains bubblewrap isolation and caller spawn options', () => {
  const runtime = fakeRuntime();
  const env = {};
  const spawn = createLauncher(runtime, '/synthetic/repo', env, 'linux');
  spawn('electron', ['main.js'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const [command, args, options] = runtime.calls[0];
  assert.equal(command, 'bwrap');
  assert.deepEqual(args, ['--die-with-parent', '--unshare-user', '--unshare-pid',
    '--bind', '/', '/', '--bind', '/synthetic/preview/tmp', '/tmp',
    '--bind', '/synthetic/repo', '/synthetic/repo', '--proc', '/proc', '--dev', '/dev', 'electron', 'main.js']);
  assert.deepEqual(options, { cwd: '/synthetic/repo', env, stdio: ['ignore', 'ignore', 'pipe'] });
});

test('Linux display startup waits for the display-fd result', async () => {
  const env = {};
  let call;
  await startDisplay((...args) => {
    call = args;
    const pipe = new EventEmitter();
    queueMicrotask(() => pipe.emit('data', '7\n'));
    return { exitCode: null, stderr: new EventEmitter(), stdio: [null, null, null, pipe] };
  }, env, { width: 2100, height: 1300 }, 'linux');
  assert.equal(call[0], 'Xvfb');
  assert.deepEqual(call[1], ['-displayfd', '3', '-screen', '0', '2100x1300x24', '-nolisten', 'tcp']);
  assert.equal(env.DISPLAY, ':7');
});

test('unsupported platforms and failed displays refuse before application launch', async () => {
  assert.throws(() => createLauncher(fakeRuntime(), '/synthetic/repo', {}, 'win32'), /Unsupported/);
  await assert.rejects(startDisplay(() => { throw new Error('must not spawn'); }, {}, {}, 'win32'), /Unsupported/);
  await assert.rejects(startDisplay(() => ({ exitCode: 1, stderr: new EventEmitter(),
    stdio: [null, null, null, new EventEmitter()] }), {}, { width: 1, height: 1 }, 'linux'), /Xvfb failed/);
});
