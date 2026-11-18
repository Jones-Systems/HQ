import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { readEnvironment } from './fieldnotes.ts';

// Fail before anything starts when the opt-in variables are missing or wrong.
readEnvironment();

/**
 * Opt-in Fieldnotes compatibility check. The root `vitest.config.ts` lists its roots explicitly and does not
 * include `tools/`, so this never runs in default discovery. Run it with:
 *   HQ_FIELDNOTES_ROOT=/path/to/growth-intel node_modules/.bin/vitest run --config tools/social-compat/vitest.config.ts
 */
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    name: 'social-compat',
    environment: 'node',
    include: ['tools/social-compat/**/*.compat.test.ts'],
    reporters: ['verbose'],
    // One Fieldnotes at a time; the file owns its lifecycle (restarts included).
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
