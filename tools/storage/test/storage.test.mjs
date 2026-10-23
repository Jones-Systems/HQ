import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { POLICY, MiB, GiB, decideStorage } from '../policy.mjs';
import {
  LOCK_NAME, createTestContext, inspectStorage, measureFilesystemNative, measureTrees, resolveDestination,
} from '../admission.mjs';
import { withStorageInvocation } from '../launcher.mjs';

const ok = () => ({ code: 0, signal: null, diagnostics: [] });
const policy = { reserveBytes: 64 * MiB, peakBytes: 2 * MiB, lockTimeoutMs: 100 };
const testContext = createTestContext({ policy });
const producer = (code = 'process.exit(0)') => ({ command: process.execPath, args: ['-e', code], bytes: MiB, stdio: 'ignore' });

async function fixture(t) {
  const parent = await fs.realpath(os.tmpdir());
  const stat = await fs.statfs(parent, { bigint: true });
  assert.ok(stat.bavail * stat.bsize >= BigInt(66 * MiB), 'tiny test fixture needs 64 MiB reserve + 2 MiB peak');
  const root = await fs.mkdtemp(path.join(parent, 'hq-storage-unit-'));
  t.after(() => fs.rm(root, { recursive: true }));
  const worktree = path.join(root, 'worktree');
  const scratch = path.join(worktree, 'scratch');
  const evidence = path.join(root, 'evidence');
  await fs.mkdir(worktree);
  await fs.mkdir(scratch);
  await fs.mkdir(evidence);
  const plan = { worktree, roots: [{ kind: 'compiled', path: path.join(worktree, 'dist') }, { kind: 'scratch', path: scratch }] };
  return { root, worktree, scratch, evidence, plan };
}

function observation(overrides = {}) {
  return { filesystems: [{ id: '1', availableBytes: 40 * GiB }], compiledBytes: 0, generatedBytes: 0, evidenceParents: [], ...overrides };
}

test('production limits and exact prospective capacity/retention boundaries', () => {
  assert.equal(POLICY.reserveBytes, 30 * GiB);
  assert.equal(POLICY.peakBytes, 10 * GiB);
  assert.equal(POLICY.compiledBytes, 256 * MiB);
  assert.equal(POLICY.generatedBytes, 512 * MiB);
  assert.equal(POLICY.evidenceOrdinaryBytes + POLICY.evidenceClosureBytes, 128 * MiB);
  assert.equal(POLICY.artifactBytes, 32 * MiB);
  assert.equal(decideStorage(observation()).allowed, true);
  assert.equal(decideStorage(observation({ filesystems: [{ id: '1', availableBytes: 40 * GiB - 1 }] })).allowed, false);
  assert.equal(decideStorage(observation({ compiledBytes: 256 * MiB, generatedBytes: 512 * MiB })).allowed, true);
  for (const excess of [{ compiledBytes: 256 * MiB + 1 }, { generatedBytes: 512 * MiB + 1 }]) {
    assert.equal(decideStorage(observation(excess)).allowed, false);
  }
  const parent = { path: '/synthetic/evidence', bytes: 2 * GiB - 128 * MiB, runs: 15 };
  assert.equal(decideStorage(observation({ evidenceParents: [parent] })).allowed, true);
  for (const excess of [{ bytes: parent.bytes + 1 }, { runs: 16 }]) {
    assert.equal(decideStorage(observation({ evidenceParents: [{ ...parent, ...excess }] })).allowed, false);
  }
  assert.equal(decideStorage(observation({ evidenceParents: [{ ...parent, bytes: 2 * GiB, runs: 16 }] }), POLICY, { prospective: false }).allowed, true);
});

test('unknown measurements and separately insufficient filesystems refuse', () => {
  for (const availableBytes of [undefined, NaN, Infinity, -1, 1.1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => decideStorage(observation({ filesystems: [{ id: '1', availableBytes }] })), /invalid|Unknown/);
  }
  assert.throws(() => decideStorage(observation({ filesystems: [] })), /Unknown/);
  assert.throws(() => decideStorage(observation({ filesystems: [{ id: '1', availableBytes: 40 * GiB }, { id: '1', availableBytes: 40 * GiB }] })), /grouping/);
  assert.equal(decideStorage(observation({ filesystems: [{ id: '1', availableBytes: 80 * GiB }, { id: '2', availableBytes: 8 * GiB }] })).allowed, false);
});

test('nearest ancestor, identical roots, nested roots and hardlinks count once', async t => {
  const { plan, worktree } = await fixture(t);
  const dist = path.join(worktree, 'dist');
  const missing = await resolveDestination(path.join(dist, 'nested'));
  assert.equal(missing.ancestor, worktree);
  assert.equal(missing.exists, false);
  await fs.mkdir(dist);
  await fs.mkdir(path.join(dist, 'nested'));
  await fs.writeFile(path.join(dist, 'a'), 'one byte beyond nothing');
  const before = await inspectStorage(plan, { testContext });
  await fs.link(path.join(dist, 'a'), path.join(dist, 'nested', 'b'));
  const linked = await inspectStorage(plan, { testContext });
  const root = linked.roots.find(root => root.kind === 'compiled');
  const nested = { ...root, path: path.join(dist, 'nested') };
  assert.equal(await measureTrees([root, nested, root]), await measureTrees([root]));
  // Directory metadata can grow when a link is added; the file itself is still one identity.
  assert.ok(linked.compiledBytes - before.compiledBytes <= root.blockBytes);
  const aliases = await inspectStorage({ ...plan, roots: [...plan.roots, { kind: 'compiled', path: `${dist}/.` }, { kind: 'cache', path: dist }] }, { testContext });
  assert.equal(aliases.generatedBytes, aliases.compiledBytes);
  assert.equal(aliases.filesystems.length, 1);
  const native = await measureFilesystemNative(root);
  assert.ok(native.availableBytes > 0);
});

test('path traversal, symlinks, writable ownership, and ambiguous evidence overlap refuse', async t => {
  const { plan, worktree, evidence } = await fixture(t);
  await assert.rejects(resolveDestination(`${worktree}/../escape`), /traversal/);
  await fs.symlink(evidence, path.join(worktree, 'alias'));
  await assert.rejects(resolveDestination(path.join(worktree, 'alias', 'new')), /Unsafe/);
  await fs.chmod(evidence, 0o777);
  await assert.rejects(resolveDestination(evidence), /Writable|ownership/);
  await fs.chmod(evidence, 0o700);
  await assert.rejects(inspectStorage({ ...plan, roots: [{ kind: 'evidence', path: evidence }, { kind: 'scratch', path: evidence }] }), /disjoint/);
  await fs.mkdir(path.join(evidence, 'nested'));
  await assert.rejects(inspectStorage({ ...plan, roots: [{ kind: 'evidence', path: evidence }, { kind: 'evidence', path: path.join(evidence, 'nested') }] }), /Nested evidence/);
  await assert.rejects(inspectStorage({ ...plan, roots: [{ kind: 'evidence', path: path.join(evidence, 'missing') }] }), /absent/);
});

test('retained symlinks and directory identity changes fail closed', async t => {
  const { plan, worktree, evidence } = await fixture(t);
  const dist = path.join(worktree, 'dist');
  await fs.mkdir(dist);
  const before = await inspectStorage(plan, { testContext });
  await fs.rename(dist, `${dist}-old`);
  await fs.mkdir(dist);
  await assert.rejects(inspectStorage(plan, { testContext, previous: before }), /identity|mount/);
  await fs.symlink(evidence, path.join(dist, 'unsafe'));
  await assert.rejects(inspectStorage(plan, { testContext }), /Unsafe retained/);
});

test('filesystem unknowns and changed mount measurements refuse before callback', async t => {
  const { plan } = await fixture(t);
  for (const measured of [undefined, { id: 'wrong', type: 'fixture', blockBytes: 4096, availableBytes: 100 * MiB }]) {
    const context = createTestContext({ policy, measureFilesystem: async () => measured });
    await assert.rejects(withStorageInvocation(plan, () => assert.fail('must not start'), { testContext: context }), /filesystem/i);
  }
  let calls = 0;
  const context = createTestContext({ policy, measureFilesystem: async root => ({ id: root.dev, type: ++calls <= 2 ? 'before' : 'after', blockBytes: 4096, availableBytes: 100 * MiB }) });
  await assert.rejects(withStorageInvocation(plan, () => assert.fail('mount changed'), { testContext: context }), /identity changed/);
});

test('low disk refusal creates no locks, scratch or producer effects', async t => {
  const { plan, worktree, scratch } = await fixture(t);
  const context = createTestContext({ measureFilesystem: async root => ({ id: root.dev, type: 'fixture', blockBytes: 4096, availableBytes: 8 * GiB }) });
  const before = await fs.readdir(worktree);
  await assert.rejects(withStorageInvocation(plan, () => assert.fail('producer started'), { testContext: context }), /Storage refused/);
  assert.deepEqual(await fs.readdir(worktree), before);
  assert.deepEqual(await fs.readdir(scratch), []);
  await assert.rejects(inspectStorage(plan, { testContext: { fixture: true } }), /Invalid test/);
});

test('all existing evidence directories count, including failed and incomplete runs', async t => {
  const { plan, evidence } = await fixture(t);
  for (let i = 0; i < 16; i++) await fs.mkdir(path.join(evidence, `incomplete-${i}`));
  const expanded = { ...plan, roots: [...plan.roots, { kind: 'evidence', path: evidence }] };
  const snapshot = await inspectStorage(expanded, { testContext });
  assert.equal(snapshot.evidenceParents[0].runs, 16);
  await assert.rejects(withStorageInvocation(expanded, () => assert.fail('count exceeded'), { testContext }), /run limit/);
  assert.equal((await fs.readdir(evidence)).length, 16);
});

test('success and failure preserve evidence before exact owned scratch cleanup', async t => {
  for (const exit of [0, 7]) {
    const { plan, scratch, evidence, worktree } = await fixture(t);
    const historical = path.join(scratch, 'historical');
    await fs.mkdir(historical);
    await fs.writeFile(path.join(historical, 'keep'), 'keep');
    let owned;
    const result = await withStorageInvocation(plan, async context => {
      owned = await context.scratch(scratch);
      await fs.writeFile(path.join(owned, 'report'), 'bounded evidence');
      return context.launch(producer(`process.exit(${exit})`));
    }, { testContext, preserveEvidence: async () => {
      assert.equal(await fs.readFile(path.join(owned, 'report'), 'utf8'), 'bounded evidence');
      await fs.copyFile(path.join(owned, 'report'), path.join(evidence, 'kept'));
    } });
    assert.equal(result.code, exit);
    assert.equal(result.signal, null);
    assert.deepEqual(result.diagnostics, []);
    await assert.rejects(fs.stat(owned), { code: 'ENOENT' });
    await assert.rejects(fs.stat(path.join(worktree, LOCK_NAME)), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(historical, 'keep'), 'utf8'), 'keep');
    assert.equal(await fs.readFile(path.join(evidence, 'kept'), 'utf8'), 'bounded evidence');
  }
});

test('failed evidence preservation retains exact scratch and original child outcomes', async t => {
  for (const [script, code, signal] of [
    ['process.exit(9)', 9, null],
    ["process.kill(process.pid, 'SIGTERM')", null, 'SIGTERM'],
    ['process.exit(0)', 1, null],
  ]) {
    const { plan, scratch, worktree, evidence } = await fixture(t);
    plan.roots.push({ kind: 'evidence', path: evidence });
    let owned;
    const bytes = Buffer.from('unique required evidence\0\xff', 'latin1');
    const result = await withStorageInvocation(plan, async context => {
      owned = await context.scratch(scratch);
      await fs.writeFile(path.join(owned, 'required'), bytes);
      return context.launch(producer(script));
    }, { testContext, preserveEvidence: async (_result, paths) => {
      assert.deepEqual(paths, [owned]);
      assert.deepEqual(await fs.readFile(path.join(owned, 'required')), bytes);
      throw new Error('evidence fault');
    } });
    assert.equal(result.code, code);
    assert.equal(result.signal, signal);
    assert.match(result.diagnostics.join(), /Evidence preservation failed: evidence fault/);
    assert.deepEqual(await fs.readFile(path.join(owned, 'required')), bytes);
    assert.ok(result.diagnostics.some(message => message.includes(owned)));
    for (const root of [worktree, evidence]) {
      await assert.rejects(fs.stat(path.join(root, LOCK_NAME)), { code: 'ENOENT' });
    }
    let next;
    const subsequent = await withStorageInvocation(plan, async context => {
      next = await context.scratch(scratch);
      return ok();
    }, { testContext, preserveEvidence: () => {} });
    assert.equal(subsequent.code, 0);
    await assert.rejects(fs.stat(next), { code: 'ENOENT' });
    assert.deepEqual(await fs.readFile(path.join(owned, 'required')), bytes);
  }
});

test('nested preservation failure holds containing scratch but cleans unrelated scratch', async t => {
  const { plan, scratch, worktree } = await fixture(t);
  let outer, nested, unrelated, sibling;
  const result = await withStorageInvocation(plan, async parent => {
    outer = await parent.scratch(scratch);
    unrelated = await parent.scratch(scratch);
    const childPlan = { worktree, roots: [{ kind: 'scratch', path: outer }] };
    await withStorageInvocation(childPlan, async child => {
      nested = await child.scratch(outer);
      await fs.writeFile(path.join(nested, 'required'), 'nested evidence');
      return { code: 7, signal: null, diagnostics: [] };
    }, { parent, allowanceBytes: MiB, preserveEvidence: () => { throw new Error('nested evidence fault'); } });
    await withStorageInvocation(childPlan, async child => {
      sibling = await child.scratch(outer);
      return ok();
    }, { parent, allowanceBytes: MiB, preserveEvidence: () => {} });
    return ok();
  }, { testContext, preserveEvidence: () => {} });
  assert.equal(result.code, 7);
  assert.match(result.diagnostics.join(), /nested evidence fault/);
  assert.deepEqual(await fs.readdir(outer), [path.basename(nested)]);
  assert.equal(await fs.readFile(path.join(nested, 'required'), 'utf8'), 'nested evidence');
  for (const removed of [unrelated, sibling, path.join(worktree, LOCK_NAME)]) {
    await assert.rejects(fs.stat(removed), { code: 'ENOENT' });
  }
});

test('callback failures without preservation failure still clean scratch', async t => {
  const { plan, scratch } = await fixture(t);
  let owned;
  const failed = await withStorageInvocation(plan, async context => {
    owned = await context.scratch(scratch);
    throw new Error('callback fault');
  }, { testContext });
  assert.equal(failed.code, 1);
  await assert.rejects(fs.stat(owned), { code: 'ENOENT' });
});

test('unsafe scratch and changed lock ownership are preserved without masking child failure', async t => {
  const { plan, scratch, worktree, evidence } = await fixture(t);
  let owned;
  const result = await withStorageInvocation(plan, async context => {
    owned = await context.scratch(scratch);
    await fs.symlink(evidence, path.join(owned, 'foreign'));
    await fs.writeFile(path.join(worktree, LOCK_NAME), 'changed-owner');
    return { code: 8, signal: null, diagnostics: [] };
  }, { testContext });
  assert.equal(result.code, 8);
  assert.match(result.diagnostics.join(), /Cleanup failed/);
  assert.match(result.diagnostics.join(), /Lock ownership changed/);
  assert.equal(await fs.readFile(path.join(worktree, LOCK_NAME), 'utf8'), 'changed-owner');
  assert.equal((await fs.lstat(path.join(owned, 'foreign'))).isSymbolicLink(), true);
});

test('stale, malformed and live locks time out without eviction', async t => {
  for (const owner of ['unreadable metadata', JSON.stringify({ nonce: 'stale', pid: 2147483647 }), JSON.stringify({ nonce: 'live', pid: process.pid })]) {
    const { plan, worktree } = await fixture(t);
    const lock = path.join(worktree, LOCK_NAME);
    await fs.writeFile(lock, owner, { mode: 0o600 });
    const start = performance.now();
    await assert.rejects(withStorageInvocation(plan, () => assert.fail('contended'), { testContext }), /Lock deadline/);
    assert.ok(performance.now() - start < 2000);
    assert.equal(await fs.readFile(lock, 'utf8'), owner);
  }
});

test('shared evidence lock contention releases only the losing invocation worktree lock', async t => {
  const one = await fixture(t);
  const two = await fixture(t);
  const firstPlan = { ...one.plan, roots: [...one.plan.roots, { kind: 'evidence', path: one.evidence }] };
  const nextPlan = { ...two.plan, roots: [...two.plan.roots, { kind: 'evidence', path: one.evidence }] };
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  const first = withStorageInvocation(firstPlan, async () => { entered(); await waiting; return ok(); }, { testContext });
  await ready;
  const metadata = await fs.readFile(path.join(one.evidence, LOCK_NAME), 'utf8');
  try {
    await assert.rejects(withStorageInvocation(nextPlan, () => assert.fail('shared parent'), { testContext }), /Lock deadline/);
    assert.equal(await fs.readFile(path.join(one.evidence, LOCK_NAME), 'utf8'), metadata);
    await assert.rejects(fs.stat(path.join(two.worktree, LOCK_NAME)), { code: 'ENOENT' });
  } finally { finish(); }
  assert.equal((await first).code, 0);
});

test('live nested invocation reuses locks and limits its scope and remaining allowance', async t => {
  const { plan, worktree } = await fixture(t);
  let captured;
  const result = await withStorageInvocation(plan, async parent => {
    captured = parent;
    const lock = await fs.readFile(path.join(worktree, LOCK_NAME), 'utf8');
    const nested = await withStorageInvocation(plan, async child => {
      assert.equal(await fs.readFile(path.join(worktree, LOCK_NAME), 'utf8'), lock);
      return child.launch(producer());
    }, { parent, allowanceBytes: MiB });
    assert.equal(nested.code, 0);
    await assert.rejects(withStorageInvocation(plan, () => assert.fail('exhausted'), { parent, allowanceBytes: 2 * MiB }), /Remaining/);
    const escaped = { ...plan, roots: [{ kind: 'scratch', path: path.join(worktree, 'undeclared') }] };
    await assert.rejects(withStorageInvocation(escaped, () => assert.fail('escaped'), { parent, allowanceBytes: 1 }), /scope/);
    return ok();
  }, { testContext });
  // A deliberately rejected last nested operation is also observed by finalization.
  assert.equal(result.code, 1);
  assert.throws(() => withStorageInvocation(plan, ok, { parent: captured, allowanceBytes: 1 }), /expired/);
  for (const fake of [{}, JSON.parse(JSON.stringify(captured)), 'environment-token']) {
    assert.throws(() => withStorageInvocation(plan, ok, { parent: fake, allowanceBytes: 1 }), /Invalid/);
  }
});

test('unawaited producer is drained and its failure is retained before cleanup', async t => {
  const { plan, scratch } = await fixture(t);
  let owned;
  const result = await withStorageInvocation(plan, async context => {
    owned = await context.scratch(scratch);
    context.launch(producer('setTimeout(() => process.exit(6), 40)'));
    return ok();
  }, { testContext });
  assert.equal(result.code, 6);
  await assert.rejects(fs.stat(owned), { code: 'ENOENT' });
});

test('later successful work cannot erase a producer failure or a refused operation', async t => {
  const { plan } = await fixture(t);
  const result = await withStorageInvocation(plan, async context => {
    await context.launch(producer('process.exit(12)'));
    await context.launch(producer());
    return ok();
  }, { testContext });
  assert.equal(result.code, 12);
  const refused = await withStorageInvocation(plan, async context => {
    await assert.rejects(context.launch({ ...producer(), bytes: 3 * MiB }), /Remaining/);
    await context.launch(producer());
    return ok();
  }, { testContext });
  assert.equal(refused.code, 1);
  assert.match(refused.diagnostics.join(), /Remaining/);
});

test('capacity is remeasured immediately before launch and after preservation', async t => {
  const { plan, worktree } = await fixture(t);
  let availableBytes = 100 * MiB;
  const context = createTestContext({ policy, measureFilesystem: async root => ({ id: root.dev, type: 'fixture', blockBytes: 4096, availableBytes }) });
  const marker = path.join(worktree, 'must-not-exist');
  const result = await withStorageInvocation(plan, async invocation => {
    availableBytes = 64 * MiB;
    return invocation.launch(producer(`require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`));
  }, { testContext: context });
  assert.equal(result.code, 1);
  await assert.rejects(fs.stat(marker), { code: 'ENOENT' });
  availableBytes = 100 * MiB;
  const final = await withStorageInvocation(plan, ok, { testContext: context, preserveEvidence: () => { availableBytes = 1; } });
  assert.equal(final.code, 1);
  assert.match(final.diagnostics.join(), /Storage refused/);
});

test('caller mutation cannot change the declaration after lock planning', async t => {
  const { plan, evidence } = await fixture(t);
  const context = createTestContext({ policy, measureFilesystem: async root => {
    if (plan.roots.length === 2) plan.roots.push({ kind: 'evidence', path: evidence });
    return measureFilesystemNative(root);
  } });
  const result = await withStorageInvocation(plan, async () => {
    await assert.rejects(fs.stat(path.join(evidence, LOCK_NAME)), { code: 'ENOENT' });
    return ok();
  }, { testContext: context });
  assert.equal(result.code, 0);
});

test('one total deadline covers all locks and cancellation preserves another owner', async t => {
  const { plan, evidence, worktree } = await fixture(t);
  const firstLock = path.join(evidence, LOCK_NAME);
  const finalLock = path.join(worktree, LOCK_NAME);
  await fs.writeFile(firstLock, 'fixture-owner', { mode: 0o600 });
  await fs.writeFile(finalLock, 'other-owner', { mode: 0o600 });
  const timer = setTimeout(() => fs.unlink(firstLock), 65);
  const start = performance.now();
  try {
    await assert.rejects(withStorageInvocation({ ...plan, roots: [...plan.roots, { kind: 'evidence', path: evidence }] }, ok, { testContext }), /Lock deadline/);
  } finally { clearTimeout(timer); }
  assert.ok(performance.now() - start < 155, 'the second lock must not get a fresh timeout');
  await assert.rejects(fs.stat(firstLock), { code: 'ENOENT' });
  assert.equal(await fs.readFile(finalLock, 'utf8'), 'other-owner');
  const controller = new AbortController();
  const cancel = setTimeout(() => controller.abort(), 20);
  const result = await withStorageInvocation(plan, () => assert.fail('cancelled before producer'), { testContext, signal: controller.signal });
  clearTimeout(cancel);
  assert.equal(result.signal, 'SIGTERM');
  assert.equal(await fs.readFile(finalLock, 'utf8'), 'other-owner');
});

test('spawn errors, child signals and cancellation retain outcomes and clean scratch', async t => {
  const { plan, scratch, worktree } = await fixture(t);
  const missing = await withStorageInvocation(plan, context => context.launch({ ...producer(), command: path.join(worktree, 'missing') }), { testContext });
  assert.notEqual(missing.code, 0);
  const signalled = await withStorageInvocation(plan, context => context.launch(producer("process.kill(process.pid, 'SIGTERM')")), { testContext });
  assert.equal(signalled.signal, 'SIGTERM');
  const controller = new AbortController();
  let owned;
  const cancelled = await withStorageInvocation(plan, async context => {
    owned = await context.scratch(scratch);
    const timer = setTimeout(() => controller.abort(), 80);
    try { return await context.launch(producer('setInterval(() => {}, 1000)')); }
    finally { clearTimeout(timer); }
  }, { testContext, signal: controller.signal });
  assert.equal(cancelled.signal, 'SIGTERM');
  await assert.rejects(fs.stat(owned), { code: 'ENOENT' });
  await assert.rejects(fs.stat(path.join(worktree, LOCK_NAME)), { code: 'ENOENT' });
});

test('periodic capacity breach stops the owned producer and remains nonzero', async t => {
  const { plan } = await fixture(t);
  let availableBytes = 100 * MiB;
  const context = createTestContext({ policy, measureFilesystem: async root => ({ id: root.dev, type: 'fixture', blockBytes: 4096, availableBytes }) });
  const result = await withStorageInvocation(plan, async invocation => {
    const timer = setTimeout(() => { availableBytes = 1; }, 60);
    try { return await invocation.launch({ ...producer('setInterval(() => {}, 1000)'), monitorMs: 10 }); }
    finally { clearTimeout(timer); }
  }, { testContext: context });
  assert.equal(result.signal, 'SIGTERM');
  assert.match(result.diagnostics.join(), /Storage refused/);
});

test('actual launcher process forwards SIGINT and cleans before its caller propagates the signal', async t => {
  const { plan, scratch, worktree } = await fixture(t);
  const launcher = fileURLToPath(new URL('../launcher.mjs', import.meta.url));
  const admission = fileURLToPath(new URL('../admission.mjs', import.meta.url));
  const script = `
    import { withStorageInvocation } from ${JSON.stringify(launcher)};
    import { createTestContext } from ${JSON.stringify(admission)};
    const result = await withStorageInvocation(${JSON.stringify(plan)}, async context => {
      await context.scratch(${JSON.stringify(scratch)});
      process.send('ready');
      return context.launch({ command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], bytes: ${MiB}, stdio: 'ignore' });
    }, { testContext: createTestContext({ policy: ${JSON.stringify(policy)} }) });
    if (result.signal) process.kill(process.pid, result.signal);
    else process.exitCode = result.code;
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); });
  await new Promise(resolve => setTimeout(resolve, 60));
  child.kill('SIGINT');
  assert.equal((await closed).signal, 'SIGINT');
  assert.deepEqual(await fs.readdir(scratch), []);
  await assert.rejects(fs.stat(path.join(worktree, LOCK_NAME)), { code: 'ENOENT' });
});
