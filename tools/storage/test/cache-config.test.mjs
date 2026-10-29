import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { it } from 'node:test';

const repository = new URL('../../../', import.meta.url);
const configs = [
  ['apps/desktop/vite.config.ts', 'vite-desktop'],
  ['apps/desktop/vite.preview-agent.config.ts', 'vite-preview-agent'],
  ['vitest.config.ts', 'vitest-root'],
];

// Evaluate the actual config expressions without installing or starting Vite. Its
// defineConfig wrapper is an identity here; hosted CI checks the real tool API.
function readConfig(path, checkout, cwd) {
  const source = readFileSync(new URL(path, repository), 'utf8')
    .replace(/^import \{ (?:fileURLToPath|defineConfig) \} from '(?:node:url|vite|vitest\/config)';\r?\n/gm, '')
    .replaceAll('import.meta.url', 'configUrl')
    .replace('export default ', 'globalThis.config = ');
  const context = {
    URL, fileURLToPath, defineConfig: value => value,
    configUrl: new URL(path, checkout).href,
    process: { cwd: () => cwd },
  };
  new Script(source, { filename: path }).runInNewContext(context, { timeout: 1000 });
  return context.config;
}

it('keeps the three scoped cache namespaces distinct and inside this worktree', () => {
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

// Module-local modules/design/*/vitest.config.ts (including the app config)
// and the design-sections.yml matrix are outside this slice and keep defaults.
