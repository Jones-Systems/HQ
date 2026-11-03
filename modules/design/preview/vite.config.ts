// Design integration preview: the assembled Design sections inside a LABELLED FAKE shell.
// Loopback only, synthetic data only. Not root configuration and not the HQ app.
// Run from the HQ root: npx vite --config modules/design/preview/vite.config.ts
import { appendFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const HOST = '127.0.0.1';
const PORT = 5197;
const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * Records every HTTP request and WebSocket upgrade that reaches this server, with
 * the peer address, so a run can show its loopback-only traffic. Set
 * HQD_PREVIEW_REQUEST_LOG to a file path to append JSON lines. It sees only
 * traffic addressed to this server; browser-side observation is in egress.ts.
 */
function requestLog(): Plugin {
  const target = process.env.HQD_PREVIEW_REQUEST_LOG;
  const record = (kind: 'http' | 'upgrade', request: IncomingMessage) => {
    const peer = request.socket.remoteAddress ?? 'unknown';
    const line = {
      at: new Date().toISOString(), kind, method: request.method, url: request.url, host: request.headers.host,
      peer, loopbackPeer: peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1',
    };
    if (target) appendFileSync(target, `${JSON.stringify(line)}\n`);
  };
  return {
    name: 'hqd-preview-request-log',
    configureServer(server) {
      server.httpServer?.on('upgrade', (request: IncomingMessage) => record('upgrade', request));
      server.middlewares.use((request, _response, next) => { record('http', request); next(); });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => { record('http', request); next(); });
    },
  };
}

export default defineConfig({
  root: here('.'),
  // Keep caches and build output in the root install, not in the source tree.
  cacheDir: here('../../../node_modules/.vite/design-preview'),
  plugins: [requestLog()],
  // Exact candidate commit shown in the fake shell; supplied by the operator, never computed here.
  define: { __HQD_CANDIDATE__: JSON.stringify(process.env.HQD_PREVIEW_CANDIDATE ?? 'unrecorded') },
  server: {
    host: HOST, port: PORT, strictPort: true,
    hmr: { host: HOST, port: PORT },
    // Serve Design sources and the root install only.
    fs: { strict: true, allow: [here('..'), here('../../../node_modules'), here('../../../packages/contracts')] },
  },
  preview: { host: HOST, port: PORT, strictPort: true },
  build: { outDir: here('../../../node_modules/.cache/hq-design-preview/dist'), emptyOutDir: true },
});
