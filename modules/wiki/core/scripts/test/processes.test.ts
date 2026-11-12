import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createNodeGitObjectSource } from '../../src/index.ts';
import { createBareRepo, profileFor } from '../../test/support.ts';
import { withScratch } from './scratch.ts';
import { createProcessTracker } from '../processes.ts';

test('counts retired and replacement batch children and confirms every close', async () => {
  await withScratch('validate-processes', async (root) => {
    const repo = createBareRepo(root, 'batch', { files: [{ path: 'a.md', content: '# A\n' }] });
    const tracker = createProcessTracker();
    const commands: string[][] = [];
    const batches: string[][] = [];
    const source = createNodeGitObjectSource(profileFor('bl', { gitDir: repo.gitDir }), {
      ...tracker.options,
      batchIdleMs: 60_000,
      exec(file, args, options, callback) {
        commands.push(args.slice(5));
        return tracker.options.exec!(file, args, options, callback);
      },
      spawn(file, args, options) {
        batches.push(args.slice(5));
        return tracker.options.spawn!(file, args, options);
      },
    });
    try {
      const pin = await source.resolvePin();
      assert.ok(pin.ok);
      const tree = await source.listTree(pin.value.commit);
      assert.ok(tree.ok);
      assert.equal(tree.value.entries.length, 1, 'the synthetic Git listing has one blob');
      const oid = tree.value.entries[0]!.oid;
      // A zero-byte limit retires the first child; a successful read starts its replacement.
      assert.deepEqual(await source.readBlob(oid, 0), { ok: false, reason: 'too-large' });
      tracker.sampling();
      assert.ok((await source.readBlob(oid, 100)).ok);
    } finally {
      try { await source.close(); } finally { await tracker.close(); }
    }
    assert.deepEqual(commands.map((args) => args[0]), ['rev-parse', 'config', 'rev-parse', 'show', 'ls-tree']);
    assert.deepEqual(batches, [['cat-file', '--batch'], ['cat-file', '--batch']]);
    assert.deepEqual(tracker.figures(), { refresh: 6, sampling: 1, oneShot: 5, batch: 2, closed: 7, failedStarts: 0, active: 0 });
  });
});

test('failure and cancellation close only owned children and prevent further launches', async () => {
  const owner = createProcessTracker();
  const peer = createProcessTracker();
  const options = { stdio: ['pipe', 'pipe', 'ignore'], shell: false, windowsHide: true, env: {}, cwd: process.cwd() } as const;
  const spawnOptions = { ...options, stdio: ['pipe', 'pipe', 'ignore'] as ['pipe', 'pipe', 'ignore'] };
  const child = owner.options.spawn!(process.execPath, ['-e', 'process.stdin.resume()'], spawnOptions);
  const other = peer.options.spawn!(process.execPath, ['-e', 'process.stdin.resume()'], spawnOptions);
  try {
    await Promise.all([once(child as NodeJS.EventEmitter, 'spawn'), once(other as NodeJS.EventEmitter, 'spawn')]);
    await owner.close();
    assert.equal(owner.figures().closed, 1);
    assert.equal(owner.figures().active, 0);
    assert.equal(peer.figures().active, 1);
    assert.throws(() => owner.options.spawn!(process.execPath, [], spawnOptions));
  } finally { await Promise.all([owner.close(), peer.close()]); }

  const failed = createProcessTracker();
  const missing = failed.options.spawn!('synthetic-missing-executable-7c1e', [], spawnOptions);
  const gone = new Promise<void>((resolve) => missing.on('close', resolve));
  missing.on('error', () => {});
  await gone;
  await failed.close();
  assert.deepEqual(failed.figures(), { refresh: 0, sampling: 0, oneShot: 0, batch: 0, closed: 0, failedStarts: 1, active: 0 });
});

// A nonzero exit is still a successful start; ENOENT is a failed start on the direct exec seam.
test('direct exec counts successful, nonzero and failed starts through confirmed close', async () => {
  const tracker = createProcessTracker();
  const options = {
    cwd: process.cwd(), env: {}, shell: false, windowsHide: true,
    encoding: 'buffer', killSignal: 'SIGKILL', timeout: 5000, maxBuffer: 1024,
  } as const;
  try {
    for (const [file, args] of [
      [process.execPath, ['-e', 'process.exitCode = 7']],
      ['synthetic-missing-executable-7c1e', []],
    ] as const) {
      const child = tracker.options.exec!(file, [...args], options, () => {});
      await new Promise<void>((resolve) => (child as unknown as NodeJS.EventEmitter).once('close', resolve));
      tracker.sampling();
    }
  } finally { await tracker.close(); }
  assert.deepEqual(tracker.figures(), { refresh: 1, sampling: 0, oneShot: 1, batch: 0, closed: 1, failedStarts: 1, active: 0 });
  assert.throws(() => tracker.options.exec!(process.execPath, [], options, () => {}));
});
