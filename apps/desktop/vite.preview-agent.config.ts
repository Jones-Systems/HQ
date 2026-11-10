import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../.t3/cache/vite-preview-agent', import.meta.url)),
  build: {
  outDir: fileURLToPath(new URL('./dist-electron/preview-agent', import.meta.url)),
  emptyOutDir: true,
  lib: { entry: fileURLToPath(new URL('../../modules/design/annotations/src/preview-agent/index.ts', import.meta.url)), name: 'HQPreviewAgent', formats: ['iife'], fileName: () => 'agent.js' },
} });
