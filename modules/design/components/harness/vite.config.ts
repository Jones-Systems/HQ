import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Lane-local review harness (not root configuration). Serves synthetic
 * fixtures only, on loopback, for rendered isolation and UI evidence.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { host: '127.0.0.1', port: 5194, strictPort: true },
  preview: { host: '127.0.0.1', port: 5194, strictPort: true },
  build: { outDir: '../.t3/harness-dist', emptyOutDir: true },
});
