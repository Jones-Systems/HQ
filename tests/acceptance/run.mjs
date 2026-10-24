import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime, connect, until as poll, isolatedEnvironment } from './runtime.mjs';

import { BUILD_SCHEMA, collectBuildInventory, inventoryDigest } from './build-inventory.mjs';
import { bindHostGallery } from './fixtures/host-gallery.mjs';
import { setupFixtures } from './fixtures/setup.mjs';
import { row, scenarioGaps, fullOutcome, selectedOutcome, routineOutcome, replaceRow } from './fixtures/results.mjs';
import { workScenarios } from './scenarios/work.mjs';
import { localFolderScenario, galleryScenario } from './scenarios/sources.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const hostIndex = args.indexOf('--gallery-host');
const hostBinding = hostIndex < 0 ? undefined : args.splice(hostIndex, 2)[1];
const checkpoint = args.includes('--checkpoint');
const selected = args.includes('--selected');
const routine = args.includes('--routine');
const galleryOnly = args.includes('--gallery-only');
if (args.some(arg => !['--checkpoint', '--selected', '--routine', '--gallery-only'].includes(arg)) ||
    [checkpoint, selected, routine, galleryOnly].filter(Boolean).length > 1 ||
    (hostIndex >= 0 && !hostBinding) || ((checkpoint || routine) && hostBinding) || (galleryOnly && !hostBinding)) {
  throw new Error('Use --checkpoint, --routine, --selected, --gallery-only --gallery-host <binding.json>, or full; optional --gallery-host with selected/full');
}
let cancelled = false;
const onSignal = () => { cancelled = true; };
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);
const evidenceParent = join(repo, '.t3/acceptance-evidence');
await mkdir(evidenceParent, { recursive: true });
const evidence = await mkdtemp(join(evidenceParent, 'run-'));
const startedAt = performance.now();
const report = { schema: 'hq-electron-acceptance/v1', head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), mode: galleryOnly ? 'distinct-host-gallery' : checkpoint ? 'shell-checkpoint' : routine ? 'routine-journeys' : selected ? 'selected-scenarios' : 'full', sourceDirty: execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim().length > 0, platform: process.platform, nodeVersion: process.version, viewport: { width: 1280, height: 900 }, checks: [], gaps: [], rows: scenarioGaps(), timings: {}, outcome: 'failed' };
const runtime = await createRuntime(join(repo, '.t3/acceptance-scratch'));
let cdp;
let fixtures;
let activeRow;
let buildInventory;
const prerequisite = [{ id: 'built-native-app', status: 'pass' }];
let rowStarted;
function begin(id) { activeRow = id; rowStarted = performance.now(); }
function finish(status, detail) {
  report.timings[activeRow] = Math.round(performance.now() - rowStarted);
  replaceRow(report.rows, row(activeRow, status, prerequisite, [detail])); activeRow = undefined;
}
function passed(detail) { finish('pass', detail); }
let log = '';
const until = (probe, label, timeout) => poll(() => { if (cancelled) throw new Error('Harness cancelled'); return probe(); }, label, timeout);
try {
  begin('native-prerequisites');
  if (cancelled) throw new Error('Harness cancelled during startup');
  const darwin = process.platform === 'darwin';
  const binary = join(repo, 'node_modules/electron/dist', darwin ? 'Electron.app/Contents/MacOS/Electron' : 'electron');
  const main = join(repo, 'apps/desktop/dist-electron/main.js');
  await access(binary);
  await access(main);
  await access(join(repo, 'apps/desktop/dist/index.html'));
  report.harness = {};
  for (const path of ['run.mjs', 'runtime.mjs', 'build-inventory.mjs', 'fixtures/setup.mjs', 'fixtures/remote-gallery.mjs', 'fixtures/host-gallery.mjs', 'scenarios/sources.mjs', 'scenarios/ui.mjs', 'scenarios/work.mjs']) report.harness[path] = createHash('sha256').update(await readFile(join(repo, 'tests/acceptance', path))).digest('hex');
  buildInventory = await collectBuildInventory(repo);
  await writeFile(join(evidence, 'build-inventory.json'), JSON.stringify(buildInventory, null, 2) + '\n');
  report.build = {};
  for (const path of ['apps/desktop/dist/index.html', 'apps/desktop/dist-electron/main.js', 'apps/desktop/dist-electron/preload.cjs']) report.build[path] = buildInventory.files.find(file => file.path === path).sha256;
  for (const dir of ['tmp', 'home', 'config', 'cache', 'profile']) await mkdir(join(runtime.root, dir));
  const env = isolatedEnvironment(runtime.root);
  if (darwin) {
    env.TMPDIR = join(runtime.root, 'tmp');
    delete env.DISPLAY;
  }
  const fixtureStarted = performance.now();
  fixtures = await setupFixtures(runtime, repo, env.HQ_USER_DATA_DIR, { scenarios: !checkpoint && !galleryOnly, localFolders: !checkpoint && !galleryOnly && !routine, observe: partial => { fixtures = partial; } });
  if (hostBinding) fixtures.hostGallery = await bindHostGallery(hostBinding);
  report.timings.fixtureSetupMs = Math.round(performance.now() - fixtureStarted);
  report.fixturePrerequisites = { work: checkpoint || galleryOnly ? 'read-only-loopback' : 'real-owned-Planner-and-recording-proxy', social: 'read-only-loopback', wiki: fixtures.wiki.commits, durableClientIntent: 'not-provided-session-only-RW9-G3' };
  // Darwin uses owned process groups, without Linux PID/user namespaces.
  const wrapped = darwin
    ? (command, args, options = {}) => runtime.spawn(command, args, { cwd: repo, env, ...options })
    : (command, args, options = {}) => runtime.spawn('bwrap', ['--die-with-parent', '--unshare-user', '--unshare-pid', '--bind', '/', '/', '--bind', join(runtime.root, 'tmp'), '/tmp', '--bind', repo, repo, '--proc', '/proc', '--dev', '/dev', command, ...args], { cwd: repo, env, ...options });
  if (!darwin) {
    let display = '';
    const xvfb = wrapped('/usr/bin/Xvfb', ['-displayfd', '3', '-screen', '0', '1280x900x24', '-nolisten', 'tcp'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
    xvfb.stdio[3].on('data', data => { display += data; });
    xvfb.stderr.on('data', data => { log = (log + data).slice(-32000); });
    await until(() => {
      if (xvfb.exitCode !== null || xvfb.launchError) throw new Error('Platform gap: Xvfb/bubblewrap unavailable');
      return /^\d+\s*$/.test(display);
    }, 'owned Xvfb display');
    env.DISPLAY = `:${display.trim()}`;
  }
  async function launch() {
    const launchStarted = performance.now();
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
    (report.timings.electronLaunchMs ??= []).push(Math.round(performance.now() - launchStarted));
    return child;
  }
  async function domain(label) {
    assert.equal(await cdp.evaluate(`(() => { const b = [...document.querySelectorAll('nav[aria-label="Domains"] button')].find(b => b.textContent.trim() === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`), true, `${label} navigation exists`);
    await until(() => cdp.evaluate(`document.querySelector('nav[aria-label="Domains"] [aria-current="page"]')?.textContent.trim() === ${JSON.stringify(label)} && document.querySelector('main')?.textContent.trim().length > 0`), `${label} mounted`);
  }
  let app = await launch();
  async function stopApp() {
    await cdp.send('Browser.close').catch(error => { if (error.message !== 'CDP connection closed') throw error; });
    await until(() => app.exitCode !== null || app.signalCode !== null, 'graceful Electron shutdown');
    cdp.close(); await runtime.stop(app);
  }
  async function launchApp() { app = await launch(); }
  async function restartApp() { await stopApp(); await launchApp(); }
  async function capture(name) { await writeFile(join(evidence, `${name}.png`), Buffer.from((await cdp.send('Page.captureScreenshot')).data, 'base64')); }
  report.electronVersion = await cdp.evaluate('window.hqDesktop.versions.electron');
  passed(darwin
    ? 'Native macOS display, owned process groups, built renderer, synthetic fixtures and profile started; Linux namespaces unavailable'
    : 'Owned display, built renderer, synthetic fixtures and profile started');
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
  for (let step = 0; step < 3; step++) {
    if (await cdp.evaluate(`localStorage.getItem('hq.appearance.v1') === 'dark'`)) break;
    assert.equal(await cdp.evaluate(`(() => { const button = document.querySelector('button[aria-label^="Appearance:"]'); if (!button) return false; button.click(); return true; })()`), true, 'appearance cycle button exists');
    await until(() => cdp.evaluate(`localStorage.getItem('hq.appearance.v1') === document.querySelector('button[aria-label^="Appearance:"]')?.getAttribute('aria-label')?.split(': ')[1]?.toLowerCase()`), 'appearance cycle persisted');
  }
  await domain('Work');
  await until(() => cdp.evaluate(`localStorage.getItem('hq.appearance.v1') === 'dark' && JSON.parse(localStorage.getItem('hq.navigation.v1:hq-local')).domain === 'work'`), 'preferences persisted');
  const before = await cdp.evaluate(`({ appearance: localStorage.getItem('hq.appearance.v1'), navigation: localStorage.getItem('hq.navigation.v1:hq-local') })`);
  await capture('before-restart');
  await restartApp();
  assert.deepEqual(await cdp.evaluate(`({ appearance: localStorage.getItem('hq.appearance.v1'), navigation: localStorage.getItem('hq.navigation.v1:hq-local') })`), before);
  assert.equal(await cdp.evaluate(`document.querySelector('[aria-current="page"]')?.textContent.trim()`), 'Work');
  assert.equal(await cdp.evaluate(`document.documentElement.dataset.theme`), 'dark');
  report.checks.push('actual process restart restores appearance and selected domain');
  passed(report.checks.at(-1));
  await capture('after-restart');
  if (!checkpoint) {
    const context = { fixtures, profile: env.HQ_USER_DATA_DIR, cdp: () => cdp, until, domain, begin, passed,
      held: detail => finish('held', detail), stopApp, launchApp, restartApp, capture };
    // Each independent scenario retains its own first failure; no behavior retries.
    for (const scenario of [...(galleryOnly ? [] : [workScenarios, ...(routine ? [] : [localFolderScenario]), galleryScenario]), ...(hostBinding ? [ctx => galleryScenario(ctx, fixtures.hostGallery)] : [])]) {
      try { await scenario(context); }
      catch (error) {
        if (cancelled) throw error;
        await capture(`${activeRow}-failure`).catch(() => {});
        finish('fail', { error: error.stack ?? error.message });
      }
    }
  }
  report.gaps = report.rows.filter(r => ['gap', 'held', 'unmeasured'].includes(r.status)).map(r => r.id);
  report.outcome = galleryOnly ? (['native-prerequisites', 'renderer-isolation', 'domain-round-trip', 'shell-restart', 'remote-gallery-distinct-host'].every(id => report.rows.find(r => r.id === id)?.status === 'pass') && !report.rows.some(r => r.status === 'fail') ? 'gallery-host-passed' : 'failed') : checkpoint ? 'checkpoint-passed' : routine ? routineOutcome(report.rows) : selected ? selectedOutcome(report.rows, { distinctHost: !!hostBinding }) : fullOutcome(report.rows);
} catch (error) {
  report.error = error.message;
  replaceRow(report.rows, row(activeRow ?? 'harness', cancelled ? 'held' : 'fail', [{ id: 'native-execution', status: cancelled ? 'held' : 'fail' }], [error.message]));
} finally {
  for (const id of ['native-prerequisites', 'renderer-isolation', 'domain-round-trip', 'shell-restart']) {
    if (!report.rows.some(r => r.id === id)) report.rows.push(row(id, 'unmeasured', [{ id: 'preceding-native-check', status: 'held' }]));
  }
  if (fixtures) {
    report.ledgers = { work: fixtures.work?.ledger, social: fixtures.social?.ledger, gallery: fixtures.gallery?.ledger };
    report.planner = fixtures.work?.processes;
    if (fixtures.hostGallery) {
      report.hostGallery = { binding: fixtures.hostGallery.binding, observations: fixtures.hostGallery.observations };
      try { await fixtures.hostGallery.restore(); } catch (error) { report.hostRestoreError = error.message; report.outcome = 'failed'; }
    }
    log += fixtures.work?.log ?? '';
  }
  report.timings.totalBeforeCleanupMs = Math.round(performance.now() - startedAt);
  await writeFile(join(evidence, 'report-before-cleanup.json'), JSON.stringify(report, null, 2) + '\n').catch(error => { report.evidenceError = error.message; report.outcome = 'failed'; });
  await writeFile(join(evidence, 'runtime.log'), log).catch(error => { report.evidenceError = error.message; report.outcome = 'failed'; });
  cdp?.close();
  try { report.cleanupReadback = await runtime.close(); report.cleanup = 'passed'; } catch (error) { report.cleanup = 'failed'; report.cleanupError = error.message; report.outcome = 'failed'; }
  if (buildInventory) {
    try {
      assert.equal(inventoryDigest(await collectBuildInventory(repo)), inventoryDigest(buildInventory), 'Build changed during acceptance');
      assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), report.head, 'Source head changed during acceptance');
      report.sourceDirty ||= execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim().length > 0;
      report.buildIdentity = { schema: BUILD_SCHEMA, sha256: inventoryDigest(buildInventory) };
    } catch (error) {
      report.buildBindingError = error.message;
      report.outcome = 'failed';
      replaceRow(report.rows, row('build-binding', 'fail', [{ id: 'unchanged-build-and-source', status: 'fail' }], [error.message]));
    }
  }
  report.timings.totalMs = Math.round(performance.now() - startedAt);
  if (cancelled) report.outcome = 'cancelled';
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await writeFile(join(evidence, 'runtime.log'), log);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Evidence: ${evidence}`);
  process.exitCode = ['passed', 'checkpoint-passed', 'routine-passed', 'selected-passed', 'gallery-host-passed'].includes(report.outcome) ? 0 : 1;
}
