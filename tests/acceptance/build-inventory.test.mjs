import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { collectBuildInventory, inventoryDigest } from './build-inventory.mjs';

async function owned(fn) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'hq-build-inventory-'));
  try {
    const files = {
      'package.json': '{"type":"module"}',
      'apps/desktop/package.json': '{"type":"module"}',
      'apps/desktop/dist/index.html': '<script src="./assets/index-a.js"></script>',
      'apps/desktop/dist/assets/index-a.js': 'export const fixture = true;',
      'apps/desktop/dist/assets/index-a.css': 'body { color: black; }',
      'apps/desktop/dist-electron/main.js': 'import "./design-host/helper.js";',
      'apps/desktop/dist-electron/preload.cjs': 'module.exports = {};',
      'apps/desktop/dist-electron/design-host/helper.js': 'export default 1;',
      'apps/desktop/dist-electron/wiki-host/reader.js': 'export default 2;',
      'apps/desktop/dist-electron/preview-agent/agent.js': 'void 0;',
    };
    for (const [path, bytes] of Object.entries(files).reverse()) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), bytes);
    }
    await fn(root, files);
  } finally { await rm(root, { recursive: true, force: true }); }
}

test('complete deterministic inventory covers renderer, compiled helpers and module metadata', () => owned(async (root, files) => {
  const first = await collectBuildInventory(root);
  assert.deepEqual(first.files.map(file => file.path), Object.keys(files).sort());
  assert.deepEqual(await collectBuildInventory(root), first);
  for (const path of ['apps/desktop/dist/assets/index-a.js', 'apps/desktop/dist/assets/index-a.css', 'apps/desktop/dist-electron/design-host/helper.js', 'apps/desktop/dist-electron/wiki-host/reader.js', 'apps/desktop/dist-electron/preview-agent/agent.js', 'apps/desktop/package.json']) {
    await writeFile(join(root, path), files[path] + '\n');
    assert.notEqual(inventoryDigest(await collectBuildInventory(root)), inventoryDigest(first), path);
    await writeFile(join(root, path), files[path]);
  }
}));

for (const [label, mutate, error] of [
  ['missing entry', root => rm(join(root, 'apps/desktop/dist/index.html')), /Missing/],
  ['missing tree', root => rm(join(root, 'apps/desktop/dist-electron'), { recursive: true }), /ENOENT/],
  ['unsafe path', root => writeFile(join(root, 'apps/desktop/dist/bad%file.js'), ''), /Unsafe/],
  ['symlink file', async root => { await rm(join(root, 'apps/desktop/dist/index.html')); await symlink('../package.json', join(root, 'apps/desktop/dist/index.html')); }, /Symlink/],
  ['symlink subtree', root => symlink('../dist', join(root, 'apps/desktop/dist/linked')), /Symlink/],
  ['symlink tree', async root => { await rm(join(root, 'apps/desktop/dist'), { recursive: true }); await symlink('dist-electron', join(root, 'apps/desktop/dist')); }, /Symlink/],
]) test('inventory rejects ' + label, () => owned(async root => {
  await mutate(root);
  await assert.rejects(collectBuildInventory(root), error);
}));
