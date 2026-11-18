import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Social domain evidence page. Build it, then serve the static build over loopback so it runs under the app's
// strict CSP (Vite's dev server would need 'unsafe-inline' styles). Output goes to the ignored dist/ directory.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 4189, strictPort: true },
});
