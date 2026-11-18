import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Matches the requests lane's React server-render test runner. */
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../../../.t3/cache/design-app-sections', import.meta.url)),
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { include: ['test/**/*.test.tsx'], environment: 'node' },
});
