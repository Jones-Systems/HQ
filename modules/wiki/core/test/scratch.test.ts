// The scratch lifecycle the other tests rely on: unique roots outside /tmp and exact cleanup on
// success, failure and cancellation.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { createScratch, currentBase, withScratch } from './scratch.ts';

describe('scratch lifecycle', () => {
  test('roots are unique, outside /tmp and the OS temp directory, and removed on success', async () => {
    let seen = '';
    const value = await withScratch('success', (root) => {
      seen = root;
      assert.ok(!root.startsWith('/tmp/') && !root.startsWith('/var/tmp/') && !root.startsWith(tmpdir() + '/'));
      writeFileSync(join(root, 'file'), 'x');
      mkdirSync(join(root, 'nested'));
      return 42;
    });
    assert.equal(value, 42);
    assert.equal(existsSync(seen), false);
  });

  test('two scratches never share a root; cleaning one leaves the other intact', () => {
    const a = createScratch('pair');
    const b = createScratch('pair');
    assert.notEqual(a.root, b.root);
    writeFileSync(join(b.root, 'keep'), 'keep');
    a.cleanup();
    a.cleanup();
    assert.equal(existsSync(a.root), false);
    assert.equal(existsSync(join(b.root, 'keep')), true);
    const base = currentBase();
    b.cleanup();
    assert.equal(existsSync(b.root), false);
    assert.equal(base !== null && existsSync(base), false, 'the process base goes with the last root');
  });

  test('on failure the root is removed and the original error is preserved', async () => {
    let seen = '';
    await assert.rejects(
      withScratch('failure', (root) => {
        seen = root;
        writeFileSync(join(root, 'file'), 'x');
        throw new Error('the real failure');
      }),
      /the real failure/,
    );
    assert.equal(existsSync(seen), false);
  });

  test('on cancellation (SIGTERM / SIGINT) the child removes exactly its own root before dying', async () => {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      const child = spawn(process.execPath, [join(import.meta.dirname, 'scratch-child.ts'), `cancel-${signal}`], { stdio: ['ignore', 'pipe', 'inherit'] });
      const first: string = await new Promise((resolve, reject) => {
        let buffer = '';
        child.stdout.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          if (buffer.includes('\n')) resolve(buffer);
        });
        child.once('error', reject);
        child.once('exit', () => reject(new Error('child exited early')));
      });
      const { root, base } = JSON.parse(first) as { root: string; base: string };
      assert.equal(existsSync(root), true);
      const siblings = readdirSync(base);
      assert.equal(siblings.length, 1);
      const exit = new Promise<string | null>((resolve) => child.once('exit', (_code, sig) => resolve(sig)));
      child.kill(signal);
      assert.equal(await exit, signal, 'the signal is re-raised after cleanup');
      assert.equal(existsSync(root), false, `${signal}: root removed`);
      assert.equal(existsSync(base), false, `${signal}: process base removed`);
    }
  });
});
