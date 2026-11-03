import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** REVIEW HARNESS ONLY. `npx vite --config modules/design/taste/preview/vite.config.ts` */
export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../../../.t3/cache/design-taste-preview', import.meta.url)),
  root: import.meta.dirname,
  server: { host: '127.0.0.1', port: 5187, strictPort: true },
});
