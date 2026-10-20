import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Section-local review harness: serves the graph and combined References section with synthetic data for
 * browser checks. Not part of the product build and not the desktop shell; delete freely.
 * Run from the repository root: node_modules/.bin/vite --config modules/design/references/harness/vite.config.ts
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  define: { __HQD_CANDIDATE__: JSON.stringify(process.env.HQD_PREVIEW_CANDIDATE ?? 'unrecorded') },
  server: { host: '127.0.0.1', port: 5191, strictPort: true, fs: { allow: [fileURLToPath(new URL('../../../..', import.meta.url))] } },
});
