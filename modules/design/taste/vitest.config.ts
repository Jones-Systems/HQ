import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Section-local config for rendered React checks; domain checks run under `node --test`. */
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../../.t3/cache/design-taste', import.meta.url)),
  root: import.meta.dirname,
  test: { include: ['test/ui/**/*.test.tsx'], environment: 'node' },
});
