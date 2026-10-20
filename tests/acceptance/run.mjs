import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime, connect, until as poll, isolatedEnvironment } from './runtime.mjs';

import { setupFixtures } from './fixtures/setup.mjs';
import { row, scenarioGaps, fullOutcome } from './fixtures/results.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const checkpoint = process.argv.includes('--checkpoint');
let cancelled = false;
const onSignal = () => { cancelled = true; };
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);
const evidenceParent = join(repo, '.t3/acceptance-evidence');
await mkdir(evidenceParent, { recursive: true });
const evidence = await mkdtemp(join(evidenceParent, 'run-'));
const runtime = await createRuntime(join(repo, '.t3/acceptance-scratch'));
const report = { schema: 'hq-electron-acceptance/v1', head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), mode: checkpoint ? 'shell-checkpoint' : 'full', sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim().length > 0, checks: [], gaps: [], rows: scenarioGaps(), outcome: 'failed' };
let cdp;
let fixtures;
let activeRow;
const prerequisite = [{ id: 'built-native-app', status: 'pass' }];
function begin(id) { activeRow = id; }
function passed(detail) { report.rows.push(row(activeRow, 'pass', prerequisite, [detail])); activeRow = undefined; }
let log = '';
const until = (probe, label, timeout) => poll(() => { if (cancelled) throw new Error('Harness cancelled'); return probe(); }, label, timeout);
try {
  begin('native-prerequisites');
  if (cancelled) throw new Error('Harness cancelled during startup');
  const binary = join(repo, 'node_modules/electron/dist/electron');
  const main = join(repo, 'apps/desktop/dist-electron/main.js');
  await access(binary);
  await access(main);
  await access(join(repo, 'apps/desktop/dist/index.html'));
  report.build = {};
  for (const path of ['apps/desktop/dist/index.html', 'apps/desktop/dist-electron/main.js', 'apps/desktop/dist-electron/preload.cjs']) report.build[path] = createHash('sha256').update(await readFile(join(repo, path))).digest('hex');
  for (const dir of ['tmp', 'home', 'config', 'cache', 'profile']) await mkdir(join(runtime.root, dir));
  const env = isolatedEnvironment(runtime.root);
  fixtures = await setupFixtures(runtime, repo, env.HQ_USER_DATA_DIR);
  report.fixturePrerequisites = { work: 'owned-loopback', social: 'owned-loopback', wiki: fixtures.wiki.commits, durableClientIntent: 'not-provided-session-only-RW9-G3' };
  const wrapped = (command, args, options = {}) => runtime.spawn('bwrap', ['--die-with-parent', '--unshare-user', '--unshare-pid', '--bind', '/', '/', '--bind', join(runtime.root, 'tmp'), '/tmp', '--bind', repo, repo, '--proc', '/proc', '--dev', '/dev', command, ...args], { cwd: repo, env, ...options });
  let display = '';
  const xvfb = wrapped('/usr/bin/Xvfb', ['-displayfd', '3', '-screen', '0', '1280x900x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
  xvfb.stdio[3].on('data', data => { display += data; });
  xvfb.stderr.on('data', data => { log = (log + data).slice(-32000); });
  await until(() => {
    if (xvfb.exitCode !== null || xvfb.launchError) throw new Error('Platform gap: Xvfb/bubblewrap unavailable');
    return /^\d+\s*$/.test(display);
  }, 'owned Xvfb display');
  env.DISPLAY = `:${display.trim()}`;
  async function launch() {
    let endpoint;
    const child = wrapped(binary, [main, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${join(runtime.root, 'profile')}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', data => {
      log = (log + data).slice(-32000);
      endpoint ??= /DevTools listening on (ws:\/\/[^\s]+)/.exec(String(data))?.[1];
    });
    await until(() => {
      if (child.exitCode !== null || child.launchError) throw new Error('Electron exited before CDP became ready');
      return endpoint;
    }, 'Electron CDP');
    const origin = new URL(endpoint);
    const pages = await until(async () => {
      const targets = await (await fetch(`http://${origin.host}/json/list`)).json();
      return targets.find(target => target.type === 'page' && target.url.startsWith('file:'));
    }, 'production renderer');
    cdp = await connect(pages.webSocketDebuggerUrl, runtime);
    await until(() => cdp.evaluate(`!!document.querySelector('nav[aria-label="Domains"] button')`), 'HQ shell');
    return child;
  }
  async function domain(label) {
    assert.equal(await cdp.evaluate(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Domains"] button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`), true, `${label} navigation exists`);
    await until(() => cdp.evaluate(`document.querySelector('nav[aria-label="Domains"] [aria-current="page"]')?.textContent.trim() === ${JSON.stringify(label)} && document.querySelector('main')?.textContent.trim().length > 0`), `${label} mounted`);
  }
  let app = await launch();
  report.electronVersion = await cdp.evaluate('window.hqDesktop.versions.electron');
  passed('Owned display, built renderer, synthetic fixtures and profile started');
  begin('renderer-isolation');
  assert.equal(await cdp.evaluate(`typeof window.require === 'undefined' && typeof window.process === 'undefined' && !!window.hqDesktop?.versions.electron`), true, 'isolated Electron renderer and preload');
  assert.ok(await cdp.evaluate(`document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content`), 'CSP present');
  report.checks.push('real Electron renderer, isolated globals, preload and CSP present');
  passed(report.checks.at(-1));
  begin('domain-round-trip');
  const labels = await cdp.evaluate(`[...document.querySelectorAll('nav[aria-label="Domains"] button')].map(b => b.textContent.trim())`);
  for (const label of ['Design', 'Social', 'Work', 'Wiki']) {
    if (!labels.includes(label)) { report.gaps.push(`${label} domain not mounted`); report.rows.push(row(`domain-${label}`, 'gap', [{ id: 'domain-mounted', status: 'gap' }])); continue; }
    await domain(label);
  }
  await domain('Design');
  report.checks.push(`domain round trip: ${labels.join(', ')}`);
  passed(report.checks.at(-1));
  begin('shell-restart');
  await cdp.evaluate(`(() => { const s = document.querySelector('#appearance'); s.value = 'dark'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await domain('Work');
  await until(() => cdp.evaluate(`localStorage.getItem('hq.appearance.v1') === 'dark' && JSON.parse(localStorage.getItem('hq.navigation.v1:hq-local')).domain === 'work'`), 'preferences persisted');
  const before = await cdp.evaluate(`({ appearance: localStorage.getItem('hq.appearance.v1'), navigation: localStorage.getItem('hq.navigation.v1:hq-local') })`);
  await writeFile(join(evidence, 'before-restart.png'), Buffer.from((await cdp.send('Page.captureScreenshot')).data, 'base64'));
  await cdp.send('Browser.close').catch(error => { if (error.message !== 'CDP connection closed') throw error; });
  await until(() => app.exitCode !== null, 'graceful Electron shutdown');
  cdp.close();
  await runtime.stop(app);
  app = await launch();
  assert.deepEqual(await cdp.evaluate(`({ appearance: localStorage.getItem('hq.appearance.v1'), navigation: localStorage.getItem('hq.navigation.v1:hq-local') })`), before);
  assert.equal(await cdp.evaluate(`document.querySelector('[aria-current="page"]')?.textContent.trim()`), 'Work');
  assert.equal(await cdp.evaluate(`document.documentElement.dataset.theme`), 'dark');
  report.checks.push('actual process restart restores appearance and selected domain');
  passed(report.checks.at(-1));
  report.gaps.push('live synthetic-service replay, reference round trips and unavailable/unknown scenarios await integrated service/UI binding');
  await writeFile(join(evidence, 'after-restart.png'), Buffer.from((await cdp.send('Page.captureScreenshot')).data, 'base64'));
  report.outcome = checkpoint ? 'checkpoint-passed' : fullOutcome(report.rows);
} catch (error) {
  report.error = error.message;
  report.rows.push(row(activeRow ?? 'harness', cancelled ? 'held' : 'fail', [{ id: 'native-execution', status: cancelled ? 'held' : 'fail' }], [error.message]));
} finally {
  for (const id of ['native-prerequisites', 'renderer-isolation', 'domain-round-trip', 'shell-restart']) {
    if (!report.rows.some(r => r.id === id)) report.rows.push(row(id, 'unmeasured', [{ id: 'preceding-native-check', status: 'held' }]));
  }
  if (fixtures) report.ledgers = { work: fixtures.work.ledger, social: fixtures.social.ledger };
  await writeFile(join(evidence, 'report-before-cleanup.json'), JSON.stringify(report, null, 2) + '\n').catch(error => { report.evidenceError = error.message; report.outcome = 'failed'; });
  await writeFile(join(evidence, 'runtime.log'), log).catch(error => { report.evidenceError = error.message; report.outcome = 'failed'; });
  cdp?.close();
  try { await runtime.close(); report.cleanup = 'passed'; } catch (error) { report.cleanup = 'failed'; report.cleanupError = error.message; report.outcome = 'failed'; }
  if (cancelled) report.outcome = 'cancelled';
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(evidence, 'runtime.log'), log);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Evidence: ${evidence}`);
  process.exitCode = ['passed', 'checkpoint-passed'].includes(report.outcome) ? 0 : 1;
}
