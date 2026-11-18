import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Section-local: runs only the React render checks; node --test runs the rest.
// Rooted at the repository; its cache has a separate worktree-local namespace.
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../../.t3/cache/design-annotations', import.meta.url)),
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  test: { include: ['modules/design/annotations/test/**/*.render.test.tsx'], environment: 'node' },
});
