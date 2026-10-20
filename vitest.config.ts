import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['apps/desktop/**/*.test.ts', 'packages/contracts/**/*.test.ts'] },
});
