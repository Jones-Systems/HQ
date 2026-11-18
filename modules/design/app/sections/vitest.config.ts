import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Matches the requests lane's React server-render test runner. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { include: ['test/**/*.test.tsx'], environment: 'node' },
});
