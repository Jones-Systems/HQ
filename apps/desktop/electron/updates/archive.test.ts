import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { archivePath, extractArchive, inspectArchive } from './archive.js';
import { manifest, zip } from './fixtures.test-support.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(entries: Parameters<typeof zip>[0]) {
  const root = await mkdtemp(join(import.meta.dirname, '.archive-test-')); roots.push(root);
  const bytes = zip(entries), path = join(root, 'archive.zip');
  await writeFile(path, bytes);
  const value = manifest({ archive: { name: 'hq-darwin-arm64.zip', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), expandedSize: entries.reduce((sum, entry) => sum + Buffer.byteLength(entry.content), 0), fileCount: entries.length } });
  return { root, path, value };
}
it('extracts regular files and internal framework symlinks with exact expansion accounting', async () => {
  const f = await fixture([{ name: 'HQ.app/Contents/Frameworks/A/Versions/A/file', content: 'one' }, { name: 'HQ.app/Contents/Frameworks/A/Versions/Current', content: 'A', mode: 0o120777 }]);
  const bundle = await extractArchive(f.path, join(f.root, 'extracted'), f.value, new AbortController().signal);
  expect(await readFile(join(bundle, 'Contents/Frameworks/A/Versions/Current/file'), 'utf8')).toBe('one');
  expect(await realpath(join(bundle, 'Contents/Frameworks/A/Versions/Current'))).toBe(join(bundle, 'Contents/Frameworks/A/Versions/A'));
});
it('rejects traversal, alternate roots, control characters and macOS case aliases', async () => {
  for (const path of ['HQ.app/../outside', '/HQ.app/file', 'Other.app/file', 'HQ.app/a\\b', 'HQ.app/a\u0000b', 'HQ.app/./file']) expect(() => archivePath(path)).toThrow('integrity');
  const f = await fixture([{ name: 'HQ.app/File', content: 'one' }, { name: 'HQ.app/file', content: 'two' }]);
  await expect(inspectArchive(f.path, f.value)).rejects.toMatchObject({ code: 'integrity' });
});
it('rejects escaping symlinks before creating executable files and symlink ancestors before extraction', async () => {
  const f = await fixture([{ name: 'HQ.app/link', content: '../../outside', mode: 0o120777 }, { name: 'HQ.app/Contents/MacOS/HQ', content: 'executable', mode: 0o100755 }]);
  await expect(extractArchive(f.path, join(f.root, 'extracted'), f.value, new AbortController().signal)).rejects.toMatchObject({ code: 'integrity' });
  await expect(readFile(join(f.root, 'extracted/HQ.app/Contents/MacOS/HQ'))).rejects.toMatchObject({ code: 'ENOENT' });
  const other = await fixture([{ name: 'HQ.app/link', content: 'inside', mode: 0o120777 }, { name: 'HQ.app/link/file', content: 'payload' }]);
  await expect(inspectArchive(other.path, other.value)).rejects.toMatchObject({ code: 'integrity' });
});
it('rejects local/central filename disagreement, corrupt content, count and expanded-size claims', async () => {
  const f = await fixture([{ name: 'HQ.app/file', content: 'one' }]);
  await expect(inspectArchive(f.path, { ...f.value, archive: { ...f.value.archive, fileCount: 2 } })).rejects.toMatchObject({ code: 'integrity' });
  await expect(inspectArchive(f.path, { ...f.value, archive: { ...f.value.archive, expandedSize: 2 } })).rejects.toMatchObject({ code: 'integrity' });
  const bytes = await readFile(f.path); bytes[30] = 88; await writeFile(f.path, bytes);
  await expect(inspectArchive(f.path, f.value)).rejects.toMatchObject({ code: 'integrity' });
  const g = await fixture([{ name: 'HQ.app/file', content: 'one' }]);
  const corrupt = await readFile(g.path); corrupt[30 + Buffer.byteLength('HQ.app/file')] = 88; await writeFile(g.path, corrupt);
  await expect(extractArchive(g.path, join(g.root, 'extracted'), g.value, new AbortController().signal)).rejects.toMatchObject({ code: 'integrity' });
});
