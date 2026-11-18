import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  test: {
    environment: 'node',
    include: ['apps/desktop/electron/design-host.e2e.*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
