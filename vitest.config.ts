import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const roots = ['apps/desktop', 'packages/contracts', 'packages/hq-ui', 'modules/social', 'modules/work'];

export default defineConfig({
  cacheDir: fileURLToPath(new URL('./.t3/cache/vitest-root', import.meta.url)),
  test: {
    projects: [
      // `.test.ts` runs in Node; a file may opt into the DOM with `// @vitest-environment happy-dom`.
      { extends: true, test: { name: 'node', environment: 'node', exclude: ['modules/wiki/**'], include: roots.map((root) => `${root}/**/*.test.ts`) } },
      { extends: true, test: { name: 'dom', environment: 'happy-dom', exclude: ['modules/wiki/**'], include: roots.map((root) => `${root}/**/*.test.tsx`) } },
    ],
  },
});
