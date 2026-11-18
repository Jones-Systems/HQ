import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Section-local config for the React render checks in ui/; root config is unchanged. */
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../../.t3/cache/design-components', import.meta.url)),
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { include: ['ui/**/*.test.tsx'], environment: 'node' },
});
