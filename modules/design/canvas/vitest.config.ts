import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Section-local runner for React render checks (TSX). Framework-free checks
 * use `node --test modules/design/canvas/test/*.test.ts` instead.
 * Run from the repository root: npx vitest run --config modules/design/canvas/vitest.config.ts
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: { include: ['test/view/**/*.test.tsx'], environment: 'node' },
});
