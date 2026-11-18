#!/usr/bin/env node
// One command: start a session, visit each domain in light and dark (at each size), save PNGs and a
// manifest, and always clean up. See docs/dev-preview.md.
import { readFile, rmdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { CAPTURE_HELP, parseCaptureArgs } from './args.mjs';
import { fail, say } from './cli.mjs';
import { DOMAINS, UsageError, formatSize } from './config.mjs';
import { perform } from './control.mjs';
import { MANIFEST_SCHEMA, defaultShotsDir, prepareOutputDir } from './files.mjs';
import { TOOL_REPO, startSession } from './session.mjs';
import { normalizeSteps } from './steps.mjs';

try {
  const options = parseCaptureArgs(process.argv.slice(2), { repo: TOOL_REPO });
  if (options.help) { process.stdout.write(CAPTURE_HELP); process.exit(0); }
  process.exitCode = await capture(options);
} catch (error) { fail(error); }

async function capture(options) {
  const steps = options.stepsFile ? await loadSteps(options.stepsFile) : null;
  const out = await prepareOutputDir(options.out ?? defaultShotsDir(options.repo));
  let session;
  try { session = await startSession({ ...options, evidenceDir: out, log: say }); }
  catch (error) { await rmdir(out).catch(() => {}); throw error; }

  let cancelled = false;
  let closing;
  const close = () => closing ??= session.close();
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(signal, () => {
      if (cancelled) { say('second signal: forcing exit'); process.exit(130); }
      cancelled = true;
      say(`${signal}: finishing the current step, then cleaning up`);
    });
  }

  const startedAt = Date.now();
  const manifest = {
    schema: MANIFEST_SCHEMA, createdAt: new Date(startedAt).toISOString(), mode: options.mode,
    wiki: options.wiki, reducedMotion: options.reducedMotion, sizes: options.sizes.map(formatSize), themes: options.themes,
    git: { head: session.info.repo.head, branch: session.info.repo.branch, dirty: session.info.repo.dirty },
    build: session.info.build, electron: session.info.electron, fontFace: session.info.fontFace, services: session.info.services,
    customSteps: steps !== null, shots: [], steps: [],
  };
  let lastSeq = 0;
  let index = 0;

  async function step(label, action) {
    const record = { step: label, status: 'ok' };
    const began = Date.now();
    try { record.result = await action(); }
    catch (error) { record.status = 'failed'; record.error = error.message; say(`FAILED ${label}: ${error.message}`); }
    record.ms = Date.now() - began;
    manifest.steps.push(record);
    return record;
  }

  async function shotEntry({ stem, domain, theme, size, navigation }) {
    index += 1;
    const entry = { file: null, domain, theme, size, mode: options.mode, head: manifest.git.head, dirty: manifest.git.dirty, at: new Date().toISOString(), status: 'failed', warnings: [] };
    manifest.shots.push(entry);
    try {
      if (navigation) {
        const landed = await navigation();
        if (!landed.landed) entry.warnings.push(`could not confirm that ${domain} became current`);
      }
      const state = await session.pageState();
      entry.observed = { theme: state.theme, scheme: state.scheme, viewport: `${state.viewport.width}x${state.viewport.height}`, current: state.current };
      if (theme && state.theme !== theme) entry.warnings.push(`app theme is ${state.theme}, expected ${theme}`);
      const shot = await session.shot(`${String(index).padStart(2, '0')}-${stem}`, { prefix: false, dir: out });
      Object.assign(entry, { file: basename(shot.file), bytes: shot.bytes, width: shot.width, height: shot.height, settled: shot.settled, status: 'ok' });
      if (shot.settled?.pending?.length) entry.warnings.push(`still showing loading indicators after settling: ${shot.settled.pending.join('; ')}`);
      if (shot.settled?.infiniteAnimations) entry.warnings.push(`${shot.settled.infiniteAnimations} endless animation(s) running; pass --reduced-motion for steadier shots`);
    } catch (error) {
      entry.error = error.message;
      say(`FAILED ${stem}: ${error.message}`);
    }
    const seen = await session.errors({ since: lastSeq });
    lastSeq = seen.lastSeq;
    entry.newConsoleEntries = seen.entries.slice(0, 20);
    if (seen.entries.length > 20) entry.warnings.push(`${seen.entries.length - 20} more console entries not listed here`);
    return entry;
  }

  try {
    if (options.reducedMotion) await step('reduced motion', () => session.media({ features: { 'prefers-reduced-motion': 'reduce' } }));
    if (steps) await runCustomSteps(steps);
    else await runTour();
  } finally {
    const seen = await session.errors({ since: 0 }).catch(() => ({ entries: [] }));
    const byLevel = {};
    for (const entry of seen.entries) byLevel[entry.level] = (byLevel[entry.level] ?? 0) + 1;
    manifest.consoleEntries = { total: seen.entries.length, byLevel, entries: seen.entries.slice(0, 100) };
    manifest.cancelled = cancelled;
    manifest.durationMs = Date.now() - startedAt;
    manifest.summary = {
      shotsOk: manifest.shots.filter(shot => shot.status === 'ok').length,
      shotsFailed: manifest.shots.filter(shot => shot.status !== 'ok').length,
      stepsFailed: manifest.steps.filter(record => record.status !== 'ok').length,
      warnings: manifest.shots.reduce((sum, shot) => sum + shot.warnings.length, 0),
    };
    await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    let cleaned;
    try {
      cleaned = await close();
      say(`cleanup: scratch removed=${cleaned.rootAbsent}, children closed=${cleaned.capturedChildrenClosed}, remaining=${cleaned.remainingChildren}`);
    } catch (error) { say(`cleanup FAILED: ${error.stack ?? error}`); process.exitCode = 1; }
  }

  const { summary } = manifest;
  say(`${summary.shotsOk} screenshot(s) saved, ${summary.shotsFailed} failed, ${summary.stepsFailed} step(s) failed, ${summary.warnings} warning(s), ${manifest.consoleEntries.total} console entr${manifest.consoleEntries.total === 1 ? 'y' : 'ies'}`);
  console.log(out);
  return cancelled ? 130 : summary.shotsFailed + summary.stepsFailed > 0 ? 1 : (process.exitCode ?? 0);

  async function runTour() {
    const places = [...DOMAINS, ...(options.settings ? ['Settings'] : [])];
    for (const size of options.sizes) {
      await step(`window ${formatSize(size)}`, () => session.window(size));
      for (const theme of options.themes) {
        await step(`theme ${theme}`, () => session.media({ features: { 'prefers-color-scheme': theme } }));
        for (const place of places) {
          if (cancelled) return;
          await shotEntry({
            stem: `${place.toLowerCase()}-${theme}-${formatSize(size)}`, domain: place, theme, size: formatSize(size),
            navigation: () => place === 'Settings' ? session.openSettings() : session.openDomain(place),
          });
        }
      }
    }
  }

  async function runCustomSteps(list) {
    for (const [position, spec] of list.entries()) {
      if (cancelled) return;
      const { do: action, ...body } = spec;
      if (action === 'shot') {
        await shotEntry({ stem: body.name, domain: null, theme: null, size: null }).then(entry => {
          // A custom sequence names no domain, theme or size, so record what the page showed.
          entry.domain = entry.observed?.current?.[0] ?? null;
          entry.theme = entry.observed?.theme ?? null;
          entry.size = entry.observed?.viewport ?? null;
        });
        continue;
      }
      await step(`step ${position + 1} (${action})`, async () => {
        const result = await perform(session, action, body);
        return action === 'eval' ? String(JSON.stringify(result)).slice(0, 300) : result;
      });
    }
  }
}

async function loadSteps(file) {
  let text;
  try { text = await readFile(file, 'utf8'); }
  catch (error) { throw new UsageError(`Cannot read --steps file: ${error.code ?? error.message}`); }
  try { return normalizeSteps(JSON.parse(text)); }
  catch (error) { throw error instanceof SyntaxError ? new UsageError(`--steps file is not valid JSON: ${error.message}`) : error; }
}
