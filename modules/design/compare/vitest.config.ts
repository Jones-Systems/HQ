import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Section-local runner for the design-compare check group; root config is unchanged. */
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../../.t3/cache/design-compare', import.meta.url)),
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { include: ['src/**/*.test.ts'] },
});
