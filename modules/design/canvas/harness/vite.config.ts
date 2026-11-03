import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Section-local review harness: serves the canvas with labelled fakes for
 * browser-mode geometry checks. Not part of the product build; delete freely.
 * Run from the repository root: npx vite --config modules/design/canvas/harness/vite.config.ts
 */
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../../../.t3/cache/design-canvas-harness', import.meta.url)),
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { host: '127.0.0.1', port: 5187, strictPort: true },
});
