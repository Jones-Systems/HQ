'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const contract = require('../contract.cjs');
const { manifest, fixture } = require('./fixtures.cjs');

test('manifest identity is closed, canonical and sensitive to accepted provenance', () => {
  const release = manifest({}, false);
  const reordered = Object.fromEntries(Object.entries(release).reverse());
  assert.equal(contract.candidateId(release), contract.candidateId(reordered));
  assert.notEqual(contract.candidateId(release), contract.candidateId({ ...release, runAttempt: 2 }));
  assert.ok(Object.isFrozen(contract.validateManifest(release).archive));
  for (const update of [
    { product: 'other' }, { platform: 'linux' }, { architecture: 'universal' }, { channel: 'other' },
    { buildSequence: 0 }, { workflow: '.github/workflows/untrusted.yml' }, { sourceSha: 'a'.repeat(39) },
    { compatibilityEpoch: 'unknown' }, { attestation: '../proof.json' }, { releaseTag: '../tag' },
    { downloadUrl: 'https://example.invalid/pkg' }, { archive: { ...release.archive, name: '../hq.zip' } },
    { archive: { ...release.archive, size: contract.MAX_ARCHIVE_BYTES + 1 } },
    { archive: { ...release.archive, expandedSize: contract.MAX_EXPANDED_BYTES + 1 } },
    { archive: { ...release.archive, fileCount: contract.MAX_FILE_COUNT + 1 } },
  ]) assert.throws(() => contract.validateManifest({ ...release, ...update }), { code: 'invalid' });
});

test('synthetic application identity requires an explicit validator context', () => {
  const release = manifest();
  assert.throws(() => contract.validateManifest(release), { code: 'invalid' });
  assert.equal(contract.validateManifest(release, { synthetic: true }).appName, 'HQ Updater Test');
  assert.throws(() => contract.validateManifest(manifest({}, false), { synthetic: true }), { code: 'invalid' });
});

test('installation records preserve exact disjoint pins and reject unknown build epochs', async t => {
  const f = await fixture(t);
  assert.deepEqual(contract.validateInstallation(f.record), f.record);
  for (const change of [{ targetPath: '/tmp/../HQ.app' }, { stateRoot: f.record.targetPath }, { userData: f.record.stateRoot }, { sessionData: f.record.targetPath }, { synthetic: false }, { compatibilityEpoch: 'unknown' }, { extra: true }]) assert.throws(() => contract.validateInstallation({ ...f.record, ...change }));
  assert.equal(contract.recordPath(f.record.targetPath), path.join(path.dirname(f.record.targetPath), '.HQ Updater Test.app.installation.json'));
});

test('prepared candidate rejects changed or stale manifest identity', async t => {
  const f = await fixture(t);
  const options = { synthetic: true };
  assert.deepEqual(contract.validatePreparedCandidate(f.candidate, options), f.candidate);
  assert.throws(() => contract.validatePreparedCandidate({ ...f.candidate, manifest: { ...f.candidate.manifest, version: '9.0.0' } }, options), { code: 'stale-candidate' });
  assert.throws(() => contract.validatePreparedCandidate({ ...f.candidate, bundlePath: 'relative/HQ.app' }, options));
});

test('atomic writes leave complete old or new records at every durable boundary', async t => {
  const f = await fixture(t);
  const filename = path.join(f.root, 'atomic.json');
  for (const boundary of ['atomic-file-synced', 'atomic-renamed', 'atomic-directory-synced']) {
    await contract.atomicWrite(filename, { value: 'old' });
    await assert.rejects(contract.atomicWrite(filename, { value: 'new' }, { checkpoint: async name => { if (name === boundary) throw new Error('injected crash'); } }), /injected crash/);
    assert.deepEqual(await contract.readJson(filename), { value: boundary === 'atomic-file-synced' ? 'old' : 'new' });
    assert.equal((await fs.readdir(f.root)).filter(name => name.endsWith('.tmp')).length, 0);
  }
});

test('record reads and path checks refuse symlinks', async t => {
  const f = await fixture(t);
  const source = path.join(f.root, 'source.json');
  const link = path.join(f.root, 'link.json');
  await contract.atomicWrite(source, { value: 1 });
  await fs.symlink(source, link);
  await assert.rejects(contract.readJson(link));
  await assert.rejects(contract.assertNoSymlink(link), { code: 'recovery-required' });
  assert.deepEqual(await contract.readBuildReceipt(f.candidate.bundlePath, { synthetic: true }), contract.receiptOf(f.candidate.manifest));
});

test('production manifests bind the signing policy into every retained receipt without weakening legacy decoding', () => {
  const { DEVELOPER_ID } = require('../signing.cjs');
  const development = manifest({}, false);
  const production = { ...development, signing: 'developer-id', signingPolicy: { ...DEVELOPER_ID } };
  assert.deepEqual(contract.validateManifest(production), production);
  assert.deepEqual(contract.validateBuildReceipt(contract.receiptOf(production)).signingPolicy, DEVELOPER_ID);
  assert.equal(Object.hasOwn(contract.receiptOf(development), 'signingPolicy'), false);
  assert.notEqual(contract.candidateId(production), contract.candidateId(development));
  for (const update of [
    { signing: 'adhoc' }, { signingPolicy: undefined },
    ...[{ teamId: 'WRONGTEAM00' }, { identifier: 'other.app' }, { secureTimestamp: false }, { hardenedRuntime: false }, { notarized: false }, { stapled: false }, { extra: true }].map(change => ({ signingPolicy: { ...DEVELOPER_ID, ...change } })),
  ]) assert.throws(() => contract.validateManifest({ ...production, ...update }));
  assert.throws(() => contract.validateManifest({ ...development, signing: 'developer-id' }));
});
