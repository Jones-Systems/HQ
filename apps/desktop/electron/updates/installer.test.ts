import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { prepareRelease } from './installer.js';
import { manifest, publication, zip, statement, installation, response } from './fixtures.test-support.js';
import { verifyStatement, type ProvenanceInput } from './provenance.js';
import { UpdateFailure, contract } from './contract.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const stateRoot = await mkdtemp(join(import.meta.dirname, '.installer-test-')); roots.push(stateRoot);
  const archive = zip([{ name: 'HQ.app/Contents/MacOS/HQ', content: 'binary', mode: 0o100755 }]);
  const value = manifest({ archive: { name: 'hq-darwin-arm64.zip', size: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), expandedSize: 6, fileCount: 1 } });
  const release = publication(value, archive);
  return { stateRoot, release };
}
it('prepares a fresh installation using updater storage only, without accepting profile bindings', async () => {
  const f = await fixture(), verifyProvenance = vi.fn(async () => {}), verifyBundle = vi.fn(async () => {});
  const request = { stateRoot: f.stateRoot, channel: 'preview' as const, architecture: 'arm64' as const };
  const adapters = { platform: 'darwin', transport: f.release.get, verifyProvenance, verifyBundle };
  const prepared = await prepareRelease(request, adapters);
  expect(prepared.bundlePath).toBe(join(f.stateRoot, 'download-cache', prepared.candidateId, 'extracted/HQ.app'));
  expect((await readdir(f.stateRoot)).sort()).toEqual(['download-cache', 'trust-cache']);
  expect(verifyProvenance).toHaveBeenCalledTimes(2); expect(verifyBundle).toHaveBeenCalledOnce();
  const reused = await prepareRelease(request, adapters);
  expect(reused).toEqual(prepared);
  expect(await readdir(join(f.stateRoot, 'download-cache'))).toEqual([prepared.candidateId]);
});
it('rejects provenance failure before archive execution and keeps Linux activation unavailable', async () => {
  const f = await fixture(), verifyBundle = vi.fn(async () => {}), transport = vi.fn(f.release.get);
  const request = { stateRoot: f.stateRoot, channel: 'preview' as const, architecture: 'arm64' as const };
  await expect(prepareRelease(request, { platform: 'linux', transport })).rejects.toMatchObject({ code: 'unavailable' });
  expect(transport).not.toHaveBeenCalled();
  await expect(prepareRelease(request, { platform: 'darwin', transport, verifyProvenance: async () => { throw new UpdateFailure('provenance'); }, verifyBundle })).rejects.toMatchObject({ code: 'provenance' });
  expect(verifyBundle).not.toHaveBeenCalled();
  expect(await readdir(join(f.stateRoot, 'download-cache'))).toEqual([]);
});

it('discovers a signed production release, verifies both subject digests and reaches compatible native install admission', async () => {
  const signingPolicy = { schemaVersion: 1, mode: 'developer-id', teamId: '2CUPSQS986', identifier: 'org.jones-systems.hq.local', hardenedRuntime: true, secureTimestamp: true, notarized: true, stapled: true } as const;
  const root = await mkdtemp(join(import.meta.dirname, '.installer-test-')); roots.push(root);
  const record = installation(root);
  const archive = zip([{ name: 'HQ.app/Contents/MacOS/HQ', content: 'binary', mode: 0o100755 }]);
  const value = manifest({ signing: 'developer-id', signingPolicy, sourceRef: 'refs/heads/main', releaseTag: 'hq-desktop-signed-2', archive: { name: 'hq-darwin-arm64.zip', size: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), expandedSize: 6, fileCount: 1 } });
  const proof = statement(value, createHash('sha256').update(JSON.stringify(value)).digest('hex'));
  const release = publication(value, archive, proof);
  const semanticVerifier = vi.fn(async (input: ProvenanceInput) => { verifyStatement(input.bundle, input.manifest, input.archiveHash, input.manifestHash); });
  const verifyBundle = vi.fn(async (_path: string, observed: typeof value) => { expect(contract.validateManifest(observed).signingPolicy).toEqual(signingPolicy); });
  const prepared = await prepareRelease({ stateRoot: record.stateRoot, channel: 'preview', architecture: 'arm64' }, { platform: 'darwin', transport: release.get, verifyProvenance: semanticVerifier, verifyBundle });
  const { createTransaction } = createRequire(import.meta.url)('../../../../tools/updater/transaction.cjs') as { createTransaction(): { admit(record: unknown, candidate: unknown): void } };
  expect(() => createTransaction().admit(record, prepared)).not.toThrow();
  expect(() => createTransaction().admit({ ...record, installed: { ...record.installed, signingPolicy } }, prepared)).not.toThrow();
  expect(prepared.manifest.signingPolicy).toEqual(signingPolicy);
  expect(semanticVerifier).toHaveBeenCalledTimes(2);
  expect(verifyBundle).toHaveBeenCalledOnce();
});

it.each(['archive', 'manifest', 'repository', 'workflow', 'ref', 'commit', 'tag', 'run-branch'] as const)('rejects production %s tampering before native install admission', async mode => {
  const signingPolicy = { schemaVersion: 1, mode: 'developer-id', teamId: '2CUPSQS986', identifier: 'org.jones-systems.hq.local', hardenedRuntime: true, secureTimestamp: true, notarized: true, stapled: true } as const;
  const stateRoot = await mkdtemp(join(import.meta.dirname, '.installer-test-')); roots.push(stateRoot);
  const archive = zip([{ name: 'HQ.app/Contents/MacOS/HQ', content: 'binary', mode: 0o100755 }]);
  const value = manifest({ signing: 'developer-id', signingPolicy, sourceRef: 'refs/heads/main', releaseTag: 'hq-desktop-signed-2', archive: { name: 'hq-darwin-arm64.zip', size: archive.length, sha256: createHash('sha256').update(archive).digest('hex'), expandedSize: 6, fileCount: 1 } });
  const proof = statement(value, createHash('sha256').update(JSON.stringify(value)).digest('hex'));
  if (mode === 'repository') proof.predicate.buildDefinition.externalParameters.workflow.repository = 'https://github.com/other/HQ';
  if (mode === 'workflow') proof.predicate.buildDefinition.externalParameters.workflow.path = '.github/workflows/other.yml';
  if (mode === 'ref') proof.predicate.buildDefinition.externalParameters.workflow.ref = 'refs/heads/untrusted';
  if (mode === 'commit') proof.predicate.buildDefinition.resolvedDependencies[0]!.digest.gitCommit = '0'.repeat(40);
  const release = publication(value, archive, proof), verifyBundle = vi.fn(async () => {});
  if (mode === 'tag') release.tag.object.sha = '0'.repeat(40);
  if (mode === 'run-branch') release.run.head_branch = 'untrusted';
  const transport: typeof release.get = async (url, signal) => {
    if (mode === 'archive' && url.pathname.endsWith(value.archive.name)) { const changed = Buffer.from(archive); changed[40] = changed[40]! ^ 1; return response(changed); }
    if (mode === 'manifest' && url.pathname.endsWith('hq-darwin-arm64.json')) return response(Buffer.from(JSON.stringify({ ...value, sourceSha: '0'.repeat(40) })));
    return release.get(url, signal);
  };
  await expect(prepareRelease({ stateRoot, channel: 'preview', architecture: 'arm64' }, { platform: 'darwin', transport, verifyProvenance: async input => verifyStatement(input.bundle, input.manifest, input.archiveHash, input.manifestHash), verifyBundle })).rejects.toMatchObject({ code: ['archive', 'manifest'].includes(mode) ? 'integrity' : 'provenance' });
  expect(verifyBundle).not.toHaveBeenCalled();
});
