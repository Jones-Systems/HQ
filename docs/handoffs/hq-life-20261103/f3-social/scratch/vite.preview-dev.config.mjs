// Scratch dev server for the HQ browser preview (lane F3 evidence only; not part of the repo).
const ROOT = process.env.HQ_ROOT;
export default {
  root: `${ROOT}/apps/desktop/preview`,
  publicDir: false,
  resolve: { alias: { '/src': `${ROOT}/apps/desktop/src` } },
  define: { __PREVIEW_REVISION__: JSON.stringify('0'.repeat(40)) },
  server: { host: '127.0.0.1', port: Number(process.env.HQ_PORT || 5310), strictPort: true, fs: { allow: [ROOT] } },
  plugins: [{
    name: 'hq-f3-dev-csp', apply: 'serve',
    transformIndexHtml(html) {
      return html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
        .replace("connect-src 'none'", `connect-src 'self' ws://127.0.0.1:${process.env.HQ_PORT || 5310}`);
    },
  }],
};
