import { defineConfig } from 'vitest/config';

/** Section-local config for rendered React checks; domain checks run under `node --test`. */
export default defineConfig({
  root: import.meta.dirname,
  test: { include: ['test/ui/**/*.test.tsx'], environment: 'node' },
});
