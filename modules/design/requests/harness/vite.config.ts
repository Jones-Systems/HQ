import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Section-local browser harness for changed-flow evidence only. It serves synthetic content over labelled
 * fakes on loopback and is not part of the product, the checks or the Electron shell.
 */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { host: '127.0.0.1', port: 5179, strictPort: true },
});
