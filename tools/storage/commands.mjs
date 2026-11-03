import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contains, inspectStorage, requireAdmission, resolveDestination, settings } from './admission.mjs';
import { withStorageInvocation } from './launcher.mjs';

const moduleWorktree = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const graphs = {
  build: [{ tool: 'npm', args: ['run', 'typecheck'] },
    { tool: 'vite', args: ['build', '--config', 'apps/desktop/vite.config.ts'] }, { task: 'build:electron' }],
  'build:electron': [
    { tool: 'tsc', args: ['-p', 'apps/desktop/tsconfig.electron.json'] },
    { tool: 'tsc', args: ['-p', 'apps/desktop/tsconfig.design-host.json'] },
    { tool: 'tsc', args: ['-p', 'apps/desktop/tsconfig.wiki-host.json'] }, { task: 'build:preview-agent' }],
  'build:preview-agent': [{ tool: 'vite', args: ['build', '--config', 'apps/desktop/vite.preview-agent.config.ts'] }],
  test: [{ task: 'build:electron' }, { tool: 'vitest', args: ['run'] }],
};
function leaves(key) { return graphs[key].flatMap(step => step.task ? leaves(step.task) : [step]); }

// A closed non-routing argument grammar: unknown options cannot silently add a
// config, output, workspace or long-lived producer outside the admitted roots.
function validateArguments(key, args) {
  if (!Object.hasOwn(graphs, key) || !Array.isArray(args)) throw new Error('Unknown storage command');
  const values = key === 'test'
    ? { '--reporter': /^(default|dot|verbose|tap|tap-flat|json)$/, '--testNamePattern': /^[^\0]{1,4096}$/, '-t': /^[^\0]{1,4096}$/ }
    : { '--mode': /^[A-Za-z0-9_-]{1,64}$/, '--logLevel': /^(info|warn|error|silent)$/ };
  const flags = new Set(key === 'test' ? ['--passWithNoTests', '--no-file-parallelism', '--silent'] : ['--sourcemap']);
  for (let i = 0; i < args.length; i++) {
    if (typeof args[i] !== 'string' || args[i].includes('\0')) throw new Error('Invalid forwarded argument');
    const equal = args[i].indexOf('=');
    const name = equal < 0 ? args[i] : args[i].slice(0, equal);
    if (equal < 0 && flags.has(name)) continue;
    if (!Object.hasOwn(values, name)) throw new Error(`Argument cannot be admitted: ${name}`);
    const value = equal < 0 ? args[++i] : args[i].slice(equal + 1);
    if (typeof value !== 'string' || !values[name].test(value)) throw new Error(`Argument cannot be admitted: ${name}`);
  }
}

/** Fixed package graphs only. Fixture DI is direct-module-only; the production
 * CLI never accepts a policy/context override, executable, worktree or shell.
 */
export async function runStorageCommand(key, args = [], {
  worktree = moduleWorktree, env = process.env, signal, observation = () => {},
} = {}, { testContext } = {}) {
  validateArguments(key, args);
  let driver;
  if (key === 'build') {
    if (!env.npm_execpath || !path.isAbsolute(env.npm_execpath)) throw new Error('Build requires an absolute invoking npm_execpath driver');
    driver = await fs.realpath(env.npm_execpath);
    if (!(await fs.stat(driver)).isFile()) throw new Error('Invoking npm driver must be a regular file');
    observation({ phase: 'npm-driver', driver });
  }
  const root = await resolveDestination(worktree, { mustExist: true });
  worktree = path.resolve(root.path);
  const bins = new Map();
  for (const { tool } of leaves(key)) {
    if (tool === 'npm' || bins.has(tool)) continue;
    const bin = await fs.realpath(path.join(worktree, 'node_modules/.bin', tool));
    if (!contains(worktree, bin) || !(await fs.stat(bin)).isFile()) throw new Error(`Unsafe worktree tool: ${tool}`);
    bins.set(tool, bin);
  }
  const cache = path.join(worktree, '.t3/cache');
  const scratchParent = path.join(worktree, '.t3/storage-command-scratch');
  const plan = { worktree, roots: [
    { kind: 'compiled', path: path.join(worktree, 'apps/desktop/dist') },
    { kind: 'compiled', path: path.join(worktree, 'apps/desktop/dist-electron') },
    { kind: 'cache', path: cache },
    { kind: 'cache', path: path.join(worktree, 'node_modules/.vite-temp') },
    { kind: 'scratch', path: scratchParent },
  ] };
  const { policy } = settings(testContext);
  signal?.throwIfAborted();
  const snapshot = await inspectStorage(plan, { testContext });
  observation({ phase: 'admission', filesystems: snapshot.filesystems,
    compiledBytes: snapshot.compiledBytes, generatedBytes: snapshot.generatedBytes,
    reserveBytes: policy.reserveBytes, peakBytes: policy.peakBytes });
  requireAdmission(snapshot, policy);
  signal?.throwIfAborted();
  // This shared parent is never cleanup scope. The launcher owns one unique
  // child and retains unsafe scratch/unknown descendants instead of sweeping.
  await fs.mkdir(scratchParent, { recursive: true, mode: 0o700 });
  return withStorageInvocation(plan, async context => {
    const scratch = await context.scratch(scratchParent);
    await fs.mkdir(path.join(cache, 'npm'), { recursive: true, mode: 0o700 });
    const routed = { ...env, npm_config_cache: path.join(cache, 'npm'), TMPDIR: scratch, TMP: scratch, TEMP: scratch };
    const perLeaf = policy.generatedBytes;
    async function execute(task, forwarded, parent) {
      const steps = graphs[task];
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const tailArgs = i === steps.length - 1 ? forwarded : [];
        let result;
        if (step.task) {
          result = await withStorageInvocation(plan, child => execute(step.task, tailArgs, child),
            { parent, allowanceBytes: leaves(step.task).length * perLeaf });
        } else {
          const executable = step.tool === 'npm' ? driver : bins.get(step.tool);
          observation({ phase: 'leaf', task, tool: step.tool, args: [...step.args, ...tailArgs] });
          result = await parent.launch({ command: process.execPath, args: [executable, ...step.args, ...tailArgs],
            cwd: worktree, env: routed, bytes: perLeaf, stdio: 'inherit' });
        }
        if (result.signal || result.code !== 0) return result;
      }
      return { code: 0, signal: null, diagnostics: [] };
    }
    return execute(key, args, context);
  }, { testContext, signal });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runStorageCommand(process.argv[2], process.argv.slice(3), {
      observation: value => console.error(JSON.stringify({ storage: value })),
    });
    for (const diagnostic of result.diagnostics) console.error(JSON.stringify({ storageError: diagnostic }));
    // All owned producers, scratch and locks have settled before propagating
    // the actual first failure/signal. No environment token bypasses admission.
    if (result.signal) process.kill(process.pid, result.signal);
    else process.exitCode = result.code;
  } catch (error) {
    console.error(JSON.stringify({ storageError: error.message }));
    process.exitCode = 1;
  }
}
