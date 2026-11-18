import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { isStoreError } from '../src/errors.ts';
import { documentKey } from '../src/ids.ts';
import { canonicalize } from '../src/jcs.ts';
import { open, scratch, WORKSPACE } from './helpers.ts';

function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(child.stdout);
}

describe('single-writer lock', () => {
  it('refuses a second writer in the same process until the first closes', async (t) => {
    const root = join(scratch(t), 'store');
    const first = await open(root);
    await assert.rejects(open(root), (error) => isStoreError(error, 'locked'));
    const reader = await open(root, { readOnly: true });
    assert.equal(reader.store.health().mode, 'read-only');
    await reader.store.close();
    await first.store.close();
    const second = await open(root);
    await second.store.putDocument(WORKSPACE, documentKey('doc'), 1);
    await second.store.close();
  });

  it('reclaims a lock left by a process that no longer exists, and honours a live one', async (t) => {
    const root = join(scratch(t), 'store');
    await (await open(root)).store.close();
    writeFileSync(join(root, 'LOCK'), canonicalize({ format: 'hq.design.store.lock/v1', pid: deadPid(), nonce: 'stale' }));
    const reclaimed = await open(root);
    await reclaimed.store.close();

    writeFileSync(join(root, 'LOCK'), canonicalize({ format: 'hq.design.store.lock/v1', pid: 424242, nonce: 'other' }));
    await assert.rejects(open(root, { isProcessAlive: () => true }), (error) => isStoreError(error, 'locked'));
  });

  it('rejects operations after close', async (t) => {
    const { store } = await open(join(scratch(t), 'store'));
    await store.close();
    await assert.rejects(store.getDocument(WORKSPACE, documentKey('doc')), (error) => isStoreError(error, 'closed'));
    await assert.rejects(store.putDocument(WORKSPACE, documentKey('doc'), 1), (error) => isStoreError(error, 'closed'));
  });
});
