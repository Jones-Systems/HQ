// public/js/ordering.js, dates.js and model.js are byte copies of Work's pinned upstream files in
// modules/work/core/upstream/manual-planner/ (spec.hq-agent-cli requirement 3 and acceptance F). A client change
// that needs different behaviour belongs in the caller, not in these files. The SHA-256 values are the "Work
// upstream equality" table in PROVENANCE.md.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const PINNED = {
  'ordering.js': 'abf141543f18fcbaefe8abae92a3f35c295d4a093ab73c8eabe30da7d57d868b',
  'dates.js': '390c39e8fda9c539a388cfac4675eca97356893e27dd36ae4f589767c954b903',
  'model.js': 'fb24638a1a68b85c5f2185668c1335ec0403ee219cba75075f22fb1896041f80',
};
const PUBLIC = new URL('../public/js/', import.meta.url);
const WORK = new URL('../../../modules/work/core/upstream/manual-planner/', import.meta.url);

const sha256 = (url) => createHash('sha256').update(readFileSync(url)).digest('hex');

for (const [file, hash] of Object.entries(PINNED)) {
  test(`public/js/${file} keeps its pinned upstream SHA-256`, () => {
    assert.equal(sha256(new URL(file, PUBLIC)), hash, `${file} changed; move the behaviour change to its callers`);
  });
}

test('PROVENANCE.md lists the same SHA-256 values', () => {
  const text = readFileSync(new URL('../PROVENANCE.md', import.meta.url), 'utf8');
  for (const [file, hash] of Object.entries(PINNED)) assert.ok(text.includes(`| \`${file}\` | \`${hash}\` |`), file);
});

// Reported as skipped, never passed, when a checkout does not carry Work's copies.
const workCopies = existsSync(new URL('ordering.js', WORK)) ? false : 'Work upstream copies are absent from this checkout';
test('public/js files are byte-equal to the Work upstream copies', { skip: workCopies }, () => {
  for (const file of Object.keys(PINNED)) assert.equal(sha256(new URL(file, PUBLIC)), sha256(new URL(file, WORK)), file);
});
