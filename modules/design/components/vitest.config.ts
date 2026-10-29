import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Section-local config for the React render checks in ui/; root config is unchanged. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { include: ['ui/**/*.test.tsx'], environment: 'node' },
});
