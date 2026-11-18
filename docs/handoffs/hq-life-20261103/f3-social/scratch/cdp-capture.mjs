#!/usr/bin/env node
// Lane F3 scratch capture tool (not part of the HQ repo). Drives headless Chromium over CDP with Node's
// built-in WebSocket: node cdp-capture.mjs <scenario.mjs> <outDir>
// A scenario module default-exports { url, width?, height?, shots: [{ name, theme?, reducedMotion?, steps: [step...] }] }.
// Steps: { click: 'Accessible name or text' [, role:'button'|'tab'|'link'|any] }, { eval: 'js expression' },
//        { wait: ms }, { waitFor: 'js expression returning truthy' }, { type: 'text', into: 'css selector' },
//        { key: 'Enter'|'Escape'|... }, { scroll: 'css selector' [, y] }
// Font note: on this Linux host fontconfig maps sans-serif/system-ui to Liberation Mono. Unless FONT=host,
// every page gets --hq-font-family-sans: "Liberation Sans" so captures approximate a desktop sans stack.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const [scenarioPath, outDir] = process.argv.slice(2);
if (!scenarioPath || !outDir) { console.error('usage: cdp-capture.mjs <scenario.mjs> <outDir>'); process.exit(2); }
const scenario = (await import(pathToFileURL(resolve(scenarioPath)).href)).default;
mkdirSync(outDir, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'hq-f3-chrome-'));
const chrome = spawn(process.env.CHROME || '/usr/bin/chromium', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let chromeErr = ''; chrome.stderr.on('data', (d) => { chromeErr += d; });
const cleanup = () => { try { chrome.kill('SIGTERM'); } catch {} setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch {} }, 300); };
process.on('exit', cleanup);

async function json(path) { for (let i = 0; i < 100; i++) { try { const r = await fetch(`http://127.0.0.1:${port}${path}`); return await r.json(); } catch { await new Promise((r) => setTimeout(r, 100)); } } throw new Error('chromium did not start: ' + chromeErr.slice(-400)); }
const targets = await json('/json/list');
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let seq = 0; const pending = new Map(); const consoleLines = [];
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const { res, rej } = pending.get(msg.id); pending.delete(msg.id); msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result); }
  else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) consoleLines.push(`${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  else if (msg.method === 'Runtime.exceptionThrown') consoleLines.push('exception: ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text)); };
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
await send('Page.enable'); await send('Runtime.enable');
const width = scenario.width ?? 1280; const height = scenario.height ?? 800;
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FONT = `document.documentElement.style.setProperty('--hq-font-family-sans', '"Liberation Sans", Arial, sans-serif');`;
const CLICK = (name, role) => `(() => { const want = ${JSON.stringify(name)}; const role = ${JSON.stringify(role ?? null)};
  const sel = role === 'tab' ? '[role=tab]' : role === 'link' ? 'a,[role=link]' : role === 'any' ? 'button,a,[role=tab],[role=button],[role=option],[role=menuitem],summary,label,input,[tabindex]' : 'button,[role=button],summary';
  const norm = (s) => (s ?? '').replace(/\\s+/g, ' ').trim();
  const els = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null || e.getClientRects().length);
  const el = els.find((e) => norm(e.getAttribute('aria-label')) === want) ?? els.find((e) => norm(e.textContent) === want) ?? els.find((e) => norm(e.getAttribute('aria-label') ?? e.textContent).startsWith(want));
  if (!el) throw new Error('no clickable ' + want); el.scrollIntoView({ block: 'center' }); el.click(); return norm(el.textContent).slice(0, 40); })()`;
const results = [];
for (const shot of scenario.shots) {
  await send('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: shot.theme === 'dark' ? 'dark' : 'light' },
    { name: 'prefers-reduced-motion', value: shot.reducedMotion ? 'reduce' : 'no-preference' } ] });
  if (shot.url !== null) { await send('Page.navigate', { url: shot.url ?? scenario.url }); await sleep(shot.loadWait ?? 1200); }
  if (process.env.FONT !== 'host') await evaluate(FONT);
  try {
    for (const step of shot.steps ?? []) {
      if (step.click) await evaluate(CLICK(step.click, step.role));
      else if (step.eval) await evaluate(step.eval);
      else if (step.waitFor) { let ok = false; for (let i = 0; i < 100 && !ok; i++) { ok = await evaluate(step.waitFor); if (!ok) await sleep(50); } if (!ok) throw new Error('waitFor timed out: ' + step.waitFor); }
      else if (step.type !== undefined) { await evaluate(`document.querySelector(${JSON.stringify(step.into)}).focus()`); await send('Input.insertText', { text: step.type }); }
      else if (step.key) { for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: step.key, code: step.code ?? step.key, windowsVirtualKeyCode: step.vk ?? 0, modifiers: step.modifiers ?? 0 }); }
      else if (step.scroll) await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(step.scroll)}); if (e) e.scrollTop = ${step.y ?? 0}; })()`);
      if (step.wait) await sleep(step.wait); else await sleep(step.after ?? 150);
    }
    if (process.env.FONT !== 'host') await evaluate(FONT);
    await sleep(shot.settle ?? 400);
    const shotData = await send('Page.captureScreenshot', { format: 'png', ...(shot.full ? { captureBeyondViewport: true } : {}) });
    const file = join(outDir, `${shot.name}.png`); writeFileSync(file, Buffer.from(shotData.data, 'base64'));
    results.push({ name: shot.name, file, ok: true });
  } catch (error) { results.push({ name: shot.name, ok: false, error: String(error.message ?? error) }); }
}
console.log(JSON.stringify({ results, console: consoleLines.slice(0, 40) }, null, 1));
ws.close(); cleanup(); setTimeout(() => process.exit(0), 400);
