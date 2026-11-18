import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { commandsFor, main, planBatches, runSections } from './design-sections.mjs';

const workflow = readFileSync(new URL('../../.github/workflows/design-sections.yml', import.meta.url), 'utf8');
const inventory = workflow.split('  HQD_INVENTORY: |\n')[1].split('\njobs:')[0].trim().split('\n').map(line => line.trim().split('|'));
const sections = inventory.map(([id, dir, cwd, node, config, , , build]) => ({
  id, dir, nodeCwd: node === '-' ? '' : cwd === 'root' ? '.' : dir,
  nodeGlob: node === '-' ? '' : cwd === 'root' ? `${dir}/${node}` : node,
  vitestConfig: config === '-' ? '' : `${dir}/${config}`,
  viteBuild: build === '-' ? '' : build,
}));

test('each supported batch count assigns the complete inventory exactly once, deterministically', () => {
  for (const count of [1, 2, 4, 20]) {
    const planned = planBatches(sections, count);
    assert.equal(planned.length, count);
    assert.ok(planned.every(batch => batch.sections.length > 0));
    assert.deepEqual(planned, planBatches(sections, count));
    const ids = planned.flatMap(batch => batch.sections.map(section => section.id));
    assert.equal(new Set(ids).size, sections.length);
    assert.deepEqual(ids.sort(), sections.map(section => section.id).sort());
  }
});

test('invalid, empty and duplicate selections and invalid batch counts fail closed', () => {
  for (const count of [0, -1, 1.5, NaN, Infinity, 21, '2']) assert.throws(() => planBatches(sections, count));
  for (const selection of [[], null, [sections[0], sections[0]], [{ ...sections[0], nodeCwd: '/tmp' }], [{ ...sections[0], dir: '../escape' }]]) {
    assert.throws(() => planBatches(selection));
  }
  assert.throws(() => main(['unknown'], { HQD_SECTIONS: JSON.stringify(sections) }));
  assert.throws(() => main(['plan'], { HQD_SECTIONS: JSON.stringify(sections), HQD_BATCH_COUNT: '2x' }));
});

test('inventory retains complete disjoint file coverage including nested discovery and build', () => {
  const claimed = inventory.flatMap(([, dir, , node, , , vitest]) => [node, vitest].filter(glob => glob !== '-').flatMap(glob => globSync(`${dir}/${glob}`)));
  const disk = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split('\n')
    .filter(path => /^(modules\/design\/|packages\/design-)/.test(path) && /\.(test|spec)\.[cm]?[jt]sx?$/.test(path));
  assert.equal(new Set(claimed).size, claimed.length);
  assert.deepEqual(claimed.sort(), [...new Set(disk)].sort());
  assert.equal(sections.find(section => section.id === 'discovery').nodeGlob, 'modules/design/discovery/test/**/*.test.ts');
  const builds = sections.flatMap(commandsFor).filter(command => command.command === 'node_modules/.bin/vite');
  assert.deepEqual(builds, [{ command: 'node_modules/.bin/vite', args: ['build', '--config', 'modules/design/preview/vite.config.ts'] }]);
});

test('commands preserve per-section tsconfig, cwd, shell glob, Vitest configs and serial Node semantics', () => {
  for (const section of sections) {
    const commands = commandsFor(section);
    assert.deepEqual(commands[0], { command: 'node_modules/.bin/tsc', args: ['-p', `${section.dir}/tsconfig.json`] });
    if (section.nodeGlob) {
      assert.deepEqual(commands[1].env, { NODE_CWD: section.nodeCwd, NODE_GLOB: section.nodeGlob });
      assert.match(commands[1].args[1], /shopt -s globstar nullglob/);
      assert.match(commands[1].args[1], /node --test --test-concurrency=1 "\$\{files\[@\]\}"/);
      assert.match(commands[1].args[1], /no files match/);
    }
    if (section.vitestConfig) assert.ok(commands.some(command => command.command === 'node_modules/.bin/vitest' && command.args.join(' ') === `run --config ${section.vitestConfig}`));
  }
});

test('section failure skips its later commands but other sections still execute and batch fails', () => {
  const selected = [sections.find(section => section.id === 'annotations'), sections.find(section => section.id === 'preview')];
  const calls = [];
  const status = runSections(selected, command => {
    calls.push(command);
    return { status: calls.length === 2 ? 7 : 0 };
  }, () => {});
  assert.equal(status, 1);
  assert.deepEqual(calls, [...commandsFor(selected[0]).slice(0, 2), ...commandsFor(selected[1])]);
  assert.equal(runSections(selected, () => ({ status: 0 }), () => {}), 0);
  assert.equal(runSections(selected, () => ({ error: new Error('spawn failed'), status: null }), () => {}), 1);
  assert.throws(() => runSections(selected, () => ({ signal: 'SIGTERM' }), () => {}), /SIGTERM/);
});

test('CLI planner writes usable batches and rejects bad input with nonzero exit', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'hqd-planner-test-'));
  try {
    const output = join(scratch, 'output');
    writeFileSync(output, '');
    const runner = new URL('./design-sections.mjs', import.meta.url);
    const invoke = (selection, count) => spawnSync(process.execPath, [runner.pathname, 'plan'], {
      encoding: 'utf8', env: { ...process.env, HQD_SECTIONS: JSON.stringify(selection), HQD_BATCH_COUNT: count, GITHUB_OUTPUT: output },
    });
    assert.equal(invoke(sections, '4').status, 0);
    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8').trim().slice('batches='.length)), planBatches(sections, 4));
    assert.equal(invoke(sections, '0').status, 1);
    assert.equal(invoke([], '1').status, 1);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
