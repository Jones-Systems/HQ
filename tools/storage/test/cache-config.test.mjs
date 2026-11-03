import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { it } from 'node:test';

const repository = new URL('../../../', import.meta.url);
const configs = [
  ['apps/desktop/vite.config.ts', 'vite-desktop'],
  ['apps/desktop/vite.preview-agent.config.ts', 'vite-preview-agent'],
  ['vitest.config.ts', 'vitest-root'],
  ['modules/design/annotations/vitest.config.ts', 'design-annotations'],
  ['modules/design/app/sections/vitest.config.ts', 'design-app-sections'],
  ['modules/design/canvas/vitest.config.ts', 'design-canvas'],
  ['modules/design/compare/vitest.config.ts', 'design-compare'],
  ['modules/design/components/vitest.config.ts', 'design-components'],
  ['modules/design/references/vitest.config.ts', 'design-references'],
  ['modules/design/requests/vitest.config.ts', 'design-requests'],
  ['modules/design/taste/vitest.config.ts', 'design-taste'],
  ['modules/design/ui/vitest.config.ts', 'design-ui'],
  ['modules/design/preview/vite.config.ts', 'design-preview'],
  ['modules/design/canvas/harness/vite.config.ts', 'design-canvas-harness'],
  ['modules/design/compare/demo/vite.config.ts', 'design-compare-demo'],
  ['modules/design/components/harness/vite.config.ts', 'design-components-harness'],
  ['modules/design/projects/harness/vite.config.ts', 'design-projects-harness'],
  ['modules/design/references/harness/vite.config.ts', 'design-references-harness'],
  ['modules/design/requests/harness/vite.config.ts', 'design-requests-harness'],
  ['modules/design/taste/preview/vite.config.ts', 'design-taste-preview'],
  ['modules/design/ui/harness/vite.config.ts', 'design-ui-harness'],
];

// Evaluate the actual config expressions without installing or starting Vite. Its
// defineConfig wrapper is an identity here; hosted CI checks the real tool API.
// Erase types once per source file, including the preview's unexecuted hooks.
const sources = new Map();
function readConfig(path, checkout, cwd) {
  if (!sources.has(path)) sources.set(path,
    stripTypeScriptTypes(readFileSync(new URL(path, repository), 'utf8'))
      .replace(/^import .* from '[^']+';\r?\n/gm, '')
      .replaceAll('import.meta.url', 'configUrl')
      .replaceAll('import.meta.dirname', 'configDir')
      .replace('export default ', 'globalThis.config = '));
  const context = {
    URL, fileURLToPath, defineConfig: value => value,
    configUrl: new URL(path, checkout).href,
    configDir: dirname(fileURLToPath(new URL(path, checkout))),
    process: { cwd: () => cwd, env: {} },
    appendFileSync: () => { throw new Error('Config evaluation must not write logs'); },
  };
  new Script(sources.get(path), { filename: path }).runInNewContext(context, { timeout: 1000 });
  return context.config;
}

it('keeps all allocated cache namespaces distinct and inside this worktree', () => {
  const destinations = configs.map(([path, namespace]) => {
    const config = readConfig(path, repository, fileURLToPath(repository));
    assert.equal(config.cacheDir, join(fileURLToPath(repository), '.t3', 'cache', namespace));
    return config.cacheDir;
  });
  assert.equal(new Set(destinations).size, configs.length);
});

it('follows the config checkout rather than the invocation cwd, including spaces in paths', () => {
  const destinations = new Set();
  for (const root of ['/synthetic/HQ one/', '/synthetic/HQ two/']) {
    const checkout = pathToFileURL(root);
    for (const [path, namespace] of configs) {
      for (const cwd of ['/unrelated', '/synthetic/other checkout']) {
        const config = readConfig(path, checkout, cwd);
        assert.equal(config.cacheDir, join(root, '.t3', 'cache', namespace));
        destinations.add(config.cacheDir);
      }
    }
  }
  assert.equal(destinations.size, configs.length * 2);
});

it('keeps all allocated cache destinations as non-nested siblings', () => {
  const parent = join(fileURLToPath(repository), '.t3', 'cache');
  for (const [path] of configs) {
    const config = readConfig(path, repository, '/unrelated');
    assert.equal(dirname(config.cacheDir), parent);
  }
});

// UNCOVERED: modules/design/app/vitest.config.ts (the separate PR168 candidate).
// No workflow/matrix is changed; no cache migration, deletion or quota is tested.
