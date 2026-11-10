import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  cacheDir: fileURLToPath(new URL('../../.t3/cache/vite-desktop', import.meta.url)),
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
  plugins: [{
    name: 'hq-development-csp',
    apply: 'serve',
    transformIndexHtml(html) {
      // Vite injects CSS during development and uses a loopback HMR socket.
      return html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
        .replace("connect-src 'none'", "connect-src 'self' ws://127.0.0.1:5173");
    },
  }],
});
