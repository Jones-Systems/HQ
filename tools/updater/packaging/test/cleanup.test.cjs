'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { withOwnedDirectory } = require('../owned-directory.cjs');

const scratch = path.resolve(__dirname, '../.scratch');

test('owned scratch waits for an asynchronous cleanup safety gate', async () => {
  let owned, completed = false;
  await withOwnedDirectory(scratch, 'async-cleanup-', async root => { owned = root; }, {
    signals: new EventEmitter(),
    async remove(root, options) {
      await Promise.resolve();
      assert.equal(fs.existsSync(root), true);
      fs.rmSync(root, options);
      completed = true;
    },
  });
  assert.equal(completed, true);
  assert.equal(fs.existsSync(owned), false);
});

test('an asynchronous unknown-process gate retains scratch and rejects completion', async () => {
  let owned;
  const signals = new EventEmitter();
  try {
    await assert.rejects(withOwnedDirectory(scratch, 'unknown-process-', async root => { owned = root; }, {
      signals,
      async remove() { await Promise.resolve(); throw new Error('native inventory is unknown'); },
    }), /native inventory is unknown/);
    assert.equal(fs.existsSync(owned), true);
    assert.equal(signals.listenerCount('SIGINT'), 0);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
  } finally {
    if (owned) fs.rmSync(owned, { recursive: true, force: true });
  }
});
