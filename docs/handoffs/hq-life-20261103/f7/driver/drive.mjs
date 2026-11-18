// F7 exploration driver: real Electron under Xvfb + bubblewrap, CDP control over a loopback HTTP API.
// Usage: node drive.mjs <repo> <label> <services: example|live|dead> [--no-wiki] [--profile <dir>]
import { createServer, request } from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, label, services = 'example', ...rest] = process.argv.slice(2);
if (!repo || !label) throw new Error('usage: drive.mjs <repo> <label> <services>');
const acc = (p) => import(pathToFileURL(join(repo, 'tests/acceptance', p)).href);
const { createRuntime, connect, until, isolatedEnvironment } = await acc('runtime.mjs');
const { startReadFixture } = await acc('fixtures/http.mjs');
const { createWikiCorpus } = await acc('fixtures/wiki.mjs');
const noWiki = rest.includes('--no-wiki');
const profileIndex = rest.indexOf('--profile');
const evidence = join('/tmp/hq-f7-eval/evidence', label);
await mkdir(evidence, { recursive: true });
const runtime = await createRuntime(join(repo, '.t3/f7-scratch'));
const consoleLog = [];
let log = '';
let cdp, browserCdp, app, svcDown = false;
const profile = profileIndex >= 0 ? rest[profileIndex + 1] : join(runtime.root, 'profile');
for (const dir of ['tmp', 'home', 'config', 'cache']) await mkdir(join(runtime.root, dir));
await mkdir(profile, { recursive: true });
await mkdir(join(runtime.root, 'config/fontconfig'), { recursive: true });
// Host-only substitution so screenshots use a proportional face (this VPS maps sans-serif to Liberation Mono).
const aliases = ['sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'IBM Plex Sans', 'Inter'].map(f => `<match target="pattern"><test name="family"><string>${f}</string></test><edit name="family" mode="prepend" binding="strong"><string>Liberation Sans</string></edit></match>`).join('');
await writeFile(join(runtime.root, 'config/fontconfig/fonts.conf'), `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include>${aliases}</fontconfig>`);
const env = { ...isolatedEnvironment(runtime.root), HQ_USER_DATA_DIR: profile };
const wrapped = (command, args, options = {}) => runtime.spawn('bwrap', ['--die-with-parent', '--unshare-user', '--unshare-pid', '--bind', '/', '/', '--bind', join(runtime.root, 'tmp'), '/tmp', '--bind', repo, repo, '--proc', '/proc', '--dev', '/dev', command, ...args], { cwd: repo, env, ...options });

// ---- services
let planner;
async function startPlannerProcess() {
  const directory = join(runtime.root, 'planner');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let output = '', plog = '';
  const child = runtime.spawn('python3', ['-m', 'planning', '--data', join(directory, 'planning.sqlite3'), '--host', '127.0.0.1', '--port', '0'], {
    cwd: join(repo, 'services/planner'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' } });
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { plog = (plog + d).slice(-8000); });
  const upstream = await until(() => {
    if (child.exitCode !== null) throw new Error('Planner failed: ' + plog);
    return /http:\/\/127\.0\.0\.1:\d+\//.exec(output)?.[0];
  }, 'planner url');
  return { child, upstream };
}
async function proxy(getUpstream, ledger) {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const bytes = Buffer.concat(chunks);
      ledger.push({ method: req.method, path: req.url, down: svcDown, at: new Date().toISOString() });
      if (svcDown) { res.destroy(); return; }
      const target = new URL(req.url, getUpstream());
      const headers = { ...req.headers, host: target.host, 'content-length': String(bytes.length) };
      delete headers['transfer-encoding'];
      const out = request(target, { method: req.method, headers }, incoming => {
        res.writeHead(incoming.statusCode, incoming.headers); incoming.pipe(res);
      });
      out.on('error', () => res.destroy());
      out.end(bytes);
    });
  });
  return runtime.listen(server);
}
const ledgers = { work: [], social: [] };
if (services === 'live') {
  planner = await startPlannerProcess();
  const workOrigin = await proxy(() => planner.upstream, ledgers.work);
  const social = await startReadFixture(runtime, { '/api/workspace': { status: 200, body: { brands: [], content: [], runs: [], tools: [], csrf: 'synthetic-acceptance-token', features: [] } } });
  ledgers.social = social.ledger;
  await writeFile(join(profile, 'service-config.json'), JSON.stringify({ work: workOrigin, social: social.origin }));
} else if (services === 'dead') {
  // Loopback ports with nothing listening: configured but unreachable.
  await writeFile(join(profile, 'service-config.json'), JSON.stringify({ work: 'http://127.0.0.1:9', social: 'http://127.0.0.1:9' }));
}
if (!noWiki && profileIndex < 0) await createWikiCorpus(runtime, repo, profile);

// ---- display
let display = '';
const xvfb = wrapped('/usr/bin/Xvfb', ['-displayfd', '3', '-screen', '0', '1920x1200x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
xvfb.stdio[3].on('data', d => { display += d; });
await until(() => { if (xvfb.exitCode !== null) throw new Error('Xvfb failed'); return /^\d+\s*$/.test(display); }, 'xvfb');
env.DISPLAY = `:${display.trim()}`;

const binary = join(repo, 'node_modules/electron/dist/electron');
const main = join(repo, 'apps/desktop/dist-electron/main.js');
async function launch() {
  let endpoint;
  app = wrapped(binary, [main, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`], { stdio: ['ignore', 'ignore', 'pipe'] });
  app.stderr.on('data', d => { log = (log + d).slice(-32000); endpoint ??= /DevTools listening on (ws:\/\/[^\s]+)/.exec(String(d))?.[1]; });
  await until(() => { if (app.exitCode !== null) throw new Error('Electron exited: ' + log.slice(-2000)); return endpoint; }, 'cdp', 30000);
  const origin = new URL(endpoint);
  const page = await until(async () => (await (await fetch(`http://${origin.host}/json/list`)).json()).find(t => t.type === 'page' && t.url.startsWith('file:')), 'page', 30000);
  cdp = await connect(page.webSocketDebuggerUrl);
  browserCdp = await connect(endpoint);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  cdp.targetId = page.id;
  await until(() => cdp.evaluate(`!!document.querySelector('nav[aria-label="Domains"] button')`), 'shell', 30000);
}
await launch();
async function hookConsole() {
  await cdp.evaluate(`(() => { if (window.__f7) return; window.__f7 = { errors: [] }; const e = console.error.bind(console), w = console.warn.bind(console);
    console.error = (...a) => { window.__f7.errors.push({ level: 'error', text: a.map(String).join(' ').slice(0, 500), at: Date.now() }); e(...a); };
    console.warn = (...a) => { window.__f7.errors.push({ level: 'warn', text: a.map(String).join(' ').slice(0, 500), at: Date.now() }); w(...a); };
    window.addEventListener('error', ev => window.__f7.errors.push({ level: 'exception', text: String(ev.message).slice(0, 500), at: Date.now() }));
    window.addEventListener('unhandledrejection', ev => window.__f7.errors.push({ level: 'rejection', text: String(ev.reason).slice(0, 500), at: Date.now() })); })()`);
}
await hookConsole();

async function windowBounds(width, height) {
  // Electron's browser endpoint lacks Browser.getWindowForTarget; emulate the content size instead.
  if (!width) { await cdp.send('Emulation.clearDeviceMetricsOverride'); return 'cleared'; }
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  return cdp.evaluate('({ w: innerWidth, h: innerHeight })');
}
const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
const KEYS = { Enter: 13, Escape: 27, Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Backspace: 8, Space: 32, ' ': 32, Home: 36, End: 35, Delete: 46, PageDown: 34, PageUp: 33 };
async function key(k, mods = []) {
  const modifiers = mods.reduce((m, x) => m | MOD[x], 0);
  const code = KEYS[k] ?? (k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0);
  const keyCode = k.length === 1 ? `Key${k.toUpperCase()}` : k;
  const text = k.length === 1 && !(modifiers & (MOD.ctrl | MOD.meta | MOD.alt)) ? k : k === 'Enter' ? '\r' : undefined;
  await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code: keyCode, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers, ...(text ? { text, unmodifiedText: text } : {}) });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: keyCode, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers });
}
async function mouse(x, y, type = 'click') {
  if (type === 'move') return cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}
let shotCount = 0;
async function shot(name) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const file = join(evidence, `${String(++shotCount).padStart(2, '0')}-${name}.png`);
  await writeFile(file, Buffer.from(data, 'base64'));
  return file;
}
async function quit() {
  await cdp.send('Browser.close').catch(() => {});
  await until(() => app.exitCode !== null || app.signalCode !== null, 'graceful shutdown', 15000).catch(() => {});
  try { cdp.close(); browserCdp.close(); } catch {}
  await runtime.stop(app);
}
const routes = {
  async eval(body) { return cdp.evaluate(body.expr); },
  async shot(body) { return shot(body.name ?? 'shot'); },
  async key(body) { for (let i = 0; i < (body.repeat ?? 1); i++) await key(body.key, body.mods ?? []); return true; },
  async type(body) { await cdp.send('Input.insertText', { text: body.text }); return true; },
  async click(body) {
    let { x, y } = body;
    if (body.selector || body.text) {
      const r = await cdp.evaluate(`(() => { const all = [...document.querySelectorAll(${JSON.stringify(body.selector ?? 'button, a, [role=button], [role=tab], [role=menuitem], [role=option], summary, input, select, textarea, [tabindex]')})];
        const t = ${JSON.stringify(body.text ?? null)}; const nth = ${body.nth ?? 0};
        const found = all.filter(e => { if (t === null) return true; const s = (e.getAttribute('aria-label') ?? e.textContent ?? '').trim(); return ${body.exact === false ? 's.includes(t)' : 's === t'}; }).filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; });
        const e = found[nth]; if (!e) return { error: 'not found', count: found.length };
        e.scrollIntoView({ block: 'center', inline: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, count: found.length, tag: e.tagName }; })()`);
      if (r.error) return r;
      ({ x, y } = r);
      await mouse(x, y, body.type ?? 'click');
      return r;
    }
    await mouse(x, y, body.type ?? 'click'); return { x, y };
  },
  async window(body) { return windowBounds(body.width, body.height); },
  async media(body) { await cdp.send('Emulation.setEmulatedMedia', { features: body.features ?? [] }); return true; },
  async errors() { return cdp.evaluate('window.__f7?.errors ?? []'); },
  async restart() { await quit(); await launch(); await hookConsole(); return true; },
  async svc(body) { svcDown = body.down; return { down: svcDown }; },
  async ledger() { return ledgers; },
  async log() { return log.slice(-6000); },
  async quit() { setTimeout(async () => { try { await quit(); } finally { const r = await runtime.close().catch(e => String(e)); console.log('closed', JSON.stringify(r)); process.exit(0); } }, 50); return 'bye'; },
};
const control = createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', async () => {
    const route = req.url.slice(1).split('?')[0];
    try {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      if (!routes[route]) throw new Error('unknown route ' + route);
      const value = await routes[route](body);
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, value }));
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: String(error?.stack ?? error) })); }
  });
});
await new Promise(r => control.listen(0, '127.0.0.1', r));
await writeFile(`/tmp/hq-f7-eval/${label}.port`, String(control.address().port));
console.log(`READY ${label} control=${control.address().port} profile=${profile} evidence=${evidence}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { try { await quit(); } catch {} await runtime.close().catch(() => {}); process.exit(1); });
