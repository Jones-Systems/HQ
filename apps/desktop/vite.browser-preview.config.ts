import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export function browserPreviewConfig(revision: string, outDir: string) {
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('A complete source revision is required.');
  return defineConfig({
    root: fileURLToPath(new URL('./preview', import.meta.url)),
    publicDir: false,
    base: './',
    resolve: { alias: { '/src': fileURLToPath(new URL('./src', import.meta.url)) } },
    define: { __PREVIEW_REVISION__: JSON.stringify(revision) },
    build: {
      outDir, emptyOutDir: false, sourcemap: false,
      rollupOptions: { input: {
        index: fileURLToPath(new URL('./preview/index.html', import.meta.url)),
        empty: fileURLToPath(new URL('./preview/empty.html', import.meta.url)),
      } },
    },
  });
}
