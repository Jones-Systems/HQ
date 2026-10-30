#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateSections(sections) {
  if (!Array.isArray(sections) || sections.length === 0) throw new Error('sections must be a non-empty array');
  const ids = new Set();
  for (const section of sections) {
    if (!section || typeof section.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(section.id) || ids.has(section.id)) {
      throw new Error('invalid or duplicate section id');
    }
    ids.add(section.id);
    for (const key of ['dir', 'nodeCwd', 'nodeGlob', 'vitestConfig', 'viteBuild']) {
      if (typeof section[key] !== 'string' || /[\s"'\\;$`]/.test(section[key]) || section[key].split('/').includes('..')) {
        throw new Error(`${section.id}: invalid ${key}`);
      }
    }
    if (!/^(modules\/design\/|packages\/design-)/.test(section.dir)) throw new Error(`${section.id}: invalid dir`);
    if (section.nodeGlob && !['.', section.dir].includes(section.nodeCwd)) throw new Error(`${section.id}: invalid nodeCwd`);
    if (section.nodeGlob && !(section.nodeCwd === section.dir || section.nodeGlob.startsWith(`${section.dir}/`))) {
      throw new Error(`${section.id}: nodeGlob outside section`);
    }
    for (const key of ['vitestConfig', 'viteBuild']) {
      if (section[key] && !section[key].startsWith(`${section.dir}/`)) throw new Error(`${section.id}: ${key} outside section`);
    }
    if (!section.nodeGlob && !section.vitestConfig) throw new Error(`${section.id}: no test runner`);
  }
  return sections;
}

export function planBatches(sections, count = 1) {
  validateSections(sections);
  if (!Number.isInteger(count) || count < 1 || count > sections.length) throw new Error('batch count must be between 1 and section count');
  const batches = Array.from({ length: count }, (_, index) => ({ id: index + 1, sections: [] }));
  // Equal unit estimates are provisional until comparable per-section timings are available.
  sections.forEach((section, index) => batches[index % count].sections.push(section));
  return batches;
}

export function commandsFor(section) {
  validateSections([section]);
  const commands = [{ command: 'node_modules/.bin/tsc', args: ['-p', `${section.dir}/tsconfig.json`] }];
  if (section.nodeGlob) commands.push({
    command: 'bash',
    args: ['-c', `set -euo pipefail
shopt -s globstar nullglob
cd "$NODE_CWD"
# shellcheck disable=SC2206
files=( $NODE_GLOB )
if [ \${#files[@]} -eq 0 ]; then echo "::error::no files match $NODE_GLOB in $NODE_CWD"; exit 1; fi
node --test --test-concurrency=1 "\${files[@]}"`],
    env: { NODE_CWD: section.nodeCwd, NODE_GLOB: section.nodeGlob },
  });
  if (section.vitestConfig) commands.push({ command: 'node_modules/.bin/vitest', args: ['run', '--config', section.vitestConfig] });
  if (section.viteBuild) commands.push({ command: 'node_modules/.bin/vite', args: ['build', '--config', section.viteBuild] });
  return commands;
}

export function execute(command) {
  return spawnSync(command.command, command.args, { stdio: 'inherit', env: { ...process.env, ...command.env } });
}

export function runSections(sections, run = execute, log = console.log) {
  validateSections(sections);
  let failed = false;
  for (const section of sections) {
    log(`::group::Design section (${section.id})`);
    try {
      for (const command of commandsFor(section)) {
        const result = run(command);
        if (result.signal) throw new Error(`${section.id}: terminated by ${result.signal}`);
        if (result.error || result.status !== 0) {
          failed = true;
          log(`::error::${section.id}: ${command.command} failed (${result.error?.message ?? result.status})`);
          break;
        }
      }
    } finally {
      log('::endgroup::');
    }
  }
  return failed ? 1 : 0;
}

export function main(args, env = process.env) {
  const sections = validateSections(JSON.parse(env.HQD_SECTIONS ?? 'null'));
  if (args[0] === 'plan' && args.length === 1) {
    const raw = env.HQD_BATCH_COUNT ?? '1';
    if (!/^[1-9]\d*$/.test(raw)) throw new Error('invalid batch count');
    const output = `batches=${JSON.stringify(planBatches(sections, Number(raw)))}\n`;
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, output);
    else process.stdout.write(output);
    return 0;
  }
  if (args[0] === 'run' && args.length === 1) return runSections(sections);
  throw new Error('usage: design-sections.mjs plan|run (HQD_SECTIONS, HQD_BATCH_COUNT)');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(`::error::${error.message}`); process.exitCode = 1; }
}
