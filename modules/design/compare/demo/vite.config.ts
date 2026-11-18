import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** Local demo server for the compare section only (loopback). */
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { host: '127.0.0.1', port: 5183, strictPort: true },
});
