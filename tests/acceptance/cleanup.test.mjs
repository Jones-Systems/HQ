import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const directory = dirname(fileURLToPath(import.meta.url));
test('owned profiles and child processes disappear on success, failure and signals; peers survive', async () => {
  const parent = resolve(directory, '../../.t3/acceptance-self-test');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'test-'));
  const active = new Set();
  async function fixture(mode) {
    const child = spawn(process.execPath, [join(directory, 'cleanup-fixture.mjs'), root, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
    active.add(child);
    const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code)); });
    let output = '';
    const identity = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('fixture readiness timeout')), 10000);
      child.stdout.on('data', data => {
        output += data;
        if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output.split('\n')[0])); }
      });
    });
    return { child, done, ...identity };
  }
  async function gone(instance, code) {
    assert.equal(await instance.done, code);
    active.delete(instance.child);
    await assert.rejects(access(instance.root), { code: 'ENOENT' });
    assert.throws(() => process.kill(instance.pid, 0), { code: 'ESRCH' });
  }
  try {
    const peer = await fixture('signal');
    await gone(await fixture('success'), 0);
    await access(peer.root);
    process.kill(peer.pid, 0);
    await gone(await fixture('failure'), 7);
    const interrupted = await fixture('signal');
    interrupted.child.kill('SIGINT');
    await gone(interrupted, 0);
    peer.child.kill('SIGTERM');
    await gone(peer, 0);
  } finally {
    for (const child of active) child.kill('SIGTERM');
    await Promise.all([...active].map(child => child.exitCode !== null ? undefined : new Promise(resolve => child.once('exit', resolve))));
    await rm(root, { recursive: true, force: true });
  }
});
