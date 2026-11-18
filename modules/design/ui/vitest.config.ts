// Section-local vitest config for checks that need Vite semantics (import.meta.glob,
// .tsx, CSS imports). Root vitest covers only the foundation today.
// Run: npx vitest run --config modules/design/ui/vitest.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Keep caches isolated in this worktree, separately from other runners.
  cacheDir: fileURLToPath(new URL('../../../.t3/cache/design-ui', import.meta.url)),
  test: { include: ['test/vite/**/*.test.ts'], environment: 'node' },
});
