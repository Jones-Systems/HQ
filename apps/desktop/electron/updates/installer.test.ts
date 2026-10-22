import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { prepareRelease } from './installer.js';
import { manifest, publication, zip } from './fixtures.test-support.js';
import { UpdateFailure } from './contract.js';

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
