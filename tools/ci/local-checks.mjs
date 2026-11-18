#!/usr/bin/env node
// Run HQ's required PR checks locally, in the same order and with the same
// commands as hosted CI. Steps are read from the workflow files on every run, so
// supported workflow command changes are reflected locally: Foundation, CLI and Planner jobs
// use their single-line `run:` steps; Design uses the workflow's HQD_INVENTORY
// rows and the shared runner in design-sections.mjs.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { commandsFor, validateSections } from './design-sections.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
export const GROUPS = Object.freeze({
  foundation: { workflow: 'foundation.yml', job: 'foundation' },
  cli: { workflow: 'cli-planner.yml', job: 'cli' },
  planner: { workflow: 'cli-planner.yml', job: 'planner' },
  design: { workflow: 'design-sections.yml' },
});

const unquote = value => value.trim().replace(/^'(.*)'$/s, '$1').replace(/^"(.*)"$/s, '$1');

/** Parse one job's env and single-line `run:` steps; setup and install steps are skipped. */
export function parseJob(text, job, { allowBlocks = false } = {}) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => line === `  ${job}:`);
  if (start < 0) throw new Error(`Job not found: ${job}`);
  const end = lines.findIndex((line, index) => index > start && /^  \S/.test(line));
  const body = lines.slice(start + 1, end < 0 ? undefined : end);
  const env = {};
  const steps = [];
  let section = null;
  let step = null;
  for (let index = 0; index < body.length; index++) {
    const line = body[index];
    if (allowBlocks && /^        run: \|$/.test(line)) {
      const script = [];
      while (index + 1 < body.length && (/^          /.test(body[index + 1]) || !body[index + 1].trim())) {
        script.push(body[++index].slice(10));
      }
      step.run = script.join('\n');
      continue;
    }
    if (/^\s*(#|$)/.test(line)) continue;
    if (/^    \S/.test(line)) { section = line.trim().replace(/:.*/, ''); continue; }
    if (section === 'env' && /^      \S/.test(line)) {
      const [key, ...rest] = line.trim().split(':');
      env[key] = unquote(rest.join(':'));
    } else if (section === 'steps') {
      const item = /^      - (.*)$/.exec(line);
      if (item) { step = {}; steps.push(step); }
      const field = /^(?:      - |        )([\w-]+):\s*(.*)$/.exec(line);
      if (field && step) step[field[1]] = field[2];
    }
  }
  const commands = [];
  for (const entry of steps) {
    if (entry.uses || entry.run === undefined) continue;
    if (/^[|>]/.test(entry.run)) throw new Error(`${job}: multi-line step "${entry.name}" is not mirrored; update local-checks`);
    if (/^npm ci\b/.test(entry.run)) continue;
    commands.push({ name: unquote(entry.name ?? entry.run), run: entry.run, cwd: entry['working-directory'] ?? '.' });
  }
  if (!commands.length) throw new Error(`${job}: no runnable steps found`);
  return { env, commands };
}

/** Rebuild the Design section matrix exactly as the inventory job does. */
export function parseDesignInventory(text) {
  const block = /^  HQD_INVENTORY: \|\n((?:    .*\n|\s*\n)+)/m.exec(text);
  const expected = /^  HQD_EXPECTED_ROWS: '(\d+)'/m.exec(text);
  if (!block || !expected) throw new Error('Design inventory not found');
  const sections = block[1].split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => {
    const fields = line.split('|');
    if (fields.length !== 8) throw new Error(`Malformed inventory row: ${line}`);
    const [id, dir, cwdMode, nodeGlob, vitestConfig, , vitestGlob, build] = fields.map(value => value === '-' ? '' : value);
    if (!nodeGlob && !vitestGlob) throw new Error(`${id}: row claims no runner`);
    return {
      id, dir,
      nodeCwd: nodeGlob ? (cwdMode === 'root' ? '.' : dir) : '',
      nodeGlob: nodeGlob ? (cwdMode === 'root' ? `${dir}/${nodeGlob}` : nodeGlob) : '',
      vitestConfig: vitestConfig ? `${dir}/${vitestConfig}` : '',
      viteBuild: build,
    };
  });
  if (sections.length !== Number(expected[1])) throw new Error(`Design inventory has ${sections.length} rows; workflow expects ${expected[1]}`);
  return validateSections(sections);
}

export function parseArgs(argv) {
  const options = { groups: Object.keys(GROUPS), design: [], list: false, timeoutSeconds: 600 };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split(/=(.*)/s);
    const value = () => inline ?? argv[++i];
    if (flag === '--only') options.groups = (value() ?? '').split(',').filter(Boolean);
    else if (flag === '--design') options.design = (value() ?? '').split(',').filter(Boolean);
    else if (flag === '--timeout') options.timeoutSeconds = Number(value());
    else if (flag === '--list') options.list = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!options.groups.length) throw new Error('--only needs at least one group');
  if (argv.some(arg => arg === '--design' || arg.startsWith('--design=')) && !options.design.length) throw new Error('--design needs at least one section');
  for (const group of options.groups) if (!Object.hasOwn(GROUPS, group)) throw new Error(`Unknown group: ${group}`);
  if (!Number.isInteger(options.timeoutSeconds) || options.timeoutSeconds < 1) throw new Error('--timeout must be a positive integer (seconds)');
  return options;
}

export function plan(options, read = file => readFileSync(path.join(repo, '.github/workflows', file), 'utf8')) {
  const steps = [];
  for (const group of options.groups) {
    const { workflow, job } = GROUPS[group];
    const text = read(workflow);
    if (group === 'design') {
      const sections = parseDesignInventory(text);
      const inventory = /^  HQD_INVENTORY: \|\n((?:    .*\n|\s*\n)+)/m.exec(text)[1]
        .split('\n').map(line => line.slice(4)).join('\n');
      const expected = /^  HQD_EXPECTED_ROWS: '(\d+)'/m.exec(text)[1];
      // Execute the workflow's complete inventory validation, including coverage and
      // duplicate ownership checks, even when a subset of sections is requested.
      for (const command of parseJob(text, 'inventory', { allowBlocks: true }).commands) {
        steps.push({ group, label: `inventory: ${command.name}`, command: 'bash',
          args: ['-e', '-o', 'pipefail', '-c', command.run], cwd: command.cwd,
          env: { HQD_INVENTORY: inventory, HQD_EXPECTED_ROWS: expected, HQD_BATCH_COUNT: '1' } });
      }
      const unknown = options.design.filter(id => !sections.some(section => section.id === id));
      if (unknown.length) throw new Error(`Unknown Design section: ${unknown.join(', ')}`);
      for (const section of sections.filter(section => !options.design.length || options.design.includes(section.id))) {
        for (const command of commandsFor(section)) {
          const label = command.env?.NODE_GLOB ? `node --test ${command.env.NODE_GLOB} (cwd ${command.env.NODE_CWD})`
            : [path.basename(command.command), ...command.args].join(' ');
          steps.push({ group, label: `${section.id}: ${label}`,
            command: command.command, args: command.args, cwd: '.', env: { ELECTRON_SKIP_BINARY_DOWNLOAD: '1', ...command.env } });
        }
      }
    } else {
      const { env, commands } = parseJob(text, job);
      for (const command of commands) steps.push({ group, label: command.run, command: 'bash', args: ['-e', '-o', 'pipefail', '-c', command.run], cwd: command.cwd, env });
    }
  }
  return steps;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const steps = plan(options);
  if (options.list) {
    for (const step of steps) console.log(`${step.group}\t${step.cwd}\t${step.label}`);
    return 0;
  }
  const failedGroups = new Set();
  const results = [];
  const scratch = mkdtempSync(path.join(tmpdir(), 'hq-local-checks-'));
  try {
    for (const step of steps) {
      if (failedGroups.has(step.group)) { results.push({ ...step, status: 'not run', seconds: 0 }); continue; }
      console.log(`\n▶ ${step.group} · ${step.label}`);
      const started = performance.now();
      const result = spawnSync(step.command, step.args, {
        cwd: path.join(repo, step.cwd), stdio: 'inherit', timeout: options.timeoutSeconds * 1000, killSignal: 'SIGTERM',
        env: { ...process.env, ...step.env, TMPDIR: scratch, GITHUB_OUTPUT: path.join(scratch, 'outputs') },
      });
      const seconds = (performance.now() - started) / 1000;
      const status = result.error?.code === 'ETIMEDOUT' ? `timed out after ${options.timeoutSeconds}s`
        : result.error ? `error: ${result.error.message}` : result.signal ? `killed by ${result.signal}`
          : result.status === 0 ? 'passed' : `failed (exit ${result.status})`;
      if (status !== 'passed') failedGroups.add(step.group);
      results.push({ ...step, status, seconds });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`\nHQ local checks (${process.version}; CI pins Node 24.19.0 and Python 3.13.5)`);
  for (const result of results) console.log(`${result.status === 'passed' ? '✔' : '✖'} ${result.group.padEnd(10)} ${result.seconds.toFixed(1).padStart(6)}s  ${result.status === 'passed' ? '' : `[${result.status}] `}${result.label}`);
  const failed = results.filter(result => result.status !== 'passed');
  console.log(failed.length ? `\n${failed.length} step(s) did not pass.` : '\nAll selected local check commands passed (hosted CI and native qualification remain separate).');
  return failed.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = main(); }
  catch (error) { console.error(`local-checks: ${error.message}`); process.exitCode = 2; }
}
