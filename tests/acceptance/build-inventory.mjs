import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export const BUILD_SCHEMA = 'hq-electron-build/v1';
export const BUILD_ROOTS = ['apps/desktop/dist', 'apps/desktop/dist-electron'];
const METADATA = ['apps/desktop/package.json', 'package.json'];
const REQUIRED = ['apps/desktop/dist/index.html', 'apps/desktop/dist-electron/main.js', 'apps/desktop/dist-electron/preload.cjs', ...METADATA];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function safePath(path) {
  if (path.length > 512 || !path.split('/').every(part => /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(part))) {
    throw new Error('Unsafe build inventory path: ' + path);
  }
}
function canonical(value) {
  return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
export function inventoryDigest(inventory) {
  return sha(JSON.stringify(canonical(inventory)));
}

export async function collectBuildInventory(directory) {
  const base = resolve(directory);
  for (let path = base; ; path = dirname(path)) {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Unsafe or symlinked build root');
    if (path === dirname(path)) break;
  }
  const files = [];
  async function visit(path, directoryRequired = false) {
    safePath(path);
    const absolute = join(base, path);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) throw new Error('Symlink in build inventory: ' + path);
    if (info.isDirectory()) {
      for (const name of (await readdir(absolute)).sort()) await visit(path + '/' + name);
    } else {
      if (directoryRequired || !info.isFile()) throw new Error('Expected regular build file/directory: ' + path);
      if (files.length >= 10000 || info.size > 512 * 1024 * 1024) throw new Error('Build inventory exceeds bounds');
      const bytes = await readFile(absolute);
      if (bytes.length !== info.size) throw new Error('Build changed while collecting inventory');
      files.push({ path, bytes: bytes.length, sha256: sha(bytes) });
    }
  }
  // Reject symlinked ancestors as well as entries inside either compiled tree.
  for (const path of ['apps', 'apps/desktop']) {
    const info = await lstat(join(base, path));
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Unsafe or symlinked build ancestor');
  }
  for (const path of BUILD_ROOTS) await visit(path, true);
  for (const path of METADATA) {
    const info = await lstat(join(base, path));
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('Expected regular build metadata');
    await visit(path);
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const paths = files.map(file => file.path);
  if (new Set(paths).size !== paths.length || REQUIRED.some(path => !paths.includes(path))) {
    throw new Error('Missing or duplicate required build inventory file');
  }
  return { schema: BUILD_SCHEMA, roots: [...BUILD_ROOTS], files };
}
