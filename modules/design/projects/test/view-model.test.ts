import assert from 'node:assert/strict';
import { test } from 'node:test';
import { galleryPhase, tabAfterKey, validateProjectName, validateViewTitle } from '../src/view-model.ts';

test('gallery distinguishes missing content, filtered content and failed loading', () => {
  assert.equal(galleryPhase({ registryStatus: 'loading', total: 0, shown: 0 }), 'loading');
  assert.equal(galleryPhase({ registryStatus: 'ready', total: 0, shown: 0 }), 'empty');
  assert.equal(galleryPhase({ registryStatus: 'error', total: 0, shown: 0 }), 'error');
  assert.equal(galleryPhase({ registryStatus: 'ready', total: 3, shown: 0 }), 'no-match');
  assert.equal(galleryPhase({ registryStatus: 'error', total: 3, shown: 2 }), 'ready', 'a failed refresh keeps the cached list');
});

test('kind tabs wrap in either direction and ignore unrelated keys', () => {
  assert.equal(tabAfterKey('ArrowRight', 2, 3), 0);
  assert.equal(tabAfterKey('ArrowLeft', 0, 3), 2);
  assert.equal(tabAfterKey('Home', 2, 3), 0);
  assert.equal(tabAfterKey('End', 0, 3), 2);
  assert.equal(tabAfterKey('Enter', 0, 3), null);
  assert.equal(tabAfterKey('End', 0, 0), null);
});

test('inline forms reject blank and control-bearing labels before submission', () => {
  assert.ok(validateProjectName('  '));
  assert.ok(validateViewTitle('Page\nTwo'));
  assert.equal(validateProjectName(' Spring launch '), null);
});
