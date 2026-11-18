// A headless HQ session: the built Electron app under Xvfb inside bubblewrap, driven over CDP.
//
// Built on the repository's own acceptance runtime (tests/acceptance/runtime.mjs and fixtures),
// imported read-only from the repo that holds this tool. The first working version of this
// approach was lane F7's exploration driver.
import { execFile } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { connect, createRuntime, isolatedEnvironment, until } from '../../tests/acceptance/runtime.mjs';
import { startReadFixture } from '../../tests/acceptance/fixtures/http.mjs';
import { createWikiCorpus } from '../../tests/acceptance/fixtures/wiki.mjs';
import { BUSY, NAV, fontconfigXml, formatSize, keyEvents, modeNeedsFixtures, parseMode, pickFace, resolveSize, serviceConfigFor } from './config.mjs';
import { defaultShotsDir, reapStaleRuns, resolveInside, safeFileName, scratchDir, writeOwnerFile } from './files.mjs';
import { currentInPage, findInPage, mountedInPage, pageStateInPage, settleInPage, textVisibleInPage } from './page.mjs';
import { PrerequisiteError, checkPrerequisites, desktopMain, desktopRenderer, electronBinary, installElectron } from './prereq.mjs';

export { PrerequisiteError };

const run = promisify(execFile);

/** The repository that holds this tool (and the acceptance modules it imports). */
export const TOOL_REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const exists = async path => { try { await stat(path); return true; } catch { return false; } };
const MAX_ERRORS = 500;
const MAX_LEDGER = 500;
const PLANNER_URL = /http:\/\/127\.0\.0\.1:\d+\//;

async function repoState(repo) {
  const git = async args => (await run('git', args, { cwd: repo, timeout: 10_000 })).stdout.trim();
  try {
    return {
      head: await git(['rev-parse', 'HEAD']),
      branch: await git(['rev-parse', '--abbrev-ref', 'HEAD']),
      dirty: (await git(['status', '--porcelain'])).length > 0,
    };
  } catch { return { head: null, branch: null, dirty: null }; }
}

/** Warns when source files are newer than the build, since screenshots would show old code. */
export async function buildFreshness(repo) {
  try {
    const built = Math.max((await stat(desktopMain(repo))).mtimeMs, (await stat(desktopRenderer(repo))).mtimeMs);
    const { stdout } = await run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'apps', 'modules', 'packages'], { cwd: repo, maxBuffer: 32 * 1024 * 1024, timeout: 15_000 });
    let newest = { file: null, mtime: 0 };
    for (const file of stdout.split('\0')) {
      if (!/\.(tsx?|css|html|svg|json)$/.test(file) || /(\.test\.|\.d\.ts$|\/tests?\/|\/fixtures\/)/.test(file)) continue;
      try {
        const { mtimeMs } = await stat(join(repo, file));
        if (mtimeMs > newest.mtime) newest = { file, mtime: mtimeMs };
      } catch { /* deleted but still listed */ }
    }
    return { stale: newest.mtime > built + 1000, newestSource: newest.file, builtAt: new Date(built).toISOString(), newestSourceAt: newest.mtime ? new Date(newest.mtime).toISOString() : null };
  } catch { return { stale: null, newestSource: null, builtAt: null, newestSourceAt: null }; }
}

async function installFontAlias(runtime) {
  let families;
  try { families = (await run('fc-list', [':', 'family'], { timeout: 10_000 })).stdout.split(/[\n,]/); }
  catch { return null; }
  const face = pickFace(families);
  if (!face) return null;
  await mkdir(join(runtime.root, 'config/fontconfig'), { recursive: true });
  await writeFile(join(runtime.root, 'config/fontconfig/fonts.conf'), fontconfigXml(face));
  return face;
}

/** Loopback proxy with a request ledger and an on/off switch that refuses connections. */
async function startProxy(runtime, upstream, gate) {
  const ledger = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const bytes = Buffer.concat(chunks);
      ledger.push({ method: req.method, path: req.url, down: gate.down, at: new Date().toISOString() });
      if (ledger.length > MAX_LEDGER) ledger.shift();
      if (gate.down) { res.destroy(); return; }
      const target = new URL(req.url, upstream);
      const headers = { ...req.headers, host: target.host, 'content-length': String(bytes.length) };
      delete headers['transfer-encoding'];
      const outgoing = httpRequest(target, { method: req.method, headers }, incoming => {
        res.writeHead(incoming.statusCode, incoming.headers);
        incoming.pipe(res);
      });
      outgoing.on('error', () => res.destroy());
      outgoing.end(bytes);
    });
  });
  return { origin: await runtime.listen(server), ledger };
}

export async function startSession(options = {}) {
  const repo = resolve(options.repo ?? TOOL_REPO);
  const mode = parseMode(options.mode);
  const baseSize = resolveSize(options.size);
  const wiki = options.wiki !== false;
  const say = options.log ?? (() => {});
  const launchTimeout = options.launchTimeoutMs ?? 45_000;
  const evidenceDir = options.evidenceDir ? resolve(options.evidenceDir) : defaultShotsDir(repo);

  let problems = await checkPrerequisites(repo, { mode });
  if (options.installElectron && problems.some(problem => problem.code === 'electron-binary')) {
    say('Electron binary missing; running node_modules/electron/install.js');
    await installElectron(repo);
    problems = await checkPrerequisites(repo, { mode });
  }
  if (problems.length) throw new PrerequisiteError(problems);

  const startedAt = Date.now();
  const git = await repoState(repo);
  const build = await buildFreshness(repo);
  if (build.stale) say(`WARNING: ${build.newestSource} is newer than the build; run npm run build or screenshots show old code`);

  const scratch = scratchDir(repo);
  for (const reaped of await reapStaleRuns(scratch)) say(`removed stale scratch ${reaped}`);
  const runtime = await createRuntime(scratch);
  try {
    return await assemble();
  } catch (error) {
    await runtime.close().catch(() => {});
    throw error;
  }

  async function assemble() {
    await writeOwnerFile(runtime.root);
    const profile = join(runtime.root, 'profile');
    for (const dir of ['tmp', 'home', 'config', 'cache', 'profile']) await mkdir(join(runtime.root, dir));
    const fontFace = await installFontAlias(runtime);
    if (!fontFace) say('WARNING: no proportional sans face found for the sandbox font alias; text may render monospace');
    const env = { ...isolatedEnvironment(runtime.root), HQ_USER_DATA_DIR: profile };
    const wrapped = (command, args, spawnOptions = {}) => runtime.spawn('bwrap', [
      '--die-with-parent', '--unshare-user', '--unshare-pid', '--bind', '/', '/', '--bind', join(runtime.root, 'tmp'), '/tmp',
      '--bind', repo, repo, '--proc', '/proc', '--dev', '/dev', command, ...args,
    ], { cwd: repo, env, ...spawnOptions });

    // ---- fixtures and profile
    const gates = { work: { down: false }, social: { down: false } };
    const ledgers = { work: [], social: [] };
    const services = { mode };
    if (modeNeedsFixtures(mode)) {
      const plannerRepo = await exists(join(repo, 'services/planner/planning')) ? repo : TOOL_REPO;
      const planner = await launchPlanner(plannerRepo);
      const work = await startProxy(runtime, planner.upstream, gates.work);
      const social = await startReadFixture(runtime, { '/api/workspace': { status: 200, body: { brands: [], content: [], runs: [], tools: [], csrf: 'synthetic-acceptance-token', features: [] } } });
      const socialProxy = await startProxy(runtime, social.origin, gates.social);
      ledgers.work = work.ledger;
      ledgers.social = socialProxy.ledger;
      Object.assign(services, { planner: { examplesCreated: planner.created }, work: 'proxy to real Planner', social: 'read fixture (empty workspace)' });
      await writeFile(join(profile, 'service-config.json'), JSON.stringify(serviceConfigFor(mode, { work: work.origin, social: socialProxy.origin })));
    } else {
      const config = serviceConfigFor(mode);
      if (config) await writeFile(join(profile, 'service-config.json'), JSON.stringify(config));
      Object.assign(services, mode === 'offline' ? { work: 'configured, unreachable', social: 'configured, unreachable' } : { work: 'built-in examples', social: 'built-in examples' });
    }
    if (wiki) {
      const corpusRepo = await exists(join(repo, 'modules/wiki/app/fixtures/corpus')) ? repo : TOOL_REPO;
      await createWikiCorpus(runtime, corpusRepo, profile);
    }
    services.wiki = wiki ? 'synthetic corpus' : 'not configured';

    async function launchPlanner(plannerRepo) {
      const directory = join(runtime.root, 'planner');
      await mkdir(directory, { mode: 0o700 });
      let output = '';
      let diagnostic = '';
      const child = wrapped('python3', ['-m', 'planning', '--data', join(directory, 'planning.sqlite3'), '--host', '127.0.0.1', '--port', '0'], {
        cwd: join(plannerRepo, 'services/planner'), stdio: ['ignore', 'pipe', 'pipe'],
        env: { PATH: process.env.PATH, HOME: directory, TMPDIR: directory, PYTHONDONTWRITEBYTECODE: '1', PYTHONUNBUFFERED: '1' },
      });
      child.stdout.on('data', data => { output = (output + data).slice(-8000); });
      child.stderr.on('data', data => { diagnostic = (diagnostic + data).slice(-8000); });
      const upstream = await until(() => {
        if (child.exitCode !== null || child.launchError) throw new Error(`Planner failed to start: ${diagnostic || child.launchError}`);
        return PLANNER_URL.exec(output)?.[0];
      }, 'Planner URL', 20_000);
      // POST /api/examples needs a JSON body and the custom request header; a second call answers 409.
      const response = await fetch(new URL('api/examples', upstream), {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-planning-request': '1' }, body: '{}', signal: AbortSignal.timeout(15_000),
      });
      if (response.status !== 201 && response.status !== 409) throw new Error(`Planner refused example data (${response.status}): ${await response.text()}`);
      return { upstream, created: response.status === 201 ? (await response.json()).created : 0 };
    }

    // ---- display and app
    const screenWidth = Math.max(1920, baseSize.width);
    const screenHeight = Math.max(1200, baseSize.height);
    let display = '';
    const xvfb = wrapped('Xvfb', ['-displayfd', '3', '-screen', '0', `${screenWidth}x${screenHeight}x24`, '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
    let xvfbLog = '';
    xvfb.stderr.on('data', data => { xvfbLog = (xvfbLog + data).slice(-4000); });
    xvfb.stdio[3].on('data', data => { display += data; });
    await until(() => {
      if (xvfb.exitCode !== null || xvfb.launchError) throw new Error(`Xvfb failed to start under bubblewrap: ${xvfbLog}`);
      return /^\d+\s*$/.test(display);
    }, 'Xvfb display', 20_000);
    env.DISPLAY = `:${display.trim()}`;

    let app;
    let cdp;
    let tap;
    let appLog = '';
    let viewport = { ...baseSize };
    let media = {};
    let shotCount = 0;
    let sequence = 0;
    let closePromise;
    const errors = [];
    const scrubs = [[runtime.root, '<scratch>'], [repo, '<repo>'], [TOOL_REPO, '<tool-repo>'], [homedir(), '~']]
      .filter(([path]) => path.length > 1).sort((a, b) => b[0].length - a[0].length);
    const scrub = text => scrubs.reduce((value, [path, label]) => value.replaceAll(path, label), String(text ?? '')).slice(0, 500);

    function record(message) {
      const { method, params } = message;
      let entry;
      if (method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(params.type)) {
        entry = { level: params.type === 'warning' ? 'warn' : 'error', text: params.args.map(arg => arg.value ?? arg.description ?? arg.type).join(' ') };
      } else if (method === 'Runtime.exceptionThrown') {
        const detail = params.exceptionDetails;
        entry = { level: 'exception', text: detail.exception?.description?.split('\n')[0] ?? detail.text, url: detail.url };
      } else if (method === 'Log.entryAdded' && ['error', 'warning'].includes(params.entry.level)) {
        entry = { level: params.entry.level === 'warning' ? 'log-warn' : 'log-error', text: params.entry.text, url: params.entry.url };
      }
      if (!entry) return;
      errors.push({ seq: ++sequence, at: new Date().toISOString(), level: entry.level, text: scrub(entry.text), ...(entry.url ? { url: scrub(entry.url) } : {}) });
      if (errors.length > MAX_ERRORS) errors.shift();
    }

    /** A second connection that only listens, so the page is never modified to observe it. */
    async function openTap(url) {
      const socket = new WebSocket(url);
      runtime.own('CDP event tap', async () => { try { socket.close(); } catch { /* already closed */ } });
      await new Promise((resolveOpen, rejectOpen) => {
        socket.addEventListener('open', resolveOpen, { once: true });
        socket.addEventListener('error', rejectOpen, { once: true });
      });
      socket.addEventListener('message', ({ data }) => { try { record(JSON.parse(data)); } catch { /* not an event we track */ } });
      socket.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
      socket.send(JSON.stringify({ id: 2, method: 'Log.enable' }));
      return socket;
    }

    async function evaluate(expression) {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description?.split('\n')[0] ?? result.exceptionDetails.text);
      return result.result.value ?? null;
    }
    const inPage = (fn, argument) => evaluate(`(${fn})(${JSON.stringify(argument)})`);

    async function applyEmulation() {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Emulation.setEmulatedMedia', { features: Object.entries(media).map(([name, value]) => ({ name, value })) });
    }

    async function launch() {
      let endpoint;
      const child = wrapped(electronBinary(repo), [desktopMain(repo), '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`], { stdio: ['ignore', 'ignore', 'pipe'] });
      app = child;
      child.stderr.on('data', data => {
        appLog = (appLog + data).slice(-32_000);
        endpoint ??= /DevTools listening on (ws:\/\/[^\s]+)/.exec(String(data))?.[1];
      });
      await until(() => {
        if (child.exitCode !== null || child.launchError) throw new Error(`Electron exited before it was ready:\n${appLog.slice(-2000)}`);
        return endpoint;
      }, 'Electron DevTools endpoint', launchTimeout);
      const origin = new URL(endpoint);
      const page = await until(async () => (await (await fetch(`http://${origin.host}/json/list`)).json()).find(target => target.type === 'page' && target.url.startsWith('file:')), 'application page', launchTimeout);
      cdp = await connect(page.webSocketDebuggerUrl, runtime);
      tap = await openTap(page.webSocketDebuggerUrl);
      try {
        await until(() => inPage(mountedInPage, { mounted: NAV.mounted }), 'application UI to mount', launchTimeout);
      } catch (error) {
        throw new Error(`${error.message}; console: ${JSON.stringify(errors.slice(-5))}; log: ${appLog.slice(-1000)}`, { cause: error });
      }
      await applyEmulation();
    }

    async function stopApp() {
      const current = app;
      if (!current) return;
      try { await cdp?.send('Browser.close'); } catch { /* already going away */ }
      await until(() => current.exitCode !== null || current.signalCode !== null, 'graceful Electron shutdown', 15_000).catch(() => {});
      try { cdp?.close(); tap?.close(); } catch { /* closed */ }
      await runtime.stop(current);
    }

    await launch();
    const electronVersion = await inPage(pageStateInPage, { current: NAV.current }).then(state => state.electron).catch(() => null);

    // ---- operations
    const settle = ({ timeout = 4000 } = {}) => inPage(settleInPage, { timeout, busy: BUSY });
    const pageState = () => inPage(pageStateInPage, { current: NAV.current });

    async function mouse(x, y) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    }
    const describeTarget = spec => spec.selector ? `selector ${spec.selector}${spec.text ? ` with text "${spec.text}"` : ''}` : `text "${spec.text}"`;

    async function click(spec) {
      if (spec.x !== undefined) { await mouse(spec.x, spec.y); return { x: spec.x, y: spec.y }; }
      const found = await inPage(findInPage, { ...spec, act: true });
      if (!found.count) throw new Error(`click: nothing visible matches ${describeTarget(spec)}`);
      if (found.missingNth) throw new Error(`click: only ${found.count} visible match${found.count === 1 ? '' : 'es'} for ${describeTarget(spec)}, no index ${spec.nth}`);
      if (found.disabled && !spec.force) throw new Error(`click: ${describeTarget(spec)} is disabled`);
      if (!found.hit && !spec.force) throw new Error(`click: ${describeTarget(spec)} is covered by ${found.covered ?? 'another element'}; use --force to click anyway`);
      await mouse(found.x, found.y);
      return found;
    }

    /** Confirms a navigation click landed: the item is marked current, or failing that the page has content. */
    async function confirmLanding(name) {
      const query = () => inPage(currentInPage, { current: NAV.current, name });
      try { await until(async () => (await query()).match, `${name} to become current`, 3000); return 'aria-current'; }
      catch {
        const state = await query();
        return state.names.length === 0 && state.hasContent ? 'content' : null;
      }
    }

    async function navigate(name, scope) {
      let target;
      try { target = await click({ text: name, scope, nth: 0 }); }
      catch (error) {
        if (!/nothing visible matches/.test(error.message)) throw error;
        target = await click({ text: name, scope, contains: true, nth: 0 });
      }
      const landed = await confirmLanding(name);
      return { name, scoped: target.scoped, landed };
    }

    const operations = {
      settle,
      pageState,
      click,
      eval: evaluate,
      async shot(name, { settle: doSettle = true, dir = evidenceDir, prefix = true } = {}) {
        const settled = doSettle ? await settle() : null;
        const bytes = Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64');
        await mkdir(dir, { recursive: true });
        const file = resolveInside(dir, `${prefix ? `${String(++shotCount).padStart(2, '0')}-` : ''}${safeFileName(name)}.png`);
        await writeFile(file, bytes);
        return { file, bytes: bytes.length, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), settled };
      },
      async key(key, mods = [], repeat = 1) {
        for (let index = 0; index < repeat; index++) for (const event of keyEvents(key, mods)) await cdp.send('Input.dispatchKeyEvent', event);
        return true;
      },
      async type(text) { await cdp.send('Input.insertText', { text }); return true; },
      async window(spec) {
        viewport = spec.reset ? { ...baseSize } : { width: spec.width, height: spec.height };
        await applyEmulation();
        return inPage(() => ({ width: innerWidth, height: innerHeight }), {});
      },
      async media(spec) {
        media = spec.reset ? {} : { ...media, ...spec.features };
        await applyEmulation();
        const wanted = media['prefers-color-scheme'];
        if (wanted === 'light' || wanted === 'dark') await until(async () => (await pageState()).theme === wanted, 'theme to follow the color scheme', 1500).catch(() => {});
        return { media: { ...media }, theme: (await pageState()).theme };
      },
      async errors({ since = 0, clear = false } = {}) {
        const entries = errors.filter(entry => entry.seq > since);
        if (clear) errors.length = 0;
        return { entries, lastSeq: sequence };
      },
      async restart() {
        await stopApp();
        await launch();
        return true;
      },
      async svc(down, target = 'all') {
        if (!modeNeedsFixtures(mode)) throw new Error(`svc needs live mode (this session is ${mode})`);
        for (const name of ['work', 'social']) if (target === 'all' || target === name) gates[name].down = down;
        return { work: { down: gates.work.down }, social: { down: gates.social.down } };
      },
      async ledger() { return { work: [...ledgers.work], social: [...ledgers.social] }; },
      async log() { return appLog.slice(-6000); },
      openDomain: name => navigate(name, [...NAV.domainScopes]),
      openSettings: () => navigate(NAV.settingsName, [...NAV.settingsScopes]),
      async wait(spec) {
        if (spec.ms !== undefined) { await delay(spec.ms); return { waited: spec.ms }; }
        const started = Date.now();
        const present = spec.selector
          ? async () => (await inPage(findInPage, { selector: spec.selector, text: spec.text, contains: true })).count > 0
          : () => inPage(textVisibleInPage, { text: spec.text });
        await until(present, `${describeTarget(spec)} to appear`, spec.timeout);
        return { waited: Date.now() - started };
      },
      async status() {
        return {
          mode, size: formatSize(baseSize), viewport, media: { ...media }, wiki, services, fontFace,
          repo: git, build, electron: electronVersion, uptimeMs: Date.now() - startedAt, consoleEntries: sequence,
          down: { work: gates.work.down, social: gates.social.down },
        };
      },
    };

    return {
      ...operations,
      info: Object.freeze({ mode, size: formatSize(baseSize), wiki, repo: git, build, services, fontFace, electron: electronVersion, evidenceDir, startedAt: new Date(startedAt).toISOString() }),
      runtimeRoot: runtime.root,
      /** Stops the app, fixtures and display, and removes all scratch. Safe to call more than once. */
      close() {
        return closePromise ??= (async () => {
          await stopApp().catch(error => say(`stopping the app: ${error.message}`));
          return runtime.close();
        })();
      },
    };
  }
}
