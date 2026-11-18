import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Section-local runner for rendered React checks; framework-free checks use `node --test`.
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../../.t3/cache/design-references', import.meta.url)),
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  test: { include: ['modules/design/references/**/*.render.test.tsx'], environment: 'node' },
});
