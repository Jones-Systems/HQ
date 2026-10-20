import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Section-local review harness: serves the graph browser with labelled fakes and synthetic data for
 * browser checks. Not part of the product build and not the desktop shell; delete freely.
 * Run from the repository root: node_modules/.bin/vite --config modules/design/references/harness/vite.config.ts
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { host: '127.0.0.1', port: 5191, strictPort: true, fs: { allow: [fileURLToPath(new URL('../../../..', import.meta.url))] } },
});
