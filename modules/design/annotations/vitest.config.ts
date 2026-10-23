import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Section-local: runs only the React render checks; node --test runs the rest.
// Rooted at the repository so caches stay in the root node_modules.
export default defineConfig({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  test: { include: ['modules/design/annotations/test/**/*.render.test.tsx'], environment: 'node' },
});
