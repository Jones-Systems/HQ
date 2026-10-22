import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createUpdateStorage } from './storage.js';
import { candidate, installation, manifest, response, transport, zip } from './fixtures.test-support.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(import.meta.dirname, '.storage-test-')); roots.push(root);
  const record = installation(root), bytes = zip([{ name: 'HQ.app/Contents/MacOS/HQ', content: 'binary', mode: 0o100755 }]);
  const selected = candidate(manifest({ archive: { name: 'hq-darwin-arm64.zip', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), expandedSize: 6, fileCount: 1 } }));
  await mkdir(record.userData); await mkdir(record.sessionData);
  await writeFile(join(record.userData, 'untouched'), 'profile'); await writeFile(join(record.sessionData, 'untouched'), 'session');
  return { root, record, bytes, selected };
}
it('authenticates the streamed archive hash before native verification and writes only its own state', async () => {
  const f = await fixture(), verify = vi.fn(async () => {}), verifyBundle = vi.fn(async () => {});
  const storage = createUpdateStorage(f.record, transport(f.bytes), verify, verifyBundle);
  await storage.initialize();
  const prepared = await storage.prepare(f.selected, new AbortController().signal, () => {}, () => {});
  expect(verify).toHaveBeenCalledWith(expect.objectContaining({ archiveHash: f.selected.manifest.archive.sha256 }));
  expect(verifyBundle).toHaveBeenCalledOnce();
  expect(prepared.bundlePath).toBe(join(f.record.stateRoot, 'download-cache', f.selected.candidateId, 'extracted/HQ.app'));
  expect(await readFile(join(f.record.userData, 'untouched'), 'utf8')).toBe('profile');
  expect(await readFile(join(f.record.sessionData, 'untouched'), 'utf8')).toBe('session');
  expect(await readdir(join(f.record.stateRoot, 'download-cache'))).toEqual([f.selected.candidateId]);
});
it('removes its exact partial directory after truncation, hash mismatch and cancellation', async () => {
  const f = await fixture();
  for (const mode of ['truncated', 'hash', 'abort']) {
    const controller = new AbortController(), verify = vi.fn(async () => {});
    const bytes = mode === 'truncated' ? f.bytes.subarray(0, 5) : Buffer.from(f.bytes);
    if (mode === 'hash') bytes[40] = bytes[40]! ^ 1;
    const transfer = mode === 'abort' ? async () => ({ ...response(bytes), body: (async function* () { yield bytes.subarray(0, 5); controller.abort(); yield bytes.subarray(5); })() }) : transport(bytes);
    const storage = createUpdateStorage(f.record, transfer, verify, async () => {});
    await storage.initialize();
    await expect(storage.prepare(f.selected, controller.signal, () => {}, () => {})).rejects.toMatchObject({ code: mode === 'abort' ? 'cancelled' : 'integrity' });
    expect(await readdir(join(f.record.stateRoot, 'download-cache'))).toEqual([]);
    expect(verify).not.toHaveBeenCalled();
  }
});
it('removes preparation on provenance or native seal failure and refuses state inside a profile', async () => {
  const f = await fixture();
  for (const stage of ['provenance', 'native']) {
    const reject = async () => { throw Error(stage); };
    const storage = createUpdateStorage(f.record, transport(f.bytes), stage === 'provenance' ? reject : async () => {}, stage === 'native' ? reject : async () => {});
    await storage.initialize();
    await expect(storage.prepare(f.selected, new AbortController().signal, () => {}, () => {})).rejects.toThrow(stage);
    expect(await readdir(join(f.record.stateRoot, 'download-cache'))).toEqual([]);
  }
  const invalid = createUpdateStorage({ ...f.record, stateRoot: join(f.record.userData, 'updates') }, transport(f.bytes), async () => {}, async () => {});
  await expect(invalid.initialize()).rejects.toMatchObject({ code: 'permission' });
  expect(await readdir(f.record.userData)).toEqual(['untouched']);
});
