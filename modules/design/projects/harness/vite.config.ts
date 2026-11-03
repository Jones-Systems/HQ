// Section-local browser harness for the projects section. Synthetic fixtures only.
// Run from the HQ root: node_modules/.bin/vite --config modules/design/projects/harness/vite.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../../../.t3/cache/design-projects-harness', import.meta.url)),
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { host: '127.0.0.1', port: 5199, strictPort: true },
  logLevel: 'warn',
});
