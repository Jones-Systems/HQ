import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createProcessTracker } from '../processes.ts';
import { createScratch, withScratch } from './scratch.ts';

test('success and deliberate failure remove their exact synthetic roots', async () => {
  let success = '';
  assert.equal(await withScratch('success', (root) => { success = root; return 7; }), 7);
  assert.equal(existsSync(success), false);
  let failure = '';
  const original = new Error('deliberate synthetic failure');
  await assert.rejects(withScratch('failure', (root) => { failure = root; throw original; }), (error) => error === original);
  assert.equal(existsSync(failure), false);
});

test('independent roots cannot remove each other', async () => {
  const first = createScratch('first');
  const second = createScratch('second');
  try {
    await first.cleanup();
    assert.equal(existsSync(first.root), false);
    assert.equal(existsSync(second.root), true);
  } finally { await Promise.all([first.cleanup(), second.cleanup()]); }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  test(`${signal} closes the fixture child before removing scratch`, { timeout: 10_000 }, async (t) => {
    const owner = createProcessTracker();
    const child = spawn(process.execPath, [join(import.meta.dirname, 'scratch-child.ts')], { stdio: ['ignore', 'pipe', 'pipe'] });
    owner.observe(child, 'oneShot');
    t.after(() => owner.close());
    const lines = createInterface({ input: child.stdout });
    t.after(() => lines.close());
    const closed = once(child, 'close');
    const line = await Promise.race([
      once(lines, 'line').then(([line]) => line as string),
      closed.then(() => { throw new Error('synthetic fixture exited before ready'); }),
    ]);
    const state = JSON.parse(line) as { root: string; pid: number };
    assert.equal(existsSync(state.root), true);
    child.kill(signal);
    const [code] = await closed;
    assert.equal(code, signal === 'SIGINT' ? 130 : 143);
    assert.equal(existsSync(state.root), false);
    assert.throws(() => process.kill(state.pid, 0), { code: 'ESRCH' });
  });
}
