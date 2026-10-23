import { expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { checkCompatibility, discover, verifyWorkflowRun } from './discovery.js';
import { UpdateFailure } from './contract.js';
import { installed, installation, manifest, publication } from './fixtures.test-support.js';

function options() {
  const release = publication(), verify = vi.fn(async () => {});
  return { release, verify, input: { installed: installed(), record: installation(join(import.meta.dirname, 'unread-fixture')), architecture: 'arm64' as const, transport: release.get, verify, cachePath: '/not-read-by-fixture', signal: new AbortController().signal } };
}
it('requires fixed repository identity, release-asset hashes, successful-run evidence and attestation', async () => {
  const f = options(), found = await discover(f.input);
  expect(found?.manifest.sourceSha).toBe(manifest().sourceSha);
  expect(f.verify).toHaveBeenCalledOnce();
  expect(f.verify).toHaveBeenCalledWith(expect.objectContaining({ archiveHash: manifest().archive.sha256, manifestHash: expect.stringMatching(/^[a-f0-9]{64}$/) }));
  f.release.repository.id = 1;
  await expect(discover(f.input)).rejects.toMatchObject({ code: 'provenance' });
});
it('rejects wrong source/run evidence even when the manifest asset hash matches', async () => {
  const f = options(); f.release.run.head_sha = '0'.repeat(40);
  await expect(discover(f.input)).rejects.toMatchObject({ code: 'provenance' });
  expect(f.verify).not.toHaveBeenCalled();
  const correct = publication().run;
  for (const override of [{ conclusion: 'failure' }, { status: 'in_progress' }, { run_attempt: 2 }, { path: '.github/workflows/other.yml' }, { event: 'pull_request' }, { id: 3 }]) expect(() => verifyWorkflowRun({ ...correct, ...override }, manifest())).toThrow('provenance');
});
it('never substitutes successful-run evidence for a failing cryptographic verifier', async () => {
  const f = options(); f.verify.mockRejectedValueOnce(new UpdateFailure('provenance'));
  await expect(discover(f.input)).rejects.toMatchObject({ code: 'provenance' });
  f.release.releases[0]!.assets[0]!.digest = `sha256:${'0'.repeat(64)}`;
  await expect(discover(f.input)).rejects.toMatchObject({ code: 'integrity' });
});
it('rejects wrong architecture, epoch, channel and synthetic product identity', () => {
  const record = installation('/unread');
  for (const overrides of [{ architecture: 'x64' as const }, { channel: 'stable' as const }, { compatibilityEpoch: `hq1-${'0'.repeat(64)}` }]) expect(() => checkCompatibility(manifest(overrides), installed(), record, 'arm64')).toThrow('incompatible');
  expect(() => checkCompatibility({ ...manifest(), bundleId: 'org.jones-systems.hq.updater-test' } as unknown as ReturnType<typeof manifest>, installed(), record, 'arm64')).toThrow('provenance');
});
it('ignores installed or older releases and requires the explicit trusted fresh-install mode without a record', async () => {
  const f = options();
  expect(await discover({ ...f.input, installed: { ...installed(), buildSequence: 2 } })).toBeNull();
  await expect(discover({ ...f.input, installed: null, record: null })).rejects.toMatchObject({ code: 'invalid' });
  expect(await discover({ ...f.input, installed: null, record: null, fresh: true, channel: 'preview' })).not.toBeNull();
});

it('admits the production signature contract and rejects an ad-hoc downgrade from production', () => {
  const signingPolicy = { schemaVersion: 1, mode: 'developer-id', teamId: '2CUPSQS986', identifier: 'org.jones-systems.hq.local', hardenedRuntime: true, secureTimestamp: true, notarized: true, stapled: true } as const;
  const production = { ...manifest(), signing: 'developer-id' as const, signingPolicy };
  const record = installation('/unread');
  expect(() => checkCompatibility(production, installed(), record, 'arm64')).not.toThrow();
  expect(() => checkCompatibility(production, { ...installed(), signingPolicy }, record, 'arm64')).not.toThrow();
  expect(() => checkCompatibility(manifest(), { ...installed(), signingPolicy }, record, 'arm64')).toThrow('incompatible');
  expect(() => checkCompatibility({ ...production, signing: 'adhoc' }, installed(), record, 'arm64')).toThrow('provenance');
});
