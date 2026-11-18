/**
 * Browser-mode harness for the preview agent. Serves a synthetic page on
 * 127.0.0.1 with the agent's TypeScript stripped to JavaScript in memory, so
 * a real browser can exercise Pick/Cite and re-resolution. Writes no files.
 *
 *   node modules/design/annotations/test/browser/harness.ts [port]
 *
 * It is local check tooling, not part of the shipped module, and proves
 * browser geometry only. Electron preload injection remains root's S2 check.
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AGENT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/preview-agent');
const AGENT_FILES = new Set(['agent', 'dom-path', 'text-quote', 'index']);

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Synthetic annotation harness</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; }
  main { max-width: var(--main-width, 960px); margin: 0 auto; padding: 24px; }
  .spacer { height: 900px; background: linear-gradient(#f4f4f6, #e8e8ee); }
  .actions button { margin-right: 12px; padding: 8px 16px; }
  .banner { height: 180px; background: #dde6f7; }
</style></head>
<body>
<main>
  <h1>Synthetic settings</h1>
  <div class="spacer"></div>
  <p class="intro">Ship the plan. Review the plan today. Then the plan ships.</p>
  <div class="actions"><button type="button">Save</button><button type="button">Cancel</button></div>
  <div class="spacer"></div>
</main>
<script type="module">
  import { installPreviewAgent } from '/agent/index.js';
  window.__events = [];
  window.__pageClicks = 0;
  document.addEventListener('click', () => { window.__pageClicks += 1; });
  window.__agent = installPreviewAgent(window, { post: (event) => window.__events.push(event) });
  /** Re-render: rebuild main with a banner above and a narrower column. */
  window.__rerender = () => {
    const main = document.querySelector('main');
    const html = main.innerHTML;
    main.innerHTML = '<div class="banner"></div>' + html;
    document.documentElement.style.setProperty('--main-width', '640px');
  };
  /** Independent measurement in document CSS px for comparison. */
  window.__measure = (selector) => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
  };
  window.__ready = true;
</script>
</body></html>`;

async function agentModule(name: string): Promise<string> {
  const source = await readFile(join(AGENT_DIR, `${name}.ts`), 'utf8');
  return stripTypeScriptTypes(source, { mode: 'strip' }).replace(/from '\.\/([\w-]+)\.ts'/gu, "from './$1.js'");
}

const port = Number(process.argv[2] ?? 4317);
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const agent = /^\/agent\/([\w-]+)\.js$/u.exec(url.pathname);
  if (url.pathname === '/') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
  } else if (agent !== null && AGENT_FILES.has(agent[1]!)) {
    agentModule(agent[1]!).then(
      (code) => response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' }).end(code),
      () => response.writeHead(500).end(),
    );
  } else {
    response.writeHead(404).end();
  }
});
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`annotation harness on http://127.0.0.1:${port}/\n`);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close(() => process.exit(0)));
