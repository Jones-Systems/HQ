import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)), base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  preview: { host: '127.0.0.1', port: 4197, strictPort: true },
});
