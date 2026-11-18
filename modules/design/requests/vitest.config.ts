import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/** Section-local rendered checks (React server rendering). Framework-free checks use `node --test`. */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { include: ['test/**/*.test.tsx'], environment: 'node' },
});
