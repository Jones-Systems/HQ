import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rename, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from './remote-gallery.mjs';

export const PREVIEW_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
export async function createLocalFolder(runtime, profile) {
  const root = join(runtime.root, 'local-projects');
  const outside = join(runtime.root, 'outside-local-root');
  await mkdir(root); await mkdir(outside);
  const eligible = ['Alpha-preview', 'Beta-no-preview', 'Bad-bytes', 'Escape-preview', 'Linked-preview'];
  for (const name of eligible) await mkdir(join(root, name, '.hq'), { recursive: true });
  await writeFile(join(root, 'Alpha-preview/.hq/preview.png'), PREVIEW_PNG);
  await writeFile(join(root, 'Bad-bytes/.hq/preview.png'), 'invalid raster bytes');
  await writeFile(join(outside, 'preview.png'), PREVIEW_PNG);
  await symlink(join(outside, 'preview.png'), join(root, 'Linked-preview/.hq/preview.png'));
  await rename(join(root, 'Escape-preview/.hq'), join(root, 'Escape-preview/empty'));
  await symlink(outside, join(root, 'Escape-preview/.hq'));
  await symlink(outside, join(root, 'Symlink-child'));
  await mkdir(join(root, '.hidden')); await mkdir(join(root, 'bad..segment'));
  await writeFile(join(root, 'ordinary-file'), 'not a directory');
  const rootId = randomUUID(), generation = 11;
  await writeFile(join(profile, 'design-catalog.json'), JSON.stringify({ generation,
    root: { rootId, label: 'Selected local directory', path: root, canonical: await realpath(root) } }));
  return { root, rootId, generation, eligible: eligible.sort(), previewDigest: `sha256:${sha256(PREVIEW_PNG)}`,
    async makeUnavailable() { await rename(root, join(runtime.root, 'local-projects-unavailable')); } };
}
