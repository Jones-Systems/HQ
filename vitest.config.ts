import { defineConfig } from 'vitest/config';

const roots = ['apps/desktop', 'packages/contracts', 'packages/hq-ui', 'modules/social', 'modules/work'];

export default defineConfig({
  test: {
    projects: [
      // `.test.ts` runs in Node; a file may opt into the DOM with `// @vitest-environment happy-dom`.
      { extends: true, test: { name: 'node', environment: 'node', include: roots.map((root) => `${root}/**/*.test.ts`) } },
      { extends: true, test: { name: 'dom', environment: 'happy-dom', include: roots.map((root) => `${root}/**/*.test.tsx`) } },
    ],
  },
});
