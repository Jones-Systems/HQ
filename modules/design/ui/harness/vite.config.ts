// Local harness for runtime evidence of Design's chrome with a LABELLED FAKE shell.
// Run: npx vite --config modules/design/ui/harness/vite.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { host: '127.0.0.1', port: 5191, strictPort: true },
});
