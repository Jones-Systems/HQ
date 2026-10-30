import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { it, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { nodeFs } from '../../../../../packages/design-store/src/fs.ts';
import { openFileStore } from '../../../../../packages/design-store/src/open.ts';
import { openEnabledCandidateStorage, openEnabledDesignStorage } from '../enabled-candidate.ts';
import { bindDesignStorage, openDesignStorage } from '../node.ts';
import { TransactionGate } from '../transaction-gate.ts';
import { TRANSACTION_STATUS } from '../transactions.ts';
import { makeDir, proveCleanup, removeDir } from './helpers.ts';

proveCleanup();
const disabled = { ok: false, kind: 'unavailable', reason: 'disabled' };
const exportedAt = '2026-01-01T00:00:00Z';
function scratch(t: TestContext) {
  const dir = makeDir(), resources: { close(): Promise<void> }[] = [];
  t.after(async () => {
    try { for (const resource of resources.reverse()) await resource.close(); }
    finally { removeDir(dir); }
  });
  return { dir, own<T extends { close(): Promise<void> }>(resource: T): T { resources.push(resource); return resource; } };
}

it('uses one initialized runtime gate and one writer lock, with the same gated workspace and cache store', async t => {
  const { dir, own } = scratch(t);
  const exclusive = t.mock.method(TransactionGate.prototype, 'exclusive');
  const shared = t.mock.method(TransactionGate.prototype, 'shared');
  let locks = 0;
  const root = join(dir, 'store');
  const candidate = own(await openEnabledCandidateStorage({ root, fs: {
    ...nodeFs,
    async link(from, to) { if (to === join(root, 'LOCK')) locks++; await nodeFs.link(from, to); },
  } }));
  assert.equal(locks, 1);
  assert.equal(exclusive.mock.callCount(), 1, 'initialize enters the sole runtime gate once');
  assert.equal(candidate.workspace, candidate.transactions.workspace);
  assert.deepEqual(await candidate.workspace.getDocument('design/projects/one'), null);
  const committed = await candidate.transactions.commit([{ op: 'put-document', namespace: 'workspace', key: 'design/projects/one', value: { candidate: true }, expectedRevision: null }]);
  assert.ok(committed.ok);
  assert.ok((await candidate.transactions.recover()).ok);
  assert.deepEqual((await candidate.workspace.getDocument('design/projects/one'))?.value, { candidate: true });
  const gates = [...exclusive.mock.calls, ...shared.mock.calls].map(call => call.this);
  assert.ok(gates.length > 1);
  assert.equal(new Set(gates).size, 1, 'initialize, commit, recovery and participating reads share one gate');
  await candidate.cache.putDocument('design.discovery.catalog', { sameStore: true });
  await candidate.close();
  const reopened = own(await openEnabledCandidateStorage({ root }));
  assert.deepEqual((await reopened.cache.getDocument('design.discovery.catalog'))?.value, { sameStore: true });
  assert.deepEqual((await reopened.workspace.getDocument('design/projects/one'))?.value, { candidate: true });
});

it('refuses a second construction on the same root through the T9 writer lock', async t => {
  const { dir, own } = scratch(t);
  const root = join(dir, 'store'), candidate = own(await openEnabledCandidateStorage({ root }));
  assert.equal(candidate.transactions.status.state, 'candidate');
  await assert.rejects(async () => {
    const unexpected = await openEnabledCandidateStorage({ root });
    await unexpected.close();
  }, { code: 'locked' });
});

it('advertises only candidate Imports routes while preview and build remain disabled', async t => {
  const { dir, own } = scratch(t);
  const candidate = own(await openEnabledCandidateStorage({ root: join(dir, 'store') }));
  assert.deepEqual(candidate.transactions.status, { accepted: true, state: 'candidate' });
  assert.equal(Object.isFrozen(candidate.transactions.status), true);
  assert.equal(candidate.exportBundle.status.state, 'disabled');
  assert.deepEqual(await candidate.exportBundle.preview(exportedAt), disabled);
  assert.deepEqual(await candidate.exportBundle.build(exportedAt), disabled);
});

it('keeps both production constructors on the unchanged disabled transaction status', async t => {
  const { dir, own } = scratch(t);
  const opened = own(await openDesignStorage({ root: join(dir, 'opened') }));
  const { store } = await openFileStore({ root: join(dir, 'bound'), schemaVersion: 1 });
  own(store);
  const bound = await bindDesignStorage(store);
  for (const production of [opened, bound]) {
    assert.equal(production.transactions.status, TRANSACTION_STATUS);
    assert.deepEqual(production.transactions.status, { accepted: false, state: 'disabled' });
    assert.deepEqual(await production.transactions.commit([]), disabled);
    assert.deepEqual(await production.transactions.recover(), disabled);
    assert.deepEqual(await production.transactions.repair('a'.repeat(64)), disabled);
    assert.deepEqual(await production.exportBundle.preview(exportedAt), disabled);
    assert.deepEqual(await production.exportBundle.build(exportedAt), disabled);
  }
});

it('uses the same single-store gated construction for explicit enabled status, with export OFF', async t => {
  const { dir, own } = scratch(t);
  const exclusive = t.mock.method(TransactionGate.prototype, 'exclusive');
  const shared = t.mock.method(TransactionGate.prototype, 'shared');
  const root = join(dir, 'store');
  let locks = 0;
  const enabled = own(await openEnabledDesignStorage({ root, fs: {
    ...nodeFs,
    async link(from, to) { if (to === join(root, 'LOCK')) locks++; await nodeFs.link(from, to); },
  } }));
  assert.equal(locks, 1);
  assert.equal(exclusive.mock.callCount(), 1, 'initialize enters the sole runtime gate once');
  assert.deepEqual(enabled.transactions.status, { accepted: true, state: 'enabled' });
  assert.equal(Object.isFrozen(enabled.transactions.status), true);
  assert.equal(enabled.workspace, enabled.transactions.workspace);
  assert.ok((await enabled.transactions.commit([{ op: 'put-document', namespace: 'workspace', key: 'design/projects/enabled', value: { enabled: true }, expectedRevision: null }])).ok);
  assert.ok((await enabled.transactions.recover()).ok);
  assert.deepEqual((await enabled.workspace.getDocument('design/projects/enabled'))?.value, { enabled: true });
  const gates = [...exclusive.mock.calls, ...shared.mock.calls].map(call => call.this);
  assert.ok(gates.length > 1);
  assert.equal(new Set(gates).size, 1, 'initialize, commit, recovery and reads share one gate');
  await assert.rejects(async () => {
    const unexpected = await openEnabledDesignStorage({ root });
    await unexpected.close();
  }, { code: 'locked' });
  assert.equal(enabled.exportBundle.status.state, 'disabled');
  assert.deepEqual(await enabled.exportBundle.preview(exportedAt), disabled);
  assert.deepEqual(await enabled.exportBundle.build(exportedAt), disabled);
  await enabled.cache.putDocument('design.discovery.catalog', { sameStore: true });
  await enabled.close();
  const reopened = own(await openEnabledDesignStorage({ root }));
  assert.deepEqual((await reopened.cache.getDocument('design.discovery.catalog'))?.value, { sameStore: true });
  assert.deepEqual((await reopened.workspace.getDocument('design/projects/enabled'))?.value, { enabled: true });
});

it('allows only the explicit emitted host, type-only compatibility and compiler-file edges', () => {
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
  const violations: string[] = [];
  const allowed = new Map<string, RegExp>([
    ['apps/desktop/electron/design-host.ts', /^new URL\('\.\/design-host\/modules\/design\/app\/storage\/enabled-candidate\.js', import\.meta\.url\)$/u],
    ['apps/desktop/design-host/compat.ts', /^import type \{ openEnabledDesignStorage \} from '\.\.\/\.\.\/\.\.\/modules\/design\/app\/storage\/enabled-candidate\.ts'/u],
  ]);
  const seen = new Map<string, number>();
  function forbidden(path: string, source: string): boolean {
    const edges = /\b(?:import|export)\s+(?:[^;'"]*?\bfrom\s*)?['"]([^'"]+)['"]|\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]|\bnew URL\(\s*['"]([^'"]+)['"],\s*import\.meta\.url\s*\)/gu;
    let invalid = false;
    for (const edge of source.matchAll(edges)) {
      if (!/(?:^|\/)enabled-candidate(?:\.[cm]?[jt]s)?$/u.test(edge[1] ?? edge[2] ?? edge[3] ?? '')) continue;
      seen.set(path, (seen.get(path) ?? 0) + 1);
      if (!allowed.get(path)?.test(edge[0])) invalid = true;
    }
    return invalid;
  }
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'test', 'tests', '__tests__', '.git'].includes(entry.name)) visit(path);
      } else if (/\.[cm]?[jt]sx?$/u.test(entry.name) && !/\.(?:test|spec)\./u.test(entry.name)) {
        const source = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
        if (forbidden(relative(repo, path), source)) violations.push(relative(repo, path));
      }
    }
  };
  visit(join(repo, 'modules'));
  visit(join(repo, 'apps'));
  assert.deepEqual(violations, []);
  for (const path of allowed.keys()) assert.equal(seen.get(path), 1, `inspect the sole allowed edge in ${path}`);
  const config = JSON.parse(readFileSync(join(repo, 'apps/desktop/tsconfig.design-host.json'), 'utf8'));
  assert.equal(config.files.filter((path: string) => path === '../../modules/design/app/storage/enabled-candidate.ts').length, 1);
  assert.equal(JSON.stringify(config).match(/enabled-candidate/gu)?.length, 1, 'only the files entry may name the enabled construction');
  for (const path of ['modules/design/app/storage/node.ts', 'modules/design/app/index.ts', 'apps/desktop/src/ImportsView.tsx', 'modules/design/other.ts']) {
    for (const edge of ["export * from './enabled-candidate.ts';", "import { openEnabledDesignStorage } from './enabled-candidate.ts';", "import('./enabled-candidate.js')", "require('./enabled-candidate.js')"]) {
      assert.equal(forbidden(path, edge), true, `reject ${edge} in ${path}`);
    }
  }
  assert.equal(forbidden('apps/desktop/design-host/compat.ts', "import { openEnabledDesignStorage } from '../../../modules/design/app/storage/enabled-candidate.ts';"), true, 'compatibility may never import the runtime');
  assert.equal(forbidden('apps/desktop/electron/design-host.ts', "export * from './design-host/modules/design/app/storage/enabled-candidate.js';"), true, 'the host may not re-export the runtime');
});
