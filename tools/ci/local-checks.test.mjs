import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs, parseDesignInventory, parseJob, plan } from './local-checks.mjs';

const workflow = `name: Example
jobs:
  first:
    name: First job
    timeout-minutes: 6
    env:
      ELECTRON_SKIP_BINARY_DOWNLOAD: '1'
    steps:
      - name: Check out candidate
        uses: actions/checkout@0000000000000000000000000000000000000000 # v7
        with:
          persist-credentials: false
      - name: Install locked dependencies
        run: npm ci --ignore-scripts --no-audit --no-fund
      # Comments between steps are ignored.
      - name: Build
        run: npm run build
      - name: Test a package
        working-directory: tools/example
        run: HQ_FLAG=1 npm test

  second:
    steps:
      - name: Multi-line
        run: |
          echo one
`;

test('a job mirrors only its single-line run steps, with job env and working directory', () => {
  assert.deepEqual(parseJob(workflow, 'first'), {
    env: { ELECTRON_SKIP_BINARY_DOWNLOAD: '1' },
    commands: [
      { name: 'Build', run: 'npm run build', cwd: '.' },
      { name: 'Test a package', run: 'HQ_FLAG=1 npm test', cwd: 'tools/example' },
    ],
  });
});

test('unmirrorable or missing jobs fail loudly instead of running a partial set', () => {
  assert.throws(() => parseJob(workflow, 'second'), /multi-line step "Multi-line" is not mirrored/);
  assert.throws(() => parseJob(workflow, 'absent'), /Job not found: absent/);
});

const inventory = rows => `env:
  HQD_EXPECTED_ROWS: '${rows.length}'
  HQD_INVENTORY: |
${rows.map(row => `    ${row}`).join('\n')}

jobs:
`;

test('Design rows become the same section matrix the inventory job emits', () => {
  assert.deepEqual(parseDesignInventory(inventory([
    'canvas|modules/design/canvas|root|test/*.test.ts|vitest.config.ts|cone|test/view/**/*.test.tsx|-',
    'flows|modules/design/flows|cone|test/*.test.ts|-|-|-|-',
    'preview|modules/design/preview|root|test/*.test.ts|-|-|-|modules/design/preview/vite.config.ts',
  ])), [
    { id: 'canvas', dir: 'modules/design/canvas', nodeCwd: '.', nodeGlob: 'modules/design/canvas/test/*.test.ts', vitestConfig: 'modules/design/canvas/vitest.config.ts', viteBuild: '' },
    { id: 'flows', dir: 'modules/design/flows', nodeCwd: 'modules/design/flows', nodeGlob: 'test/*.test.ts', vitestConfig: '', viteBuild: '' },
    { id: 'preview', dir: 'modules/design/preview', nodeCwd: '.', nodeGlob: 'modules/design/preview/test/*.test.ts', vitestConfig: '', viteBuild: 'modules/design/preview/vite.config.ts' },
  ]);
});

test('Design row count, shape and runner claims are checked', () => {
  const row = 'flows|modules/design/flows|cone|test/*.test.ts|-|-|-|-';
  assert.throws(() => parseDesignInventory(inventory([row]).replace("ROWS: '1'", "ROWS: '2'")), /has 1 rows; workflow expects 2/);
  assert.throws(() => parseDesignInventory(inventory(['flows|modules/design/flows|cone'])), /Malformed inventory row/);
  assert.throws(() => parseDesignInventory(inventory(['flows|modules/design/flows|cone|-|-|-|-|-'])), /row claims no runner/);
});

test('arguments select groups, Design sections and a per-step timeout', () => {
  assert.deepEqual(parseArgs(['--only', 'cli,design', '--design=canvas', '--timeout', '30', '--list']),
    { groups: ['cli', 'design'], design: ['canvas'], list: true, timeoutSeconds: 30 });
  assert.throws(() => parseArgs(['--only', 'nope']), /Unknown group: nope/);
  assert.throws(() => parseArgs(['--timeout', '0']), /positive integer/);
  assert.throws(() => parseArgs(['--fast']), /Unknown argument/);
});

test('the actual workflows still parse into every required group (drift guard)', () => {
  const steps = plan(parseArgs([]));
  for (const group of ['foundation', 'cli', 'planner', 'design']) assert.ok(steps.some(step => step.group === group), group);
  assert.ok(steps.some(step => step.label === 'npm run build'));
  assert.ok(steps.some(step => step.group === 'cli' && step.cwd === 'tools/hq-cli' && /HQ_CLI_E2E=1/.test(step.label)));
  assert.throws(() => plan(parseArgs(['--only', 'design', '--design', 'no-such-section'])), /Unknown Design section/);
});


test('the inventory block retains every command and its indentation', () => {
  const parsed = parseJob(workflow, 'second', { allowBlocks: true });
  assert.equal(parsed.commands[0].run, 'echo one\n');
});

test('empty selections cannot report a passing empty check set', () => {
  for (const args of [['--only='], ['--only'], ['--design='], ['--design']]) {
    assert.throws(() => parseArgs(args), /needs at least one/);
  }
});

test('Design planning includes workflow inventory validation before sections', () => {
  const steps = plan(parseArgs(['--only', 'design', '--design', 'canvas']));
  assert.match(steps[0].label, /^inventory:/);
  const inventory = steps.find(step => step.label.includes('Require every cone'));
  assert.ok(inventory);
  assert.match(inventory.args.at(-1), /Every test file on disk must be claimed exactly once/);
  assert.match(inventory.args.at(-1), /HQD_SECTIONS=.*design-sections.mjs plan/);
  assert.match(inventory.env.HQD_INVENTORY, /canvas\|modules\/design\/canvas/);
  assert.equal(inventory.env.HQD_BATCH_COUNT, '1');
  assert.ok(steps.some(step => step.label.startsWith('canvas:')));
  assert.ok(steps.every(step => /^inventory:|^canvas:/.test(step.label)));
});
