import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const harness = fileURLToPath(new URL('.', import.meta.url));
const wiki = fileURLToPath(new URL('../..', import.meta.url));
const nodeModules = fileURLToPath(new URL('../../../../node_modules', import.meta.url));

// Temporary evidence server: explicit loopback only, no HMR socket, no browser launch.
export default defineConfig({
  root: harness,
  cacheDir: process.env['WIKI_UI_VITE_CACHE'] ?? undefined,
  clearScreen: false,
  server: { host: '127.0.0.1', port: 5199, strictPort: true, open: false, hmr: false, fs: { allow: [wiki, nodeModules] } },
});
