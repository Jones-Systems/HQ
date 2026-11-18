'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { admitNativeStorage, METADATA_ALLOWANCE_BYTES, RESERVE_BYTES } = require('../native-storage.cjs');

const sourceBundle = path.resolve('/synthetic-storage/HQ.app');
const outputDirectory = path.resolve('/synthetic-storage/native-output');
const bundleBytes = 4096 + 8192 + 40;
const required = 10 * bundleBytes + METADATA_ALLOWANCE_BYTES + RESERVE_BYTES;

function filesystem(availableBlocks) {
  const entries = new Map([
    [sourceBundle, { kind: 'directory', size: 512n, blocks: 8n }],
    [path.join(sourceBundle, 'payload'), { kind: 'file', size: 5000n, blocks: 16n }],
    [path.join(sourceBundle, 'link'), { kind: 'symlink', size: 40n, blocks: 0n }],
  ]);
  return {
    statfsSync(directory) { assert.equal(directory, outputDirectory); return { bsize: 4096n, bavail: availableBlocks, bfree: availableBlocks, blocks: 10000000n }; },
    lstatSync(filename) {
      const entry = entries.get(filename);
      assert.ok(entry, 'only source-bundle entries may be inspected');
      return { ...entry, isDirectory: () => entry.kind === 'directory', isFile: () => entry.kind === 'file', isSymbolicLink: () => entry.kind === 'symlink' };
    },
    readdirSync(filename) { assert.equal(filename, sourceBundle); return ['payload', 'link']; },
  };
}

test('native storage admission measures its destination and does not follow bundle symlinks', () => {
  const blocks = BigInt(Math.ceil(required / 4096));
  const storage = admitNativeStorage({ sourceBundle, outputDirectory, bundleCopies: 10, fs: filesystem(blocks) });
  assert.equal(storage.bundleBytes, bundleBytes);
  assert.equal(storage.availableBytes, Number(blocks) * 4096);
  assert.equal(storage.additionalPeakBytes, 10 * bundleBytes + 1024 ** 3);
  assert.equal(storage.requiredAvailableBytes, required);
  assert.ok(storage.availableBytes - storage.additionalPeakBytes >= 2 * 1024 ** 3);
});

test('native storage admission refuses insufficient space before allocating a bundle', () => {
  const blocks = BigInt(Math.ceil(required / 4096) - 1);
  assert.throws(() => admitNativeStorage({ sourceBundle, outputDirectory, bundleCopies: 10, fs: filesystem(blocks) }), error => {
    assert.match(error.message, /no synthetic bundle copies were admitted/);
    assert.equal(error.storage.requiredAvailableBytes, required);
    assert.ok(error.storage.availableBytes < required);
    return true;
  });
});

test('unknown, malformed and out-of-range storage evidence holds admission', () => {
  for (const value of [undefined, -1n, 1]) {
    assert.throws(() => admitNativeStorage({ sourceBundle, outputDirectory, bundleCopies: 10, fs: filesystem(value) }), /unknown or malformed|supported byte range/);
  }
  const missing = filesystem(1000000n);
  missing.statfsSync = () => ({ bsize: 0n, bavail: 1n, bfree: 1n, blocks: 1n });
  assert.throws(() => admitNativeStorage({ sourceBundle, outputDirectory, bundleCopies: 10, fs: missing }), /unknown or malformed/);
  const excessive = filesystem(1000000n);
  excessive.statfsSync = () => ({ bsize: 4096n, bavail: BigInt(Number.MAX_SAFE_INTEGER), bfree: BigInt(Number.MAX_SAFE_INTEGER), blocks: BigInt(Number.MAX_SAFE_INTEGER) });
  assert.throws(() => admitNativeStorage({ sourceBundle, outputDirectory, bundleCopies: 10, fs: excessive }), /supported byte range/);
});
