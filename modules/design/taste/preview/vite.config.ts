import { defineConfig } from 'vite';

/** REVIEW HARNESS ONLY. `npx vite --config modules/design/taste/preview/vite.config.ts` */
export default defineConfig({
  root: import.meta.dirname,
  server: { host: '127.0.0.1', port: 5187, strictPort: true },
});
